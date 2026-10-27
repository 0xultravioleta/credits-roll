import { afterEach, expect, test, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../app.js';
import { Store } from '../store/index.js';
import { MemoryCreditLedger, FileCreditLedger } from '../ledger/index.js';
import { ClipService } from './service.js';
import { TwitchApiError } from '../twitch/helix.js';
import { forgottenClipCount } from './privacy.js';
import type { ClipProvider } from './types.js';
import type { Moment } from '../domain.js';
import { Pipeline } from '../pipeline.js';
import { Matcher } from '../matcher/index.js';
import { createProviders } from '../ai/providers.js';

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close();
  vi.useRealTimers();
});
function setup(ledger = new MemoryCreditLedger()) {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-27T12:00:00Z'));
  const store = new Store();
  const app = createApp({ store, ledger });
  let stream = 'stream-one',
    live = true,
    enabled = true;
  let scopes = ['clips:edit', 'channel:manage:broadcast'];
  const create = vi.fn<ClipProvider['create']>(async () => ({ id: 'ClipOne' }));
  const get = vi.fn<ClipProvider['get']>(async (id) => ({
    id,
    url: 'https://clips.twitch.tv/' + id,
    thumbnailUrl: 'https://clips-media-assets2.twitch.tv/thumb.jpg',
  }));
  const marker = vi.fn<ClipProvider['marker']>(async () => ({
    id: 'marker-one',
    positionSeconds: 20,
  }));
  const onReady = vi.fn((moment: Moment) => app.hub.publishClip(moment));
  const announce = vi.fn(async () => undefined);
  const service = new ClipService({
    provider: { mode: 'live', create, get, marker },
    ledger,
    store,
    channelId: 'channel',
    streamId: () => stream,
    live: () => live,
    enabled: () => enabled,
    scopes: () => scopes,
    onReady,
    announce,
  });
  cleanup.push(async () => {
    await service.stop();
    await app.app.close();
    store.close();
  });
  const credit = (id = 'credit-one', viewerId = 'viewer'): Moment => {
    const moment: Moment = {
      id,
      streamId: stream,
      messageId: id + '-message',
      viewer: { id: viewerId, login: viewerId === 'viewer' ? 'mapmaker' : 'otherperson' },
      kind: 'idea',
      confidence: 1,
      quote: 'Try the northern bridge',
      adoptionExcerpt: 'Good idea, going for the northern bridge.',
      occurredAt: Date.now(),
    };
    app.hub.beginStream(stream);
    expect(app.scoring.credit(moment)).toBe(true);
    service.credit(moment);
    return moment;
  };
  return {
    ...app,
    store,
    ledger,
    service,
    create,
    get,
    marker,
    onReady,
    announce,
    credit,
    setStream: (value: string) => {
      stream = value;
    },
    setLive: (value: boolean) => {
      live = value;
    },
    setEnabled: (value: boolean) => {
      enabled = value;
    },
    setScopes: (value: string[]) => {
      scopes = value;
    },
  };
}
test('accepted clip confirms on the five-second poll and enriches credits without changing points', async () => {
  const s = setup();
  s.credit();
  expect(s.store.getReputation()[0]?.points).toBe(10);
  await vi.advanceTimersByTimeAsync(4999);
  expect(s.onReady).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  await s.service.drain();
  expect(s.get).toHaveBeenCalledTimes(1);
  expect(s.ledger.read()[0]?.media).toMatchObject({
    clip: { status: 'ready', id: 'ClipOne' },
    marker: { status: 'ready', id: 'marker-one' },
  });
  expect(s.scoring.credits('stream-one')[0]?.quotes[0]?.clip?.id).toBe('ClipOne');
  expect(s.onReady).toHaveBeenCalledTimes(1);
  expect(s.announce).toHaveBeenCalledTimes(1);
  expect(s.store.getReputation()[0]?.points).toBe(10);
});
test('accepted but invisible clip stops at sixty seconds as pending-unconfirmed; it is not recreated', async () => {
  const s = setup();
  s.get.mockResolvedValue(null);
  s.credit();
  await vi.advanceTimersByTimeAsync(60_000);
  await s.service.drain();
  expect(s.ledger.read()[0]?.media?.clip.status).toBe('pending-unconfirmed');
  expect(s.get.mock.calls.length).toBeGreaterThan(0);
  expect(s.get.mock.calls.length).toBeLessThanOrEqual(12);
  expect(s.onReady).not.toHaveBeenCalled();
  expect(s.announce).not.toHaveBeenCalled();
  expect(s.create).toHaveBeenCalledTimes(1);
});
test('403 disables clips for the same stream, including service recreation; the next stream can retry', async () => {
  const s = setup();
  s.create.mockRejectedValueOnce(new TwitchApiError(403));
  s.credit();
  await vi.advanceTimersByTimeAsync(0);
  await s.service.drain();
  expect(s.service.status().message).toContain('403');
  await vi.advanceTimersByTimeAsync(60_000);
  s.credit('two');
  await vi.advanceTimersByTimeAsync(0);
  expect(s.create).toHaveBeenCalledTimes(1);
  s.setStream('stream-two');
  s.credit('three');
  await vi.advanceTimersByTimeAsync(5000);
  await s.service.drain();
  expect(s.create).toHaveBeenCalledTimes(2);
  expect(s.store.getReputation()[0]?.points).toBe(30);
});
test('404 skips a clip without disabling later attempts or blocking the credit', async () => {
  const s = setup();
  s.create.mockRejectedValueOnce(new TwitchApiError(404));
  s.credit();
  await vi.advanceTimersByTimeAsync(0);
  await s.service.drain();
  expect(s.ledger.read()[0]?.media?.clip).toMatchObject({ status: 'offline', named: false });
  expect(s.service.status().message).toContain('offline');
  expect(s.store.getMoments()).toHaveLength(1);
});
test('one-minute and twenty-per-stream limits persist independently of viewer privacy and disconnect cleanup', async () => {
  const s = setup();
  for (let index = 0; index < 20; index++) {
    s.credit('c' + index);
    await vi.advanceTimersByTimeAsync(60_000);
  }
  s.credit('limit');
  await vi.advanceTimersByTimeAsync(0);
  await s.service.drain();
  expect(s.create).toHaveBeenCalledTimes(20);
  expect(s.marker).toHaveBeenCalledTimes(21);
  expect(s.ledger.read().at(-1)?.media?.clip.status).toBe('skipped');
  s.store.optOut('viewer');
  s.store.clearChannelData();
  s.credit('after-forget', 'other');
  await vi.advanceTimersByTimeAsync(0);
  await s.service.drain();
  expect(s.create).toHaveBeenCalledTimes(20);
});
test('rapid credits keep one clip and independent markers; opted-out viewers cannot trigger media', async () => {
  const s = setup();
  s.credit('one');
  s.credit('two');
  await vi.advanceTimersByTimeAsync(5000);
  await s.service.drain();
  expect(s.create).toHaveBeenCalledTimes(1);
  expect(s.marker).toHaveBeenCalledTimes(2);
  s.store.optOut('viewer');
  s.service.credit({
    id: 'old',
    streamId: 'stream-one',
    messageId: 'old',
    viewer: { id: 'viewer', login: 'mapmaker' },
    kind: 'idea',
    confidence: 1,
    quote: 'Synthetic',
    occurredAt: Date.now(),
  });
  expect(s.create).toHaveBeenCalledTimes(1);
});
test.each(['off', 'practice', 'missing-scope'] as const)(
  '%s does not create a live clip',
  async (mode) => {
    const s = setup();
    if (mode === 'off') s.setEnabled(false);
    if (mode === 'practice') s.setLive(false);
    if (mode === 'missing-scope') s.setScopes([]);
    s.credit();
    await vi.advanceTimersByTimeAsync(0);
    await s.service.drain();
    expect(s.create).not.toHaveBeenCalled();
    expect(s.marker).not.toHaveBeenCalled();
    if (mode === 'missing-scope')
      expect(s.service.status().message).toContain('Reconnect streamer to enable clips');
  },
);
test('marker 404 reports the VOD requirement without claiming that VOD is certainly disabled', async () => {
  const s = setup();
  s.marker.mockRejectedValue(new TwitchApiError(404));
  s.credit();
  await vi.advanceTimersByTimeAsync(5000);
  await s.service.drain();
  expect(s.service.status().markerMessage).toContain('Markers need VOD storage');
  expect(s.ledger.read()[0]?.media?.marker?.status).toBe('needs-vod');
  expect(s.ledger.read()[0]?.media?.clip.status).toBe('ready');
});

test('a bot 403 cannot disable confirmed clips, and Stop cancels a hanging optional announcement', async () => {
  const s = setup();
  s.announce.mockRejectedValueOnce(new TwitchApiError(403));
  s.credit();
  await vi.advanceTimersByTimeAsync(5000);
  await s.service.drain();
  expect(s.ledger.read()[0]?.media?.clip.status).toBe('ready');
  expect(s.service.status().message).toContain('chat announcement failed');
  await vi.advanceTimersByTimeAsync(60_000);
  s.announce.mockImplementation(async () => new Promise(() => undefined));
  s.credit('two');
  await vi.advanceTimersByTimeAsync(5000);
  expect(s.create).toHaveBeenCalledTimes(2);
  await s.service.stop();
  expect(s.service.status().pending).toBe(0);
  expect(s.ledger.read().at(-1)?.media?.clip.status).toBe('ready');
});
test('forgetting while confirmation hangs removes all media and retains only an anonymous cleanup count', async () => {
  const s = setup();
  s.get.mockImplementation(async () => new Promise(() => undefined));
  s.credit();
  await vi.advanceTimersByTimeAsync(5000);
  s.store.optOut('viewer');
  s.service.forget('viewer');
  await s.service.drain();
  expect(s.ledger.read()).toEqual([]);
  expect(forgottenClipCount(s.store)).toBe(1);
  expect(s.onReady).not.toHaveBeenCalled();
  expect(s.announce).not.toHaveBeenCalled();
  s.store.optOut('viewer');
  expect(forgottenClipCount(s.store)).toBe(1);
  s.store.clearChannelData();
  expect(forgottenClipCount(s.store)).toBe(1);
});
test('legacy ledger loads and append-only enrichment survives restart; forget erases prior revisions too', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'credits-media-'));
  const path = join(directory, 'credits.jsonl');
  const ledger = new FileCreditLedger(path, process.cwd());
  const s = setup(ledger);
  s.credit();
  expect(new FileCreditLedger(path, process.cwd()).read()).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(5000);
  await s.service.drain();
  const restored = new FileCreditLedger(path, process.cwd());
  expect(restored.read()).toHaveLength(1);
  expect(restored.read()[0]?.media?.clip.status).toBe('ready');
  expect(readFileSync(path, 'utf8').trim().split(/\r?\n/).length).toBeGreaterThan(1);
  s.store.optOut('viewer');
  const content = readFileSync(path, 'utf8');
  for (const removed of ['mapmaker', 'ClipOne', 'northern bridge', 'marker-one'])
    expect(content).not.toContain(removed);
  cleanup.push(async () => rmSync(directory, { recursive: true }));
});
test('a hanging or failing post-credit provider never blocks the real matching pipeline', async () => {
  const s = setup();
  s.create.mockImplementation(async () => new Promise(() => undefined));
  const providers = createProviders({});
  const pipeline = new Pipeline({
    store: s.store,
    scoring: s.scoring,
    hub: s.hub,
    matcher: new Matcher(providers.judge),
    transcriber: providers.transcriber,
    onCredit: (moment) => s.service.credit(moment),
  });
  cleanup.push(async () => pipeline.close());
  pipeline.addChat({
    id: 'chat',
    viewer: { id: 'viewer', login: 'mapmaker' },
    text: 'Try the northern bridge',
    sentAt: Date.now() - 1000,
  });
  const moments = await pipeline.processWindow({
    id: 'window',
    streamId: 'stream-one',
    startAt: Date.now(),
    endAt: Date.now(),
    text: 'Good idea, I will try the northern bridge.',
  });
  expect(moments).toHaveLength(1);
  expect(s.store.getReputation()).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(10_000);
  await s.service.drain();
  expect(s.store.getMoments()).toHaveLength(1);
});
