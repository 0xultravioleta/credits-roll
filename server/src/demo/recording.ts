import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import type { Moment } from '../domain.js';
import { Pipeline } from '../pipeline.js';
import { RecordedChatSource } from '../twitch/recorded.js';
import { object, text } from '../twitch/source.js';

export const DEMO_STREAM_ID = 'synthetic-rehearsal';
export const DEMO_END_MS = 41_500;

export interface TranscriptEntry {
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
    };
  });
}

export async function replayDemo(options: {
  pipeline: Pipeline;
  signal: AbortSignal;
  realtime: boolean;
  onMoment?: (moment: Moment) => void;
  origin?: number;
}): Promise<Moment[]> {
  const origin = options.origin ?? Date.now() - (options.realtime ? 0 : DEMO_END_MS + 1);
  const path = fileURLToPath(new URL('../../../demo/', import.meta.url));
  const transcript = await readTranscript(`${path}/transcript.jsonl`);
  const moments: Moment[] = [];
  if (!options.realtime) {
    // Merge the two timelines so !optout happens at its actual place in the stream.
    const chat = new Map<number, (() => void)[]>();
    await new RecordedChatSource(`${path}/chat.jsonl`, { origin }).run((message) => {
      const actions = chat.get(message.sentAt) ?? [];
      actions.push(() => options.pipeline.addChat(message));
      chat.set(message.sentAt, actions);
    }, options.signal);
    for (const row of transcript) {
      if (options.signal.aborted) break;
      for (const [at, actions] of chat) {
        if (at <= origin + row.endMs) {
          actions.forEach((action) => action());
          chat.delete(at);
        }
      }
      const found = await options.pipeline.processAudioWindow(
        {
          id: row.id,
          streamId: DEMO_STREAM_ID,
          startAt: origin + row.startMs,
          endAt: origin + row.endMs,
        },
        {
          bytes: new TextEncoder().encode(row.text),
          filename: 'synthetic.txt',
          mimeType: 'text/plain',
        },
      );
      found.forEach((moment) => {
        moments.push(moment);
        options.onMoment?.(moment);
      });
    }
  } else {
    const chat = new RecordedChatSource(`${path}/chat.jsonl`, { origin, speed: 1 }).run(
      (message) => options.pipeline.addChat(message),
      options.signal,
    );
    const spoken = (async () => {
      for (const row of transcript) {
        const wait = origin + row.endMs - Date.now();
        if (wait > 0) await delay(wait, undefined, { signal: options.signal });
        if (options.signal.aborted) break;
        const found = await options.pipeline.processAudioWindow(
          {
            id: row.id,
            streamId: DEMO_STREAM_ID,
            startAt: origin + row.startMs,
            endAt: origin + row.endMs,
          },
          {
            bytes: new TextEncoder().encode(row.text),
            filename: 'synthetic.txt',
            mimeType: 'text/plain',
          },
        );
        found.forEach((moment) => {
          moments.push(moment);
          options.onMoment?.(moment);
        });
      }
    })();
    await Promise.all([chat, spoken]);
  }
  return moments;
}
