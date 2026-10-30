import { languageCode } from '../transcript/language.js';

export const COUNTER_INTERVAL_MS = 60_000;
const CHAT_REASONS = new Set([
  'ignored-bot',
  'command',
  'too-long',
  'duplicate',
  'not-in-window',
  'candidate',
  'privacy-command',
  'opted-out',
]);
const MATCH_REASONS = new Set([
  'too-long',
  'command',
  'instruction-attack',
  'short-reaction',
  'not-in-window',
  'short-duplicate',
  'duplicate',
  'candidate-limit',
  'no-adoption-or-invalid-response',
  'invalid-or-repeated-decision',
  'streamer-first-cannot-cause-earlier-action',
  'below-threshold',
  'kept-weak-streamer-first',
  'kept',
  'provider-failed-or-timed-out',
]);
type Counter =
  | 'chunks'
  | 'transcriptsNonEmpty'
  | 'chatIn'
  | 'candidates'
  | 'judgeCalls'
  | 'kept'
  | 'providerErrors';

// Cumulative process counters only. This class never receives chat, transcripts or identities.
export class LiveCounters {
  private readonly counts: Record<Counter, number> = {
    chunks: 0,
    transcriptsNonEmpty: 0,
    chatIn: 0,
    candidates: 0,
    judgeCalls: 0,
    kept: 0,
    providerErrors: 0,
  };
  private readonly reasons: Record<string, number> = {};
  private timer?: ReturnType<typeof setInterval>;
  constructor(
    private readonly language: () => string,
    private readonly threshold: () => number,
    private readonly write: (line: string) => void = (line) => console.log(line),
  ) {}
  increment(counter: Counter, amount = 1): void {
    if (!Number.isSafeInteger(amount) || amount < 0) return;
    this.counts[counter] = Math.min(Number.MAX_SAFE_INTEGER, this.counts[counter] + amount);
  }
  reason(scope: 'chat' | 'match', reason: string): void {
    const known = scope === 'chat' ? CHAT_REASONS : MATCH_REASONS;
    const key = `${scope}:${known.has(reason) ? reason : 'other'}`;
    this.reasons[key] = Math.min(Number.MAX_SAFE_INTEGER, (this.reasons[key] ?? 0) + 1);
  }
  snapshot() {
    const threshold = this.threshold();
    return {
      ...this.counts,
      byReason: { ...this.reasons },
      language: languageCode(this.language()) ?? 'en',
      threshold: Number.isFinite(threshold) ? threshold : 0.7,
    };
  }
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(
      () => this.write(JSON.stringify(this.snapshot())),
      COUNTER_INTERVAL_MS,
    );
    this.timer.unref();
  }
  close(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }
}
