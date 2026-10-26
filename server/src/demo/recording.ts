import { fileURLToPath } from 'node:url';
import type { Moment } from '../domain.js';
import { Pipeline } from '../pipeline.js';
import { RecordedChatSource } from '../twitch/recorded.js';
import { readTranscript, RecordedTranscriptSource } from '../transcript/recorded.js';
export { readTranscript } from '../transcript/recorded.js';

export const DEMO_STREAM_ID = 'synthetic-rehearsal';
export const DEMO_END_MS = 41_500;

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
    const spoken = new RecordedTranscriptSource(`${path}/transcript.jsonl`, {
      streamId: DEMO_STREAM_ID,
      origin,
      speed: 1,
    }).run(async (window) => {
      const { text, ...metadata } = window;
      const found = await options.pipeline.processAudioWindow(metadata, {
        bytes: new TextEncoder().encode(text),
        filename: 'synthetic.txt',
        mimeType: 'text/plain',
      });
      found.forEach((moment) => {
        moments.push(moment);
        options.onMoment?.(moment);
      });
    }, options.signal);
    await Promise.all([chat, spoken]);
  }
  return moments;
}
