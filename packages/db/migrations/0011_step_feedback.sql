-- Reconstructed on 2026-11-19 from the production D1 schema (sqlite_master) after the local history was lost.
-- Production already applied this file by name; it only runs on fresh databases.
CREATE TABLE step_feedback (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  episode_num INTEGER NOT NULL REFERENCES episodes(num),
  step INTEGER NOT NULL CHECK(step BETWEEN 1 AND 10),
  stars INTEGER NOT NULL CHECK(stars BETWEEN 1 AND 5),
  had_difficulty INTEGER NOT NULL CHECK(had_difficulty IN (0, 1)),
  difficulty TEXT CHECK(difficulty IS NULL OR length(difficulty) <= 1000),
  improvement TEXT CHECK(improvement IS NULL OR length(improvement) <= 1000),
  created_at INTEGER NOT NULL
) STRICT;
CREATE INDEX ix_step_feedback_created ON step_feedback(created_at DESC, id DESC);
CREATE INDEX ix_step_feedback_user ON step_feedback(user_id, episode_num, step);
