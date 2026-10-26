import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { expect, test, vi } from 'vitest';
import { RETENTION_MS, Store } from './index.js';
import { SCHEMA } from './schema.js';

const epoch = Date.parse('2026-10-26T12:00:00Z');
const moment = {
  id: 'm',
  streamId: 's',
  messageId: 'c',
  viewer: { id: 'v', login: 'syntheticviewer' },
  quote: 'Try the northern bridge',
  kind: 'idea' as const,
  confidence: 0.9,
  occurredAt: epoch,
};

test('migrates existing moments without inventing an excerpt and preserves earned scores on reopen', () => {
  const directory = mkdtempSync(join(tmpdir(), 'credits-roll-v4-'));
  const path = join(directory, 'legacy.sqlite');
  const old = new Database(path);
  old.exec(
    SCHEMA.replace(/^\s+adoption_excerpt .*$/m, '')
      .replace(/^\s+points_earned .*$/m, '')
      .replace('user_version = 5', 'user_version = 4'),
  );
  old.prepare('INSERT INTO viewers VALUES (?, ?, ?)').run('v', 'syntheticviewer', epoch);
  old
    .prepare('INSERT INTO moments VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run('m', 's', 'c', 'v', 'Try the northern bridge', 'idea', 0.9, epoch);
  old.prepare('INSERT INTO reputation VALUES (?, ?, ?, ?)').run('v', 9, 1, epoch);
  old.close();
  try {
    const migrated = new Store(path, () => epoch);
    try {
      expect(migrated.getMoments()[0]).toMatchObject({
        id: 'm',
        adoptionExcerpt: '',
        pointsEarned: 9,
      });
      expect(migrated.getReputation()[0]?.points).toBe(9);
    } finally {
      migrated.close();
    }
    const reopened = new Store(path, () => epoch);
    try {
      expect(reopened.getMoments()[0]?.pointsEarned).toBe(9);
    } finally {
      reopened.close();
    }
  } finally {
    rmSync(directory, { recursive: true });
  }
});

test('bounds saved excerpts to 200 Unicode characters and records the actual awarded points', () => {
  const store = new Store(':memory:', () => epoch);
  try {
    store.recordMoment({ ...moment, adoptionExcerpt: '🌉'.repeat(220), pointsEarned: 999 }, 8);
    const saved = store.getMoments()[0]!;
    expect(Array.from(saved.adoptionExcerpt!)).toHaveLength(200);
    expect(saved.adoptionExcerpt).not.toContain('\uFFFD');
    expect(saved.pointsEarned).toBe(8);
  } finally {
    store.close();
  }
});

test('scheduled retention deletes the entire excerpt-bearing record before the retention deadline', () => {
  vi.useFakeTimers();
  let now = epoch;
  const store = new Store(':memory:', () => now);
  try {
    store.recordMoment({ ...moment, adoptionExcerpt: 'Synthetic adoption evidence' }, 8);
    store.startRetentionJob(100);
    now += RETENTION_MS - 100;
    vi.advanceTimersByTime(100);
    expect(store.getMoments()).toEqual([]);
    expect(store.purgeExpired()).toBe(0);
  } finally {
    store.close();
    vi.useRealTimers();
  }
});
