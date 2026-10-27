import { expect, test } from 'vitest';
import { ledgerAsCsv, ledgerAsText, mediaCells } from '../../public/dashboard.js';
import { createApp } from '../app.js';
import { Store } from '../store/index.js';
import { FileCreditLedger } from '../ledger/index.js';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const row = {
  schema: 1,
  id: 'credit',
  time: new Date().toISOString(),
  streamId: 'stream',
  channelId: 'channel',
  viewerId: 'viewer',
  login: 'mapmaker',
  kind: 'idea',
  confidence: 1,
  points: 10,
  quote: 'Try the northern bridge',
  adoptionExcerpt: 'Good idea, going to the bridge.',
  judgeModel: 'fake',
  sourceMessageId: 'message',
};
const media = {
  clip: {
    status: 'ready' as const,
    id: 'ClipOne',
    url: 'https://clips.twitch.tv/ClipOne',
    thumbnailUrl: 'https://clips-media-assets2.twitch.tv/thumb.jpg',
    named: true,
  },
  marker: { status: 'ready' as const, id: 'marker-one', positionSeconds: 42 },
};
test('CSV and copy exports include clip URLs and marker IDs/positions; legacy rows remain readable', () => {
  const csv = ledgerAsCsv([
    { ...row, media },
    { ...row, id: 'old' },
  ]).replace(/\r\n/g, '\n');
  expect(csv.split('\n')[0]).toContain('Clip,VOD marker');
  expect(csv).toContain('https://clips.twitch.tv/ClipOne');
  expect(csv).toContain('Marker marker-one @ 42 s');
  expect(csv).toContain('Not requested');
  expect(ledgerAsText([{ ...row, media }])).toContain('VOD marker: Marker marker-one @ 42 s');
  expect(mediaCells(row).clip.url).toBeUndefined();
  expect(
    mediaCells({ ...row, media: { clip: { status: 'ready', url: 'javascript:alert(1)' } } }).clip
      .url,
  ).toBeUndefined();
});
test('ledger API omits forgotten media and the anonymous count survives channel cleanup', async () => {
  const store = new Store();
  const { app, ledger } = createApp({ store });
  ledger.append(row);
  ledger.updateMedia(row.id, media);
  try {
    expect((await app.inject('/dashboard/api/ledger')).json().records[0].media.clip.id).toBe(
      'ClipOne',
    );
    store.optOut('viewer');
    expect((await app.inject('/dashboard/api/ledger')).json().records).toEqual([]);
    const state = (await app.inject('/dashboard/api/state')).json();
    expect(state.forgottenClipCount).toBe(1);
    expect(state.settings.clipsEnabled).toBe(true);
    expect(state.clips.markerMessage).toContain('Markers need VOD storage');
    expect(JSON.stringify(state)).not.toContain('ClipOne');
    const page = (await app.inject('/dashboard')).body;
    expect(page).toContain('Clip each credited moment');
    expect(page).toContain('VOD marker');
    expect(page).toContain('Clips naming forgotten viewers');
  } finally {
    await app.close();
    store.close();
  }
});

test('legacy records and enriched media survive app restarts without duplicate points; pending requests stay uncertain', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'credits-media-restart-'));
  const path = join(directory, 'credits.jsonl'),
    database = join(directory, 'store.sqlite');
  let ledger = new FileCreditLedger(path, process.cwd());
  ledger.append(row);
  expect(new FileCreditLedger(path, process.cwd()).get(row.id)?.media).toBeUndefined();
  let store = new Store(database);
  let current = createApp({ store, ledger });
  current.ledger.updateMedia(row.id, { ...media, clip: { ...media.clip, status: 'confirming' } });
  await current.app.close();
  store.close();
  ledger = new FileCreditLedger(path, process.cwd());
  store = new Store(database);
  current = createApp({ store, ledger });
  try {
    const records = (await current.app.inject('/dashboard/api/ledger')).json().records;
    expect(records).toHaveLength(1);
    expect(records[0].media.clip.status).toBe('pending-unconfirmed');
    expect(store.getReputation()[0]?.points).toBe(10);
    current.ledger.updateMedia(row.id, media);
  } finally {
    await current.app.close();
    store.close();
  }
  ledger = new FileCreditLedger(path, process.cwd());
  store = new Store(database);
  current = createApp({ store, ledger });
  try {
    const records = (await current.app.inject('/dashboard/api/ledger')).json().records;
    expect(records).toHaveLength(1);
    expect(records[0].media.clip.url).toBe('https://clips.twitch.tv/ClipOne');
    expect(store.getReputation()[0]?.points).toBe(10);
    store.optOut('viewer');
  } finally {
    await current.app.close();
    store.close();
  }
  ledger = new FileCreditLedger(path, process.cwd());
  store = new Store(database);
  current = createApp({ store, ledger });
  try {
    expect((await current.app.inject('/dashboard/api/ledger')).json().records).toEqual([]);
    expect((await current.app.inject('/dashboard/api/state')).json().forgottenClipCount).toBe(1);
    expect(readFileSync(path, 'utf8')).not.toContain('ClipOne');
  } finally {
    await current.app.close();
    store.close();
    rmSync(directory, { recursive: true });
  }
});
