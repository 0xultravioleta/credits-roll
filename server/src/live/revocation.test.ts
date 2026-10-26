import { afterEach, expect, test } from 'vitest';
import { Store } from '../store/index.js';
import { createApp } from '../app.js';
import { Pipeline } from '../pipeline.js';
import { Matcher } from '../matcher/index.js';
import { createProviders } from '../ai/providers.js';
import { OAuthAccounts, AuthorizationRejected } from '../auth/oauth.js';
import { SCOPES } from '../auth/types.js';
import type { Accounts, AccountRole } from '../auth/types.js';
import type { Judge, Judgment } from '../matcher/judge.js';
import { LiveRuntime } from './runtime.js';

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close();
});
async function setup(judge?: Judge) {
  let saved: Accounts = {};
  let revoked = false;
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
      exchange: async (role) => ({
        accessToken: role,
        refreshToken: `synthetic-${role}`,
        expiresIn: 3600,
        scopes: [...SCOPES[role as AccountRole]],
      }),
      refresh: async () => {
        throw new AuthorizationRejected();
      },
      validate: async (token) => {
        if (revoked) throw new AuthorizationRejected();
        const role = token as AccountRole;
        return {
          clientId: 'client',
          userId: role,
          login: role,
          expiresIn: 3600,
          scopes: [...SCOPES[role]],
        };
      },
    },
  );
  await accounts.authorize('streamer', 'streamer');
  await accounts.authorize('bot', 'bot');
  const store = new Store();
  const { app, hub, scoring, dashboard } = createApp({ store });
  const providers = createProviders({});
  const pipeline = new Pipeline({
    store,
    hub,
    scoring,
    transcriber: providers.transcriber,
    matcher: new Matcher(judge ?? providers.judge),
  });
  const runtime = new LiveRuntime({
    store,
    accounts,
    hub,
    dashboard,
    pipeline,
    enabled: false,
    apiKeyPresent: false,
    audioDelay: 0,
    transcriber: providers.transcriber,
  });
  scoring.credit({
    id: 'm',
    streamId: 'stream',
    messageId: 'chat',
    viewer: { id: 'viewer', login: 'syntheticviewer' },
    quote: 'Synthetic idea',
    kind: 'idea',
    confidence: 0.95,
    occurredAt: Date.now(),
  });
  cleanup.push(async () => {
    await runtime.stop();
    pipeline.close();
    await app.close();
    store.close();
  });
  return {
    accounts,
    store,
    hub,
    runtime,
    pipeline,
    revoke: () => {
      revoked = true;
    },
  };
}

test('explicit disconnect clears channel data and credentials, preserving only privacy preferences', async () => {
  const { runtime, store, accounts, hub } = await setup();
  store.optOut('private-viewer');
  store.setSetting('last-stream:streamer', 'stream');
  await runtime.actions.disconnect!();
  expect(store.getMoments()).toEqual([]);
  expect(store.getReputation()).toEqual([]);
  expect(store.getSetting('last-stream:streamer')).toBeUndefined();
  expect(accounts.summary()).toEqual({});
  expect(store.isOptedOut('private-viewer')).toBe(true);
  expect(hub.snapshot().credits).toEqual([]);
});

test('validation revocation removes local data and stops both account sessions', async () => {
  const { accounts, store, revoke } = await setup();
  revoke();
  await expect(accounts.validateAll()).rejects.toThrow('disconnected');
  await Promise.resolve();
  await Promise.resolve();
  expect(store.getMoments()).toEqual([]);
  expect(store.getReputation()).toEqual([]);
  expect(accounts.summary()).toEqual({});
});

test('disconnect invalidates a judge already in flight so cleared data cannot reappear', async () => {
  let finish!: (rows: Judgment[]) => void;
  let entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const { pipeline, runtime, store } = await setup({
    judge: async () => {
      entered();
      return new Promise((resolve) => {
        finish = resolve;
      });
    },
  });
  const now = Date.now();
  pipeline.addChat({
    id: 'pending',
    viewer: { id: 'other', login: 'syntheticother' },
    sentAt: now - 1000,
    text: 'Try the northern bridge',
  });
  const processing = pipeline.processWindow({
    id: 'w',
    streamId: 'stream',
    startAt: now - 500,
    endAt: now,
    text: "I'll try the northern bridge",
  });
  await started;
  await runtime.actions.disconnect!();
  finish([{ messageId: 'pending', kind: 'idea', confidence: 0.95 }]);
  expect(await processing).toEqual([]);
  expect(store.getMoments()).toEqual([]);
});
