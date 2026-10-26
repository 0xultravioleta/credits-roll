import type { ChatMessage, MatchedMoment, TranscriptWindow } from '../domain.js';
import { MOMENT_KINDS } from '../domain.js';
import type { Embeddings } from '../ai/interfaces.js';
import type { Judge } from './judge.js';
import { isInstructionAttack } from './judge.js';

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
  ) {}

  async match(window: TranscriptWindow, chat: ChatMessage[]): Promise<MatchedMoment[]> {
    if (
      !Number.isFinite(window.startAt) ||
      !Number.isFinite(window.endAt) ||
      window.endAt < window.startAt ||
      !window.text.trim()
    )
      return [];
    let candidates = chat.filter(
      (message) =>
        message.sentAt <= window.startAt &&
        message.sentAt >= window.startAt - LOOKBACK_MS &&
        message.text.length <= 500 &&
        message.text.trim() &&
        !message.text.trim().startsWith('!') &&
        !isInstructionAttack(message.text),
    );
    // Identical suggestions from multiple viewers provide insufficient attribution evidence.
    candidates = candidates.filter(
      (message) =>
        !candidates.some(
          (other) =>
            other.viewer.id !== message.viewer.id &&
            other.text.trim().toLowerCase() === message.text.trim().toLowerCase(),
        ),
    );
    candidates = [...new Map(candidates.map((message) => [message.id, message])).values()].slice(
      -200,
    );
    if (!candidates.length) return [];
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
    const judgments = await this.judge.judge(
      { ...window, text: window.text.slice(0, 16_000) },
      candidates,
    );
    const seen = new Set<string>();
    return judgments.flatMap((judgment) => {
      const message = candidates.find((candidate) => candidate.id === judgment.messageId);
      if (
        !message ||
        seen.has(message.id) ||
        !Number.isFinite(judgment.confidence) ||
        judgment.confidence < MIN_CONFIDENCE ||
        judgment.confidence > 1 ||
        !MOMENT_KINDS.includes(judgment.kind)
      )
        return [];
      seen.add(message.id);
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
