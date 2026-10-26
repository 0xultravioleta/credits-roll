import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { setTimeout as delay } from 'node:timers/promises';
import type { ChatSource, ChatHandler } from './source.js';
import { object, text, validLogin } from './source.js';

export interface RecordedChatEntry {
  atMs: number;
  id: string;
  viewer: { id: string; login: string };
  text: string;
}

export function parseRecordedEntry(input: unknown): RecordedChatEntry {
  const row = object(input);
  const viewer = object(row.viewer);
  if (
    !Number.isSafeInteger(row.atMs) ||
    (row.atMs as number) < 0 ||
    !text(row.id, 128) ||
    !text(viewer.id, 128) ||
    !validLogin(viewer.login) ||
    !text(row.text)
  ) {
    throw new Error('Invalid recorded chat entry');
  }
  return {
    atMs: row.atMs as number,
    id: row.id,
    viewer: { id: viewer.id, login: viewer.login },
    text: row.text,
  };
}

export class RecordedChatSource implements ChatSource {
  constructor(
    private readonly path: string,
    private readonly options: { origin?: number; speed?: number } = {},
  ) {}

  async run(onMessage: ChatHandler, signal: AbortSignal): Promise<void> {
    const origin = this.options.origin ?? Date.now();
    const speed = this.options.speed ?? 0;
    if (!Number.isFinite(speed) || speed < 0) throw new Error('Invalid replay speed');
    const input = createReadStream(this.path, { encoding: 'utf8' });
    const lines = createInterface({ input, crlfDelay: Infinity });
    const abort = () => {
      lines.close();
      input.destroy();
    };
    signal.addEventListener('abort', abort, { once: true });
    let previous = 0;
    try {
      if (signal.aborted) return;
      for await (const line of lines) {
        if (signal.aborted) break;
        if (!line.trim()) continue;
        const row = parseRecordedEntry(JSON.parse(line));
        if (row.atMs < previous) throw new Error('Recorded chat must be in chronological order');
        if (speed > 0 && row.atMs > previous) {
          await delay((row.atMs - previous) / speed, undefined, { signal });
        }
        previous = row.atMs;
        if (!signal.aborted)
          await onMessage({
            id: row.id,
            viewer: row.viewer,
            text: row.text,
            sentAt: origin + row.atMs,
          });
      }
    } catch (error) {
      if (!signal.aborted) throw error;
    } finally {
      signal.removeEventListener('abort', abort);
      lines.close();
      input.destroy();
    }
  }
}
