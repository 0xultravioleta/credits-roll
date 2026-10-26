import { randomUUID } from 'node:crypto';
import type { ChatMessage, Moment, TranscriptWindow } from './domain.js';
import type { AudioChunk, Transcriber } from './ai/interfaces.js';
import { Matcher, LOOKBACK_MS } from './matcher/index.js';
import { Scoring, scoreMoment } from './scoring/index.js';
import { adoptionExcerpt } from './matcher/excerpt.js';
import { Store } from './store/index.js';
import { quoteText } from './ledger/index.js';
import { OverlayHub } from './events/hub.js';
import { BotFilter } from './twitch/bot-filter.js';
import type { DebugLog, ChatDecision } from './debug/log.js';
import { isInstructionAttack } from './matcher/judge.js';
import { MATCH_RULES } from './matcher/rules.js';
import { abortableDelay } from './runtime/time.js';

export class Pipeline {
  private chat: ChatMessage[] = [];
  private readonly timer: ReturnType<typeof setInterval>;
  private pending = Promise.resolve();
  private closed = false;
  private generation = 0;
  private readonly botFilter: BotFilter;
  private windowController = new AbortController();

  constructor(
    private readonly options: {
      store: Store;
      matcher: Matcher;
      scoring: Scoring;
      hub: OverlayHub;
      transcriber: Transcriber;
      now?: () => number;
      botFilter?: BotFilter;
      debug?: DebugLog;
      lookbackSeconds?: () => number;
      allowAfterReply?: () => boolean;
      onTranscript?: (window: TranscriptWindow) => void;
      onChat?: (message: ChatMessage) => void;
      onPrivacy?: (
        viewerId: string,
        command: 'optout' | 'forgetme',
        messageId: string,
      ) => void | Promise<void>;
    },
  ) {
    this.botFilter = options.botFilter ?? new BotFilter();
    this.timer = setInterval(() => this.prune(), 15_000);
    this.timer.unref();
  }

  addChat(message: ChatMessage): void {
    if (this.closed) return;
    const privacy = /^!(optout|forgetme)(?:\s|$)/i.exec(message.text.trim());
    if (privacy) {
      try {
        this.options.store.optOut(message.viewer.id);
      } finally {
        this.chat = this.chat.filter((row) => row.viewer.id !== message.viewer.id);
        this.options.hub.forgetViewer(message.viewer.id);
      }
      void Promise.resolve()
        .then(async () => {
          if (this.options.debug) await this.options.debug.flush();
          await this.options.onPrivacy?.(
            message.viewer.id,
            privacy[1]!.toLowerCase() as 'optout' | 'forgetme',
            message.id,
          );
        })
        .catch(() => undefined);
      return;
    }
    if (this.botFilter.ignores(message)) {
      this.options.debug?.chat(message, 'ignored-bot');
      return;
    }
    this.prune();
    const decision: ChatDecision =
      message.text.trim().startsWith('!') || isInstructionAttack(message.text)
        ? 'command'
        : message.text.length > 500
          ? 'too-long'
          : this.chat.some(
                (row) =>
                  row.id === message.id ||
                  (row.viewer.id !== message.viewer.id &&
                    row.text.trim().toLowerCase() === message.text.trim().toLowerCase()),
              )
            ? 'duplicate'
            : !Number.isFinite(message.sentAt) ||
                message.sentAt < this.now() - this.bufferMs() ||
                message.sentAt > this.now() + 1000
              ? 'not-in-window'
              : 'candidate';
    if (!this.options.store.isOptedOut(message.viewer.id))
      this.options.debug?.chat(message, decision);
    if (
      this.options.store.isOptedOut(message.viewer.id) ||
      !Number.isFinite(message.sentAt) ||
      message.sentAt < this.now() - this.bufferMs() ||
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
      this.options.debug?.transcript(window);
      if (this.options.allowAfterReply?.()) {
        const boundary = window.timing === 'chunk' ? window.endAt : window.startAt;
        const waitMs = Math.min(
          MATCH_RULES.tailSeconds * 1000,
          Math.max(0, boundary + MATCH_RULES.tailSeconds * 1000 - this.now()),
        );
        try {
          if (waitMs) await abortableDelay(waitMs, this.windowController.signal);
        } catch {
          return [];
        }
        if (this.closed || generation !== this.generation) return [];
      }
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
    this.windowController.abort();
    this.closed = true;
    clearInterval(this.timer);
    this.chat = [];
  }
  clearChat(): void {
    this.windowController.abort();
    this.windowController = new AbortController();
    this.generation += 1;
    this.chat = [];
  }

  private now(): number {
    return (this.options.now ?? Date.now)();
  }
  private prune(): void {
    this.chat = this.chat.filter((message) => message.sentAt >= this.now() - this.bufferMs());
  }
  private bufferMs(): number {
    return (
      (this.options.lookbackSeconds?.() ?? LOOKBACK_MS / 1000) * 1000 + MATCH_RULES.bufferGraceMs
    );
  }
}
