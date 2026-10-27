import { afterEach, expect, test, vi } from 'vitest';
import { runDemo } from '../demo.js';
import { createApp } from '../app.js';
import { Store } from '../store/index.js';
import { HelixClipProvider } from './provider.js';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
test('demo illustrates five local clips while real Helix methods and fetch remain unused', async () => {
  const create = vi.spyOn(HelixClipProvider.prototype, 'create');
  const marker = vi.spyOn(HelixClipProvider.prototype, 'marker');
  const fetcher = vi.fn(() => {
    throw new Error('External requests forbidden');
  });
  vi.stubGlobal('fetch', fetcher);
  const output: string[] = [];
  const result = await runDemo({ once: true, port: 0, log: (line) => output.push(line) });
  expect(result.moments).toHaveLength(5);
  expect(output).toContain('DEMO CLIPS — 5 local illustrations; Demo clip - not on Twitch');
  expect(create).not.toHaveBeenCalled();
  expect(marker).not.toHaveBeenCalled();
  expect(fetcher).not.toHaveBeenCalled();
});
test('practice never invokes a real clip provider, and local demo pages disclose that no Twitch clip exists', async () => {
  const create = vi.spyOn(HelixClipProvider.prototype, 'create');
  const marker = vi.spyOn(HelixClipProvider.prototype, 'marker');
  const store = new Store();
  const { app } = createApp({ store });
  try {
    const state = (await app.inject('/dashboard/api/state')).json();
    expect(state.settings.clipsEnabled).toBe(true);
    for (const action of ['chat', 'speech'])
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/dashboard/api/practice/' + action,
            headers: { 'x-credits-csrf': state.csrf },
          })
        ).statusCode,
      ).toBe(200);
    expect((await app.inject('/dashboard/api/state')).json().moments).toBe(1);
    expect(create).not.toHaveBeenCalled();
    expect(marker).not.toHaveBeenCalled();
    expect((await app.inject('/demo/clip/demo-one')).body).toContain('Demo clip - not on Twitch');
    const thumbnail = await app.inject('/demo/clip-thumbnail.svg');
    expect(thumbnail.headers['content-type']).toContain('image/svg+xml');
    expect(thumbnail.body).toContain('Demo clip - not on Twitch');
  } finally {
    await app.close();
    store.close();
  }
});
