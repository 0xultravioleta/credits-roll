import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Moment, Reputation, Viewer } from '../domain.js';
import { SCHEMA } from './schema.js';

export const RETENTION_MS = 72 * 60 * 60 * 1000;
export const PURGE_INTERVAL_MS = 60_000;
export interface WheelRedemption {
  id: string;
  broadcaster_id: string;
  reward_id: string;
  stream_id: string;
  viewer_id: string | null;
  status: 'queued' | 'fulfilled' | 'canceled';
  round_id: string | null;
  target_status: 'fulfilled' | 'canceled' | null;
}
export interface WheelRound {
  id: string;
  broadcaster_id: string;
  stream_id: string;
  winner_id: string | null;
  state: 'settling' | 'complete';
}

interface MomentRow {
  id: string;
  stream_id: string;
  message_id: string;
  viewer_id: string;
  login: string;
  quote: string;
  kind: Moment['kind'];
  confidence: number;
  occurred_at: number;
}

export class Store {
  private readonly db: Database.Database;
  private retentionTimer?: ReturnType<typeof setInterval>;

  constructor(
    path = ':memory:',
    private readonly now: () => number = Date.now,
  ) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path);
    this.db.pragma('foreign_keys = ON');
    this.db.pragma('secure_delete = ON');
    // Deleted journal files avoid retaining old quote pages in a persistent WAL.
    this.db.pragma('journal_mode = DELETE');
    this.db.exec(SCHEMA);
    const optoutColumns = this.db.pragma('table_info(optouts)') as { name: string }[];
    if (!optoutColumns.some((column) => column.name === 'confirmed_at'))
      this.db.exec('ALTER TABLE optouts ADD COLUMN confirmed_at INTEGER');
    this.purgeExpired();
  }

  isOptedOut(viewerId: string): boolean {
    return !!this.db.prepare('SELECT 1 FROM optouts WHERE viewer_id = ?').get(viewerId);
  }

  getSetting(key: string): string | undefined {
    return (
      this.db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key) as
        { value: string } | undefined
    )?.value;
  }
  setSetting(key: string, value: string): void {
    this.db
      .prepare(
        'INSERT INTO app_settings VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      )
      .run(key, value);
  }
  ensureViewer(viewer: Viewer): void {
    if (!this.isOptedOut(viewer.id))
      this.db
        .prepare(
          'INSERT INTO viewers VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET login = excluded.login, updated_at = excluded.updated_at',
        )
        .run(viewer.id, viewer.login, this.now());
  }
  getViewer(id: string): Viewer | undefined {
    return this.db.prepare('SELECT id, login FROM viewers WHERE id = ?').get(id) as
      Viewer | undefined;
  }
  addRedemption(
    value: { id: string; broadcasterId: string; rewardId: string; viewer: Viewer },
    streamId: string,
  ): boolean {
    this.ensureViewer(value.viewer);
    return !!this.db
      .prepare(
        'INSERT OR IGNORE INTO wheel_redemptions(id, broadcaster_id, reward_id, stream_id, viewer_id, received_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(
        value.id,
        value.broadcasterId,
        value.rewardId,
        streamId,
        this.isOptedOut(value.viewer.id) ? null : value.viewer.id,
        this.now(),
      ).changes;
  }
  redemptions(channel: string, streamId?: string): WheelRedemption[] {
    return this.db
      .prepare(
        'SELECT * FROM wheel_redemptions WHERE broadcaster_id = ? AND (? IS NULL OR stream_id = ?) ORDER BY received_at, id',
      )
      .all(channel, streamId ?? null, streamId ?? null) as WheelRedemption[];
  }
  settleRedemption(id: string, status: 'fulfilled' | 'canceled'): void {
    this.db.prepare('UPDATE wheel_redemptions SET status = ? WHERE id = ?').run(status, id);
  }
  targetRedemption(id: string, status: 'fulfilled' | 'canceled'): void {
    this.db.prepare('UPDATE wheel_redemptions SET target_status = ? WHERE id = ?').run(status, id);
  }
  wheelRound(channel: string, streamId: string): WheelRound | undefined {
    return this.db
      .prepare('SELECT * FROM wheel_rounds WHERE broadcaster_id = ? AND stream_id = ?')
      .get(channel, streamId) as WheelRound | undefined;
  }
  prepareRound(id: string, channel: string, streamId: string, winnerId: string): WheelRound {
    this.db.transaction(() => {
      this.db
        .prepare(
          'INSERT OR IGNORE INTO wheel_rounds(id, broadcaster_id, stream_id, winner_id) VALUES (?, ?, ?, ?)',
        )
        .run(id, channel, streamId, winnerId);
      const round = this.wheelRound(channel, streamId)!;
      this.db
        .prepare(
          "UPDATE wheel_redemptions SET round_id = ? WHERE broadcaster_id = ? AND stream_id = ? AND status = 'queued' AND round_id IS NULL",
        )
        .run(round.id, channel, streamId);
    })();
    return this.wheelRound(channel, streamId)!;
  }
  completeRound(id: string): void {
    this.db.prepare("UPDATE wheel_rounds SET state = 'complete' WHERE id = ?").run(id);
  }

  optOut(viewerId: string): void {
    this.db.transaction(() => {
      this.db
        .prepare('INSERT OR IGNORE INTO optouts(viewer_id, opted_out_at) VALUES (?, ?)')
        .run(viewerId, this.now());
      this.db
        .prepare(
          "UPDATE wheel_redemptions SET viewer_id = NULL, target_status = CASE WHEN status = 'queued' THEN 'canceled' ELSE target_status END WHERE viewer_id = ?",
        )
        .run(viewerId);
      this.db.prepare('UPDATE wheel_rounds SET winner_id = NULL WHERE winner_id = ?').run(viewerId);
      this.db.prepare('DELETE FROM viewers WHERE id = ?').run(viewerId);
    })();
  }

  privacyConfirmed(viewerId: string): boolean {
    return !!this.db
      .prepare('SELECT 1 FROM optouts WHERE viewer_id = ? AND confirmed_at IS NOT NULL')
      .get(viewerId);
  }
  clearChannelData(): void {
    this.db.transaction(() => {
      this.db.exec(
        'DELETE FROM moments; DELETE FROM reputation; DELETE FROM viewers; DELETE FROM wheel_redemptions; DELETE FROM wheel_rounds;',
      );
      this.db.prepare("DELETE FROM app_settings WHERE key <> 'settings'").run();
    })();
  }
  claimPrivacyConfirmation(viewerId: string): boolean {
    return !!this.db
      .prepare('UPDATE optouts SET confirmed_at = ? WHERE viewer_id = ? AND confirmed_at IS NULL')
      .run(this.now(), viewerId).changes;
  }

  // One transaction keeps reputation consistent across retries and process restarts.
  recordMoment(moment: Moment, points = 0): boolean {
    if (!Number.isSafeInteger(points) || points < 0) throw new Error('Invalid reputation points');
    if (!Number.isFinite(moment.occurredAt) || moment.occurredAt > this.now()) return false;
    if (moment.occurredAt <= this.now() - RETENTION_MS || this.isOptedOut(moment.viewer.id))
      return false;
    if (!moment.quote.trim() || moment.quote.length > 500) return false;
    return this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO viewers VALUES (?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET login = excluded.login, updated_at = excluded.updated_at`,
        )
        .run(moment.viewer.id, moment.viewer.login, this.now());
      const result = this.db
        .prepare(
          `INSERT OR IGNORE INTO moments
        (id, stream_id, message_id, viewer_id, quote, kind, confidence, occurred_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          moment.id,
          moment.streamId,
          moment.messageId,
          moment.viewer.id,
          moment.quote,
          moment.kind,
          moment.confidence,
          moment.occurredAt,
        );
      if (!result.changes) return false;
      this.db
        .prepare(
          `INSERT INTO reputation VALUES (?, ?, 1, ?)
        ON CONFLICT(viewer_id) DO UPDATE SET points = points + excluded.points,
        moment_count = moment_count + 1, updated_at = excluded.updated_at`,
        )
        .run(moment.viewer.id, points, this.now());
      return true;
    })();
  }

  getMoments(streamId?: string): Moment[] {
    const rows = this.db
      .prepare(
        `SELECT m.*, v.login FROM moments m
      JOIN viewers v ON v.id = m.viewer_id
      WHERE m.occurred_at > ? AND (? IS NULL OR m.stream_id = ?)
      ORDER BY m.occurred_at, m.id`,
      )
      .all(this.now() - RETENTION_MS, streamId ?? null, streamId ?? null) as MomentRow[];
    return rows.map((row) => ({
      id: row.id,
      streamId: row.stream_id,
      messageId: row.message_id,
      viewer: { id: row.viewer_id, login: row.login },
      quote: row.quote,
      kind: row.kind,
      confidence: row.confidence,
      occurredAt: row.occurred_at,
    }));
  }

  getReputation(): Reputation[] {
    const rows = this.db
      .prepare(
        `SELECT v.id, v.login, r.points, r.moment_count
      FROM reputation r JOIN viewers v ON v.id = r.viewer_id
      ORDER BY r.points DESC, v.id`,
      )
      .all() as { id: string; login: string; points: number; moment_count: number }[];
    return rows.map((row) => ({
      viewer: { id: row.id, login: row.login },
      points: row.points,
      momentCount: row.moment_count,
    }));
  }

  purgeExpired(headroomMs = 0): number {
    return this.db
      .prepare('DELETE FROM moments WHERE occurred_at <= ?')
      .run(this.now() - RETENTION_MS + headroomMs).changes;
  }

  startRetentionJob(intervalMs = PURGE_INTERVAL_MS): void {
    if (!Number.isFinite(intervalMs) || intervalMs <= 0 || intervalMs > PURGE_INTERVAL_MS)
      throw new Error('Retention interval must be between 1 and 60000 milliseconds');
    if (this.retentionTimer) clearInterval(this.retentionTimer);
    // Delete one tick early so a normal job interval cannot extend storage past 72 hours.
    this.purgeExpired(intervalMs);
    this.retentionTimer = setInterval(() => this.purgeExpired(intervalMs), intervalMs);
    this.retentionTimer.unref();
  }

  close(): void {
    if (this.retentionTimer) clearInterval(this.retentionTimer);
    this.db.close();
  }
}
