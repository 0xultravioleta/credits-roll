import type { ChatMessage, MatchedMoment, TranscriptWindow } from '../domain.js';
import { MOMENT_KINDS } from '../domain.js';
import type { Embeddings } from '../ai/interfaces.js';
import type { Judge } from './judge.js';
import { isInstructionAttack } from './judge.js';
import type { JudgeAudit } from '../debug/log.js';
import { DEFAULT_MATCH_OPTIONS, MATCH_RULES, messageOrder, isShortReaction } from './rules.js';
import type { MatchOptions } from './rules.js';
import { providerOperation } from '../ai/failure.js';
import type { LiveCounters } from '../live/counters.js';

export const LOOKBACK_MS = MATCH_RULES.defaultLookbackSeconds * 1000;
export const MIN_CONFIDENCE = MATCH_RULES.minConfidence;

export function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  const dot = a.reduce((sum, value, index) => sum + value * (b[index] ?? 0), 0);
  const norm = Math.hypot(...a) * Math.hypot(...b);
  return norm ? dot / norm : 0;
}

export class Matcher {
  constructor(
    private readonly judge: Judge,
    private readonly embeddings?: Embeddings,
    private readonly threshold: () => number = () => MATCH_RULES.defaultConfidence,
    private readonly audit?: (event: JudgeAudit) => void,
    private readonly settings: () => MatchOptions = () => DEFAULT_MATCH_OPTIONS,
    private readonly counters?: LiveCounters,
  ) {}

  async match(
    window: TranscriptWindow,
    chat: ChatMessage[],
    signal?: AbortSignal,
  ): Promise<MatchedMoment[]> {
    if (
      !Number.isFinite(window.startAt) ||
      !Number.isFinite(window.endAt) ||
      window.endAt < window.startAt ||
      !window.text.trim()
    )
      return [];
    const options = this.settings();
    const requested = this.threshold();
    const threshold = Number.isFinite(requested)
      ? Math.max(MIN_CONFIDENCE, Math.min(MATCH_RULES.maxThreshold, requested))
      : MATCH_RULES.defaultConfidence;
    const lookback =
      Math.max(
        MATCH_RULES.minLookbackSeconds,
        Math.min(MATCH_RULES.maxLookbackSeconds, options.lookbackSeconds),
      ) * 1000;
    const boundary = window.timing === 'chunk' ? window.endAt : window.startAt;
    const note = (
      message: ChatMessage,
      reason: string,
      kept = false,
      confidence: number | null = null,
      kind: string | null = null,
      rawConfidence?: number,
    ) => {
      this.counters?.reason('match', reason);
      this.audit?.({
        messageId: message.id,
        viewerId: message.viewer.id,
        windowId: window.id,
        streamId: window.streamId,
        reason,
        kept,
        confidence,
        kind,
        rawConfidence,
        threshold,
        ...messageOrder(window, message),
      });
    };
    let candidates: ChatMessage[] = [];
    for (const message of chat) {
      const reason =
        message.text.length > MATCH_RULES.maxTextLength
          ? 'too-long'
          : message.text.trim().startsWith('!')
            ? 'command'
            : isInstructionAttack(message.text)
              ? 'instruction-attack'
              : !message.text.trim() || isShortReaction(message.text)
                ? 'short-reaction'
                : !Number.isFinite(message.sentAt) ||
                    message.sentAt < window.startAt - lookback ||
                    message.sentAt >
                      boundary + (options.allowAfterReply ? MATCH_RULES.tailSeconds * 1000 : 0)
                  ? 'not-in-window'
                  : null;
      if (reason) note(message, reason);
      else candidates.push(message);
    }
    candidates.sort((a, b) => a.sentAt - b.sentAt || a.id.localeCompare(b.id));
    const groups = new Map<string, ChatMessage[]>();
    for (const message of candidates) {
      const key = message.text.trim().toLowerCase();
      groups.set(key, [...(groups.get(key) ?? []), message]);
    }
    candidates = candidates.filter((message) => {
      const group = groups.get(message.text.trim().toLowerCase())!;
      const ambiguous =
        options.duplicatePolicy === 'reject-all' &&
        new Set(group.map((row) => row.viewer.id)).size > 1;
      const shortDuplicate =
        new Set(group.map((row) => row.viewer.id)).size > 1 &&
        Array.from(message.text.trim()).length < MATCH_RULES.duplicateMinTextLength;
      const keep = !ambiguous && !shortDuplicate && group[0] === message;
      if (!keep) note(message, shortDuplicate ? 'short-duplicate' : 'duplicate');
      return keep;
    });
    const beforePool = candidates;
    candidates = [...new Map(candidates.map((message) => [message.id, message])).values()].slice(
      -MATCH_RULES.embeddingPool,
    );
    for (const message of beforePool)
      if (!candidates.includes(message)) note(message, 'candidate-limit');
    if (!candidates.length) return [];
    this.counters?.increment('candidates', candidates.length);
    const beforeRanking = candidates;
    try {
      if (this.embeddings) {
        const vectors = await providerOperation(
          'embeddings',
          (deadline) =>
            this.embeddings!.embed(
              [window.text.slice(0, 16_000), ...candidates.map((message) => message.text)],
              deadline,
            ),
          signal,
        );
        candidates = candidates
          .map((message, index) => ({
            message,
            similarity: cosine(vectors[0] ?? [], vectors[index + 1] ?? []),
          }))
          .sort((a, b) => b.similarity - a.similarity || a.message.id.localeCompare(b.message.id))
          .slice(0, MATCH_RULES.maxCandidates)
          .map((row) => row.message);
      } else candidates = candidates.slice(-MATCH_RULES.maxCandidates);
      for (const message of beforeRanking)
        if (!candidates.includes(message)) note(message, 'candidate-limit');
      this.counters?.increment('judgeCalls');
      const judgments = await providerOperation(
        'judge',
        (deadline) =>
          this.judge.judge({ ...window, text: window.text.slice(0, 16_000) }, candidates, deadline),
        signal,
      );
      for (const message of candidates)
        if (!judgments.some((judgment) => judgment.messageId === message.id))
          note(message, 'no-adoption-or-invalid-response');
      const seen = new Set<string>();
      return judgments.flatMap((judgment) => {
        const message = candidates.find((candidate) => candidate.id === judgment.messageId);
        if (!message) return [];
        const late = messageOrder(window, message).ordering === 'streamer spoke first';
        const confidence = late
          ? Math.min(judgment.confidence, MATCH_RULES.tailConfidenceCap)
          : judgment.confidence;
        const reason =
          seen.has(message.id) ||
          !Number.isFinite(judgment.confidence) ||
          judgment.confidence < 0 ||
          judgment.confidence > 1 ||
          !MOMENT_KINDS.includes(judgment.kind)
            ? 'invalid-or-repeated-decision'
            : late && judgment.kind !== 'riff'
              ? 'streamer-first-cannot-cause-earlier-action'
              : confidence < threshold
                ? 'below-threshold'
                : late
                  ? 'kept-weak-streamer-first'
                  : 'kept';
        const kept = reason === 'kept' || reason === 'kept-weak-streamer-first';
        note(
          message,
          reason,
          kept,
          Number.isFinite(confidence) ? confidence : null,
          MOMENT_KINDS.includes(judgment.kind) ? judgment.kind : null,
          Number.isFinite(judgment.confidence) ? judgment.confidence : undefined,
        );
        if (!kept) return [];
        seen.add(message.id);
        return [
          {
            viewer: message.viewer,
            messageId: message.id,
            quote: message.text,
            kind: judgment.kind,
            confidence,
          },
        ];
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      for (const message of candidates) note(message, 'provider-failed-or-timed-out');
      throw error;
    }
  }
}
