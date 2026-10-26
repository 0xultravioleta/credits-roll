import { expect, test, vi } from 'vitest';
import { Helix, TwitchApiError } from './helix.js';
import { TwitchChannelApi, parseRedemption } from './channel-api.js';
import type { TwitchApi } from './helix.js';

test('Helix refreshes a 401 once and honors bounded 429 backoff without exposing credentials', async () => {
  let token = 'synthetic-old';
  const accounts = {
    config: {
      clientId: 'client',
      clientSecret: 'synthetic-secret',
      redirectUri: 'http://localhost/auth/callback',
    },
    accessToken: vi.fn(async (_role, force) => {
      if (force) token = 'synthetic-new';
      return token;
    }),
  };
  const request = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(new Response('', { status: 401 }))
    .mockResolvedValueOnce(new Response('', { status: 429, headers: { 'Retry-After': '2' } }))
    .mockResolvedValueOnce(new Response('{"data":[]}'));
  const wait = vi.fn(async () => undefined);
  const helix = new Helix(accounts, request, wait);
  expect(
    await helix.request('bot', 'chat/messages', {
      method: 'POST',
      body: { message: 'Synthetic winner' },
    }),
  ).toEqual({ data: [] });
  expect(accounts.accessToken).toHaveBeenCalledWith('bot', true);
  expect(wait).toHaveBeenCalledWith(2000, undefined);
  expect(String(request.mock.calls[0]?.[0])).not.toContain('synthetic');
});

test('channel API uses streamer for rewards and bot for Send Chat Message', async () => {
  const api: TwitchApi = {
    request: vi.fn(async (_role, path) =>
      path === 'chat/messages'
        ? { data: [{ is_sent: true }] }
        : { data: [{ id: 'reward', title: 'Enter the Credits Wheel' }] },
    ),
  };
  const channel = new TwitchChannelApi(api);
  await channel.createReward('channel', 'Choose a map');
  await channel.send('channel', 'bot', 'Synthetic winner');
  expect(api.request).toHaveBeenCalledWith(
    'streamer',
    'channel_points/custom_rewards',
    expect.objectContaining({
      method: 'POST',
      body: expect.objectContaining({ cost: 100, should_redemptions_skip_request_queue: false }),
    }),
  );
  expect(api.request).toHaveBeenCalledWith(
    'bot',
    'chat/messages',
    expect.objectContaining({
      body: { broadcaster_id: 'channel', sender_id: 'bot', message: 'Synthetic winner' },
    }),
  );
});

test('settlement reconciles a crash after remote status was changed', async () => {
  const api: TwitchApi = {
    request: vi
      .fn()
      .mockRejectedValueOnce(new TwitchApiError(400))
      .mockResolvedValueOnce({ data: [{ status: 'FULFILLED' }] }),
  };
  await expect(
    new TwitchChannelApi(api).settle('channel', 'reward', 'redemption', 'FULFILLED'),
  ).resolves.toBeUndefined();
});

test('parser supports Helix and EventSub status casing and discards input text', () => {
  const value = {
    id: 'r',
    broadcaster_user_id: 'channel',
    user_id: 'viewer',
    user_login: 'viewer',
    reward: { id: 'reward' },
    status: 'UNFULFILLED',
    user_input: 'Untrusted input',
  };
  expect(parseRedemption(value)?.status).toBe('unfulfilled');
  expect(JSON.stringify(parseRedemption(value))).not.toContain('Untrusted');
});
