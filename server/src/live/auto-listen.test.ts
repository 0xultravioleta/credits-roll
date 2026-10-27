import { afterEach, expect, test, vi } from 'vitest';
import { AutoListener, HLS_RETRIES, HLS_RETRY_MS } from './auto-listen.js';
import { parseEventSub } from '../twitch/parser.js';

afterEach(() => vi.useRealTimers());
function setup(initial: string | null = null, pause = '') {
  const start = vi.fn(async (_id: string) => undefined);
  const stop = vi.fn(async () => undefined);
  const finish = vi.fn(async () => undefined);
  let paused = pause;
  let blocker: string | null = null;
  const probe = vi.fn(async (): Promise<string | null> => initial);
  const options = {
    start,
    stop,
    finish,
    probe,
    blockReason: () => blocker,
    readPause: () => paused,
    savePause: (value: string) => {
      paused = value;
    },
    now: () => 1234,
  };
  return {
    listener: new AutoListener(options),
    options,
    start,
    stop,
    finish,
    probe,
    block: (reason: string) => {
      blocker = reason;
    },
  };
}
test('a synthetic online notification starts once per Twitch stream, including redelivery on reconnect', async () => {
  const { listener, start } = setup();
  await listener.ready();
  expect(listener.snapshot().phase).toBe('standby');
  const event = parseEventSub(
    JSON.stringify({
      metadata: {
        message_type: 'notification',
        subscription_type: 'stream.online',
        message_id: 'delivery',
      },
      payload: { event: { id: 'stream-one', broadcaster_user_id: 'channel', type: 'live' } },
    }),
  );
  expect(event?.type).toBe('online');
  if (event?.type !== 'online') throw new Error('Online event rejected');
  await listener.online(event.streamId);
  await listener.online(event.streamId);
  expect(start).toHaveBeenCalledExactlyOnceWith('stream-one');
  expect(listener.snapshot().listening).toBe(false);
  listener.audio();
  listener.chat();
  expect(listener.snapshot()).toMatchObject({
    phase: 'listening',
    listening: true,
    lastAudioAt: 1234,
    lastChatAt: 1234,
  });
  await listener.close();
});
test('offline rolls credits once, releases capture and returns to standby', async () => {
  const { listener, stop, finish } = setup('stream');
  await listener.ready();
  listener.audio();
  await listener.offline();
  await listener.offline();
  expect(finish).toHaveBeenCalledTimes(1);
  expect(stop).toHaveBeenCalled();
  expect(listener.snapshot()).toMatchObject({ phase: 'standby', listening: false });
});
test('startup and reconnect probe an already-live channel without another Start click', async () => {
  const { listener, start, probe } = setup('live-at-boot');
  await listener.ready();
  await listener.ready();
  expect(probe).toHaveBeenCalledTimes(2);
  expect(start).toHaveBeenCalledExactlyOnceWith('live-at-boot');
  await listener.close();
});
test('failed HLS startup retries six times at twenty-second intervals, then exposes a reason', async () => {
  vi.useFakeTimers();
  const { listener, start } = setup('stream');
  start.mockRejectedValue(new Error('synthetic HLS not ready'));
  await listener.ready();
  expect(start).toHaveBeenCalledTimes(1);
  for (let retry = 1; retry <= HLS_RETRIES; retry++) {
    await vi.advanceTimersByTimeAsync(HLS_RETRY_MS - 1);
    expect(start).toHaveBeenCalledTimes(retry);
    await vi.advanceTimersByTimeAsync(1);
    expect(start).toHaveBeenCalledTimes(retry + 1);
  }
  expect(listener.snapshot()).toMatchObject({ listening: false, phase: 'not-listening' });
  expect(listener.snapshot().reason).toContain('after 6 retries');
  await listener.online('stream');
  expect(start).toHaveBeenCalledTimes(7);
  await listener.close();
});
test('HLS recovers on retry; audio is required before claiming Listening', async () => {
  vi.useFakeTimers();
  const { listener, start } = setup('stream');
  start.mockRejectedValueOnce(new Error('not ready'));
  await listener.ready();
  await vi.advanceTimersByTimeAsync(HLS_RETRY_MS);
  expect(start).toHaveBeenCalledTimes(2);
  expect(listener.snapshot().listening).toBe(false);
  listener.audio();
  expect(listener.snapshot().phase).toBe('listening');
  await listener.close();
});
test('Stop cancels retries and its pause survives restart for the same stream; next stream starts', async () => {
  vi.useFakeTimers();
  const { listener, options, start } = setup('stream');
  await listener.ready();
  listener.failure();
  await listener.pause();
  await vi.advanceTimersByTimeAsync(HLS_RETRY_MS * 2);
  expect(start).toHaveBeenCalledTimes(1);
  const restarted = new AutoListener(options);
  await restarted.ready();
  expect(start).toHaveBeenCalledTimes(1);
  expect(restarted.snapshot().reason).toContain('Stopped by you');
  expect(restarted.snapshot().lastAudioAt).toBeNull();
  await restarted.online('next-stream');
  expect(start).toHaveBeenCalledTimes(2);
  await restarted.close();
});
test('Auto-listen off waits for explicit Start; missing tools expose a useful reason', async () => {
  const { listener, start, block } = setup('stream');
  await listener.configure(false);
  await listener.ready();
  expect(start).not.toHaveBeenCalled();
  expect(listener.snapshot().phase).toBe('not-listening');
  block('streamlink is not installed: live audio needs it; practice works without it.');
  await listener.online('stream', true);
  expect(listener.snapshot().reason).toContain('streamlink');
  expect(start).not.toHaveBeenCalled();
});
test('a stale startup probe cannot undo a more recent online event', async () => {
  const { listener, probe, start } = setup();
  let complete!: (value: string | null) => void;
  probe.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  const ready = listener.ready();
  await listener.online('fresh');
  complete(null);
  await ready;
  expect(start).toHaveBeenCalledExactlyOnceWith('fresh');
  expect(listener.snapshot().phase).toBe('connecting');
  await listener.close();
});
