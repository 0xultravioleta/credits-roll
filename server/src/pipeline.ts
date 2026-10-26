import { randomUUID } from 'node:crypto';
import type { ChatMessage, Moment, TranscriptWindow } from './domain.js';
import type { AudioChunk, Transcriber } from './ai/interfaces.js';
import { Matcher, LOOKBACK_MS } from './matcher/index.js';
import { Scoring, scoreMoment } from './scoring/index.js';
import { adoptionExcerpt } from './matcher/excerpt.js';
import { Store } from './store/index.js';
import { quoteText } from './ledger/index.js';
import { OverlayHub } from './events/hub.js';

export class Pipeline {
  private chat: ChatMessage[] = [];
  private readonly timer: ReturnType<typeof setInterval>;
  private pending = Promise.resolve();
  private closed = false;
  private generation = 0;

  constructor(
    private readonly options: {
      store: Store;
      matcher: Matcher;
      scoring: Scoring;
      hub: OverlayHub;
      transcriber: Transcriber;
      now?: () => number;
      onTranscript?: (window: TranscriptWindow) => void;
      onChat?: (message: ChatMessage) => void;
      onPrivacy?: (
        viewerId: string,
        command: 'optout' | 'forgetme',
        messageId: string,
      ) => void | Promise<void>;
    },
  ) {
    this.timer = setInterval(() => this.prune(), 15_000);
    this.timer.unref();
  }

  addChat(message: ChatMessage): void {
    if (this.closed) return;
    const privacy = /^!(optout|forgetme)(?:\s|$)/i.exec(message.text.trim());
    if (privacy) {
      this.options.store.optOut(message.viewer.id);
      this.chat = this.chat.filter((row) => row.viewer.id !== message.viewer.id);
      this.options.hub.forgetViewer(message.viewer.id);
      void Promise.resolve()
        .then(() =>
          this.options.onPrivacy?.(
            message.viewer.id,
            privacy[1]!.toLowerCase() as 'optout' | 'forgetme',
            message.id,
          ),
        )
        .catch(() => undefined);
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
    this.options.onChat?.(message);
    if (this.chat.length > 5000) this.chat.shift();
  }

  processWindow(window: TranscriptWindow): Promise<Moment[]> {
    const generation = this.generation;
    const result = this.pending.then(async () => {
      if (this.closed || generation !== this.generation) return [];
      this.options.onTranscript?.(window);
      this.prune();
      const matches = await this.options.matcher.match(
        window,
        this.chat.filter((message) => !this.options.store.isOptedOut(message.viewer.id)),
      );
      if (this.closed || generation !== this.generation) return [];
      const moments: Moment[] = [];
      for (const match of matches) {
        const moment: Moment = {
          ...match,
          quote: quoteText(match.quote),
          id: randomUUID(),
          streamId: window.streamId,
          occurredAt: window.endAt,
          adoptionExcerpt: adoptionExcerpt(window.text, match.quote),
          pointsEarned: scoreMoment(match),
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
  clearChat(): void {
    this.generation += 1;
    this.chat = [];
  }

  private now(): number {
    return (this.options.now ?? Date.now)();
  }
  private prune(): void {
    this.chat = this.chat.filter((message) => message.sentAt >= this.now() - LOOKBACK_MS);
  }
}
