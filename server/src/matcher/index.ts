import type { ChatMessage, MatchedMoment, TranscriptWindow } from '../domain.js';
import { MOMENT_KINDS } from '../domain.js';
import type { Embeddings } from '../ai/interfaces.js';
import type { Judge } from './judge.js';
import { isInstructionAttack } from './judge.js';
import type { JudgeAudit } from '../debug/log.js';

export const LOOKBACK_MS = 90_000;
export const MIN_CONFIDENCE = 0.75;

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
    private readonly threshold: () => number = () => MIN_CONFIDENCE,
    private readonly audit?: (event: JudgeAudit) => void,
  ) {}

  async match(window: TranscriptWindow, chat: ChatMessage[]): Promise<MatchedMoment[]> {
    if (
      !Number.isFinite(window.startAt) ||
      !Number.isFinite(window.endAt) ||
      window.endAt < window.startAt ||
      !window.text.trim()
    )
      return [];
    const threshold = Math.max(MIN_CONFIDENCE, this.threshold());
    const note = (
      message: ChatMessage,
      reason: string,
      kept = false,
      confidence: number | null = null,
      kind: string | null = null,
    ) =>
      this.audit?.({
        messageId: message.id,
        viewerId: message.viewer.id,
        windowId: window.id,
        streamId: window.streamId,
        reason,
        kept,
        confidence,
        kind,
        threshold,
      });
    let candidates = chat.filter(
      (message) =>
        message.sentAt <= (window.timing === 'chunk' ? window.endAt : window.startAt) &&
        message.sentAt >= window.startAt - LOOKBACK_MS &&
        message.text.length <= 500 &&
        message.text.trim() &&
        !message.text.trim().startsWith('!') &&
        !isInstructionAttack(message.text),
    );
    for (const message of chat)
      if (!candidates.includes(message))
        note(
          message,
          message.text.length > 500
            ? 'too-long'
            : message.text.trim().startsWith('!')
              ? 'command'
              : isInstructionAttack(message.text)
                ? 'instruction-attack'
                : 'not-in-window',
        );
    // Identical suggestions from multiple viewers provide insufficient attribution evidence.
    const beforeDuplicates = candidates;
    candidates = candidates.filter(
      (message) =>
        !candidates.some(
          (other) =>
            other.viewer.id !== message.viewer.id &&
            other.text.trim().toLowerCase() === message.text.trim().toLowerCase(),
        ),
    );
    for (const message of beforeDuplicates)
      if (!candidates.includes(message)) note(message, 'duplicate');
    candidates = [...new Map(candidates.map((message) => [message.id, message])).values()].slice(
      -200,
    );
    if (!candidates.length) return [];
    const beforeRanking = candidates;
    if (this.embeddings) {
      const vectors = await this.embeddings.embed([
        window.text.slice(0, 16_000),
        ...candidates.map((message) => message.text),
      ]);
      candidates = candidates
        .map((message, index) => ({
          message,
          similarity: cosine(vectors[0] ?? [], vectors[index + 1] ?? []),
        }))
        .sort((a, b) => b.similarity - a.similarity || a.message.id.localeCompare(b.message.id))
        .slice(0, 50)
        .map((row) => row.message);
    } else candidates = candidates.slice(-50);
    for (const message of beforeRanking)
      if (!candidates.includes(message)) note(message, 'candidate-limit');
    const judgments = await this.judge.judge(
      { ...window, text: window.text.slice(0, 16_000) },
      candidates,
    );
    const seen = new Set<string>();
    for (const message of candidates)
      if (!judgments.some((judgment) => judgment.messageId === message.id))
        note(message, 'no-adoption-or-invalid-response');
    return judgments.flatMap((judgment) => {
      const message = candidates.find((candidate) => candidate.id === judgment.messageId);
      if (
        !message ||
        seen.has(message.id) ||
        !Number.isFinite(judgment.confidence) ||
        judgment.confidence < threshold ||
        judgment.confidence > 1 ||
        !MOMENT_KINDS.includes(judgment.kind)
      ) {
        if (message)
          note(
            message,
            judgment.confidence < threshold ? 'below-threshold' : 'invalid-or-repeated-decision',
            false,
            Number.isFinite(judgment.confidence) ? judgment.confidence : null,
            MOMENT_KINDS.includes(judgment.kind) ? judgment.kind : null,
          );
        return [];
      }
      seen.add(message.id);
      note(message, 'kept', true, judgment.confidence, judgment.kind);
      return [
        {
          viewer: message.viewer,
          messageId: message.id,
          quote: message.text,
          kind: judgment.kind,
          confidence: judgment.confidence,
        },
      ];
    });
  }
}
