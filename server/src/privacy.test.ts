import { afterEach, expect, test, vi } from 'vitest';
import { Store } from './store/index.js';
import { Pipeline } from './pipeline.js';
import { createApp } from './app.js';
import { Matcher } from './matcher/index.js';
import { createProviders } from './ai/providers.js';
import { ChatRateLimiter, QuietBot } from './twitch/bot.js';
import type { ChannelApi } from './twitch/channel-api.js';
import { WheelService } from './wheel/service.js';
import { DEFAULT_SETTINGS } from './dashboard/state.js';

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close();
});
function setup() {
  const store = new Store();
  store.startRetentionJob();
  const { app, hub, scoring, dashboard } = createApp({ store });
  const providers = createProviders({});
  let now = 0;
  const api: ChannelApi = {
    rewards: vi.fn(async () => []),
    createReward: vi.fn(async () => ({ id: 'reward', title: 'Enter the Credits Wheel' })),
    updateReward: vi.fn(async () => undefined),
    redemptions: vi.fn(async () => []),
    settle: vi.fn(async () => undefined),
    send: vi.fn(async () => undefined),
    stream: vi.fn(async () => 'stream'),
  };
  const bot = new QuietBot({
    store,
    api,
    channel: 'channel',
    sender: 'bot',
    quiet: () => true,
    limiter: new ChatRateLimiter(
      () => now,
      async (ms) => {
        now += ms;
      },
    ),
  });
  const wheel = new WheelService({
    store,
    api,
    bot,
    channel: 'channel',
    settings: () => ({ ...DEFAULT_SETTINGS, wheelEnabled: true }),
    streamId: () => 'stream',
  });
  const confirmations: Promise<void>[] = [];
  const pipeline = new Pipeline({
    store,
    scoring,
    hub,
    transcriber: providers.transcriber,
    matcher: new Matcher(providers.judge),
    onPrivacy: (id, _command, messageId) => {
      const operation = Promise.all([wheel.refundOptOuts(), bot.privacy(id, messageId)]).then(
        () => undefined,
      );
      confirmations.push(operation);
      return operation;
    },
  });
  cleanup.push(async () => {
    pipeline.close();
    bot.close();
    await app.close();
    store.close();
  });
  return { store, hub, scoring, dashboard, pipeline, bot, api, wheel, confirmations };
}

test.each(['!optout', '!forgetme', ' !FORGETME please '])(
  '%s erases local history and wheel eligibility before confirmation',
  async (command) => {
    const { store, scoring, wheel, api, pipeline, confirmations, dashboard } = setup();
    const viewer = { id: 'viewer', login: 'syntheticviewer' };
    const now = Date.now();
    scoring.credit({
      id: 'm',
      messageId: 'chat',
      streamId: 'stream',
      viewer,
      quote: 'Synthetic bridge idea',
      confidence: 0.95,
      kind: 'idea',
      occurredAt: now,
    });
    dashboard.setWinner(viewer);
    await wheel.configure({ ...DEFAULT_SETTINGS, wheelEnabled: true });
    await wheel.redemption({
      id: 'r',
      viewer,
      broadcasterId: 'channel',
      rewardId: 'reward',
      status: 'unfulfilled',
    });
    pipeline.addChat({ id: 'command', viewer, text: command, sentAt: now });
    expect(store.getMoments()).toEqual([]);
    expect(store.getReputation()).toEqual([]);
    expect(store.getViewer(viewer.id)).toBeUndefined();
    expect(wheel.entries()).toEqual([]);
    expect(dashboard.getWinner()).toBeNull();
    expect(api.send).not.toHaveBeenCalled();
    expect(store.redemptions('channel')[0]?.viewer_id).toBeNull();
    await Promise.resolve();
    await Promise.all(confirmations);
    expect(api.settle).toHaveBeenCalledWith('channel', 'reward', 'r', 'CANCELED');
    expect(api.send).toHaveBeenCalledOnce();
    expect(vi.mocked(api.send).mock.calls[0]?.[3]).toBe('command');
    pipeline.addChat({ id: 'repeat', viewer, text: '!optout', sentAt: now });
    await Promise.resolve();
    await Promise.all(confirmations);
    expect(api.send).toHaveBeenCalledOnce();
    expect(
      await pipeline.processWindow({
        id: 'w',
        streamId: 'stream',
        startAt: now,
        endAt: now,
        text: "Good idea, I'll try the northern bridge",
      }),
    ).toEqual([]);
  },
);

test('confirmation remains at most once across bot recreation and failed network delivery', async () => {
  const { store, bot, api } = setup();
  store.optOut('viewer');
  vi.mocked(api.send).mockRejectedValueOnce(new Error('Synthetic transport failure'));
  await expect(bot.privacy('viewer', 'command')).rejects.toThrow();
  expect(store.privacyConfirmed('viewer')).toBe(true);
  const restarted = new QuietBot({
    store,
    api,
    channel: 'channel',
    sender: 'bot',
    quiet: () => true,
  });
  await restarted.privacy('viewer', 'repeat');
  expect(api.send).toHaveBeenCalledOnce();
  restarted.close();
});

test('forgetting a selected viewer removes persisted round identity', () => {
  const { store } = setup();
  const viewer = { id: 'viewer', login: 'syntheticviewer' };
  store.addRedemption({ id: 'r', viewer, rewardId: 'reward', broadcasterId: 'channel' }, 'stream');
  store.prepareRound('round', 'channel', 'stream', viewer.id);
  store.optOut(viewer.id);
  expect(store.wheelRound('channel', 'stream')?.winner_id).toBeNull();
});
