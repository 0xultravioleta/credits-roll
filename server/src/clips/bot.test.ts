import { expect, test, vi } from 'vitest';
import { Store } from '../store/index.js';
import { QuietBot, ChatRateLimiter } from '../twitch/bot.js';
import type { ChannelApi } from '../twitch/channel-api.js';

test('clip notices use the shared limiter, allow at most one per ninety seconds, survive restart and honor quiet/privacy', async () => {
  const store = new Store();
  let now = 0,
    quiet = false;
  const send = vi.fn<ChannelApi['send']>(async () => undefined);
  const api: ChannelApi = {
    send,
    rewards: async () => [],
    createReward: async () => ({ id: 'r', title: 'r' }),
    updateReward: async () => undefined,
    redemptions: async () => [],
    settle: async () => undefined,
    stream: async () => 'stream',
  };
  const limiter = new ChatRateLimiter(
    () => now,
    async (ms) => {
      now += ms;
    },
  );
  const acquire = vi.spyOn(limiter, 'acquire');
  const make = () =>
    new QuietBot({
      channel: 'channel',
      sender: 'bot',
      api,
      store,
      quiet: () => quiet,
      limiter,
      now: () => now,
    });
  const bot = make(),
    restarted = make();
  const viewer = { id: 'viewer', login: 'mapmaker' };
  try {
    await bot.clip('one', viewer, 'https://clips.twitch.tv/One');
    now = 89_999;
    await restarted.clip('two', viewer, 'https://clips.twitch.tv/Two');
    expect(send).toHaveBeenCalledTimes(1);
    now = 90_000;
    await restarted.clip('three', viewer, 'https://clips.twitch.tv/Three');
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0]).toEqual([
      'channel',
      'bot',
      '@mapmaker moved the stream - clip: https://clips.twitch.tv/One',
    ]);
    expect(acquire).toHaveBeenCalledWith('channel', expect.any(AbortSignal));
    now = 180_000;
    quiet = true;
    await bot.clip('four', viewer, 'https://clips.twitch.tv/Four');
    quiet = false;
    store.optOut(viewer.id);
    await bot.clip('five', viewer, 'https://clips.twitch.tv/Five');
    await bot.clip('six', { id: 'other', login: 'other' }, '/demo/clip/demo-one');
    expect(send).toHaveBeenCalledTimes(2);
  } finally {
    bot.close();
    restarted.close();
    store.close();
  }
});
