import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { spawn } from 'node:child_process';
import { afterEach, expect, test, vi } from 'vitest';
import { ProcessAudioRunner, AudioStall } from './runner.js';
import { LiveTranscriptSource } from './live.js';
import type { AudioRunner } from './runner.js';

afterEach(() => vi.useRealTimers());
class FakeChild extends EventEmitter {
  stdout = new PassThrough();
  stdin = new PassThrough();
  kill = vi.fn(() => {
    this.emit('close', null);
    return true;
  });
}
test.each(['streamlink', 'ffmpeg'])(
  'a silent %s pipe kills both owned children after 60 seconds',
  async (silent) => {
    vi.useFakeTimers();
    const children: FakeChild[] = [];
    const spawnFake = vi.fn(() => {
      const child = new FakeChild();
      children.push(child);
      return child;
    });
    const runner = new ProcessAudioRunner(
      undefined,
      Date.now,
      spawnFake as unknown as typeof spawn,
    );
    const iterator = runner.chunks('syntheticchannel', new AbortController().signal);
    const consuming = (async () => {
      for await (const audio of iterator) expect(audio.chunk.bytes.length).toBeGreaterThan(0);
    })();
    const rejected = expect(consuming).rejects.toBeInstanceOf(AudioStall);
    const active = setInterval(() => {
      if (silent === 'ffmpeg') children[0]?.stdout.write(Buffer.alloc(1));
      else children[1]?.stdout.write(Buffer.alloc(32_000));
    }, 1000);
    await vi.advanceTimersByTimeAsync(60_000);
    clearInterval(active);
    await rejected;
    expect(children).toHaveLength(2);
    for (const child of children) expect(child.kill).toHaveBeenCalledWith('SIGKILL');
  },
);
test('Stop destroys both pipes immediately and availability checks cannot hang', async () => {
  vi.useFakeTimers();
  const children: FakeChild[] = [];
  const spawnFake = vi.fn(() => {
    const child = new FakeChild();
    children.push(child);
    return child;
  });
  const runner = new ProcessAudioRunner(undefined, Date.now, spawnFake as unknown as typeof spawn);
  const controller = new AbortController();
  const audioInput = runner.chunks('syntheticchannel', controller.signal);
  const reading = audioInput[Symbol.asyncIterator]().next();
  controller.abort();
  expect((await reading).done).toBe(true);
  for (const child of children) {
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
    expect(child.stdout.destroyed).toBe(true);
  }
  const available = runner.available('streamlink');
  await vi.advanceTimersByTimeAsync(5000);
  expect(await available).toBe(false);
  expect(children[2]!.kill).toHaveBeenCalledWith('SIGKILL');
});
test('a fake runner that never yields is aborted and restarted, and Stop still finishes', async () => {
  vi.useFakeTimers();
  const signals: AbortSignal[] = [];
  const runner: AudioRunner = {
    available: async () => true,
    chunks: (_channel, signal) => {
      signals.push(signal);
      return {
        [Symbol.asyncIterator]: () => ({
          next: () => new Promise(() => undefined),
          return: async () => ({ done: true, value: undefined }),
        }),
      };
    },
  };
  const controller = new AbortController();
  const status = vi.fn();
  const source = new LiveTranscriptSource({
    channel: 'synthetic',
    streamId: 's',
    apiKeyPresent: true,
    runner,
    transcriber: { transcribe: async () => 'Synthetic words' },
    status,
  });
  const running = source.run(() => undefined, controller.signal);
  await vi.advanceTimersByTimeAsync(61_000);
  expect(signals).toHaveLength(2);
  expect(signals[0]!.aborted).toBe(true);
  expect(status).toHaveBeenCalledWith(expect.stringContaining('Restarting capture'));
  controller.abort();
  expect(await running).toBe('aborted');
  expect(signals[1]!.aborted).toBe(true);
});
