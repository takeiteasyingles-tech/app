-- 0004_ops.sql
CREATE TABLE uploads(id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN('photo','recording')), r2_key TEXT NOT NULL UNIQUE, mime TEXT NOT NULL, bytes INTEGER NOT NULL,
  sha256 TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active' CHECK(status IN('active','removed')), created_at INTEGER NOT NULL) STRICT;
CREATE INDEX ix_uploads_user ON uploads(user_id, kind);
CREATE TABLE moderation_items(id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN('photo','transcript','recording','report')),
  subject_user_id TEXT REFERENCES users(id) ON DELETE CASCADE, reporter_user_id TEXT, ref_type TEXT, ref_id TEXT,
  reason TEXT, guard_categories TEXT, excerpt TEXT, priority INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN('pending','approved','removed','dismissed')),
  created_at INTEGER NOT NULL, reviewed_by TEXT, reviewed_at INTEGER, notes TEXT) STRICT;
CREATE INDEX ix_mod_queue ON moderation_items(status, priority DESC, created_at);
CREATE TABLE audit_log(id INTEGER PRIMARY KEY, at INTEGER NOT NULL, actor_user_id TEXT, actor_role TEXT, action TEXT NOT NULL,
  target_type TEXT, target_id TEXT, ip_hash TEXT, ua TEXT, diff TEXT) STRICT;
CREATE INDEX ix_audit_at ON audit_log(at DESC);
CREATE INDEX ix_audit_target ON audit_log(target_type, target_id);
CREATE INDEX ix_audit_actor ON audit_log(actor_user_id, at);
CREATE TRIGGER audit_no_update BEFORE UPDATE ON audit_log BEGIN SELECT RAISE(ABORT,'audit_log is append-only'); END;
CREATE TRIGGER audit_no_delete BEFORE DELETE ON audit_log BEGIN SELECT RAISE(ABORT,'audit_log is append-only'); END;
CREATE TABLE feature_flags(key TEXT PRIMARY KEY, enabled INTEGER NOT NULL DEFAULT 0, rollout_pct INTEGER NOT NULL DEFAULT 100,
  rules TEXT, updated_by TEXT, updated_at INTEGER NOT NULL) STRICT;
CREATE TABLE app_settings(key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_by TEXT, updated_at INTEGER NOT NULL) STRICT;
