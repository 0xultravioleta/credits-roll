import { randomUUID } from 'node:crypto';
import type { ChatMessage, Moment, TranscriptWindow } from './domain.js';
import type { AudioChunk, Transcriber } from './ai/interfaces.js';
import { Matcher, LOOKBACK_MS } from './matcher/index.js';
import { Scoring } from './scoring/index.js';
import { Store } from './store/index.js';
import { OverlayHub } from './events/hub.js';

export class Pipeline {
  private chat: ChatMessage[] = [];
  private readonly timer: ReturnType<typeof setInterval>;
  private pending = Promise.resolve();
  private closed = false;

  constructor(
    private readonly options: {
      store: Store;
      matcher: Matcher;
      scoring: Scoring;
      hub: OverlayHub;
      transcriber: Transcriber;
      now?: () => number;
      onTranscript?: (window: TranscriptWindow) => void;
    },
  ) {
    this.timer = setInterval(() => this.prune(), 15_000);
    this.timer.unref();
  }

  addChat(message: ChatMessage): void {
    if (this.closed) return;
    if (/^!optout(?:\s|$)/i.test(message.text.trim())) {
      this.options.store.optOut(message.viewer.id);
      this.chat = this.chat.filter((row) => row.viewer.id !== message.viewer.id);
      this.options.hub.forgetViewer(message.viewer.id);
      return;
    }
    this.prune();
    if (
      this.options.store.isOptedOut(message.viewer.id) ||
      !Number.isFinite(message.sentAt) ||
      message.sentAt < this.now() - LOOKBACK_MS ||
      message.sentAt > this.now() + 1000 ||
      message.text.length > 500 ||
      this.chat.some((row) => row.id === message.id)
    )
      return;
    this.chat.push(message);
    if (this.chat.length > 5000) this.chat.shift();
  }

  processWindow(window: TranscriptWindow): Promise<Moment[]> {
    const result = this.pending.then(async () => {
      if (this.closed) return [];
      this.options.onTranscript?.(window);
      this.prune();
      const matches = await this.options.matcher.match(
        window,
        this.chat.filter((message) => !this.options.store.isOptedOut(message.viewer.id)),
      );
      if (this.closed) return [];
      const moments: Moment[] = [];
      for (const match of matches) {
        const moment: Moment = {
          ...match,
          id: randomUUID(),
          streamId: window.streamId,
          occurredAt: window.endAt,
        };
        // A viewer can opt out while the provider request is in flight. Recheck on write.
        if (this.options.scoring.credit(moment)) {
          moments.push(moment);
          this.options.hub.publishMoment(moment);
        }
      }
      return moments;
    });
    this.pending = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  async processAudioWindow(
    window: Omit<TranscriptWindow, 'text'>,
    chunk: AudioChunk,
  ): Promise<Moment[]> {
    if (this.closed) return [];
    const text = await this.options.transcriber.transcribe(chunk);
    return this.processWindow({ ...window, text });
  }

  close(): void {
    this.closed = true;
    clearInterval(this.timer);
    this.chat = [];
  }

  private now(): number {
    return (this.options.now ?? Date.now)();
  }
  private prune(): void {
    this.chat = this.chat.filter((message) => message.sentAt >= this.now() - LOOKBACK_MS);
  }
}
