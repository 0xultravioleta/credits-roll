import type { Transcriber } from '../ai/interfaces.js';
import type { AudioRunner } from './runner.js';
import { AUDIO_IDLE_MS, AudioStall } from './runner.js';
import { abortableDelay, OperationTimeout, withDeadline } from '../runtime/time.js';
import { OPENAI_TIMEOUT_MS } from '../ai/openai.js';
import {
  providerOperation,
  ProviderFailure,
  ProviderSessionStopped,
  PROVIDER_FAILURE_LIMIT,
} from '../ai/failure.js';
import type { TranscriptEnd, TranscriptHandler, TranscriptSource } from './source.js';

export class LiveTranscriptSource implements TranscriptSource {
  constructor(
    private readonly options: {
      channel: string;
      streamId: string;
      apiKeyPresent: boolean;
      runner: AudioRunner;
      transcriber: Transcriber;
      language?: () => string;
      delayMs?: number;
      status?: (message: string) => void;
      onAudio?: () => void;
      onProviderFailure?: (error: ProviderFailure, consecutive: number) => void;
      onProviderSuccess?: () => void;
      startupManaged?: boolean;
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
    let receivedAudio = false;
    let consecutive = 0;
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
          receivedAudio = true;
          this.options.onAudio?.();
          const language = this.options.language?.() ?? 'en';
          try {
            const text = await providerOperation(
              'transcription',
              (deadline) =>
                this.options.transcriber.transcribe(
                  {
                    ...audio.chunk,
                    language,
                  },
                  deadline,
                ),
              inputSignal,
            );
            if (signal.aborted) return 'aborted';
            if (text.trim()) {
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
                      language,
                      timing: 'chunk',
                    }),
                  ),
                OPENAI_TIMEOUT_MS * 2 + 10_000,
                inputSignal,
              );
            }
            if (consecutive)
              this.options.status?.(
                'Provider recovered. Listening continues with the existing chat buffer.',
              );
            consecutive = 0;
            this.options.onProviderSuccess?.();
          } catch (error) {
            if (inputSignal.aborted) return 'aborted';
            if (!(error instanceof ProviderFailure)) throw error;
            consecutive++;
            this.options.onProviderFailure?.(error, consecutive);
            if (!error.retryable || consecutive >= PROVIDER_FAILURE_LIMIT)
              throw new ProviderSessionStopped(error, consecutive);
            this.options.status?.(
              `Skipped one chunk after a ${error.stage} error (${consecutive}/${PROVIDER_FAILURE_LIMIT} consecutive failures). Listening continues; chat is kept.`,
            );
          }
        }
      } catch (error) {
        if (signal.aborted) return 'aborted';
        if (error instanceof ProviderSessionStopped) throw error;
        // Let the stream lifecycle own the initial HLS retry budget. Once audio has
        // arrived, retain the established short recovery loop for an interrupted pipe.
        if (!receivedAudio && this.options.startupManaged)
          throw new Error('Initial live audio capture failed');
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
