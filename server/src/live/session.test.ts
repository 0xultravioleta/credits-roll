import { afterEach, expect, test, vi } from 'vitest';
import { Store } from '../store/index.js';
import { createApp } from '../app.js';
import { Pipeline } from '../pipeline.js';
import { Matcher } from '../matcher/index.js';
import { createProviders } from '../ai/providers.js';
import { OAuthAccounts } from '../auth/oauth.js';
import { SCOPES } from '../auth/types.js';
import { ListeningSession } from './session.js';
import type { TranscriptSource } from '../transcript/source.js';
import type { Accounts, AccountRole } from '../auth/types.js';

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close();
});
async function setup() {
  let saved: Accounts = {};
  let role: AccountRole = 'streamer';
  const accounts = new OAuthAccounts(
    {
      clientId: 'client',
      clientSecret: 'synthetic',
      redirectUri: 'http://localhost/auth/callback',
    },
    {
      read: () => saved,
      write: (value) => {
        saved = value;
      },
    },
    {
      exchange: async () => ({
        accessToken: 'synthetic',
        refreshToken: 'synthetic-refresh',
        expiresIn: 3600,
        scopes: [...SCOPES[role]],
      }),
      refresh: async () => {
        throw new Error('Not needed');
      },
      validate: async () => ({
        clientId: 'client',
        userId: role,
        login: role,
        expiresIn: 3600,
        scopes: [...SCOPES[role]],
      }),
    },
  );
  await accounts.authorize(role, 'code');
  role = 'bot';
  await accounts.authorize(role, 'code');
  const store = new Store();
  const { app, hub, scoring, dashboard } = createApp({ store });
  const providers = createProviders({});
  const pipeline = new Pipeline({
    store,
    hub,
    scoring,
    matcher: new Matcher(providers.judge),
    transcriber: providers.transcriber,
    onTranscript: (window) => dashboard.transcript(window),
  });
  const chat = vi.fn(() => ({
    run: async (_handler: unknown, signal: AbortSignal) => {
      await new Promise<void>((resolve) => {
        if (signal.aborted) resolve();
        else signal.addEventListener('abort', () => resolve(), { once: true });
      });
    },
  }));
  const transcript = vi.fn((): TranscriptSource => ({
    run: async (_handler: unknown, signal: AbortSignal) => {
      await new Promise<void>((resolve) => {
        if (signal.aborted) resolve();
        else signal.addEventListener('abort', () => resolve(), { once: true });
      });
      return 'aborted' as const;
    },
  }));
  const pause = vi.fn(async () => undefined);
  const session = new ListeningSession({
    enabled: true,
    accounts,
    dashboard,
    hub,
    pipeline,
    chat,
    transcript,
    stream: async () => 'stream',
    onStop: pause,
  });
  cleanup.push(async () => {
    await session.stop();
    pipeline.close();
    await app.close();
    store.close();
  });
  return { session, chat, transcript, accounts, pause, dashboard };
}

test('concurrent Start actions share one capture and Stop aborts it', async () => {
  const { session, chat, transcript, pause } = await setup();
  await Promise.all([session.start(), session.start()]);
  expect(chat).toHaveBeenCalledOnce();
  expect(transcript).toHaveBeenCalledOnce();
  await session.stop();
  expect(session.running).toBe(false);
  expect(pause).toHaveBeenCalledOnce();
});

test('Stop while authorization is pending prevents capture launch', async () => {
  const { session, chat, accounts } = await setup();
  let release!: (token: string) => void;
  const waiting = new Promise<string>((resolve) => {
    release = resolve;
  });
  vi.spyOn(accounts, 'accessToken').mockReturnValue(waiting);
  const starting = session.start();
  await Promise.resolve();
  await Promise.resolve();
  const stopping = session.stop();
  release('synthetic');
  await starting;
  await stopping;
  expect(chat).not.toHaveBeenCalled();
  expect(session.running).toBe(false);
});

test('already listening returns an actionable error and Stop permits a fresh session', async () => {
  const { session, chat } = await setup();
  await session.start();
  await expect(session.start()).rejects.toThrow('Already listening');
  expect(session.running).toBe(true);
  await session.stop();
  await session.start();
  expect(chat).toHaveBeenCalledTimes(2);
});

test('skipped audio releases the stale listening session and explains missing tools', async () => {
  const { session, transcript, dashboard, pause } = await setup();
  transcript.mockReturnValueOnce({ run: async () => 'skipped' });
  await session.start();
  await vi.waitFor(() => expect(pause).toHaveBeenCalledOnce());
  expect(session.running).toBe(false);
  await vi.waitFor(() => expect(dashboard.getStatus()).toContain('Audio capture was skipped'));
  expect(dashboard.getStatus()).toContain('Practice is available');
  await session.start();
  expect(session.running).toBe(true);
});

test('authorization failures reach the button as safe instructions, without provider secrets', async () => {
  const { session, accounts, dashboard } = await setup();
  vi.spyOn(accounts, 'accessToken').mockRejectedValue(new Error('private-provider-response'));
  await expect(session.start()).rejects.toThrow('Check Twitch authorization');
  expect(session.running).toBe(false);
  expect(dashboard.getStatus()).not.toContain('private-provider-response');
});
