import type { Transcriber } from '../ai/interfaces.js';
import type { AudioRunner } from './runner.js';
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
      if (!(await this.options.runner.available(tool))) {
        this.options.status?.(`Live transcription skipped: install ${tool} and put it on PATH.`);
        return 'skipped';
      }
    }
    this.options.status?.('Listening to live audio in 20-second chunks.');
    let sequence = 0;
    try {
      for await (const audio of this.options.runner.chunks(this.options.channel, signal)) {
        if (signal.aborted) return 'aborted';
        const text = await this.options.transcriber.transcribe({
          ...audio.chunk,
          language: this.options.language?.() ?? 'en',
        });
        if (signal.aborted) return 'aborted';
        if (!text.trim()) continue;
        const delayMs = this.options.delayMs ?? 0;
        await onWindow({
          id: `${this.options.streamId}:${++sequence}`,
          streamId: this.options.streamId,
          startAt: audio.startAt - delayMs,
          endAt: audio.endAt - delayMs,
          text,
          timing: 'chunk',
        });
      }
      return signal.aborted ? 'aborted' : 'ended';
    } catch {
      if (signal.aborted) return 'aborted';
      throw new Error('Live transcription stopped; check stream access and provider availability');
    }
  }
}
