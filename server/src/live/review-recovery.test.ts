import { afterEach, expect, test, vi } from 'vitest';
import { Store } from '../store/index.js';
import { createApp } from '../app.js';
import { OAuthAccounts } from '../auth/oauth.js';
import { CORE_SCOPES } from '../auth/types.js';
import type { Accounts } from '../auth/types.js';
import { Pipeline } from '../pipeline.js';
import { Matcher } from '../matcher/index.js';
import { createProviders } from '../ai/providers.js';
import { OpenAIRequestFailure } from '../ai/failure.js';
import { ProcessAudioRunner } from '../transcript/runner.js';
import { abortableDelay } from '../runtime/time.js';
import { LiveRuntime } from './runtime.js';
import type { LiveSourceOptions } from '../twitch/live.js';

const closes: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of closes.splice(0)) await close();
  vi.useRealTimers();
});
const untilAbort = (signal: AbortSignal) =>
  signal.aborted
    ? Promise.resolve()
    : new Promise<void>((resolve) =>
        signal.addEventListener('abort', () => resolve(), { once: true }),
      );

async function setup() {
  vi.useFakeTimers();
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
  const store = new Store();
  const result = createApp({ store, accounts });
  const providers = createProviders({});
  const pipeline = new Pipeline({
    store,
    hub: result.hub,
    scoring: result.scoring,
    transcriber: providers.transcriber,
    matcher: new Matcher(providers.judge),
  });
  vi.spyOn(ProcessAudioRunner.prototype, 'available').mockResolvedValue(true);
  vi.spyOn(ProcessAudioRunner.prototype, 'chunks').mockImplementation(
    async function* (_channel, signal) {
      while (!signal.aborted) {
        await abortableDelay(20_000, signal).catch(() => undefined);
        if (signal.aborted) return;
        yield {
          startAt: Date.now() - 20_000,
          endAt: Date.now(),
          chunk: { bytes: new Uint8Array([1]), filename: 'chunk.wav', mimeType: 'audio/wav' },
        };
      }
    },
  );
  const transcribe = vi.fn(async () => '');
  let info: { id: string; language: string } | null = null;
  let probeOverride: (() => Promise<unknown>) | undefined;
  let events!: LiveSourceOptions;
  const chatStarted = vi.fn();
  const runtime = new LiveRuntime({
    ...result,
    store,
    pipeline,
    accounts,
    enabled: true,
    apiKeyPresent: true,
    audioDelay: 0,
    transcriber: { transcribe },
    transcriptionLanguage: 'en',
    tools: { streamlink: true, ffmpeg: true },
    twitchApi: {
      request: async (_role, path) => {
        if (path === 'users') return { data: [{ id: 'streamer', broadcaster_type: '' }] };
        if (path === 'streams')
          return probeOverride ? probeOverride() : { data: info ? [info] : [] };
        if (path === 'eventsub/subscriptions') return { data: [] };
        throw new Error('Unexpected synthetic API request');
      },
    },
    eventSource: (_config, options) => {
      events = options;
      return {
        run: async (_handler, signal) => {
          await options.onReady!();
          await untilAbort(signal);
        },
      };
    },
    chatSource: () => ({
      run: async (handler, signal) => {
        chatStarted();
        handler({
          id: 'chat',
          viewer: { id: 'viewer', login: 'synthetic_viewer' },
          text: 'Prueba el puente del norte',
          sentAt: Date.now(),
        });
        await untilAbort(signal);
      },
    }),
  });
  closes.push(async () => {
    await runtime.stop();
    pipeline.close();
    await result.app.close();
    store.close();
  });
  await runtime.initialize();
  await vi.advanceTimersByTimeAsync(0);
  const online = () =>
    events.onEvent!({
      type: 'online',
      deliveryId: 'synthetic-online',
      broadcasterId: 'streamer',
      streamId: 'stream-one',
    });
  return {
    ...result,
    runtime,
    transcribe,
    online,
    store,
    chatStarted,
    setInfo: (value: typeof info) => {
      info = value;
    },
    setProbe: (value?: typeof probeOverride) => {
      probeOverride = value;
    },
  };
}

test('R1: late Get Streams language and mid-stream changes reach the real audio source', async () => {
  const { runtime, online, transcribe, setInfo } = await setup();
  await online();
  expect(runtime.transcriptionStatus().warning).toContain('fallback');
  await vi.advanceTimersByTimeAsync(20_000);
  expect(transcribe).toHaveBeenLastCalledWith(
    expect.objectContaining({ language: 'en' }),
    expect.any(AbortSignal),
  );
  setInfo({ id: 'stream-one', language: 'es' });
  await vi.advanceTimersByTimeAsync(60_000);
  expect(runtime.transcriptionStatus()).toMatchObject({
    resolved: 'es',
    source: 'stream',
    warning: null,
  });
  expect(transcribe).toHaveBeenLastCalledWith(
    expect.objectContaining({ language: 'es' }),
    expect.any(AbortSignal),
  );
  setInfo({ id: 'stream-one', language: 'en' });
  await vi.advanceTimersByTimeAsync(60_000);
  expect(transcribe).toHaveBeenLastCalledWith(
    expect.objectContaining({ language: 'en' }),
    expect.any(AbortSignal),
  );
  await runtime.actions.stop!();
  expect(runtime.transcriptionStatus().streamLanguage).toBeNull();
});

test('R2: permanent rejection makes one provider call over five minutes; manual Start resumes', async () => {
  const { runtime, online, transcribe, setInfo, dashboard } = await setup();
  setInfo({ id: 'stream-one', language: 'es' });
  transcribe.mockRejectedValue(new OpenAIRequestFailure(false, 'http-4xx'));
  await online();
  await vi.advanceTimersByTimeAsync(5 * 60_000);
  expect(transcribe).toHaveBeenCalledTimes(1);
  expect(runtime.auto.snapshot()).toMatchObject({ listening: false, phase: 'not-listening' });
  expect(runtime.auto.snapshot().reason).toContain('provider rejected');
  expect(dashboard.getStatus()).toContain('provider rejected');
  await runtime.actions.start!();
  expect(runtime.providerStatus().consecutive).toBe(0);
  await vi.advanceTimersByTimeAsync(20_000);
  expect(transcribe).toHaveBeenCalledTimes(2);
});

test('chat intake starts while the onStart language probe is pending', async () => {
  const { runtime, online, setProbe, chatStarted } = await setup();
  let release!: (value: unknown) => void;
  setProbe(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const starting = online();
  await vi.advanceTimersByTimeAsync(0);
  try {
    expect(chatStarted).toHaveBeenCalledOnce();
  } finally {
    release({ data: [{ id: 'stream-one', language: 'es' }] });
    await starting;
  }
  expect(runtime.transcriptionStatus().resolved).toBe('es');
});

test('runtime clears the provider streak on success and on a new session', async () => {
  const { runtime, online, transcribe, setInfo } = await setup();
  setInfo({ id: 'stream-one', language: 'es' });
  transcribe.mockRejectedValueOnce(new OpenAIRequestFailure(true, 'http-429'));
  await online();
  await vi.advanceTimersByTimeAsync(20_000);
  expect(runtime.providerStatus().consecutive).toBe(1);
  await vi.advanceTimersByTimeAsync(20_000);
  expect(runtime.providerStatus().consecutive).toBe(0);
  transcribe.mockRejectedValueOnce(new OpenAIRequestFailure(true, 'http-429'));
  await vi.advanceTimersByTimeAsync(20_000);
  expect(runtime.providerStatus().consecutive).toBe(1);
  await runtime.actions.stop!();
  await runtime.actions.start!();
  expect(runtime.providerStatus().consecutive).toBe(0);
});
