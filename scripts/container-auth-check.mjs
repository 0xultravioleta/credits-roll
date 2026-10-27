import assert from 'node:assert/strict';
import { createApp } from './server/dist/app.js';
import { Store } from './server/dist/store/index.js';
import { OAuthAccounts } from './server/dist/auth/oauth.js';
import { SCOPES } from './server/dist/auth/types.js';
import { hostedConfig } from './server/dist/hosting/config.js';

// Sent to a disposable container on stdin. No listener and no real OAuth calls.
const hosting = hostedConfig(process.env);
assert.ok(hosting);
let writes = 0;
const accounts = new OAuthAccounts(
  {
    clientId: 'synthetic-client',
    clientSecret: 'synthetic-secret',
    redirectUri: `${hosting.origin}/auth/callback`,
  },
  {
    read: () => ({}),
    write: () => {
      writes++;
    },
  },
  {
    exchange: async () => ({
      accessToken: 'synthetic-access',
      refreshToken: 'synthetic-refresh',
      expiresIn: 3600,
      scopes: SCOPES.streamer,
    }),
    refresh: async () => {
      throw new Error('Unexpected refresh');
    },
    validate: async () => ({
      userId: '999',
      login: 'foreignviewer',
      clientId: 'synthetic-client',
      scopes: SCOPES.streamer,
      expiresIn: 3600,
    }),
  },
  Date.now,
  hosting.allowedUserId,
);
const store = new Store();
const { app } = createApp({ store, hosting, accounts });
try {
  const headers = { host: hosting.host, 'x-forwarded-proto': 'https' };
  const login = await app.inject({ url: '/auth/login', headers });
  const state = new URL(login.headers.location).searchParams.get('state');
  const callback = await app.inject({
    url: `/auth/callback?state=${state}&code=synthetic-code`,
    headers: { ...headers, cookie: String(login.headers['set-cookie']).split(';')[0] },
  });
  assert.equal(callback.statusCode, 403);
  assert.equal(writes, 0);
  assert.equal((await app.inject({ url: '/auth/login?role=bot', headers })).statusCode, 403);
  console.log(
    'CONTAINER AUTH PASS: foreign streamer 403; token writes 0; bot requires owner session (fake OAuth transport)',
  );
} finally {
  await app.close();
  store.close();
}
