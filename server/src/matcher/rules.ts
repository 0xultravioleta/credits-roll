import type { ChatMessage, TranscriptWindow } from '../domain.js';

export const MATCH_RULES = {
  defaultConfidence: 0.7,
  minConfidence: 0.6,
  maxThreshold: 0.9,
  defaultLookbackSeconds: 90,
  minLookbackSeconds: 30,
  maxLookbackSeconds: 180,
  duplicateMinTextLength: 13,
  maxTextLength: 500,
  maxCandidates: 50,
  embeddingPool: 200,
  tailSeconds: 10,
  tailConfidenceCap: 0.65,
  bufferGraceMs: 60_000,
} as const;
export interface MatchOptions {
  lookbackSeconds: number;
  duplicatePolicy: 'keep-first' | 'reject-all';
  allowAfterReply: boolean;
}
export const DEFAULT_MATCH_OPTIONS: MatchOptions = {
  lookbackSeconds: MATCH_RULES.defaultLookbackSeconds,
  duplicatePolicy: 'keep-first',
  allowAfterReply: false,
};
export const isShortReaction = (text: string): boolean =>
  /^(?:lol|lul|lmao|rofl|\+1|f)$/i.test(text.trim());
export function messageOrder(window: TranscriptWindow, message: ChatMessage) {
  const boundary = window.timing === 'chunk' ? window.endAt : window.startAt;
  return {
    ordering:
      message.sentAt > boundary
        ? 'streamer spoke first'
        : message.sentAt <= window.startAt
          ? 'viewer spoke first'
          : 'order uncertain within audio chunk',
    deltaMs: message.sentAt - boundary,
  };
}
