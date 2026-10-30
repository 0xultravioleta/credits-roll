import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { object, text } from '../twitch/source.js';
import type { TranscriptHandler, TranscriptSource, TranscriptEnd } from './source.js';

export interface TranscriptEntry {
  language?: string;
  id: string;
  startMs: number;
  endMs: number;
  text: string;
}
export async function readTranscript(path: string): Promise<TranscriptEntry[]> {
  const lines = (await readFile(path, 'utf8')).trim().split(/\r?\n/).filter(Boolean);
  let previous = 0;
  return lines.map((line) => {
    const row = object(JSON.parse(line));
    if (
      !text(row.id, 128) ||
      !text(row.text, 16_000) ||
      (row.language !== undefined &&
        (typeof row.language !== 'string' || !/^[a-z]{2}$/.test(row.language))) ||
      !Number.isSafeInteger(row.startMs) ||
      !Number.isSafeInteger(row.endMs) ||
      (row.startMs as number) < previous ||
      (row.endMs as number) < (row.startMs as number)
    )
      throw new Error('Invalid recorded transcript');
    previous = row.endMs as number;
    return {
      id: row.id,
      startMs: row.startMs as number,
      endMs: row.endMs as number,
      text: row.text,
      ...(typeof row.language === 'string' ? { language: row.language } : {}),
    };
  });
}

export class RecordedTranscriptSource implements TranscriptSource {
  constructor(
    private readonly path: string,
    private readonly options: { streamId: string; origin?: number; speed?: number },
  ) {}
  async run(onWindow: TranscriptHandler, signal: AbortSignal): Promise<TranscriptEnd> {
    const origin = this.options.origin ?? Date.now();
    const speed = this.options.speed ?? 0;
    if (!Number.isFinite(speed) || speed < 0) throw new Error('Invalid transcript replay speed');
    const rows = await readTranscript(this.path);
    const started = Date.now();
    try {
      for (const row of rows) {
        if (signal.aborted) return 'aborted';
        const wait = speed > 0 ? started + row.endMs / speed - Date.now() : 0;
        if (wait > 0) await delay(wait, undefined, { signal });
        if (signal.aborted) return 'aborted';
        await onWindow({
          id: row.id,
          streamId: this.options.streamId,
          startAt: origin + row.startMs,
          endAt: origin + row.endMs,
          text: row.text,
          language: row.language,
        });
      }
      return 'ended';
    } catch (error) {
      if (signal.aborted) return 'aborted';
      throw error;
    }
  }
}
