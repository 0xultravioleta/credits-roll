import { afterEach, expect, test, vi } from 'vitest';
import { Store } from '../store/index.js';
import { Scoring } from '../scoring/index.js';
import { DEFAULT_SETTINGS } from '../dashboard/state.js';
import type { Settings } from '../dashboard/state.js';
import { QuietBot, ChatRateLimiter } from '../twitch/bot.js';
import type { ChannelApi, Redemption } from '../twitch/channel-api.js';
import { WheelService } from './service.js';
import { rewardPrompt } from './prizes.js';

const cleanup: (() => void)[] = [];
afterEach(() => {
  cleanup.splice(0).forEach((close) => close());
});
function setup() {
  const store = new Store();
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
  const settings: Settings = { ...DEFAULT_SETTINGS, quietMode: false, wheelEnabled: true };
  const limiter = new ChatRateLimiter(
    () => now,
    async (ms) => {
      now += ms;
    },
  );
  const bot = new QuietBot({
    store,
    channel: 'channel',
    sender: 'bot',
    api,
    quiet: () => settings.quietMode,
    limiter,
  });
  const options = {
    channel: 'channel',
    api,
    store,
    bot,
    settings: () => settings,
    streamId: () => 'stream',
    random: () => 0,
  };
  const wheel = new WheelService(options);
  cleanup.push(() => {
    bot.close();
    store.close();
  });
  return { store, api, bot, settings, wheel, options };
}
const redemption = (id = 'redemption', viewerId = 'viewer'): Redemption => ({
  id,
  viewer: { id: viewerId, login: viewerId },
  broadcasterId: 'channel',
  rewardId: 'reward',
  status: 'unfulfilled',
});

test('creates a reward only after explicit opt-in and reuses it', async () => {
  const { wheel, api, settings } = setup();
  await wheel.configure({ ...settings, wheelEnabled: false });
  expect(api.createReward).not.toHaveBeenCalled();
  await wheel.configure(settings);
  await wheel.configure(settings);
  expect(api.createReward).toHaveBeenCalledOnce();
  expect(api.updateReward).toHaveBeenCalledWith(
    'channel',
    'reward',
    true,
    rewardPrompt(settings.prizeText, true),
  );
});

test('redemption retries produce one ticket; reputation adds weight to a baseline entry', async () => {
  const { wheel, store, settings } = setup();
  await wheel.configure(settings);
  new Scoring(store).credit({
    id: 'm',
    streamId: 'stream',
    messageId: 'chat',
    viewer: { id: 'veteran', login: 'veteran' },
    quote: 'Synthetic idea',
    kind: 'idea',
    confidence: 0.95,
    occurredAt: Date.now(),
  });
  await wheel.redemption(redemption('a', 'veteran'));
  await wheel.redemption(redemption('a', 'veteran'));
  await wheel.redemption(redemption('b', 'newcomer'));
  expect(wheel.entries().map((entry) => [entry.viewer.id, entry.weight])).toEqual([
    ['veteran', 4],
    ['newcomer', 1],
  ]);
});

test('spins once per stream, fulfills entries and announces a winner once', async () => {
  const { wheel, api, settings, store } = setup();
  await wheel.configure(settings);
  await wheel.redemption(redemption('a'));
  await wheel.redemption(redemption('b', 'second'));
  const first = await wheel.spin();
  const again = await wheel.spin();
  expect(first.winner?.viewer.id).toBe('viewer');
  expect(again.roundId).toBe(first.roundId);
  expect(api.settle).toHaveBeenCalledTimes(2);
  expect(api.send).toHaveBeenCalledOnce();
  expect(store.redemptions('channel').every((entry) => entry.status === 'fulfilled')).toBe(true);
  expect(api.updateReward).toHaveBeenLastCalledWith(
    'channel',
    'reward',
    false,
    rewardPrompt(settings.prizeText, true),
  );
});

test('refunds opt-outs, duplicates, unknown recovered events and disabled rewards', async () => {
  const { wheel, api, settings, store } = setup();
  await wheel.configure(settings);
  store.optOut('optedout');
  await wheel.redemption(redemption('opt', 'optedout'));
  await wheel.redemption(redemption('first'));
  await wheel.redemption(redemption('duplicate'));
  vi.mocked(api.redemptions).mockResolvedValue([redemption('missed', 'unknown')]);
  await wheel.reconcile();
  for (const id of ['opt', 'duplicate', 'missed'])
    expect(api.settle).toHaveBeenCalledWith('channel', 'reward', id, 'CANCELED');
  settings.wheelEnabled = false;
  await wheel.configure(settings);
  expect(wheel.entries()).toEqual([]);
});

test('restart retries settlement with the original winner rather than drawing again', async () => {
  const { wheel, api, settings, options, store } = setup();
  await wheel.configure(settings);
  await wheel.redemption(redemption());
  vi.mocked(api.settle).mockRejectedValueOnce(new Error('Synthetic transport failure'));
  await expect(wheel.spin()).rejects.toThrow();
  const round = store.wheelRound('channel', 'stream')!;
  const restarted = new WheelService({
    ...options,
    random: () => {
      throw new Error('Must not draw again');
    },
  });
  const resumed = await restarted.spin();
  expect(resumed.roundId).toBe(round.id);
  expect(resumed.winner?.viewer.id).toBe('viewer');
});

test('credited entrants are refunded and remain eligible with the original weight; other entrants are fulfilled', async () => {
  const { wheel, api, settings, store } = setup();
  await wheel.configure(settings);
  new Scoring(store).credit({
    id: 'credit',
    messageId: 'chat',
    streamId: 'stream',
    viewer: { id: 'credited', login: 'credited' },
    kind: 'idea',
    confidence: 1,
    quote: 'Synthetic adopted idea',
    occurredAt: Date.now(),
  });
  await wheel.redemption(redemption('a', 'credited'));
  await wheel.redemption(redemption('b', 'other'));
  const before = wheel.entries().find((entry) => entry.viewer.id === 'credited');
  const result = await wheel.spin();
  expect(api.settle).toHaveBeenCalledWith('channel', 'reward', 'a', 'CANCELED');
  expect(api.settle).toHaveBeenCalledWith('channel', 'reward', 'b', 'FULFILLED');
  expect(result.winner?.viewer.id).toBe('credited');
  expect(result.winner?.weight).toBe(before?.weight);
  expect(wheel.refundedCount()).toBe(1);
  const calls = vi.mocked(api.settle).mock.calls.length;
  vi.mocked(api.redemptions).mockResolvedValue([
    redemption('a', 'credited'),
    redemption('b', 'other'),
  ]);
  await wheel.reconcile();
  await wheel.reconcile();
  expect(api.settle).toHaveBeenCalledTimes(calls);
});
test('refund intent survives a failed spin and reconcile retries it once without changing the winner', async () => {
  const { wheel, api, settings, options, store } = setup();
  await wheel.configure(settings);
  new Scoring(store).credit({
    id: 'credit',
    messageId: 'chat',
    streamId: 'stream',
    viewer: { id: 'credited', login: 'credited' },
    kind: 'idea',
    confidence: 1,
    quote: 'Synthetic adopted idea',
    occurredAt: Date.now(),
  });
  await wheel.redemption(redemption('a', 'credited'));
  vi.mocked(api.settle).mockRejectedValueOnce(new Error('Synthetic refund failure'));
  await expect(wheel.spin()).rejects.toThrow();
  const round = store.wheelRound('channel', 'stream');
  expect(store.redemptions('channel')[0]?.target_status).toBe('canceled');
  settings.creditedViewersEnterFree = false;
  const restarted = new WheelService(options);
  await restarted.reconcile();
  await restarted.reconcile();
  expect(api.settle).toHaveBeenCalledTimes(2);
  const result = await restarted.spin();
  expect(result.roundId).toBe(round?.id);
  expect(result.winner?.viewer.id).toBe('credited');
});
test('credit from another stream does not refund this ticket', async () => {
  const { wheel, api, settings, store } = setup();
  await wheel.configure(settings);
  new Scoring(store).credit({
    id: 'credit',
    messageId: 'chat',
    streamId: 'old-stream',
    viewer: { id: 'credited', login: 'credited' },
    kind: 'idea',
    confidence: 1,
    quote: 'Synthetic adopted idea',
    occurredAt: Date.now(),
  });
  await wheel.redemption(redemption('a', 'credited'));
  await wheel.spin();
  expect(api.settle).toHaveBeenCalledWith('channel', 'reward', 'a', 'FULFILLED');
});
test('disabling credited free entry fulfills a credited ticket normally', async () => {
  const { wheel, api, settings, store } = setup();
  settings.creditedViewersEnterFree = false;
  await wheel.configure(settings);
  new Scoring(store).credit({
    id: 'credit',
    messageId: 'chat',
    streamId: 'stream',
    viewer: { id: 'credited', login: 'credited' },
    kind: 'idea',
    confidence: 1,
    quote: 'Synthetic adopted idea',
    occurredAt: Date.now(),
  });
  await wheel.redemption(redemption('a', 'credited'));
  await wheel.spin();
  expect(api.settle).toHaveBeenCalledWith('channel', 'reward', 'a', 'FULFILLED');
  expect(wheel.refundedCount()).toBe(0);
});

test('quiet bot suppresses announcements and filters opted-out names at send time', async () => {
  const { bot, settings, api, store } = setup();
  settings.quietMode = true;
  await bot.winner('quiet', { id: 'viewer', login: 'viewer' }, 'Choose a map');
  expect(api.send).not.toHaveBeenCalled();
  settings.quietMode = false;
  store.optOut('viewer');
  await bot.winner('opt', { id: 'viewer', login: 'viewer' }, 'Choose a map');
  expect(api.send).not.toHaveBeenCalled();
  await bot.credits('stream', [
    { viewer: { id: 'viewer', login: 'viewer' }, points: 10, momentCount: 1, kinds: ['idea'] },
  ]);
  expect(vi.mocked(api.send).mock.calls[0]?.[2]).not.toContain('@viewer');
});

test('limiter obeys 20 per 30 seconds and one per second per channel', async () => {
  let now = 0;
  const times: number[] = [];
  const limiter = new ChatRateLimiter(
    () => now,
    async (ms) => {
      now += ms;
    },
  );
  for (let i = 0; i < 25; i++) {
    await limiter.acquire('channel', new AbortController().signal);
    times.push(now);
  }
  expect(times[1]).toBe(1000);
  expect(times[19]).toBe(19000);
  expect(times[20]).toBe(30000);
  for (const time of times)
    expect(
      times.filter((value) => value > time - 30000 && value <= time).length,
    ).toBeLessThanOrEqual(20);
});
