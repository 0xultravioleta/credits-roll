import Fastify from 'fastify';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, vi } from 'vitest';
import {
  authorizationUrl,
  OAuthAccounts,
  OAuthStates,
  registerOAuth,
  TwitchOAuthTransport,
  AuthorizationRejected,
} from './oauth.js';
import { FileTokenStorage } from './storage.js';
import { SCOPES } from './types.js';
import type {
  Accounts,
  AccountRole,
  OAuthTransport,
  TokenGrant,
  TokenIdentity,
  TokenStorage,
} from './types.js';

const config = {
  clientId: 'synthetic-client',
  clientSecret: 'synthetic-secret',
  redirectUri: 'http://localhost:3000/auth/callback',
};
const grant = (suffix = 'initial'): TokenGrant => ({
  accessToken: `synthetic-${suffix}`,
  refreshToken: `synthetic-refresh-${suffix}`,
  expiresIn: 3600,
  scopes: [...SCOPES.bot],
});
const identity = (role: AccountRole = 'bot'): TokenIdentity => ({
  clientId: config.clientId,
  userId: role,
  login: role,
  scopes: [...SCOPES[role]],
  expiresIn: 3600,
});
function setup() {
  let disk: Accounts = {};
  const storage: TokenStorage = {
    read: () => disk,
    write: (value) => {
      disk = value;
    },
  };
  const transport: OAuthTransport = {
    exchange: vi.fn(async () => grant()),
    refresh: vi.fn(async () => grant('rotated')),
    validate: vi.fn(async () => identity()),
  };
  let now = 0;
  const accounts = new OAuthAccounts(config, storage, transport, () => now);
  return {
    accounts,
    transport,
    storage,
    advance: () => {
      now += 3_600_000;
    },
  };
}

test.each(['streamer', 'bot'] as const)(
  'authorization URL requests only %s scopes and never the secret',
  (role) => {
    const url = new URL(authorizationUrl(config, role, 'csrf-value'));
    expect(url.origin).toBe('https://id.twitch.tv');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('scope')?.split(' ')).toEqual(SCOPES[role]);
    expect(url.searchParams.get('state')).toBe('csrf-value');
    expect(url.href).not.toContain(config.clientSecret);
    expect(url.searchParams.get('force_verify')).toBe('true');
  },
);

test('state is browser bound, expiring and single use', () => {
  let now = 0;
  const states = new OAuthStates(() => now);
  expect(() => states.consume(states.issue('bot', 'one'), 'two')).toThrow();
  const state = states.issue('streamer', 'browser');
  expect(states.consume(state, 'browser')).toBe('streamer');
  expect(() => states.consume(state, 'browser')).toThrow();
  const expired = states.issue('bot', 'browser');
  now = 600_000;
  expect(() => states.consume(expired, 'browser')).toThrow();
});

test('callback rejects missing browser state before token exchange and strips query on success', async () => {
  const { accounts, transport } = setup();
  const app = Fastify({ logger: false });
  registerOAuth(app, accounts);
  try {
    const login = await app.inject('/auth/login?role=bot');
    const state = new URL(login.headers.location!).searchParams.get('state');
    const cookie = String(login.headers['set-cookie']).split(';')[0]!;
    const rejected = await app.inject(`/auth/callback?state=${state}&code=synthetic-code`);
    expect(rejected.headers.location).toBe('/dashboard?auth=failed');
    expect(transport.exchange).not.toHaveBeenCalled();
    const next = await app.inject('/auth/login?role=bot');
    const nextState = new URL(next.headers.location!).searchParams.get('state');
    const accepted = await app.inject({
      url: `/auth/callback?state=${nextState}&code=synthetic-code`,
      headers: { cookie: String(next.headers['set-cookie']).split(';')[0]! },
    });
    expect(accepted.headers.location).toBe('/dashboard?auth=connected');
    expect(accepted.headers['cache-control']).toBe('no-store');
    expect(cookie).toMatch(/^cr_oauth=/);
    expect(JSON.stringify(accounts.summary())).not.toContain('synthetic');
  } finally {
    await app.close();
  }
});

test('expired tokens refresh once across concurrent callers and persist rotation', async () => {
  const { accounts, transport, storage, advance } = setup();
  await accounts.authorize('bot', 'code');
  advance();
  expect(await Promise.all([accounts.accessToken('bot'), accounts.accessToken('bot')])).toEqual([
    'synthetic-rotated',
    'synthetic-rotated',
  ]);
  expect(transport.refresh).toHaveBeenCalledTimes(1);
  expect(storage.read().bot?.refreshToken).toBe('synthetic-refresh-rotated');
  await accounts.validateAll();
  expect(storage.read().bot?.accessToken).toBe('synthetic-rotated');
});

test('rejects wrong clients, insufficient scopes and the same account in both roles', async () => {
  const { accounts, transport } = setup();
  await accounts.authorize('bot', 'code');
  vi.mocked(transport.validate).mockResolvedValue({ ...identity('streamer'), userId: 'bot' });
  await expect(accounts.authorize('streamer', 'code')).rejects.toThrow('Account or scopes');
  vi.mocked(transport.validate).mockResolvedValue({ ...identity(), scopes: [] });
  await expect(accounts.authorize('bot', 'code')).rejects.toThrow();
});

test('refresh failures are sanitized and validation revocation removes persisted authorization', async () => {
  const { accounts, transport, storage } = setup();
  await accounts.authorize('bot', 'code');
  vi.mocked(transport.validate).mockRejectedValue(new AuthorizationRejected());
  await expect(accounts.validateAll()).rejects.toThrow('disconnected');
  expect(storage.read()).toEqual({});
});

test('token storage is outside the repository and uses private permissions where supported', () => {
  const root = mkdtempSync(join(tmpdir(), 'credits-auth-'));
  const repo = join(root, 'repo');
  mkdirSync(repo);
  try {
    expect(() => new FileTokenStorage(join(repo, 'tokens.json'), repo)).toThrow('outside');
    const file = new FileTokenStorage(join(root, 'private', 'tokens.json'), repo);
    file.write({});
    expect(file.read()).toEqual({});
    expect(readFileSync(file.path, 'utf8')).toBe('{}');
    if (process.platform !== 'win32') expect(statSync(file.path).mode & 0o777).toBe(0o600);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('refresh sends secrets in an encoded POST body and sanitizes transport errors', async () => {
  const request = vi.fn<typeof fetch>().mockResolvedValue(
    new Response(
      JSON.stringify({
        access_token: 'synthetic',
        refresh_token: 'rotated',
        expires_in: 3600,
        scope: SCOPES.bot,
      }),
    ),
  );
  const transport = new TwitchOAuthTransport(config, request);
  await transport.refresh('synthetic+&refresh');
  expect(String(request.mock.calls[0]![0])).not.toContain('refresh');
  expect((request.mock.calls[0]![1]!.body as URLSearchParams).get('refresh_token')).toBe(
    'synthetic+&refresh',
  );
  request.mockRejectedValue(new Error(config.clientSecret));
  await expect(transport.refresh('synthetic')).rejects.toThrow(
    /^Twitch authorization request failed$/,
  );
});
