// Quotes are the only persisted chat text. No audio or transcripts are stored.
export const SCHEMA = `
  CREATE TABLE IF NOT EXISTS viewers (
    id TEXT PRIMARY KEY,
    login TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS moments (
    id TEXT PRIMARY KEY,
    stream_id TEXT NOT NULL,
    message_id TEXT NOT NULL,
    viewer_id TEXT NOT NULL REFERENCES viewers(id) ON DELETE CASCADE,
    quote TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('idea', 'assist', 'riff')),
    confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
    occurred_at INTEGER NOT NULL,
    UNIQUE(stream_id, message_id)
  );
  CREATE INDEX IF NOT EXISTS moments_expiry ON moments(occurred_at);
  CREATE INDEX IF NOT EXISTS moments_stream ON moments(stream_id);
  CREATE TABLE IF NOT EXISTS reputation (
    viewer_id TEXT PRIMARY KEY REFERENCES viewers(id) ON DELETE CASCADE,
    points INTEGER NOT NULL CHECK (points >= 0),
    moment_count INTEGER NOT NULL CHECK (moment_count >= 0),
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS optouts (
    viewer_id TEXT PRIMARY KEY,
    opted_out_at INTEGER NOT NULL,
    confirmed_at INTEGER
  );
  CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS wheel_redemptions (
    id TEXT PRIMARY KEY, broadcaster_id TEXT NOT NULL, reward_id TEXT NOT NULL,
    stream_id TEXT NOT NULL, viewer_id TEXT, status TEXT NOT NULL DEFAULT 'queued',
    round_id TEXT, target_status TEXT, received_at INTEGER NOT NULL,
    CHECK(status IN ('queued', 'fulfilled', 'canceled'))
  );
  CREATE INDEX IF NOT EXISTS wheel_pending ON wheel_redemptions(broadcaster_id, stream_id, status);
  CREATE TABLE IF NOT EXISTS wheel_rounds (
    id TEXT PRIMARY KEY, broadcaster_id TEXT NOT NULL, stream_id TEXT NOT NULL,
    winner_id TEXT, state TEXT NOT NULL DEFAULT 'settling',
    UNIQUE(broadcaster_id, stream_id), CHECK(state IN ('settling', 'complete'))
  );
  PRAGMA user_version = 4;
`;
