import type { TranscriptWindow } from '../domain.js';

export type TranscriptHandler = (window: TranscriptWindow) => void | Promise<void>;
export type TranscriptEnd = 'ended' | 'skipped' | 'aborted';
export interface TranscriptSource {
  run(onWindow: TranscriptHandler, signal: AbortSignal): Promise<TranscriptEnd>;
}
