-- 0001_auth.sql
-- All timestamps are unix ms. IDs are text. All tables are STRICT.
CREATE TABLE users(id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE COLLATE NOCASE, pass_hash TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN('active','suspended','deleted')),
  tz TEXT NOT NULL DEFAULT 'America/Sao_Paulo', failed_logins INTEGER NOT NULL DEFAULT 0, locked_until INTEGER,
  terms_version TEXT, terms_accepted_at INTEGER, created_at INTEGER NOT NULL, last_login_at INTEGER) STRICT;
CREATE TABLE user_roles(user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK(role IN('super_admin','admin','editor','moderator')), granted_by TEXT, granted_at INTEGER NOT NULL,
  PRIMARY KEY(user_id,role)) STRICT;
CREATE TABLE sessions(token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  audience TEXT NOT NULL CHECK(audience IN('app','admin')), created_at INTEGER NOT NULL, last_seen_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL, ip_hash TEXT, ua TEXT) STRICT;
CREATE INDEX ix_sessions_user ON sessions(user_id, audience);
CREATE INDEX ix_sessions_exp ON sessions(expires_at);
CREATE TABLE one_time_tokens(token_hash TEXT PRIMARY KEY, user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN('reset','admin_invite')), email TEXT, role TEXT, created_by TEXT,
  expires_at INTEGER NOT NULL, used_at INTEGER) STRICT;
CREATE TABLE plans(id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, name TEXT NOT NULL, ai_minutes_month INTEGER NOT NULL,
  features TEXT NOT NULL DEFAULT '{}', is_default INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL) STRICT;
CREATE UNIQUE INDEX ux_plans_default ON plans(is_default) WHERE is_default=1;
CREATE TABLE user_plans(user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, plan_id TEXT NOT NULL REFERENCES plans(id),
  assigned_by TEXT, assigned_at INTEGER NOT NULL, expires_at INTEGER) STRICT;
CREATE INDEX ix_user_plans_plan ON user_plans(plan_id);
