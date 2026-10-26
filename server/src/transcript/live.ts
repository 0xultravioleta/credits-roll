import type { Transcriber } from '../ai/interfaces.js';
import type { AudioRunner } from './runner.js';
import { AUDIO_IDLE_MS, AudioStall } from './runner.js';
import { abortableDelay, OperationTimeout, withDeadline } from '../runtime/time.js';
import { OPENAI_TIMEOUT_MS } from '../ai/openai.js';
import type { TranscriptEnd, TranscriptHandler, TranscriptSource } from './source.js';

export class LiveTranscriptSource implements TranscriptSource {
  constructor(
    private readonly options: {
      channel: string;
      streamId: string;
      apiKeyPresent: boolean;
      runner: AudioRunner;
      transcriber: Transcriber;
      language?: () => 'en' | 'es';
      delayMs?: number;
      status?: (message: string) => void;
    },
  ) {}
  async run(onWindow: TranscriptHandler, signal: AbortSignal): Promise<TranscriptEnd> {
    if (signal.aborted) return 'aborted';
    if (!this.options.apiKeyPresent) {
      this.options.status?.('Live transcription skipped: set OPENAI_API_KEY.');
      return 'skipped';
    }
    for (const tool of ['streamlink', 'ffmpeg'] as const) {
      const available = await withDeadline(
        () => this.options.runner.available(tool),
        5000,
        signal,
      ).catch(() => false);
      if (!available) {
        if (signal.aborted) return 'aborted';
        this.options.status?.(
          'Live transcription skipped: install ' + tool + ' and put it on PATH.',
        );
        return 'skipped';
      }
    }
    this.options.status?.('Listening to live audio in 20-second chunks.');
    let sequence = 0;
    while (!signal.aborted) {
      const capture = new AbortController();
      const inputSignal = AbortSignal.any([signal, capture.signal]);
      const audioInput = this.options.runner.chunks(this.options.channel, inputSignal);
      const iterator = audioInput[Symbol.asyncIterator]();
      try {
        while (!signal.aborted) {
          const next = await withDeadline(() => iterator.next(), AUDIO_IDLE_MS, inputSignal);
          if (next.done) return signal.aborted ? 'aborted' : 'ended';
          const audio = next.value;
          const text = await withDeadline(
            (deadline) =>
              this.options.transcriber.transcribe(
                {
                  ...audio.chunk,
                  language: this.options.language?.() ?? 'en',
                },
                deadline,
              ),
            OPENAI_TIMEOUT_MS,
            inputSignal,
          );
          if (signal.aborted) return 'aborted';
          if (!text.trim()) continue;
          const delayMs = this.options.delayMs ?? 0;
          await withDeadline(
            () =>
              Promise.resolve(
                onWindow({
                  id: this.options.streamId + ':' + ++sequence,
                  streamId: this.options.streamId,
                  startAt: audio.startAt - delayMs,
                  endAt: audio.endAt - delayMs,
                  text,
                  timing: 'chunk',
                }),
              ),
            OPENAI_TIMEOUT_MS * 2 + 10_000,
            inputSignal,
          );
        }
      } catch (error) {
        if (signal.aborted) return 'aborted';
        if (error instanceof AudioStall || error instanceof OperationTimeout) {
          this.options.status?.(
            'Audio or transcription timed out. Restarting capture; Stop listening remains available.',
          );
          capture.abort();
          await abortableDelay(1000, signal).catch(() => undefined);
          continue;
        }
        throw new Error(
          'Live transcription stopped; check stream access and provider availability',
        );
      } finally {
        capture.abort();
        // A fake or broken iterator may ignore cancellation; do not let its return block Stop.
        void iterator.return?.().catch(() => undefined);
      }
    }
    return 'aborted';
  }
}
