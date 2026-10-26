import { afterEach, expect, test } from 'vitest';
import { Store } from '../store/index.js';
import { createApp } from '../app.js';
import { encodeSse } from './hub.js';
import type { OverlayEvent } from './protocol.js';

const resources: { app: ReturnType<typeof createApp>['app']; store: Store }[] = [];
function setup(enableDev = true) {
  const store = new Store();
  const result = createApp({ store, enableDev });
  resources.push({ app: result.app, store });
  return { ...result, store };
}
afterEach(async () => {
  for (const { app, store } of resources.splice(0)) {
    await app.close();
    store.close();
  }
});

test('dev endpoints default to disabled', async () => {
  const { app } = setup(false);
  expect(
    (
      await app.inject({
        method: 'POST',
        url: '/dev/moment',
        payload: { viewer: 'test', quote: 'bridge' },
      })
    ).statusCode,
  ).toBe(404);
});

test('accepts a dev moment, updates the wheel and exposes credits for late subscribers', async () => {
  const { app, hub } = setup();
  const events: OverlayEvent[] = [];
  const unsubscribe = hub.subscribe((event) => {
    events.push(event);
  });
  const response = await app.inject({
    method: 'POST',
    url: '/dev/moment',
    payload: { viewer: 'mapmaker', quote: 'Try the northern bridge' },
  });
  expect(response.statusCode).toBe(201);
  expect(events[1]?.type).toBe('moment');
  expect((await app.inject('/wheel')).json().entries[0].weight).toBe(4);
  expect(
    (await app.inject({ method: 'POST', url: '/dev/credits', payload: {} })).json().phase,
  ).toBe('credits');
  expect(hub.snapshot().credits[0]?.viewer.login).toBe('mapmaker');
  const later: OverlayEvent[] = [];
  const stop = hub.subscribe((event) => {
    later.push(event);
  });
  expect(later[0]).toMatchObject({
    type: 'snapshot',
    state: { phase: 'credits', credits: [{ viewer: { login: 'mapmaker' } }] },
  });
  unsubscribe();
  stop();
  expect(hub.subscriberCount).toBe(0);
});

test('validates incoming dev payloads and never credits opted-out viewers', async () => {
  const { app, store } = setup();
  expect(
    (
      await app.inject({
        method: 'POST',
        url: '/dev/moment',
        payload: { viewer: '<script>', quote: 'hi' },
      })
    ).statusCode,
  ).toBe(400);
  store.optOut('dev:mapmaker');
  expect(
    (
      await app.inject({
        method: 'POST',
        url: '/dev/moment',
        payload: { viewer: 'mapmaker', quote: 'bridge' },
      })
    ).statusCode,
  ).toBe(409);
});

test('encodes untrusted newlines within JSON rather than as SSE control fields', () => {
  const event: OverlayEvent = { type: 'optout', viewerId: 'viewer\n\ndata: malicious' };
  const encoded = encodeSse(event);
  expect(encoded.split('\n')).toHaveLength(4);
  expect(JSON.parse(encoded.split('\n')[1]!.slice(6))).toEqual(event);
});

test('streams actual SSE snapshots and moments over HTTP', async () => {
  const { app } = setup();
  const address = await app.listen({ host: '127.0.0.1', port: 0 });
  const controller = new AbortController();
  try {
    const response = await fetch(`${address}/events`, { signal: controller.signal });
    expect(response.headers.get('content-type')).toBe('text/event-stream');
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    expect(decoder.decode((await reader.read()).value)).toContain('"type":"snapshot"');
    await app.inject({
      method: 'POST',
      url: '/dev/moment',
      payload: { viewer: 'mapmaker', quote: 'Try the bridge' },
    });
    expect(decoder.decode((await reader.read()).value)).toContain('"type":"moment"');
    await reader.cancel();
  } finally {
    controller.abort();
  }
});
