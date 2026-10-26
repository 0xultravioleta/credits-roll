import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { FileCreditLedger } from './index.js';
import { Store } from '../store/index.js';
import { createApp } from '../app.js';
import { Pipeline } from '../pipeline.js';
import { Matcher } from '../matcher/index.js';
import { createProviders } from '../ai/providers.js';
import { filterCredits, creditTotals, ledgerAsCsv } from '../../public/dashboard.js';

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});
function setup() {
  const directory = mkdtempSync(join(tmpdir(), 'credits-ledger-history-'));
  cleanup.push(async () => rmSync(directory, { recursive: true }));
  return join(directory, 'credits-ledger.jsonl');
}
function open(path: string, now = Date.now(), store = new Store(':memory:', () => now)) {
  const ledger = new FileCreditLedger(path, process.cwd());
  const result = createApp({
    store,
    ledger,
    creditContext: () => ({ channelId: 'synthetic-channel', judgeModel: 'fake' }),
  });
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    await result.app.close();
    store.close();
  };
  cleanup.push(close);
  return { ...result, store, close };
}
const moment = (now: number, id = 'one') => ({
  id,
  messageId: id,
  streamId: 'synthetic-stream',
  viewer: { id: 'viewer', login: 'syntheticviewer' },
  quote: 'Try the northern bridge',
  adoptionExcerpt: 'Good idea, trying the northern bridge.',
  kind: 'idea' as const,
  confidence: 1,
  occurredAt: now,
});

test('a new app on the same JSONL file shows all credits after restart and beyond 72 hours', async () => {
  const path = setup();
  const now = Date.now();
  const first = open(path, now);
  first.scoring.credit(moment(now - 1000));
  first.scoring.credit({
    ...moment(now, 'two'),
    viewer: { id: 'other', login: 'syntheticother' },
    kind: 'assist',
  });
  const before = (await first.app.inject('/dashboard/api/ledger')).json().records;
  await first.close();
  const second = open(path, now + 73 * 60 * 60 * 1000);
  const after = (await second.app.inject('/dashboard/api/ledger')).json().records;
  expect(after).toEqual(before);
  expect(after.map((row: { id: string }) => row.id)).toEqual(['two', 'one']);
  expect(creditTotals(after)).toEqual({ credits: 2, viewers: 2, points: 18 });
  expect(
    (await second.app.inject('/dashboard/api/state')).json().creditedViewerLists.recent,
  ).toHaveLength(2);
});
test('SQLite import is idempotent and does not fabricate missing adoption or model evidence', async () => {
  const path = setup();
  const now = Date.now();
  const store = new Store(':memory:', () => now);
  store.recordMoment({ ...moment(now), adoptionExcerpt: '' }, 9);
  const first = open(path, now, store);
  expect(first.ledger.read()[0]).toMatchObject({
    adoptionExcerpt: '',
    judgeModel: 'legacy-unknown',
    points: 9,
  });
  const original = readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
  await first.close();
  const restoredStore = new Store(':memory:', () => now);
  restoredStore.recordMoment({ ...moment(now), adoptionExcerpt: '' }, 9);
  const second = open(path, now, restoredStore);
  expect(second.ledger.read()).toHaveLength(1);
  expect(readFileSync(path, 'utf8').replace(/\r\n/g, '\n')).toBe(original);
});
test.each(['!optout', '!forgetme'])(
  '%s removes file records before confirming and excludes them after restart',
  async (command) => {
    const path = setup();
    const now = Date.now();
    const app = open(path, now);
    app.scoring.credit(moment(now));
    app.scoring.credit({
      ...moment(now, 'other-credit'),
      viewer: { id: 'other', login: 'syntheticother' },
    });
    const providers = createProviders({});
    const pipeline = new Pipeline({
      store: app.store,
      scoring: app.scoring,
      hub: app.hub,
      matcher: new Matcher(providers.judge),
      transcriber: providers.transcriber,
      onPrivacy: () => {
        expect(
          new FileCreditLedger(path, process.cwd()).read().some((row) => row.viewerId === 'viewer'),
        ).toBe(false);
      },
    });
    cleanup.push(async () => pipeline.close());
    pipeline.addChat({
      id: 'privacy',
      viewer: { id: 'viewer', login: 'syntheticviewer' },
      text: command,
      sentAt: now,
    });
    await Promise.resolve();
    expect(app.scoring.credit({ ...moment(now, 'blocked') })).toBe(false);
    const records = (await app.app.inject('/dashboard/api/ledger')).json().records;
    expect(records.map((row: { viewerId: string }) => row.viewerId)).toEqual(['other']);
    expect(ledgerAsCsv(records)).not.toContain('syntheticviewer');
    expect(new FileCreditLedger(path, process.cwd()).read().map((row) => row.viewerId)).toEqual([
      'other',
    ]);
  },
);
test('filters, totals, ordering and CSV escaping use only the selected records', () => {
  const rows = [
    {
      id: 'one',
      time: '2026-10-26T12:00:00.000Z',
      login: 'syntheticviewer',
      viewerId: 'one',
      streamId: 'first',
      kind: 'idea',
      points: 10,
      quote: '=1+1',
      adoptionExcerpt: '"Quoted", synthetic speech',
    },
    {
      id: 'two',
      time: '2026-10-26T13:00:00.000Z',
      login: 'syntheticother',
      viewerId: 'two',
      streamId: 'second',
      kind: 'assist',
      points: 8,
      quote: 'Try the switch',
    },
  ];
  expect(filterCredits(rows).map((row: { id: string }) => row.id)).toEqual(['two', 'one']);
  const selected = filterCredits(rows, {
    viewer: '@SYNTHETICVIEWER',
    stream: 'first',
    kind: 'idea',
  });
  expect(creditTotals(selected)).toEqual({ credits: 1, viewers: 1, points: 10 });
  const csv = ledgerAsCsv(selected);
  expect(csv).toContain("'=1+1");
  expect(csv).toContain('""Quoted"", synthetic speech');
  expect(csv).not.toContain('syntheticother');
});
