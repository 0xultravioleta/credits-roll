import { expect, test } from 'vitest';
import { OAuthAccounts, authorizationUrl } from '../auth/oauth.js';
import { CORE_SCOPES, SCOPES } from '../auth/types.js';
import { channelCapabilities } from './capabilities.js';
import { TwitchChannelApi } from '../twitch/channel-api.js';

const config = {
  clientId: 'synthetic',
  clientSecret: 'synthetic',
  redirectUri: 'http://localhost:3101/auth/callback',
};
function accounts() {
  return new OAuthAccounts(
    config,
    {
      read: () => ({
        streamer: {
          userId: 'one',
          login: 'streamer',
          accessToken: 'fake',
          refreshToken: 'fake',
          expiresAt: 0,
          expiresIn: 1,
          scopes: [...CORE_SCOPES.streamer],
        },
      }),
      write: () => undefined,
    },
    {
      exchange: async () => {
        throw new Error('unused');
      },
      refresh: async () => ({
        accessToken: 'fake-new',
        refreshToken: 'fake',
        expiresIn: 3600,
        scopes: [...CORE_SCOPES.streamer],
      }),
      validate: async () => ({
        clientId: 'synthetic',
        userId: 'one',
        login: 'streamer',
        expiresIn: 3600,
        scopes: [...CORE_SCOPES.streamer],
      }),
    },
  );
}
test('request all four upcoming permissions in one streamer reconnect; keep bot scopes unchanged', () => {
  const scopes = new URL(authorizationUrl(config, 'streamer', 'state')).searchParams
    .get('scope')!
    .split(' ');
  expect(scopes).toEqual(
    expect.arrayContaining([
      'clips:edit',
      'channel:manage:broadcast',
      'channel:manage:predictions',
      'channel:manage:polls',
    ]),
  );
  expect(SCOPES.bot).toEqual(CORE_SCOPES.bot);
});
test('existing core-only authorization refreshes without disconnecting and exposes feature-specific reconnect notices', async () => {
  const current = accounts();
  await expect(current.accessToken('streamer')).resolves.toBe('fake-new');
  expect(current.identity('streamer')?.login).toBe('streamer');
  const status = channelCapabilities(current, 'affiliate');
  expect(status.features).toHaveLength(4);
  expect(
    status.features.every((row) => row.message === `Reconnect streamer to enable ${row.feature}`),
  ).toBe(true);
  expect(JSON.stringify(status)).not.toContain('fake-new');
});
test('a regular channel hides Affiliate-only features; clips and markers remain eligible', () => {
  const status = channelCapabilities(accounts(), '');
  expect(status.wheelAvailable).toBe(false);
  expect(status.features.filter((row) => row.visible).map((row) => row.feature)).toEqual([
    'clips',
    'stream markers',
  ]);
  expect(status.eligibilityReason).toContain('Affiliate or Partner');
});
test('Helix distinguishes an offline channel from an unavailable channel and verifies broadcaster_type', async () => {
  const calls: string[] = [];
  const api = new TwitchChannelApi({
    request: async (_role, path, options) => {
      calls.push(path);
      if (path === 'users') {
        expect(options?.query).toEqual({ id: 'one' });
        return { data: [{ id: 'one', broadcaster_type: '' }] };
      }
      expect(options?.query).toEqual({ user_id: 'one' });
      return { data: [] };
    },
  });
  await expect(api.broadcasterType('one')).resolves.toBe('');
  await expect(api.liveStream('one')).resolves.toBeNull();
  expect(calls).toEqual(['users', 'streams']);
});
