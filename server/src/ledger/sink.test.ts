import { expect, test, vi } from 'vitest';
import { Store } from '../store/index.js';
import { Scoring } from '../scoring/index.js';
import type { CreditSink } from './sink.js';
import { MemoryCreditLedger } from './index.js';

const moment = {
  id: 'synthetic-credit',
  messageId: 'synthetic-chat',
  streamId: 'synthetic-stream',
  viewer: { id: 'synthetic-viewer', login: 'syntheticviewer' },
  quote: 'q'.repeat(180),
  adoptionExcerpt: 'a'.repeat(250),
  kind: 'idea' as const,
  confidence: 1,
  occurredAt: Date.now(),
};
const context = () => ({ channelId: 'synthetic-channel', judgeModel: 'fake' });

test('CreditSink receives one canonical record per accepted credit and no duplicates or opted-out credits', () => {
  const store = new Store();
  const ledger = new MemoryCreditLedger();
  const sink: CreditSink = { onCredit: vi.fn((record) => ledger.onCredit(record)) };
  const scoring = new Scoring(store, ledger, context, sink);
  try {
    expect(scoring.credit(moment)).toBe(true);
    expect(scoring.credit(moment)).toBe(false);
    expect(sink.onCredit).toHaveBeenCalledOnce();
    expect(ledger.read()[0]).toMatchObject({
      schema: 1,
      id: moment.id,
      time: new Date(moment.occurredAt).toISOString(),
      channelId: 'synthetic-channel',
      judgeModel: 'fake',
      points: 10,
      quote: 'q'.repeat(140),
      adoptionExcerpt: 'a'.repeat(200),
    });
    store.optOut(moment.viewer.id);
    expect(scoring.credit({ ...moment, id: 'blocked', messageId: 'blocked' })).toBe(false);
    expect(sink.onCredit).toHaveBeenCalledOnce();
  } finally {
    store.close();
  }
});

test('a failed credit sink rolls back the moment and reputation so a later retry can save it', () => {
  const store = new Store();
  const onCredit = vi.fn().mockImplementationOnce(() => {
    throw new Error('Synthetic disk failure');
  });
  const scoring = new Scoring(store, undefined, context, { onCredit });
  try {
    expect(() => scoring.credit(moment)).toThrow('Synthetic disk failure');
    expect(store.getMoments()).toEqual([]);
    expect(store.getReputation()).toEqual([]);
    expect(scoring.credit(moment)).toBe(true);
    expect(store.getMoments()).toHaveLength(1);
    expect(onCredit).toHaveBeenCalledTimes(2);
  } finally {
    store.close();
  }
});
