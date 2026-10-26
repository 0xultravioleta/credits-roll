import { afterEach, expect, test, vi } from 'vitest';
import { createApp } from '../app.js';
import { Store } from '../store/index.js';
import { DashboardState, DEFAULT_SETTINGS } from './state.js';

const resources: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of resources.splice(0)) await close();
});
function setup() {
  const store = new Store();
  const spinWheel = vi.fn(async () => ({ winner: null }));
  const result = createApp({ store, actions: { spinWheel } });
  resources.push(async () => {
    await result.app.close();
    store.close();
  });
  return { ...result, store, spinWheel };
}

test('serves accessible dashboard and persists validated settings behind CSRF checks', async () => {
  const { app, store } = setup();
  const page = await app.inject('/dashboard');
  expect(page.statusCode).toBe(200);
  expect(page.body).toContain('Live transcript');
  expect(page.headers['content-security-policy']).toContain("script-src 'self'");
  const csrf = (await app.inject('/dashboard/api/state')).json().csrf;
  const payload = { ...DEFAULT_SETTINGS, prizeText: 'Choose a map', quietMode: false };
  expect(
    (await app.inject({ method: 'POST', url: '/dashboard/api/settings', payload })).statusCode,
  ).toBe(403);
  expect(
    (
      await app.inject({
        method: 'POST',
        url: '/dashboard/api/settings',
        headers: { 'x-credits-csrf': csrf, origin: 'https://example.com' },
        payload,
      })
    ).statusCode,
  ).toBe(403);
  expect(
    (
      await app.inject({
        method: 'POST',
        url: '/dashboard/api/settings',
        headers: { 'x-credits-csrf': csrf },
        payload,
      })
    ).statusCode,
  ).toBe(200);
  expect(new DashboardState(store).getSettings()).toEqual(payload);
  expect(
    (
      await app.inject({
        method: 'POST',
        url: '/dashboard/api/settings',
        headers: { 'x-credits-csrf': csrf },
        payload: { ...payload, confidenceThreshold: 0.1 },
      })
    ).statusCode,
  ).toBe(400);
});

test('dispatches controls and rejects DNS rebinding hosts', async () => {
  const { app, hub, spinWheel } = setup();
  const csrf = (await app.inject('/dashboard/api/state')).json().csrf;
  await app.inject({
    method: 'POST',
    url: '/dashboard/api/credits',
    headers: { 'x-credits-csrf': csrf },
  });
  expect(hub.snapshot().phase).toBe('credits');
  await app.inject({
    method: 'POST',
    url: '/dashboard/api/spin',
    headers: { 'x-credits-csrf': csrf },
  });
  expect(spinWheel).toHaveBeenCalledOnce();
  expect(
    (await app.inject({ url: '/dashboard/api/state', headers: { host: 'attacker.example' } }))
      .statusCode,
  ).toBe(403);
});

test('keeps transcripts transient, bounded and off disk', () => {
  const { store } = setup();
  let now = 0;
  const state = new DashboardState(store, () => now);
  const window = { id: 'w', streamId: 's', startAt: 0, endAt: 1000, text: 'Synthetic transcript' };
  for (let i = 0; i < 12; i++) state.transcript({ ...window, id: String(i) });
  expect(state.getTranscripts()).toHaveLength(8);
  expect(store.getSetting('transcripts')).toBeUndefined();
  now = 90_000;
  expect(state.getTranscripts()).toEqual([]);
});
