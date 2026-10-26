import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import type { AudioChunk } from '../ai/interfaces.js';
import { validLogin } from '../twitch/source.js';
import { withDeadline } from '../runtime/time.js';

export interface CapturedAudio {
  chunk: AudioChunk;
  startAt: number;
  endAt: number;
}
export interface AudioRunner {
  available(tool: 'streamlink' | 'ffmpeg'): Promise<boolean>;
  chunks(channel: string, signal: AbortSignal): AsyncIterable<CapturedAudio>;
}

export function wav(pcm: Uint8Array): Uint8Array {
  const header = Buffer.alloc(44);
  header.write('RIFF');
  header.writeUInt32LE(pcm.length + 36, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(16000, 24);
  header.writeUInt32LE(32000, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}
export function capturePcm(pcm: Uint8Array, receivedAt: number): CapturedAudio {
  return {
    chunk: { bytes: wav(pcm), filename: 'chunk.wav', mimeType: 'audio/wav' },
    startAt: Math.round(receivedAt - pcm.length / 32),
    endAt: Math.round(receivedAt),
  };
}

export const AUDIO_IDLE_MS = 60_000;
export class AudioStall extends Error {
  constructor() {
    super('Audio capture stalled');
  }
}

export class ProcessAudioRunner implements AudioRunner {
  constructor(
    private readonly tools = { streamlink: 'streamlink', ffmpeg: 'ffmpeg' },
    private readonly now: () => number = Date.now,
    private readonly spawnProcess: typeof spawn = spawn,
    private readonly status: (message: string) => void = () => undefined,
  ) {}
  async available(tool: 'streamlink' | 'ffmpeg'): Promise<boolean> {
    return new Promise((resolve) => {
      const child = this.spawnProcess(
        this.tools[tool],
        [tool === 'ffmpeg' ? '-version' : '--version'],
        {
          windowsHide: true,
          stdio: 'ignore',
        },
      );
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        resolve(false);
      }, 5000);
      child.once('error', () => {
        clearTimeout(timer);
        resolve(false);
      });
      child.once('close', (code) => {
        clearTimeout(timer);
        resolve(code === 0);
      });
    });
  }
  async *chunks(channel: string, signal: AbortSignal): AsyncIterable<CapturedAudio> {
    if (!validLogin(channel)) throw new Error('Invalid Twitch channel');
    if (signal.aborted) return;
    const source = this.spawnProcess(
      this.tools.streamlink,
      ['--stdout', '--twitch-low-latency', 'https://www.twitch.tv/' + channel, 'audio_only,best'],
      { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] },
    );
    const converter = this.spawnProcess(
      this.tools.ffmpeg,
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-nostdin',
        '-i',
        'pipe:0',
        '-vn',
        '-ac',
        '1',
        '-ar',
        '16000',
        '-f',
        's16le',
        'pipe:1',
      ],
      { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] },
    );
    const output = source.stdout;
    const pcm = converter.stdout;
    const input = converter.stdin;
    if (!output || !pcm || !input) {
      source.kill('SIGKILL');
      converter.kill('SIGKILL');
      throw new Error('Audio capture pipes unavailable');
    }
    let buffer = Buffer.alloc(0);
    const queue: CapturedAudio[] = [];
    let ended = false;
    let failed: Error | undefined;
    let wake: (() => void) | undefined;
    let lastSource = this.now();
    let lastPcm = this.now();
    let stopped = false;
    const stop = () => {
      if (stopped) return;
      stopped = true;
      ended = true;
      clearInterval(idle);
      output.unpipe(input);
      source.kill('SIGKILL');
      converter.kill('SIGKILL');
      input.destroy();
      output.destroy();
      pcm.destroy();
      wake?.();
      wake = undefined;
    };
    const fail = (error = new Error('Audio capture process failed')) => {
      if (stopped) return;
      failed = error;
      stop();
    };
    const closed = (child: ChildProcess) =>
      new Promise<number | null>((resolve) => {
        child.once('close', resolve);
        child.once('error', () => resolve(-1));
      });
    const sourceDone = closed(source);
    const converterDone = closed(converter);
    source.once('error', () => fail());
    converter.once('error', () => fail());
    source.once('exit', (code) => {
      if (code !== 0 && !signal.aborted) fail();
    });
    converter.once('exit', (code) => {
      if (code !== 0 && !signal.aborted) fail();
    });
    input.on('error', () => {
      if (!signal.aborted && !stopped) fail();
    });
    output.on('data', () => {
      lastSource = this.now();
    });
    output.on('error', () => fail());
    pcm.on('error', () => fail());
    pcm.on('data', (bytes: Uint8Array) => {
      lastPcm = this.now();
      buffer = Buffer.concat([buffer, bytes]);
      while (buffer.length >= 640_000) {
        queue.push(capturePcm(buffer.subarray(0, 640_000), this.now()));
        buffer = Buffer.from(buffer.subarray(640_000));
        if (queue.length > 3) {
          queue.shift();
          this.status(
            'Audio processing is behind. Skipped one buffered chunk; capture remains bounded.',
          );
        }
      }
      wake?.();
      wake = undefined;
    });
    pcm.once('end', () => {
      ended = true;
      wake?.();
      wake = undefined;
    });
    const idle = setInterval(() => {
      if (this.now() - lastSource >= AUDIO_IDLE_MS || this.now() - lastPcm >= AUDIO_IDLE_MS)
        fail(new AudioStall());
    }, 1000);
    signal.addEventListener('abort', stop, { once: true });
    if (signal.aborted) stop();
    else output.pipe(input);
    try {
      while (!signal.aborted) {
        if (failed) throw failed;
        if (queue.length) {
          yield queue.shift()!;
          continue;
        }
        if (ended) break;
        try {
          await withDeadline(
            () =>
              new Promise<void>((resolve) => {
                wake = resolve;
              }),
            AUDIO_IDLE_MS,
            signal,
          );
        } catch {
          if (!signal.aborted) throw new AudioStall();
        }
      }
      if (signal.aborted) return;
      if (failed) throw failed;
      const codes = await withDeadline(
        () => Promise.all([sourceDone, converterDone]),
        5000,
        signal,
      );
      if (codes.some((code) => code !== 0)) throw new Error('Audio capture process failed');
      if (buffer.length >= 32_000)
        yield capturePcm(buffer.subarray(0, buffer.length - (buffer.length % 2)), this.now());
    } finally {
      signal.removeEventListener('abort', stop);
      stop();
      queue.length = 0;
      buffer = Buffer.alloc(0);
    }
  }
}
