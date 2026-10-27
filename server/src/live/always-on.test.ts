import { afterEach, expect, test, vi } from 'vitest';
import { createApp } from '../app.js';
import { Store } from '../store/index.js';
import { OAuthAccounts } from '../auth/oauth.js';
import { CORE_SCOPES } from '../auth/types.js';
import type { Accounts } from '../auth/types.js';
import { createProviders } from '../ai/providers.js';
import { Matcher } from '../matcher/index.js';
import { Pipeline } from '../pipeline.js';
import { LiveRuntime } from './runtime.js';
import type { LiveSourceOptions } from '../twitch/live.js';
import type { TwitchApi } from '../twitch/helix.js';

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close();
});
const untilAbort = (signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (signal.aborted) resolve();
    else signal.addEventListener('abort', () => resolve(), { once: true });
  });
async function setup(live = false, type = '') {
  const tokens: Accounts = {};
  for (const role of ['streamer', 'bot'] as const)
    tokens[role] = {
      userId: role,
      login: role,
      accessToken: 'synthetic',
      refreshToken: 'synthetic',
      expiresAt: Date.now() + 3600_000,
      expiresIn: 3600,
      scopes: [...CORE_SCOPES[role]],
    };
  const accounts = new OAuthAccounts(
    {
      clientId: 'synthetic',
      clientSecret: 'synthetic',
      redirectUri: 'http://localhost:3101/auth/callback',
    },
    { read: () => tokens, write: () => undefined },
    {
      exchange: async () => {
        throw new Error('unused');
      },
      refresh: async () => {
        throw new Error('unused');
      },
      validate: async () => {
        throw new Error('unused');
      },
    },
  );
  const calls: { path: string; body?: unknown }[] = [];
  const twitchApi: TwitchApi = {
    request: async (_role, path, options) => {
      calls.push({ path, body: options?.body });
      if (path === 'users') return { data: [{ id: 'streamer', broadcaster_type: type }] };
      if (path === 'streams') return { data: live ? [{ id: 'stream-one' }] : [] };
      if (path === 'eventsub/subscriptions') return { data: [] };
      throw new Error('Unexpected synthetic API path');
    },
  };
  const store = new Store();
  let runtime!: LiveRuntime;
  const result = createApp({
    store,
    accounts,
    environment: () => ({
      liveEnabled: true,
      apiKeyPresent: true,
      tools: { streamlink: true, ffmpeg: true },
      listening: runtime.running,
      broadcasterType: runtime.broadcasterType,
      status: runtime.auto.snapshot(),
    }),
  });
  const providers = createProviders({});
  const pipeline = new Pipeline({
    store,
    scoring: result.scoring,
    hub: result.hub,
    matcher: new Matcher(providers.judge),
    transcriber: providers.transcriber,
  });
  let events!: LiveSourceOptions;
  const capture = vi.fn((_stream: string, _channel: string, onAudio: () => void) => ({
    run: async (_handler: unknown, signal: AbortSignal) => {
      onAudio();
      await untilAbort(signal);
      return 'aborted' as const;
    },
  }));
  runtime = new LiveRuntime({
    ...result,
    store,
    pipeline,
    accounts,
    enabled: true,
    apiKeyPresent: true,
    transcriber: providers.transcriber,
    audioDelay: 0,
    tools: { streamlink: true, ffmpeg: true },
    twitchApi,
    eventSource: (_config, options) => {
      events = options;
      return {
        run: async (_handler, signal) => {
          await options.subscribe!('synthetic-session', signal);
          await options.onReady!();
          await untilAbort(signal);
        },
      };
    },
    chatSource: () => ({ run: async (_handler, signal) => untilAbort(signal) }),
    transcriptSource: capture,
  });
  cleanup.push(async () => {
    await runtime.stop();
    pipeline.close();
    await result.app.close();
    store.close();
  });
  await runtime.initialize();
  await vi.waitFor(() =>
    expect(runtime.auto.snapshot().phase).toBe(live ? 'listening' : 'standby'),
  );
  return { ...result, runtime, calls, capture, events: () => events };
}
test('standby uses streamer subscriptions, a real parsed online event starts capture, and offline rolls stored credits', async () => {
  const { runtime, calls, capture, events, hub, scoring, app } = await setup();
  expect(
    calls
      .filter((row) => row.path === 'eventsub/subscriptions')
      .map((row) => (row.body as { type: string }).type),
  ).toEqual(['stream.online', 'stream.offline']);
  await events().onEvent!({
    type: 'online',
    deliveryId: 'one',
    broadcasterId: 'streamer',
    streamId: 'stream-one',
  });
  await events().onEvent!({
    type: 'online',
    deliveryId: 'two',
    broadcasterId: 'streamer',
    streamId: 'stream-one',
  });
  expect(capture).toHaveBeenCalledTimes(1);
  scoring.credit({
    id: 'credit',
    messageId: 'message',
    streamId: 'stream-one',
    viewer: { id: 'viewer', login: 'mapmaker' },
    quote: 'Try the northern bridge',
    kind: 'idea',
    confidence: 1,
    occurredAt: Date.now(),
  });
  const health = (await app.inject('/health')).json();
  expect(health).toMatchObject({ autoListen: true, listening: true, lastChatAt: null });
  expect(health.lastAudioAt).toBeGreaterThan(0);
  await events().onEvent!({ type: 'offline', deliveryId: 'three', broadcasterId: 'streamer' });
  expect(runtime.auto.snapshot().phase).toBe('standby');
  expect(hub.snapshot().phase).toBe('credits');
  expect(hub.snapshot().credits[0]?.viewer.login).toBe('mapmaker');
});
test('startup probes Get Streams and resumes an already-live channel without future scopes or Affiliate status', async () => {
  const { capture, calls, app } = await setup(true);
  expect(capture).toHaveBeenCalledTimes(1);
  expect(calls.some((row) => row.path === 'streams')).toBe(true);
  const state = (await app.inject('/dashboard/api/state')).json();
  expect(state.capabilities.broadcasterType).toBe('');
  expect(state.capabilities.wheelAvailable).toBe(false);
  expect(state.capabilities.features.every((row: { granted: boolean }) => !row.granted)).toBe(true);
});
