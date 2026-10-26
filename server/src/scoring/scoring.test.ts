import { afterEach, expect, test } from 'vitest';
import type { Moment } from '../domain.js';
import { Store } from '../store/index.js';
import { drawWheel, Scoring, scoreMoment, wheelWeight } from './index.js';

const store = () => {
  const value = new Store(':memory:', () => 1000);
  stores.push(value);
  return value;
};
const stores: Store[] = [];
const moment = (overrides: Partial<Moment> = {}): Moment => ({
  id: 'm1',
  streamId: 'stream',
  messageId: 'c1',
  viewer: { id: 'v1', login: 'mapmaker' },
  quote: 'Try the northern bridge',
  kind: 'idea',
  confidence: 0.9,
  occurredAt: 1000,
  ...overrides,
});
afterEach(() => {
  for (const value of stores.splice(0)) value.close();
});

test.each([
  ['idea', 0.9, 9],
  ['assist', 0.9, 7],
  ['riff', 1, 6],
  ['idea', 0.59, 0],
  ['idea', 0.7, 7],
  ['idea', NaN, 0],
  ['idea', 1.1, 0],
] as const)('scores %s at %s as %s', (kind, confidence, points) => {
  expect(scoreMoment({ kind, confidence })).toBe(points);
});

test('accumulates reputation once per message and derives stream credits', () => {
  const db = store();
  const scoring = new Scoring(db);
  expect(scoring.credit(moment())).toBe(true);
  expect(scoring.credit(moment({ id: 'retry' }))).toBe(false);
  scoring.credit(moment({ id: 'm2', messageId: 'c2', kind: 'assist' }));
  scoring.credit(moment({ id: 'm3', messageId: 'c3', streamId: 'other', kind: 'riff' }));
  expect(scoring.credits('stream')).toEqual([
    {
      viewer: { id: 'v1', login: 'mapmaker' },
      momentCount: 2,
      points: 16,
      kinds: ['idea', 'assist'],
      quotes: [
        { text: 'Try the northern bridge', occurredAt: 1000 },
        { text: 'Try the northern bridge', occurredAt: 1000 },
      ],
    },
  ]);
  expect(db.getReputation()[0]).toMatchObject({ points: 21, momentCount: 3 });
  expect(scoring.wheelEntries()[0]?.weight).toBe(5);
});

test('opt-out immediately removes a viewer from credits and wheel eligibility', () => {
  const db = store();
  const scoring = new Scoring(db);
  scoring.credit(moment());
  db.optOut('v1');
  expect(scoring.credits('stream')).toEqual([]);
  expect(scoring.wheelEntries()).toEqual([]);
  expect(scoring.credit(moment({ id: 'm2', messageId: 'c2' }))).toBe(false);
});

test('end credits include every credited viewer and quote in descending earned-points order', () => {
  const scoring = new Scoring(store());
  scoring.credit(
    moment({
      id: 'low',
      messageId: 'low',
      viewer: { id: 'low', login: 'syntheticlow' },
      quote: 'Name the tower Moonrise',
      kind: 'riff',
    }),
  );
  scoring.credit(
    moment({
      id: 'high',
      messageId: 'high',
      viewer: { id: 'high', login: 'synthetichigh' },
      quote: 'Try the northern bridge',
      kind: 'idea',
    }),
  );
  const credits = scoring.credits('stream');
  expect(credits.map((row) => row.viewer.login)).toEqual(['synthetichigh', 'syntheticlow']);
  expect(credits.map((row) => row.quotes.map((quote) => quote.text))).toEqual([
    ['Try the northern bridge'],
    ['Name the tower Moonrise'],
  ]);
});

test('wheel weights have diminishing returns and can be limited to reward redeemers', () => {
  expect([0, 9, 100, 1_000_000, -1].map(wheelWeight)).toEqual([0, 4, 11, 20, 0]);
  const scoring = new Scoring(store());
  scoring.credit(moment());
  expect(scoring.wheelEntries(new Set(['uncredited']))).toEqual([]);
  expect(scoring.wheelEntries(new Set(['v1']))).toHaveLength(1);
});

test('weighted selection respects interval boundaries and injected randomness', () => {
  const scoring = new Scoring(store());
  scoring.credit(moment());
  scoring.credit(moment({ id: 'm2', messageId: 'c2', viewer: { id: 'v2', login: 'switchwitch' } }));
  const entries = scoring.wheelEntries();
  expect(drawWheel(entries, () => 0)?.viewer.id).toBe('v1');
  expect(drawWheel(entries, () => 0.5)?.viewer.id).toBe('v2');
  expect(drawWheel(entries, () => 0.999)?.viewer.id).toBe('v2');
  expect(drawWheel([])).toBeUndefined();
  expect(() => drawWheel(entries, () => 1)).toThrow();
});

test('low-confidence moments never reach durable reputation', () => {
  const scoring = new Scoring(store());
  expect(scoring.credit(moment({ confidence: 0.1 }))).toBe(false);
  expect(scoring.wheelEntries()).toEqual([]);
});

test('viewer history groups by stable ID, sorts by total reputation and scopes retained evidence by stream', () => {
  const db = store();
  const scoring = new Scoring(db);
  scoring.credit(moment({ occurredAt: 500 }));
  scoring.credit(
    moment({
      id: 'second',
      messageId: 'second',
      kind: 'assist',
      occurredAt: 900,
      adoptionExcerpt: 'Good call, pressing the switch.',
    }),
  );
  for (const [id, streamId] of [
    ['other-a', 'other'],
    ['other-b', 'other'],
    ['other-c', 'stream'],
  ] as const)
    scoring.credit(
      moment({ id, messageId: id, streamId, viewer: { id: 'v2', login: 'syntheticviewer' } }),
    );
  const current = scoring.creditedViewers('stream');
  expect(
    current.map((row) => [row.viewer.id, row.points, row.wheelWeight, row.momentCount]),
  ).toEqual([
    ['v2', 27, 6, 1],
    ['v1', 16, 5, 2],
  ]);
  expect(current[1]?.lastCreditedAt).toBe(900);
  expect(current[1]?.moments.map((row) => row.id)).toEqual(['second', 'm1']);
  expect(current[1]?.moments[0]).toMatchObject({
    pointsEarned: 7,
    adoptionExcerpt: 'Good call, pressing the switch.',
  });
  expect(scoring.creditedViewers()[0]?.momentCount).toBe(3);
  db.optOut('v2');
  expect(scoring.creditedViewers().map((row) => row.viewer.id)).toEqual(['v1']);
});
