import { afterEach, expect, test, vi } from 'vitest';
import Fastify from 'fastify';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../app.js';
import { Store } from '../store/index.js';
import { OAuthAccounts } from '../auth/oauth.js';
import { SCOPES } from '../auth/types.js';
import type { Accounts, OAuthTransport, TokenIdentity } from '../auth/types.js';
import { hostedConfig, hostingEnvironment, HOSTED_PATHS } from './config.js';
import { HostedSecurity } from './security.js';

const env = {
  PUBLIC_BASE_URL: 'https://credits.example',
  CR_ALLOWED_TWITCH_USER_ID: '123',
  CR_SESSION_SECRET: 'synthetic-session-secret-32-characters',
  CR_OVERLAY_TOKEN: 'synthetic-overlay-token-32-characters',
};
const hosting = hostedConfig(env)!;
const headers = { host: hosting.host, 'x-forwarded-proto': 'https' };
const cookie = new HostedSecurity(hosting).sessionCookie().split(';')[0]!;
const resources: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of resources.splice(0).reverse()) await close();
});
function setup(accounts?: OAuthAccounts, overlayRoot?: string) {
  const store = new Store(':memory:');
  const value = createApp({ store, hosting, accounts, overlayRoot, enableDev: true });
  resources.push(async () => {
    await value.app.close();
    store.close();
  });
  return value;
}
function oauth() {
  let disk: Accounts = {};
  const write = vi.fn((value: Accounts) => {
    disk = value;
  });
  const identity: TokenIdentity = {
    clientId: 'synthetic-client',
    userId: '123',
    login: 'streamer',
    scopes: [...SCOPES.streamer],
    expiresIn: 3600,
  };
  const transport: OAuthTransport = {
    exchange: vi.fn(async () => ({
      accessToken: 'synthetic-access',
      refreshToken: 'synthetic-refresh',
      expiresIn: 3600,
      scopes: [...SCOPES.streamer],
    })),
    refresh: vi.fn(),
    validate: vi.fn(async () => identity),
  };
  const accounts = new OAuthAccounts(
    {
      clientId: identity.clientId,
      clientSecret: 'synthetic-client-secret',
      redirectUri: `${hosting.origin}/auth/callback`,
    },
    { read: () => disk, write },
    transport,
    Date.now,
    hosting.allowedUserId,
  );
  return { accounts, transport, write, identity };
}
test('hosted settings derive callback, bind address and distinct /data defaults without mutating local env', () => {
  const local = { HOST: '127.0.0.1', DATABASE_PATH: 'data/local.sqlite' };
  expect(hostingEnvironment(local)).toBe(local);
  const configured = hostingEnvironment({
    ...env,
    HOST: '127.0.0.1',
    TWITCH_REDIRECT_URI: 'http://localhost:3000/auth/callback',
  });
  expect(configured).toMatchObject({
    ...HOSTED_PATHS,
    HOST: '0.0.0.0',
    TWITCH_REDIRECT_URI: 'https://credits.example/auth/callback',
  });
});
test.each([
  'http://credits.example',
  'https://credits.example/path',
  'https://user:password@credits.example',
  'https://credits.example/?token=value',
])('reject invalid hosted origin %s', (PUBLIC_BASE_URL) => {
  expect(() => hostedConfig({ ...env, PUBLIC_BASE_URL })).toThrow();
});
test.each(['CR_ALLOWED_TWITCH_USER_ID', 'CR_SESSION_SECRET', 'CR_OVERLAY_TOKEN'] as const)(
  'hosted mode fails closed without %s',
  (name) => {
    expect(() => hostedConfig({ ...env, [name]: '' })).toThrow();
  },
);
test.each(['/tmp/tokens.json', '/data/../tokens.json', 'data/tokens.json', '/data\\tokens.json'])(
  'reject private file outside /data: %s',
  (TWITCH_TOKEN_PATH) => {
    expect(() => hostingEnvironment({ ...env, TWITCH_TOKEN_PATH })).toThrow();
  },
);
test('reject private path collisions and reused secrets', () => {
  expect(() =>
    hostingEnvironment({ ...env, TWITCH_TOKEN_PATH: HOSTED_PATHS.DATABASE_PATH }),
  ).toThrow();
  expect(() => hostedConfig({ ...env, CR_OVERLAY_TOKEN: env.CR_SESSION_SECRET })).toThrow();
});
test('only configured raw Host works; health is public even with a private IP Host and no forwarding headers', async () => {
  const { app } = setup();
  const health = await app.inject({ url: '/health', headers: { host: '10.0.0.3:3000' } });
  expect(health.statusCode).toBe(200);
  expect(Object.keys(health.json()).sort()).toEqual([
    'autoListen',
    'lastAudioAt',
    'lastChatAt',
    'listening',
    'mode',
    'status',
  ]);
  expect(health.body).not.toContain(env.CR_OVERLAY_TOKEN);
  expect((await app.inject({ url: '/', headers })).statusCode).toBe(200);
  expect(
    (
      await app.inject({
        url: '/',
        headers: { ...headers, host: 'evil.example', 'x-forwarded-host': hosting.host },
      })
    ).statusCode,
  ).toBe(403);
  expect((await app.inject({ url: '/', headers: { host: hosting.host } })).statusCode).toBe(403);
});
test('dashboard and all data APIs require a signed session, not an overlay token', async () => {
  const { app } = setup();
  const page = await app.inject({ url: '/dashboard', headers });
  expect(page.statusCode).toBe(302);
  expect(page.headers.location).toBe('/auth/login');
  for (const url of [
    '/dashboard/app.js',
    '/dashboard/api/state',
    '/dashboard/api/ledger',
    '/dashboard/api/debug/download',
  ])
    expect((await app.inject({ url, headers })).statusCode).toBe(401);
  expect(
    (await app.inject({ url: `/dashboard/api/state?token=${hosting.overlayToken}`, headers }))
      .statusCode,
  ).toBe(401);
  const state = await app.inject({ url: '/dashboard/api/state', headers: { ...headers, cookie } });
  expect(state.statusCode).toBe(200);
  expect(new URL(state.json().setup.overlayUrl).searchParams.get('token')).toBe(
    hosting.overlayToken,
  );
  expect(state.headers['cache-control']).toBe('no-store');
});
test('session checks reject tampering, duplicate cookies, expiry, different owner and secret rotation', () => {
  let now = 1000;
  const security = new HostedSecurity(hosting, () => now);
  const value = security.sessionCookie().split(';')[0]!;
  expect(security.authenticated({ headers: { cookie: value } })).toBe(true);
  expect(security.authenticated({ headers: { cookie: value + 'x' } })).toBe(false);
  expect(security.authenticated({ headers: { cookie: `${value}; ${value}` } })).toBe(false);
  expect(
    new HostedSecurity({ ...hosting, allowedUserId: '456' }, () => now).authenticated({
      headers: { cookie: value },
    }),
  ).toBe(false);
  expect(
    new HostedSecurity(
      { ...hosting, sessionSecret: 'another-synthetic-secret' },
      () => now,
    ).authenticated({ headers: { cookie: value } }),
  ).toBe(false);
  now += 12 * 60 * 60 * 1000;
  expect(security.authenticated({ headers: { cookie: value } })).toBe(false);
});
test.each(['/overlay', '/overlay/', '/overlay/assets/app.js', '/events', '/api/state', '/wheel'])(
  'overlay access is hidden without the token: %s',
  async (path) => {
    const { app } = setup();
    for (const suffix of ['', '?token=wrong', `?token=${hosting.overlayToken}&token=wrong`])
      expect(
        (await app.inject({ url: path + suffix, headers: { ...headers, cookie } })).statusCode,
      ).toBe(404);
  },
);
test('tokenized overlay injects asset tokens and supplies security headers; dev endpoints stay disabled', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'credits-hosted-overlay-'));
  resources.push(async () => {
    rmSync(directory, { recursive: true, force: true });
  });
  mkdirSync(join(directory, 'assets'));
  writeFileSync(
    join(directory, 'index.html'),
    '<script src="/overlay/assets/app.js"></script><link href="/overlay/assets/style.css">',
  );
  writeFileSync(join(directory, 'assets/app.js'), 'console.log("synthetic")');
  const { app } = setup(undefined, directory);
  const result = await app.inject({ url: `/overlay/?token=${hosting.overlayToken}`, headers });
  expect(result.statusCode).toBe(200);
  expect(result.body.match(/\?token=/g)).toHaveLength(2);
  expect(result.headers['content-security-policy']).toContain("frame-ancestors 'none'");
  expect(result.headers['strict-transport-security']).toBe('max-age=31536000');
  expect(result.headers['x-content-type-options']).toBe('nosniff');
  expect(result.headers['referrer-policy']).toBe('no-referrer');
  expect(
    (await app.inject({ url: `/overlay/assets/app.js?token=${hosting.overlayToken}`, headers }))
      .statusCode,
  ).toBe(200);
  expect(
    (await app.inject({ url: `/api/state?token=${hosting.overlayToken}`, headers })).statusCode,
  ).toBe(200);
  expect(
    (
      await app.inject({
        method: 'POST',
        url: '/dev/moment',
        headers: { ...headers, cookie },
        payload: {},
      })
    ).statusCode,
  ).toBe(404);
});
test('trustProxy accepts HTTPS behind a proxy while CSRF uses the canonical origin', async () => {
  const { app } = setup();
  const state = (
    await app.inject({ url: '/dashboard/api/state', headers: { ...headers, cookie } })
  ).json();
  const post = (origin: string) =>
    app.inject({
      method: 'POST',
      url: '/dashboard/api/practice/chat',
      headers: { ...headers, cookie, origin, 'x-credits-csrf': state.csrf },
      payload: {},
    });
  expect((await post(hosting.origin)).statusCode).toBe(200);
  expect((await post('http://credits.example')).statusCode).toBe(403);
  expect((await post('https://evil.example')).statusCode).toBe(403);
});
test('rate limits are per IP and do not block public health', async () => {
  const { app } = setup();
  for (let i = 0; i < 60; i++)
    expect(
      (
        await app.inject({
          url: '/dashboard/api/state',
          headers: { ...headers, cookie, 'x-forwarded-for': '192.0.2.1' },
        })
      ).statusCode,
    ).toBe(200);
  const limited = await app.inject({
    url: '/dashboard/api/state',
    headers: { ...headers, cookie, 'x-forwarded-for': '192.0.2.1' },
  });
  expect(limited.statusCode).toBe(429);
  expect(limited.headers['retry-after']).toBe('60');
  expect(
    (
      await app.inject({
        url: '/dashboard/api/state',
        headers: { ...headers, cookie, 'x-forwarded-for': '192.0.2.2' },
      })
    ).statusCode,
  ).toBe(200);
  expect((await app.inject({ url: '/health', headers })).statusCode).toBe(200);
});
test('auth rate limit resets after one minute and does not share the dashboard bucket', async () => {
  let now = 0;
  const app = Fastify({ trustProxy: true });
  new HostedSecurity(hosting, () => now).install(app);
  app.get('/auth/login', () => ({ ok: true }));
  app.get('/dashboard/api/state', () => ({ ok: true }));
  try {
    for (let index = 0; index < 60; index++)
      expect((await app.inject({ url: '/auth/login', headers })).statusCode).toBe(200);
    expect((await app.inject({ url: '/auth/login', headers })).statusCode).toBe(429);
    expect(
      (
        await app.inject({
          url: '/dashboard/api/state',
          headers: {
            ...headers,
            cookie: new HostedSecurity(hosting, () => now).sessionCookie().split(';')[0],
          },
        })
      ).statusCode,
    ).toBe(200);
    now = 60_000;
    expect((await app.inject({ url: '/auth/login', headers })).statusCode).toBe(200);
  } finally {
    await app.close();
  }
});
test('foreign streamer callback is 403 and never writes tokens; allowed streamer receives a secure session', async () => {
  const auth = oauth();
  const { app } = setup(auth.accounts);
  async function callback() {
    const login = await app.inject({ url: '/auth/login', headers });
    const state = new URL(login.headers.location!).searchParams.get('state');
    return app.inject({
      url: `/auth/callback?state=${state}&code=synthetic`,
      headers: { ...headers, cookie: String(login.headers['set-cookie']).split(';')[0]! },
    });
  }
  vi.mocked(auth.transport.validate).mockResolvedValueOnce({ ...auth.identity, userId: '999' });
  const foreign = await callback();
  expect(foreign.statusCode).toBe(403);
  expect(auth.write).not.toHaveBeenCalled();
  expect(auth.accounts.summary()).toEqual({});
  const owner = await callback();
  expect(owner.statusCode).toBe(302);
  const cookies = owner.headers['set-cookie'] as string[];
  const session = cookies.find((value) => value.startsWith('__Host-cr_session='))!;
  expect(session).toContain('HttpOnly; Secure; SameSite=Lax');
  expect(
    (
      await app.inject({
        url: '/dashboard/api/state',
        headers: { ...headers, cookie: session.split(';')[0] },
      })
    ).statusCode,
  ).toBe(200);
  expect(auth.write).toHaveBeenCalledTimes(1);
});
test('bot login and callback both require the streamer session; separate authorized bot can be saved', async () => {
  const auth = oauth();
  const { app } = setup(auth.accounts);
  expect((await app.inject({ url: '/auth/login?role=bot', headers })).statusCode).toBe(403);
  const login = await app.inject({ url: '/auth/login?role=bot', headers: { ...headers, cookie } });
  const state = new URL(login.headers.location!).searchParams.get('state');
  const nonce = String(login.headers['set-cookie']).split(';')[0]!;
  expect(
    (
      await app.inject({
        url: `/auth/callback?state=${state}&code=synthetic`,
        headers: { ...headers, cookie: nonce },
      })
    ).statusCode,
  ).toBe(403);
  expect(auth.transport.exchange).not.toHaveBeenCalled();
  vi.mocked(auth.transport.validate).mockResolvedValue({
    ...auth.identity,
    userId: '456',
    login: 'separatebot',
    scopes: [...SCOPES.bot],
  });
  const next = await app.inject({ url: '/auth/login?role=bot', headers: { ...headers, cookie } });
  const nextState = new URL(next.headers.location!).searchParams.get('state');
  expect(
    (
      await app.inject({
        url: `/auth/callback?state=${nextState}&code=synthetic`,
        headers: {
          ...headers,
          cookie: `${cookie}; ${String(next.headers['set-cookie']).split(';')[0]}`,
        },
      })
    ).statusCode,
  ).toBe(302);
  expect(auth.accounts.identity('bot')?.id).toBe('456');
});
