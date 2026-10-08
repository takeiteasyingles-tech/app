-- 0005_hardening.sql (spec 06, Workflow 3)

-- Login lockout decay: failures older than the decay window no longer count (auth/lockout.ts).
ALTER TABLE users ADD COLUMN failed_at INTEGER;

-- One-time tokens are claimed with a per-request nonce, so two consumers in the same millisecond can
-- never both see their claim as the winning one.
ALTER TABLE one_time_tokens ADD COLUMN claim TEXT;
CREATE INDEX ix_ott_exp ON one_time_tokens(expires_at);

-- Game counters: award() reads per-kind totals and goal days from here instead of scanning the
-- ledger and daily_stats. Kept in step by triggers (also on deletes: "Zerar progresso", account delete).
-- The trigger inserts use WHERE NOT EXISTS, not OR IGNORE: an outer upsert (ON CONFLICT DO UPDATE)
-- overrides a trigger statement's own conflict clause, and the duplicate would then abort it.
CREATE TABLE user_kind_counts(user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, kind TEXT NOT NULL,
  n INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(user_id, kind)) STRICT;
INSERT INTO user_kind_counts(user_id, kind, n) SELECT user_id, kind, COUNT(*) FROM point_ledger GROUP BY user_id, kind;
CREATE TRIGGER trg_ledger_kind_ai AFTER INSERT ON point_ledger BEGIN
  INSERT INTO user_kind_counts(user_id, kind, n) SELECT NEW.user_id, NEW.kind, 0
    WHERE NOT EXISTS (SELECT 1 FROM user_kind_counts WHERE user_id = NEW.user_id AND kind = NEW.kind);
  UPDATE user_kind_counts SET n = n + 1 WHERE user_id = NEW.user_id AND kind = NEW.kind;
END;
CREATE TRIGGER trg_ledger_kind_ad AFTER DELETE ON point_ledger BEGIN
  UPDATE user_kind_counts SET n = MAX(0, n - 1) WHERE user_id = OLD.user_id AND kind = OLD.kind;
END;

ALTER TABLE user_stats ADD COLUMN goal_days INTEGER NOT NULL DEFAULT 0;
UPDATE user_stats SET goal_days = (SELECT COUNT(*) FROM daily_stats d WHERE d.user_id = user_stats.user_id AND d.goal_hit = 1);
CREATE TRIGGER trg_daily_goal_au AFTER UPDATE OF goal_hit ON daily_stats WHEN NEW.goal_hit = 1 AND OLD.goal_hit = 0 BEGIN
  INSERT INTO user_stats(user_id) SELECT NEW.user_id WHERE NOT EXISTS (SELECT 1 FROM user_stats WHERE user_id = NEW.user_id);
  UPDATE user_stats SET goal_days = goal_days + 1 WHERE user_id = NEW.user_id;
END;
CREATE TRIGGER trg_daily_goal_ai AFTER INSERT ON daily_stats WHEN NEW.goal_hit = 1 BEGIN
  INSERT INTO user_stats(user_id) SELECT NEW.user_id WHERE NOT EXISTS (SELECT 1 FROM user_stats WHERE user_id = NEW.user_id);
  UPDATE user_stats SET goal_days = goal_days + 1 WHERE user_id = NEW.user_id;
END;
CREATE TRIGGER trg_daily_goal_ad AFTER DELETE ON daily_stats WHEN OLD.goal_hit = 1 BEGIN
  UPDATE user_stats SET goal_days = MAX(0, goal_days - 1) WHERE user_id = OLD.user_id;
END;

-- Server-verified kinds get a daily cap too (spec 06 "Game engine"); NULL rows are the seed default.
UPDATE point_rules SET daily_cap = 100 WHERE kind IN ('maggie_turn', 'card') AND daily_cap IS NULL;
UPDATE point_rules SET daily_cap = 8 WHERE kind = 'maggie_session' AND daily_cap IS NULL;

-- Karaoke: the first pick of a line is final (the prototype's K.picks).
CREATE TABLE karaoke_picks(user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, track_id TEXT NOT NULL,
  line INTEGER NOT NULL, correct INTEGER NOT NULL, picked_at INTEGER NOT NULL, PRIMARY KEY(user_id, track_id, line)) STRICT;

-- Pronunciation attempt tokens are single use: one row per consumed token (its signature).
CREATE TABLE attempt_uses(token_sig TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  claim TEXT NOT NULL, used_at INTEGER NOT NULL) STRICT;
CREATE INDEX ix_attempt_uses_at ON attempt_uses(used_at);

-- Idempotency-Key for the offline outbox: the first response of a (user, key) is stored and replayed.
CREATE TABLE idempotency_keys(user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, key TEXT NOT NULL,
  method TEXT NOT NULL, path TEXT NOT NULL, status INTEGER, body TEXT, created_at INTEGER NOT NULL,
  PRIMARY KEY(user_id, key)) STRICT;
CREATE INDEX ix_idem_created ON idempotency_keys(created_at);

-- Retention cron: transcripts by age.
CREATE INDEX ix_mic_turns_created ON mic_turns(created_at);

-- Moderation lookups per user (Mic retention pins) without walking the whole pending queue.
CREATE INDEX ix_mod_subject ON moderation_items(subject_user_id, status);
