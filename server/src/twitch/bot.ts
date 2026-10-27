import { setTimeout as delay } from 'node:timers/promises';
import type { Viewer } from '../domain.js';
import type { CreditSummary } from '../events/protocol.js';
import type { ChannelApi } from './channel-api.js';
import { Store } from '../store/index.js';
import { CLIP_RULES, safeClipUrl } from '../clips/types.js';

export class ChatRateLimiter {
  private history: number[] = [];
  private readonly channelLast = new Map<string, number>();
  constructor(
    private readonly now: () => number = Date.now,
    private readonly wait: (ms: number, signal: AbortSignal) => Promise<void> = async (
      ms,
      signal,
    ) => {
      await delay(ms, undefined, { signal });
    },
  ) {}
  async acquire(channel: string, signal: AbortSignal): Promise<void> {
    for (;;) {
      signal.throwIfAborted();
      const now = this.now();
      this.history = this.history.filter((at) => at > now - 30_000);
      const wait = Math.max(
        0,
        (this.channelLast.get(channel) ?? -Infinity) + 1000 - now,
        this.history.length >= 20 ? this.history[0]! + 30_000 - now : 0,
      );
      if (wait > 0) {
        await this.wait(wait, signal);
        continue;
      }
      this.history.push(now);
      this.channelLast.set(channel, now);
      return;
    }
  }
}

// This class has no general reply method. Only explicit notices can enter its queue.
export class QuietBot {
  private queue = Promise.resolve();
  private queued = 0;
  private readonly controller = new AbortController();
  constructor(
    private readonly options: {
      channel: string;
      sender: string;
      api: ChannelApi;
      store: Store;
      quiet: () => boolean;
      limiter?: ChatRateLimiter;
      now?: () => number;
    },
  ) {}
  credits(streamId: string, credits: CreditSummary[]): Promise<void> {
    return this.notice(`credits:${streamId}`, false, () => {
      const current = credits.filter((entry) => !this.options.store.isOptedOut(entry.viewer.id));
      const names = current
        .map((entry) => `@${entry.viewer.login}`)
        .slice(0, 12)
        .join(', ');
      return `Credits are rolling: ${current.reduce((sum, entry) => sum + entry.momentCount, 0)} moments from ${current.length} viewers.${names ? ` Thanks ${names}.` : ''}`;
    });
  }
  winner(roundId: string, viewer: Viewer, prize: string): Promise<void> {
    return this.notice(`winner:${roundId}`, false, () =>
      this.options.store.isOptedOut(viewer.id)
        ? undefined
        : `Credits Wheel winner: @${viewer.login}. Prize: ${prize}`,
    );
  }
  close(): void {
    this.controller.abort();
  }
  clip(creditId: string, viewer: Viewer, url: string): Promise<void> {
    if (!safeClipUrl(url) || !url.startsWith('https://')) return Promise.resolve();
    return this.notice(`clip:${creditId}`, false, () => {
      const key = `clips:last-notice:${this.options.channel}`;
      const now = (this.options.now ?? Date.now)();
      const last = Number(this.options.store.getSetting(key) ?? -Infinity);
      if (this.options.store.isOptedOut(viewer.id) || now - last < CLIP_RULES.announcementMs)
        return undefined;
      this.options.store.setSetting(key, String(now));
      return `@${viewer.login} moved the stream - clip: ${url}`;
    });
  }
  privacy(viewerId: string, messageId: string): Promise<void> {
    return this.notice(
      `privacy:${viewerId}`,
      true,
      () =>
        'Privacy request confirmed. Your Credits Roll history was removed and future credits are disabled.',
      { viewerId, messageId },
    );
  }
  private notice(
    id: string,
    privacy: boolean,
    build: () => string | undefined,
    confirmation?: { viewerId: string; messageId: string },
  ): Promise<void> {
    if (this.queued >= 100) return Promise.reject(new Error('Announcement queue is full'));
    const key = `notice:${this.options.channel}:${id}`;
    this.queued += 1;
    const operation = this.queue.then(async () => {
      if (
        this.controller.signal.aborted ||
        (confirmation
          ? this.options.store.privacyConfirmed(confirmation.viewerId)
          : this.options.store.getSetting(key)) ||
        (!privacy && this.options.quiet())
      )
        return;
      await (this.options.limiter ?? this.defaultLimiter).acquire(
        this.options.channel,
        this.controller.signal,
      );
      const message = build();
      if (this.controller.signal.aborted) return;
      if (!message || (!privacy && this.options.quiet())) return;
      // Mark before sending: an uncertain network result must not cause duplicate chat posts.
      if (confirmation) {
        if (!this.options.store.claimPrivacyConfirmation(confirmation.viewerId)) return;
        await this.options.api.send(
          this.options.channel,
          this.options.sender,
          message.slice(0, 500),
          confirmation.messageId,
        );
      } else {
        this.options.store.setSetting(key, '1');
        await this.options.api.send(
          this.options.channel,
          this.options.sender,
          message.slice(0, 500),
        );
      }
    });
    this.queue = operation
      .catch(() => undefined)
      .finally(() => {
        this.queued -= 1;
      });
    return operation;
  }
  private readonly defaultLimiter = new ChatRateLimiter();
}
