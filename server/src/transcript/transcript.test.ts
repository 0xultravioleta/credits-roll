import { fileURLToPath } from 'node:url';
import { expect, test, vi } from 'vitest';
import { LiveTranscriptSource } from './live.js';
import { RecordedTranscriptSource } from './recorded.js';
import { capturePcm, wav } from './runner.js';
import type { AudioRunner } from './runner.js';
import type { TranscriptWindow } from '../domain.js';
import { OpenAIRequestFailure } from '../ai/failure.js';

function setup(available = true, key = true) {
  const runner: AudioRunner = {
    available: vi.fn(async () => available),
    chunks: vi.fn(async function* () {
      yield {
        chunk: { bytes: new Uint8Array([1, 2]), filename: 'chunk.wav', mimeType: 'audio/wav' },
        startAt: 1000,
        endAt: 21000,
      };
    }),
  };
  const transcriber = { transcribe: vi.fn(async () => "Good idea, I'll try the northern bridge.") };
  const status = vi.fn();
  const source = new LiveTranscriptSource({
    channel: 'synthetic',
    streamId: 'stream',
    apiKeyPresent: key,
    runner,
    transcriber,
    status,
    language: () => 'es',
    delayMs: 500,
  });
  return { runner, transcriber, status, source };
}

test('live transcript source uses injected runner, language and aligned 20-second windows', async () => {
  const { source, runner, transcriber } = setup();
  const windows: TranscriptWindow[] = [];
  expect(
    await source.run((window) => {
      windows.push(window);
    }, new AbortController().signal),
  ).toBe('ended');
  expect(runner.available).toHaveBeenCalledTimes(2);
  expect(transcriber.transcribe).toHaveBeenCalledWith(
    expect.objectContaining({ language: 'es' }),
    expect.any(AbortSignal),
  );
  expect(windows[0]).toMatchObject({
    startAt: 500,
    endAt: 20500,
    timing: 'chunk',
    streamId: 'stream',
  });
});

test('missing credentials or executables skip without capture or provider requests', async () => {
  for (const [tool, key] of [
    [true, false],
    [false, true],
  ]) {
    const { source, runner, transcriber, status } = setup(tool, key);
    expect(await source.run(() => undefined, new AbortController().signal)).toBe('skipped');
    expect(runner.chunks).not.toHaveBeenCalled();
    expect(transcriber.transcribe).not.toHaveBeenCalled();
    expect(status.mock.calls[0]?.[0]).toContain('skipped');
  }
});

test('cancellation prevents transcript publication after a transcription request', async () => {
  const { source, transcriber } = setup();
  const controller = new AbortController();
  const handler = vi.fn();
  transcriber.transcribe.mockImplementation(async () => {
    controller.abort();
    return 'Synthetic words';
  });
  expect(await source.run(handler, controller.signal)).toBe('aborted');
  expect(handler).not.toHaveBeenCalled();
});

test('fake runner failure is sanitized', async () => {
  const { source, runner } = setup();
  runner.chunks = async function* () {
    yield await Promise.reject(new Error('private content'));
  };
  await expect(source.run(() => undefined, new AbortController().signal)).rejects.toThrow(
    /^Live transcription stopped;/,
  );
});

test('three consecutive provider failures stop; a successful chunk resets the streak', async () => {
  const { source, runner, transcriber, status } = setup();
  runner.chunks = async function* () {
    for (let index = 0; index < 8; index++)
      yield {
        startAt: index * 20_000,
        endAt: (index + 1) * 20_000,
        chunk: { bytes: new Uint8Array([1]), filename: 'chunk.wav', mimeType: 'audio/wav' },
      };
  };
  let call = 0;
  transcriber.transcribe.mockImplementation(async () => {
    if (++call === 3) return ''; // Empty but successful transcription breaks the failure streak.
    throw new Error('private provider response');
  });
  await expect(source.run(() => undefined, new AbortController().signal)).rejects.toThrow(
    '3 consecutive provider failures',
  );
  expect(transcriber.transcribe).toHaveBeenCalledTimes(6);
  expect(status.mock.calls.flat().join(' ')).not.toContain('private provider response');
});

test('permanent provider rejection stops immediately rather than pretending to recover', async () => {
  const { source, transcriber } = setup();
  transcriber.transcribe.mockRejectedValue(new OpenAIRequestFailure(false, 'http-4xx'));
  await expect(source.run(() => undefined, new AbortController().signal)).rejects.toThrow(
    'provider rejected',
  );
  expect(transcriber.transcribe).toHaveBeenCalledOnce();
});

test('managed initial HLS stall returns to the bounded session retry budget instead of looping forever', async () => {
  vi.useFakeTimers();
  try {
    const runner: AudioRunner = {
      available: async () => true,
      chunks: vi.fn(async function* () {
        yield await new Promise<never>(() => undefined);
      }),
    };
    const onAudio = vi.fn();
    const source = new LiveTranscriptSource({
      channel: 'synthetic',
      streamId: 's',
      apiKeyPresent: true,
      runner,
      transcriber: { transcribe: async () => '' },
      startupManaged: true,
      onAudio,
    });
    const rejected = expect(
      source.run(() => undefined, new AbortController().signal),
    ).rejects.toThrow('Initial live audio capture failed');
    await vi.advanceTimersByTimeAsync(60_000);
    await rejected;
    expect(runner.chunks).toHaveBeenCalledTimes(1);
    expect(onAudio).not.toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
  }
});

test('WAV wrapper describes mono 16-kHz signed 16-bit PCM', () => {
  const result = Buffer.from(wav(new Uint8Array(640000)));
  expect(result.subarray(0, 4).toString()).toBe('RIFF');
  expect(result.readUInt32LE(24)).toBe(16000);
  expect(result.readUInt16LE(22)).toBe(1);
  expect(result.readUInt32LE(40)).toBe(640000);
});

test('capture timestamps cannot drift into the future when HLS delivers buffered audio', () => {
  const captured = capturePcm(new Uint8Array(640000), 100000);
  expect(captured.startAt).toBe(80000);
  expect(captured.endAt).toBe(100000);
});

test('recorded source replays demo transcript through the same interface', async () => {
  const source = new RecordedTranscriptSource(
    fileURLToPath(new URL('../../../demo/transcript.jsonl', import.meta.url)),
    { streamId: 'demo', origin: 1000 },
  );
  const windows: TranscriptWindow[] = [];
  expect(
    await source.run((window) => {
      windows.push(window);
    }, new AbortController().signal),
  ).toBe('ended');
  expect(windows).toHaveLength(6);
  expect(windows[0]?.startAt).toBe(5000);
});
