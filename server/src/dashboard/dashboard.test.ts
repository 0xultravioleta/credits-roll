import { afterEach, expect, test, vi } from 'vitest';
import { createApp } from '../app.js';
import { Store } from '../store/index.js';
import { DashboardState, DEFAULT_SETTINGS } from './state.js';
import { OAuthAccounts } from '../auth/oauth.js';
import type { Accounts, AccountRole } from '../auth/types.js';
import { SCOPES } from '../auth/types.js';
import { OverlayModel } from '../../../overlay/src/state.js';
import type { OverlayEvent } from '../events/protocol.js';

const resources: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of resources.splice(0)) await close();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});
function setup(options: Partial<Parameters<typeof createApp>[0]> = {}) {
  const store = new Store();
  const spinWheel = vi.fn(async () => ({ winner: null }));
  const result = createApp({ ...options, store, actions: { spinWheel, ...options.actions } });
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
  const restored = new DashboardState(store);
  expect(restored.getSettings()).toEqual(payload);
  restored.close();
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
  resources.push(async () => state.close());
  const window = { id: 'w', streamId: 's', startAt: 0, endAt: 1000, text: 'Synthetic transcript' };
  for (let i = 0; i < 12; i++) state.transcript({ ...window, id: String(i) });
  expect(state.getTranscripts()).toHaveLength(8);
  expect(store.getSetting('transcripts')).toBeUndefined();
  now = 90_000;
  expect(state.getTranscripts()).toEqual([]);
});

async function command(app: ReturnType<typeof createApp>['app'], action: string, payload = {}) {
  const csrf = (await app.inject('/dashboard/api/state')).json().csrf;
  return app.inject({
    method: 'POST',
    url: `/dashboard/api/${action}`,
    headers: { 'x-credits-csrf': csrf },
    payload,
  });
}

function fakeAccounts(sameAccount = false) {
  let saved: Accounts = Object.fromEntries(
    (['streamer', 'bot'] as const).map((role) => [
      role,
      {
        userId: sameAccount ? 'same-id' : `${role}-id`,
        login: `synthetic${role}`,
        accessToken: 'synthetic-private-token',
        refreshToken: 'synthetic-private-refresh',
        expiresAt: Date.now() + 3_600_000,
        expiresIn: 3600,
        scopes: [...SCOPES[role]],
      },
    ]),
  );
  const unavailable = async (): Promise<never> => {
    throw new Error('Unexpected OAuth request');
  };
  return new OAuthAccounts(
    {
      clientId: 'synthetic',
      clientSecret: 'synthetic-private-secret',
      redirectUri: 'http://localhost/auth/callback',
    },
    {
      read: () => saved,
      write: (value) => {
        saved = value;
      },
    },
    { exchange: unavailable, refresh: unavailable, validate: unavailable },
  );
}

test('dashboard contains the story, trial, preview, OBS instructions and distinct account controls', async () => {
  const { app } = setup();
  const page = (await app.inject('/dashboard')).body.replace(/\r\n/g, '\n');
  for (const text of [
    'Start here',
    'Try the northern bridge',
    'Try it without being live',
    'Simulate a viewer message',
    'Simulate the streamer speaking',
    '1920',
    '1080',
    'transparent',
    '/overlay/?preview=1',
    'Activity',
    'private window',
    'Disconnect streamer',
    'Disconnect bot',
  ])
    expect(page).toContain(text);
  const state = (await app.inject('/dashboard/api/state')).json();
  expect(state.setup.steps.map((step: { done: boolean }) => step.done)).toEqual([
    false,
    false,
    false,
    false,
  ]);
  expect(state.practice.available).toBe(true);
  expect(state.wheelStatus).toContain('Live wheel disabled');
  expect(state.wheelStatus).toContain('Affiliate or Partner');
});

test.each(['streamer', 'bot'] as AccountRole[])(
  'disconnects only the %s role and returns login names without secrets',
  async (role) => {
    const accounts = fakeAccounts();
    const { app } = setup({ accounts });
    const before = await app.inject('/dashboard/api/state');
    expect(before.json().accounts[role].login).toBe(`synthetic${role}`);
    expect(before.body).not.toContain('synthetic-private');
    expect((await command(app, 'disconnect', { role: 'invalid' })).statusCode).toBe(400);
    expect((await command(app, 'disconnect', { role })).statusCode).toBe(200);
    expect(accounts.identity(role)).toBeUndefined();
    expect(accounts.identity(role === 'bot' ? 'streamer' : 'bot')).toBeDefined();
  },
);

test('same-account warning is exposed from the actual safe account summaries', async () => {
  const { app } = setup({ accounts: fakeAccounts(true) });
  const state = (await app.inject('/dashboard/api/state')).json();
  expect(state.setup.sameAccount).toBe(true);
  expect(state.setup.canStart).toBe(false);
  expect(state.setup.steps[1].done).toBe(false);
});

test('practice drives a real matched moment, overlay pop-up, counters, end credits and weighted draw offline', async () => {
  vi.stubEnv('OPENAI_API_KEY', 'synthetic-unused-key');
  vi.stubEnv('JUDGE', 'openai');
  const request = vi
    .spyOn(globalThis, 'fetch')
    .mockRejectedValue(new Error('Unexpected external request'));
  const liveCredits = vi.fn(async () => ({}));
  const { app, hub, store, spinWheel } = setup({ actions: { rollCredits: liveCredits } });
  const model = new OverlayModel();
  const events: OverlayEvent[] = [];
  const unsubscribe = hub.subscribe((event) => {
    events.push(event);
    model.accept(event, 0);
  });
  try {
    expect((await command(app, 'practice/chat')).statusCode).toBe(200);
    const chatState = (await app.inject('/dashboard/api/state')).json();
    expect(chatState.moments).toBe(0);
    expect(chatState.activity[0].text).toBe('Chat: @mapmaker: Try the northern bridge');
    const result = await command(app, 'practice/speech');
    expect(result.statusCode).toBe(200);
    expect(result.json().moments).toHaveLength(1);
    expect(result.json().moments[0]).toMatchObject({
      viewer: { login: 'mapmaker' },
      quote: 'Try the northern bridge',
      kind: 'idea',
      confidence: 0.95,
    });
    model.tick(1);
    expect(model.current?.moment.quote).toBe('Try the northern bridge');
    expect(events.some((event) => event.type === 'moment')).toBe(true);
    const state = (await app.inject('/dashboard/api/state')).json();
    expect(state).toMatchObject({ moments: 1, creditedViewers: 1, practice: { active: true } });
    expect(state.wheel[0]).toMatchObject({ points: 10, weight: 4 });
    expect(state.activity.map((entry: { text: string }) => entry.text)).toEqual([
      'Chat: @mapmaker: Try the northern bridge',
      "Heard the streamer: Good idea, I'm going to try the northern bridge.",
      'Moment found: @mapmaker moved the stream: Try the northern bridge',
    ]);
    expect((await command(app, 'practice/credits')).statusCode).toBe(200);
    expect(model.phase).toBe('credits');
    expect(model.credits[0]?.viewer.login).toBe('mapmaker');
    const draw = await command(app, 'practice/spin');
    expect(draw.json().winner).toMatchObject({ viewer: { login: 'mapmaker' }, weight: 4 });
    expect(draw.json().message).toContain('nothing sent to Twitch');
    expect(store.getMoments()).toEqual([]);
    expect(store.getReputation()).toEqual([]);
    expect(request).not.toHaveBeenCalled();
    expect(spinWheel).not.toHaveBeenCalled();
    expect(liveCredits).not.toHaveBeenCalled();
    hub.beginStream('live-stream');
    const liveState = (await app.inject('/dashboard/api/state')).json();
    expect(liveState).toMatchObject({
      moments: 0,
      creditedViewers: 0,
      activity: [],
      practice: { active: false },
      winner: null,
    });
    expect(liveState.wheel).toEqual([]);
  } finally {
    unsubscribe();
  }
});

test('practice rejects missing or foreign CSRF and explains speech without a preceding viewer message', async () => {
  const { app } = setup();
  expect(
    (await app.inject({ method: 'POST', url: '/dashboard/api/practice/chat', payload: {} }))
      .statusCode,
  ).toBe(403);
  const csrf = (await app.inject('/dashboard/api/state')).json().csrf;
  expect(
    (
      await app.inject({
        method: 'POST',
        url: '/dashboard/api/practice/chat',
        headers: { 'x-credits-csrf': csrf, origin: 'https://example.com' },
        payload: {},
      })
    ).statusCode,
  ).toBe(403);
  const speech = await command(app, 'practice/speech');
  expect(speech.statusCode).toBe(409);
  expect(speech.json().error).toContain('viewer message first');
  expect((await command(app, 'practice/spin')).statusCode).toBe(409);
  expect((await app.inject('/dashboard/api/state')).json().moments).toBe(0);
});

test('practice expires a pending suggestion and can repeat the scene with one fresh moment per pair', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-26T12:00:00Z'));
  const { app } = setup();
  await command(app, 'practice/chat');
  vi.setSystemTime(new Date('2026-10-26T12:01:31Z'));
  expect((await command(app, 'practice/speech')).statusCode).toBe(409);
  for (let index = 0; index < 2; index++) {
    await command(app, 'practice/chat');
    await command(app, 'practice/chat');
    expect((await command(app, 'practice/speech')).json().moments).toHaveLength(1);
  }
  expect((await app.inject('/dashboard/api/state')).json()).toMatchObject({
    moments: 2,
    creditedViewers: 1,
  });
});

test.each(['live listening', 'automatic replay'])(
  'practice cannot interrupt %s',
  async (reason) => {
    const { app, dashboard } = setup({
      environment: () => ({
        liveEnabled: true,
        apiKeyPresent: true,
        tools: { streamlink: true, ffmpeg: true },
        listening: reason === 'live listening',
      }),
    });
    dashboard.setReplayRunning(reason === 'automatic replay');
    const state = (await app.inject('/dashboard/api/state')).json();
    expect(state.practice.available).toBe(false);
    for (const action of ['chat', 'speech', 'credits', 'spin'])
      expect((await command(app, `practice/${action}`)).statusCode).toBe(409);
  },
);

test('activity expires after 90 seconds, stays bounded in memory and clears immediately on privacy requests', () => {
  const { store, hub, dashboard } = setup();
  let now = 0;
  const state = new DashboardState(store, () => now);
  resources.push(async () => state.close());
  const message = {
    id: 'chat',
    viewer: { id: 'viewer', login: 'syntheticviewer' },
    sentAt: 0,
    text: '<script>synthetic text</script>',
  };
  for (let index = 0; index < 45; index++) state.chat({ ...message, id: String(index) });
  expect(state.getActivity()).toHaveLength(40);
  expect(store.getSetting('activity')).toBeUndefined();
  now = 90_000;
  expect(state.getActivity()).toEqual([]);
  dashboard.chat(message);
  dashboard.transcript({
    id: 'window',
    streamId: 'live',
    startAt: 0,
    endAt: 1,
    text: 'Synthetic speech',
  });
  store.optOut(message.viewer.id);
  hub.forgetViewer(message.viewer.id);
  expect(dashboard.getActivity()).toEqual([]);
  expect(dashboard.getTranscripts()).toEqual([]);
});

test('setup detects actual overlay SSE connections and serves the current port in the Browser Source URL', async () => {
  const { app } = setup();
  const address = await app.listen({ host: '127.0.0.1', port: 0 });
  const before = (
    await app.inject({ url: '/dashboard/api/state', headers: { host: new URL(address).host } })
  ).json();
  expect(before.setup.overlayUrl).toBe(`${address}/overlay/`);
  expect(before.setup.steps[2].done).toBe(false);
  const response = await fetch(`${address}/events`);
  const reader = response.body!.getReader();
  try {
    expect(new TextDecoder().decode((await reader.read()).value)).toContain('"type":"snapshot"');
    expect((await app.inject('/dashboard/api/state')).json().setup.steps[2].done).toBe(true);
  } finally {
    await reader.cancel();
  }
});

test('the prize editor saves only prize text, validates it and returns scoring rules from the implementation', async () => {
  const { app, dashboard } = setup();
  const before = dashboard.getSettings();
  expect((await command(app, 'prize', { prizeText: 'Pick the next map' })).statusCode).toBe(200);
  expect(dashboard.getSettings()).toEqual({ ...before, prizeText: 'Pick the next map' });
  expect((await command(app, 'prize', { prizeText: '' })).statusCode).toBe(400);
  expect(
    (await command(app, 'prize', { prizeText: 'Valid prize', wheelEnabled: true })).statusCode,
  ).toBe(400);
  expect(
    (
      await app.inject({
        method: 'POST',
        url: '/dashboard/api/prize',
        payload: { prizeText: 'Different prize' },
      })
    ).statusCode,
  ).toBe(403);
  const state = (await app.inject('/dashboard/api/state')).json();
  expect(state.creditRules).toEqual({
    basePoints: { idea: 10, assist: 8, riff: 6 },
    weightBase: 1,
    weightCap: 20,
  });
  expect(state.settings.prizeText).toBe('Pick the next map');
});

test('Start explains missing authorization, accounts, tools and key instead of silently succeeding', async () => {
  const offline = setup();
  const missingAuth = await command(offline.app, 'start');
  expect(missingAuth.statusCode).toBe(409);
  expect(missingAuth.json().error).toContain('authorization is not configured');
  expect(missingAuth.json().error).toContain('Connect the streamer');
  const start = vi.fn(async () => undefined);
  const configured = setup({
    accounts: fakeAccounts(),
    actions: { start },
    environment: () => ({
      liveEnabled: true,
      apiKeyPresent: false,
      tools: { streamlink: false, ffmpeg: false },
      listening: false,
    }),
  });
  const missingTools = await command(configured.app, 'start');
  expect(missingTools.statusCode).toBe(409);
  for (const detail of [
    'OPENAI_API_KEY is missing',
    'streamlink is not installed',
    'ffmpeg is not installed',
  ])
    expect(missingTools.json().error).toContain(detail);
  expect(start).not.toHaveBeenCalled();
});

test('an active session exposes Stop and can be released before practicing', async () => {
  let listening = true;
  const start = vi.fn(async () => {
    listening = true;
  });
  const stop = vi.fn(async () => {
    listening = false;
  });
  const { app } = setup({
    accounts: fakeAccounts(),
    actions: { start, stop },
    environment: () => ({
      liveEnabled: true,
      apiKeyPresent: true,
      tools: { streamlink: true, ffmpeg: true },
      listening,
    }),
  });
  expect((await app.inject('/dashboard/api/state')).json().listening).toBe(true);
  expect((await app.inject('/dashboard')).body).toContain('Listening to your stream now.');
  const already = await command(app, 'start');
  expect(already.statusCode).toBe(409);
  expect(already.json().error).toContain('Choose Stop listening');
  expect((await command(app, 'practice/chat')).statusCode).toBe(409);
  expect((await command(app, 'stop')).statusCode).toBe(200);
  expect(stop).toHaveBeenCalledOnce();
  expect((await command(app, 'practice/chat')).statusCode).toBe(200);
  expect((await command(app, 'start')).statusCode).toBe(200);
  expect(start).toHaveBeenCalledOnce();
});
