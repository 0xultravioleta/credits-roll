import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test, vi } from 'vitest';
import type { Moment } from '../domain.js';
import { RETENTION_MS, Store } from './index.js';

const epoch = Date.parse('2026-10-25T12:00:00Z');
let now = epoch;
const stores: Store[] = [];
const open = (path?: string) => {
  const store = new Store(path, () => now);
  stores.push(store);
  return store;
};
const moment = (overrides: Partial<Moment> = {}): Moment => ({
  id: 'moment-1',
  streamId: 'stream-1',
  messageId: 'chat-1',
  viewer: { id: 'viewer-1', login: 'mapmaker' },
  quote: 'Try the northern bridge',
  kind: 'idea',
  confidence: 0.9,
  occurredAt: epoch,
  ...overrides,
});

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  now = epoch;
  vi.useRealTimers();
});

describe('SQLite store', () => {
  test('round trips moments and updates reputation atomically', () => {
    const store = open();
    expect(store.recordMoment(moment(), 8)).toBe(true);
    expect(store.getMoments('stream-1')).toEqual([moment()]);
    expect(store.getMoments('other')).toEqual([]);
    expect(store.getReputation()[0]).toMatchObject({ points: 8, momentCount: 1 });
  });

  test('deduplicates a chat message across overlapping transcript windows', () => {
    const store = open();
    store.recordMoment(moment(), 8);
    expect(store.recordMoment(moment({ id: 'retry' }), 8)).toBe(false);
    expect(store.getReputation()[0]?.points).toBe(8);
  });

  test('purges on the exact 72-hour boundary and preserves aggregate points', () => {
    const store = open();
    store.recordMoment(moment(), 8);
    now += RETENTION_MS - 1;
    expect(store.getMoments()).toHaveLength(1);
    now += 1;
    expect(store.getMoments()).toEqual([]);
    expect(store.purgeExpired()).toBe(1);
    expect(store.getReputation()[0]?.points).toBe(8);
    expect(store.recordMoment(moment({ id: 'too-old' }))).toBe(false);
  });

  test('refuses future timestamps and invalid scores', () => {
    const store = open();
    expect(store.recordMoment(moment({ occurredAt: now + 1 }))).toBe(false);
    expect(() => store.recordMoment(moment(), -1)).toThrow('Invalid reputation');
  });

  test('opt-out cascades text and scores, blocks future credits and survives restart', () => {
    const directory = mkdtempSync(join(tmpdir(), 'credits-roll-'));
    const path = join(directory, 'test.sqlite');
    const store = open(path);
    store.recordMoment(moment(), 8);
    store.optOut('viewer-1');
    expect(store.getMoments()).toEqual([]);
    expect(store.getReputation()).toEqual([]);
    expect(store.recordMoment(moment())).toBe(false);
    store.close();
    stores.splice(stores.indexOf(store), 1);
    const reopened = open(path);
    expect(reopened.isOptedOut('viewer-1')).toBe(true);
    reopened.close();
    stores.splice(stores.indexOf(reopened), 1);
    rmSync(directory, { recursive: true });
  });

  test('runs retention on startup', () => {
    const directory = mkdtempSync(join(tmpdir(), 'credits-roll-'));
    const path = join(directory, 'test.sqlite');
    const store = open(path);
    store.recordMoment(moment());
    store.close();
    stores.pop();
    now += RETENTION_MS;
    const reopened = open(path);
    expect(reopened.getMoments()).toEqual([]);
    expect(reopened.purgeExpired()).toBe(0);
    reopened.close();
    stores.pop();
    rmSync(directory, { recursive: true });
  });

  test('runs periodic retention and replaces the previous timer', () => {
    vi.useFakeTimers();
    const store = open();
    store.recordMoment(moment());
    store.startRetentionJob(100);
    store.startRetentionJob(100);
    expect(vi.getTimerCount()).toBe(1);
    now += RETENTION_MS;
    vi.advanceTimersByTime(100);
    expect(store.purgeExpired()).toBe(0);
    expect(() => store.startRetentionJob(0)).toThrow();
  });
});
