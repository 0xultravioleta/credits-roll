import { expect, test, vi } from 'vitest';
import { shutdownHosted } from './shutdown.js';
import { Helix } from '../twitch/helix.js';

test('hosted shutdown cancels inputs before closing pipeline, durable logs and SQLite', async () => {
  const order: string[] = [];
  await shutdownHosted({
    stopInputs: async () => {
      order.push('inputs');
    },
    closePipeline: () => {
      order.push('pipeline');
    },
    closeServer: async () => {
      order.push('server');
    },
    flush: async () => {
      order.push('flush');
    },
    closeStore: () => {
      order.push('store');
    },
    log: () => {},
    exit: (code) => {
      order.push(`exit:${code}`);
    },
  });
  expect(order).toEqual(['inputs', 'pipeline', 'server', 'flush', 'store', 'exit:0']);
});
test('hung input cleanup cannot block durable flush and database close', async () => {
  const flush = vi.fn(async () => undefined);
  const closeStore = vi.fn();
  const exit = vi.fn();
  await shutdownHosted({
    stopInputs: () => new Promise(() => {}),
    closePipeline: () => {},
    closeServer: async () => {},
    flush,
    closeStore,
    exit,
    log: () => {},
    deadlineMs: 5,
    exitMs: 100,
  });
  expect(flush).toHaveBeenCalledOnce();
  expect(closeStore).toHaveBeenCalledOnce();
  expect(exit).toHaveBeenCalledWith(1);
});
test('hosted network cancellation aborts an owned hanging Helix fetch', async () => {
  const controller = new AbortController();
  let called!: () => void;
  const started = new Promise<void>((resolve) => {
    called = resolve;
  });
  const fetcher = vi.fn<typeof fetch>(async (_url, options) => {
    called();
    return new Promise((_resolve, reject) => {
      options!.signal!.addEventListener('abort', () => reject(new Error('aborted')), {
        once: true,
      });
    });
  });
  const helix = new Helix(
    {
      config: { clientId: 'synthetic', clientSecret: '', redirectUri: '' },
      accessToken: async () => 'synthetic-token',
    },
    fetcher,
    undefined,
    controller.signal,
  );
  const operation = helix.request('streamer', 'streams');
  await started;
  controller.abort();
  await expect(operation).rejects.toThrow('Twitch request unavailable');
  await expect(helix.request('streamer', 'streams')).rejects.toThrow();
  expect(fetcher).toHaveBeenCalledOnce();
});
