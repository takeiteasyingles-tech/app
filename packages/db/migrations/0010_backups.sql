-- Backups (tie-admin, Operação → Backup): the index of the gzip JSON dumps kept in R2 under backups/.
-- kind: manual (staff), auto (hourly cron when the schedule is due), pre_restore (taken right before a
-- restore), agent (MCP create_backup). scope: content (course tables) or full (every table except
-- sessions, one-time tokens, idempotency keys and this one). The schedule is app_settings['backup.config'].
CREATE TABLE backups(
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK(kind IN ('manual', 'auto', 'pre_restore', 'agent')),
  scope TEXT NOT NULL CHECK(scope IN ('content', 'full')),
  status TEXT NOT NULL CHECK(status IN ('ok', 'failed')),
  r2_key TEXT,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  tables INTEGER NOT NULL DEFAULT 0,
  rows INTEGER NOT NULL DEFAULT 0,
  note TEXT,
  error TEXT,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  restored_at INTEGER
) STRICT;
CREATE INDEX ix_backups_created ON backups(created_at DESC);
CREATE INDEX ix_backups_kind ON backups(kind, created_at DESC);
