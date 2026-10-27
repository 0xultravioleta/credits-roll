import { afterEach, expect, test, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../store/index.js';
import { Scoring } from '../scoring/index.js';
import { TwitchApiError } from '../twitch/helix.js';
import { FakePredictionProvider } from './provider.js';
import { ForecastService } from './service.js';

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});
function setup() {
  let now = Date.now();
  let listening = true;
  let eligible = true;
  let scope = true;
  const store = new Store(':memory:', () => now);
  const provider = new FakePredictionProvider(() => now);
  const options = {
    provider,
    store,
    channelId: 'channel',
    streamId: () => 'stream',
    listening: () => listening,
    eligible: () => eligible,
    scope: () => scope,
    now: () => now,
    timer: false,
  };
  const service = new ForecastService(options);
  cleanup.push(async () => {
    await service.close();
    store.close();
  });
  let sequence = 0;
  const credit = (streamId = 'stream') => {
    sequence++;
    now++;
    const moment = {
      id: `credit-${sequence}`,
      messageId: `chat-${sequence}`,
      streamId,
      viewer: { id: `viewer-${sequence}`, login: `viewer${sequence}` },
      quote: 'Synthetic adopted idea',
      kind: 'idea' as const,
      confidence: 1,
      occurredAt: now,
    };
    new Scoring(store).credit(moment);
    service.credit();
    return moment;
  };
  return {
    service,
    options,
    store,
    provider,
    credit,
    advance: (ms: number) => {
      now += ms;
    },
    listening: (value: boolean) => {
      listening = value;
    },
    eligible: (value: boolean) => {
      eligible = value;
    },
    scope: (value: boolean) => {
      scope = value;
    },
  };
}
test.each([0, 2, 3, 5])(
  'forecast count %s selects the correct native outcome after 120 seconds of correction',
  async (count) => {
    const { service, provider, credit, advance } = setup();
    await service.start(10);
    for (let i = 0; i < count; i++) credit();
    advance(120_000);
    await service.tick();
    expect(provider.predictions[0]?.status).toBe('LOCKED');
    advance(480_000);
    await service.tick();
    expect(service.view().phase).toBe('correction');
    expect(service.view().count).toBe(count);
    advance(119_999);
    await service.tick();
    expect(provider.predictions[0]?.status).toBe('LOCKED');
    advance(1);
    await service.tick();
    expect(provider.predictions[0]?.winningOutcomeId).toBe(`demo-outcome-${count >= 3 ? 0 : 1}`);
    expect(service.view().phase).toBe('resolved');
  },
);
test('a correction changes the forecast outcome without removing the credit or reputation', async () => {
  const { service, provider, credit, advance, store } = setup();
  await service.start(10);
  const moment = credit();
  credit();
  credit();
  credit('other-stream');
  expect(service.view().count).toBe(3);
  advance(600_000);
  await service.tick();
  service.exclude(moment.id);
  expect(service.view().count).toBe(2);
  expect(store.getMoments()).toHaveLength(4);
  advance(120_000);
  await service.tick();
  expect(provider.predictions[0]?.winningOutcomeId).toBe('demo-outcome-1');
  expect(() => service.exclude(moment.id, false)).toThrow();
});
test('corrections are rejected before review and at its exact deadline', async () => {
  const { service, credit, advance } = setup();
  await service.start(10);
  const moment = credit();
  expect(() => service.exclude(moment.id)).toThrow();
  advance(600_000);
  await service.tick();
  expect(() => service.exclude('foreign-credit')).toThrow();
  service.exclude(moment.id);
  service.exclude(moment.id, false);
  expect(service.view().count).toBe(1);
  advance(120_000);
  expect(() => service.exclude(moment.id)).toThrow();
});
test.each(['listening interrupted', 'explicit cancel'])(
  'canceling %s requests Twitch refunds',
  async (reason) => {
    const { service, provider, listening } = setup();
    await service.start(10);
    if (reason === 'listening interrupted') {
      listening(false);
      await service.tick(true);
    } else await service.cancel();
    expect(provider.predictions[0]?.status).toBe('CANCELED');
    expect(service.view().phase).toBe('canceled');
  },
);
test('another active or locked prediction disables starting without changing it', async () => {
  const { service, provider } = setup();
  const external = await provider.create('channel');
  await service.tick(true);
  expect(service.view().canStart).toBe(false);
  expect(service.view().message).toContain('Another Twitch prediction');
  await expect(service.start()).rejects.toThrow();
  expect((await provider.list('channel', external.id))[0]?.status).toBe('ACTIVE');
});
test('missing scope and regular channels remain off; API 403 hides the feature', async () => {
  const value = setup();
  value.scope(false);
  expect(value.service.view().message).toBe('Reconnect streamer to enable predictions');
  await expect(value.service.start()).rejects.toThrow();
  value.scope(true);
  value.eligible(false);
  expect(value.service.view().visible).toBe(false);
  value.eligible(true);
  vi.spyOn(value.provider, 'list').mockRejectedValue(new TwitchApiError(403));
  await value.service.tick(true);
  expect(value.service.view().visible).toBe(false);
});
test('uncertain creation is not retried and cannot create a duplicate', async () => {
  const { service, provider } = setup();
  const create = vi
    .spyOn(provider, 'create')
    .mockRejectedValue(new Error('Uncertain network outcome'));
  await expect(service.start()).rejects.toThrow();
  expect(service.view().phase).toBe('uncertain');
  await service.recover();
  await expect(service.start()).rejects.toThrow();
  expect(create).toHaveBeenCalledOnce();
});
test('failed resolution is reconciled by Get Predictions without a second remote update', async () => {
  const { service, provider, advance } = setup();
  await service.start(10);
  advance(600_000);
  await service.tick();
  advance(120_000);
  const real = provider.update.bind(provider);
  const update = vi.spyOn(provider, 'update').mockImplementationOnce(async (...args) => {
    await real(...args);
    throw new Error('Lost response');
  });
  await service.tick(true);
  expect(service.view().phase).toBe('resolving');
  await service.tick(true);
  expect(service.view().phase).toBe('resolved');
  expect(update).toHaveBeenCalledOnce();
});
test('privacy removes credit evidence and excluded IDs from forecast state', async () => {
  const { service, store, credit, advance } = setup();
  await service.start(10);
  const moment = credit();
  advance(600_000);
  await service.tick();
  service.exclude(moment.id);
  store.optOut(moment.viewer.id);
  expect(service.reviewMoments()).toEqual([]);
  expect(store.getSetting('forecast:channel')).not.toContain(moment.id);
  expect(store.getSetting('forecast:channel')).not.toContain(moment.quote);
});
test('restart with expired measurement gets native status and opens the first full correction window', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'credits-forecast-restart-'));
  let now = Date.now();
  let store = new Store(join(directory, 'test.sqlite'), () => now);
  const provider = new FakePredictionProvider(() => now);
  const options = () => ({
    provider,
    store,
    channelId: 'channel',
    streamId: () => 'stream',
    listening: () => true,
    eligible: () => true,
    scope: () => true,
    now: () => now,
    timer: false,
  });
  const first = new ForecastService(options());
  await first.start(10);
  // Model a hard process exit: do not invoke the orderly cancellation path.
  store.close();
  now += 600_001;
  store = new Store(join(directory, 'test.sqlite'), () => now);
  const restarted = new ForecastService(options());
  const list = vi.spyOn(provider, 'list');
  try {
    await restarted.recover();
    expect(list).toHaveBeenCalled();
    expect(restarted.view().phase).toBe('correction');
    expect(restarted.view().correctionEndsAt).toBe(now + 120_000);
  } finally {
    await restarted.close();
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
test('restart mid-period cancels conservatively and cancellation retries preserve existing credits', async () => {
  const { service, provider, credit, options, store } = setup();
  await service.start(10);
  credit();
  const restarted = new ForecastService(options);
  await restarted.recover();
  expect(provider.predictions[0]?.status).toBe('CANCELED');
  expect(store.getMoments()).toHaveLength(1);
  await restarted.close();
});
test('ordinary notification reconnect does not cancel a forecast started in this process', async () => {
  const { service, provider } = setup();
  await service.start(10);
  await service.recover();
  await service.recover();
  expect(service.view().phase).toBe('counting');
  expect(provider.predictions[0]?.status).toBe('ACTIVE');
});
test('failed cancellation remains pending, retries and never removes a credit', async () => {
  const { service, provider, credit, store } = setup();
  await service.start(10);
  credit();
  const update = vi.spyOn(provider, 'update').mockRejectedValueOnce(new Error('Synthetic failure'));
  await service.cancel();
  expect(service.view().phase).toBe('canceling');
  expect(store.getMoments()).toHaveLength(1);
  await service.tick(true);
  expect(service.view().phase).toBe('canceled');
  expect(update).toHaveBeenCalledTimes(2);
  await service.tick(true);
  expect(update).toHaveBeenCalledTimes(2);
});
test('invalid saved forecast cannot stop crediting or initiate a duplicate prediction', async () => {
  const { options, store, credit, provider } = setup();
  store.setSetting('forecast:channel', 'invalid-json');
  const recovered = new ForecastService(options);
  expect(recovered.view().phase).toBe('uncertain');
  expect(recovered.view().canStart).toBe(false);
  credit();
  expect(store.getMoments()).toHaveLength(1);
  expect(provider.predictions).toHaveLength(0);
  await recovered.close();
});
test('disconnect cancellation removes correction references before channel data is cleared', async () => {
  const { service, store, credit, advance, provider } = setup();
  await service.start(10);
  const moment = credit();
  advance(600_000);
  await service.tick(true);
  service.exclude(moment.id);
  await service.close(true);
  store.clearChannelData();
  expect(provider.predictions[0]?.status).toBe('CANCELED');
  expect(store.getSetting('forecast:channel')).not.toContain(moment.id);
  expect(store.getMoments()).toHaveLength(0);
});
test('offline forecast status never claims that Twitch created a prediction or paid points', async () => {
  const { options, credit, advance } = setup();
  const demo = new ForecastService({ ...options, source: 'demo' });
  await demo.start(10);
  credit();
  advance(600_000);
  await demo.tick(true);
  advance(120_000);
  await demo.tick(true);
  expect(demo.view().phase).toBe('resolved');
  expect(demo.view().message).toBe(
    'Offline forecast illustration. No Twitch Prediction, bets, payouts or refunds exist.',
  );
  await demo.close();
});
