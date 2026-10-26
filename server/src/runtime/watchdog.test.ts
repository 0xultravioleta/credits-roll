import { afterEach, expect, test, vi } from 'vitest';
import { HealthWatchdog, reportLag } from './watchdog.js';
import { OpenAIClient } from '../ai/openai.js';
import { Matcher } from '../matcher/index.js';

afterEach(() => vi.useRealTimers());
test.each(['fetch', 'body'])(
  'OpenAI aborts a hanging %s after 30 seconds without exposing provider data',
  async (stage) => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const request = vi.fn<typeof fetch>(async (_url, options) => {
      signal = options?.signal as AbortSignal;
      if (stage === 'fetch') return new Promise<Response>(() => undefined);
      return { ok: true, json: () => new Promise(() => undefined) } as Response;
    });
    const operation = new OpenAIClient('synthetic-private-key', request).post('embeddings', {});
    const rejected = expect(operation).rejects.toThrow(/^OpenAI request failed$/);
    await vi.advanceTimersByTimeAsync(30_000);
    await rejected;
    expect(signal?.aborted).toBe(true);
  },
);
test('Stop aborts an in-flight OpenAI call immediately', async () => {
  const controller = new AbortController();
  const request = vi.fn<typeof fetch>(async () => new Promise(() => undefined));
  const operation = new OpenAIClient('synthetic-private-key', request).post(
    'embeddings',
    {},
    controller.signal,
  );
  controller.abort();
  await expect(operation).rejects.toThrow('OpenAI request failed');
});
test('a hanging fake judge is bounded and audited rather than blocking the matching queue', async () => {
  vi.useFakeTimers();
  const audit = vi.fn();
  const matcher = new Matcher(
    { judge: async () => new Promise(() => undefined) },
    undefined,
    undefined,
    audit,
  );
  const operation = matcher.match(
    { id: 'w', streamId: 's', startAt: 100, endAt: 100, text: 'Synthetic adoption' },
    [
      {
        id: 'm',
        viewer: { id: 'v', login: 'syntheticviewer' },
        sentAt: 99,
        text: 'Try the northern bridge',
      },
    ],
  );
  const rejected = expect(operation).rejects.toThrow('Matching provider failed or timed out');
  await vi.advanceTimersByTimeAsync(30_000);
  await rejected;
  expect(audit).toHaveBeenCalledWith(
    expect.objectContaining({ reason: 'provider-failed-or-timed-out', kept: false }),
  );
});
test('a hung health probe cannot suppress the 90-second watchdog exit', async () => {
  vi.useFakeTimers();
  let now = 0;
  const exit = vi.fn();
  const log = vi.fn();
  const watchdog = new HealthWatchdog({
    now: () => now,
    probe: async () => new Promise(() => undefined),
    exit,
    log,
  });
  for (now = 0; now <= 90_000; now += 30_000) {
    const tick = watchdog.tick();
    await vi.advanceTimersByTimeAsync(5000);
    await tick;
  }
  await watchdog.tick();
  expect(exit).toHaveBeenCalledOnce();
  expect(log).toHaveBeenCalledWith(
    expect.stringContaining('WATCHDOG: /health has not answered for 90 seconds'),
  );
});
test('successful health responses reset the deadline and lag logging uses the real 500-ms boundary', async () => {
  let now = 0;
  let healthy = true;
  const exit = vi.fn();
  const log = vi.fn();
  const watchdog = new HealthWatchdog({ now: () => now, probe: async () => healthy, exit, log });
  now = 80_000;
  await watchdog.tick();
  healthy = false;
  now = 169_999;
  await watchdog.tick();
  expect(exit).not.toHaveBeenCalled();
  now = 170_000;
  await watchdog.tick();
  expect(exit).toHaveBeenCalledOnce();
  log.mockClear();
  reportLag(500, 100, log);
  expect(log).not.toHaveBeenCalled();
  reportLag(501, 400, log);
  expect(log).toHaveBeenCalledWith('Event-loop lag: max 501 ms; p99 400 ms.');
});
