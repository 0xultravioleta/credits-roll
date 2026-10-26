import { spawn } from 'node:child_process';
import type { AudioChunk } from '../ai/interfaces.js';
import { validLogin } from '../twitch/source.js';

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

export class ProcessAudioRunner implements AudioRunner {
  constructor(
    private readonly tools = { streamlink: 'streamlink', ffmpeg: 'ffmpeg' },
    private readonly now: () => number = Date.now,
  ) {}
  async available(tool: 'streamlink' | 'ffmpeg'): Promise<boolean> {
    return new Promise((resolve) => {
      const process = spawn(this.tools[tool], [tool === 'ffmpeg' ? '-version' : '--version'], {
        windowsHide: true,
        stdio: 'ignore',
      });
      const timeout = setTimeout(() => {
        process.kill();
        resolve(false);
      }, 5000);
      process.once('error', () => {
        clearTimeout(timeout);
        resolve(false);
      });
      process.once('close', (code) => {
        clearTimeout(timeout);
        resolve(code === 0);
      });
    });
  }
  async *chunks(channel: string, signal: AbortSignal): AsyncIterable<CapturedAudio> {
    if (!validLogin(channel)) throw new Error('Invalid Twitch channel');
    if (signal.aborted) return;
    const source = spawn(
      this.tools.streamlink,
      ['--stdout', '--twitch-low-latency', `https://www.twitch.tv/${channel}`, 'audio_only,best'],
      { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] },
    );
    const converter = spawn(
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
    let failed = false;
    let buffer = Buffer.alloc(0);
    const sourceDone = new Promise<number | null>((resolve) => {
      source.once('close', resolve);
      source.once('error', () => resolve(-1));
    });
    const converterDone = new Promise<number | null>((resolve) => {
      converter.once('close', resolve);
      converter.once('error', () => resolve(-1));
    });
    const stop = () => {
      source.kill();
      converter.kill();
      source.stdout.destroy();
      converter.stdout.destroy();
    };
    const fail = () => {
      failed = true;
      stop();
    };
    source.once('error', fail);
    converter.once('error', fail);
    converter.stdin.on('error', () => undefined);
    source.once('exit', (code) => {
      if (code !== 0 && !signal.aborted) fail();
    });
    converter.once('exit', (code) => {
      if (code !== 0 && !signal.aborted) failed = true;
    });
    signal.addEventListener('abort', stop, { once: true });
    source.stdout.pipe(converter.stdin);
    try {
      for await (const bytes of converter.stdout) {
        if (signal.aborted) break;
        const data = Buffer.from(bytes as Uint8Array);
        buffer = Buffer.concat([buffer, data]);
        while (buffer.length >= 640_000) {
          const pcm = buffer.subarray(0, 640_000);
          buffer = Buffer.from(buffer.subarray(640_000));
          yield capturePcm(pcm, this.now());
          if (signal.aborted) return;
        }
      }
      const codes = await Promise.all([sourceDone, converterDone]);
      if ((failed || codes.some((code) => code !== 0)) && !signal.aborted)
        throw new Error('Audio capture process failed');
      if (buffer.length >= 32_000 && !signal.aborted) {
        const pcm = buffer.subarray(0, buffer.length - (buffer.length % 2));
        yield capturePcm(pcm, this.now());
      }
    } catch {
      if (!signal.aborted) throw new Error('Audio capture process failed');
    } finally {
      signal.removeEventListener('abort', stop);
      source.stdout.unpipe(converter.stdin);
      stop();
      buffer = Buffer.alloc(0);
    }
  }
}
