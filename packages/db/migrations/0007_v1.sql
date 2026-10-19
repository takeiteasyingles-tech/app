-- 0007_v1.sql (spec 07 "v1"): password reset by e-mail, season test + certificates, NPS per episode,
-- API tokens for the admin MCP server, season editor. Additive only: new tables, new columns with
-- defaults, new indexes and one point rule. Nothing here rewrites existing rows.

-- ---------- Password reset by e-mail (feature A) ----------
-- one_time_tokens(kind 'reset') already exists. The e-mail flow throttles per user by counting the
-- live reset tokens of the account (expires_at > now), so it needs this lookup.
CREATE INDEX ix_ott_user ON one_time_tokens(user_id, kind, expires_at);

-- ---------- Seasons: editor + test settings (features B and D) ----------
-- test_pass_pct: percentage of right answers needed to pass (0..100).
-- test_question_count: target size of the test. The AI draft defaults to it and publishing needs at
--   least this many approved questions; learners answer every approved question.
-- test_published: the test is open to learners (live from D1, not part of a content release).
ALTER TABLE seasons ADD COLUMN test_pass_pct INTEGER NOT NULL DEFAULT 70 CHECK(test_pass_pct BETWEEN 0 AND 100);
ALTER TABLE seasons ADD COLUMN test_question_count INTEGER NOT NULL DEFAULT 20 CHECK(test_question_count BETWEEN 1 AND 100);
ALTER TABLE seasons ADD COLUMN test_published INTEGER NOT NULL DEFAULT 0 CHECK(test_published IN (0, 1));
ALTER TABLE seasons ADD COLUMN test_published_at INTEGER;
ALTER TABLE seasons ADD COLUMN test_published_by TEXT;
ALTER TABLE seasons ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE seasons ADD COLUMN updated_by TEXT;

-- Questions mirror ebook_test_questions: a choice question (opts + answer_idx) or a typed one
-- (accept, already normalized with norm()). status: draft (AI/agent/staff proposal, invisible to
-- learners), approved (part of the test), rejected (kept so a new draft does not repeat it).
-- source: 'ai' (Workers AI draft endpoint), 'agent' (MCP API token), 'staff' (typed in the admin).
-- ep_num (the episode a question reviews) has no FK, like ebook_test_questions: the routes check it.
CREATE TABLE season_test_questions(id TEXT PRIMARY KEY, season_n INTEGER NOT NULL REFERENCES seasons(n) ON DELETE CASCADE,
  sort INTEGER NOT NULL DEFAULT 0, part_title TEXT NOT NULL DEFAULT '', q TEXT NOT NULL, opts TEXT, answer_idx INTEGER,
  accept TEXT, show TEXT, audio TEXT, rev TEXT, ep_num INTEGER,
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN('draft','approved','rejected')),
  source TEXT NOT NULL DEFAULT 'staff' CHECK(source IN('ai','agent','staff')),
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, updated_by TEXT,
  CHECK((opts IS NOT NULL AND answer_idx IS NOT NULL) OR accept IS NOT NULL)) STRICT;
CREATE INDEX ix_stq_season ON season_test_questions(season_n, status, sort);

-- Saved answers (graded on submit, like ebook_test_answers).
CREATE TABLE season_test_answers(user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  question_id TEXT NOT NULL REFERENCES season_test_questions(id) ON DELETE CASCADE,
  choice_idx INTEGER, text_value TEXT, correct INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL,
  PRIMARY KEY(user_id, question_id)) STRICT;

-- Last graded attempt per learner and season. score/total = right answers / questions graded;
-- score_pct = round(100 * score / total). submitted_at = 0 marks a redo in progress (as in
-- ebook_test_results). passed_at is the first time the learner passed (never cleared by a redo).
-- No FK to seasons (like ebook_test_results): the season editor's delete answers 409 in_use instead.
CREATE TABLE season_test_results(user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, season_n INTEGER NOT NULL,
  score INTEGER NOT NULL, total INTEGER NOT NULL, score_pct INTEGER NOT NULL CHECK(score_pct BETWEEN 0 AND 100),
  passed INTEGER NOT NULL DEFAULT 0, best_pct INTEGER NOT NULL DEFAULT 0, attempts INTEGER NOT NULL DEFAULT 0,
  submitted_at INTEGER NOT NULL, passed_at INTEGER, PRIMARY KEY(user_id, season_n)) STRICT;
CREATE INDEX ix_str_season ON season_test_results(season_n, passed);

-- Certificates: issued automatically on the first pass of a season test. code is the short public
-- verification code (CERT_CODE_ALPHABET, 'TIE-XXXX-XXXX'); the name and season title are frozen at
-- issue time. r2_key is the cached PDF (certs/{user_id}/{id}.pdf), NULL until first rendered.
-- A revoked certificate still verifies, as revoked.
CREATE TABLE certificates(id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  season_n INTEGER NOT NULL, full_name_snapshot TEXT NOT NULL, season_title_snapshot TEXT NOT NULL,
  score_pct INTEGER NOT NULL CHECK(score_pct BETWEEN 0 AND 100), issued_at INTEGER NOT NULL, r2_key TEXT,
  revoked_at INTEGER, revoked_by TEXT, revoke_reason TEXT, UNIQUE(user_id, season_n)) STRICT;
CREATE INDEX ix_cert_season ON certificates(season_n, issued_at);
CREATE INDEX ix_cert_issued ON certificates(issued_at);

-- Passing a season test pays once per season (award key season_pass:{n}). Admin-tunable afterwards.
INSERT OR IGNORE INTO point_rules(kind, points, daily_cap, verifiable) VALUES('season_pass', 100, NULL, 1);

-- ---------- NPS per episode (feature C) ----------
-- One rating per learner and episode, upserted from the Concluído screen. Episodes with ratings
-- cannot be deleted (FK without cascade).
CREATE TABLE lesson_feedback(id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  episode_num INTEGER NOT NULL REFERENCES episodes(num), stars INTEGER NOT NULL CHECK(stars BETWEEN 1 AND 5),
  comment TEXT CHECK(comment IS NULL OR length(comment) <= 1000), created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
  UNIQUE(user_id, episode_num)) STRICT;
CREATE INDEX ix_feedback_ep ON lesson_feedback(episode_num, stars);
CREATE INDEX ix_feedback_updated ON lesson_feedback(updated_at);

-- Learning funnel (admin stats): episode_progress by episode without scanning per user.
CREATE INDEX ix_progress_ep ON episode_progress(episode_num, done_at);

-- ---------- API tokens for agents (feature D: MCP server in tie-admin) ----------
-- token_hash = sha256 hex of the plaintext ('tie_pat_' + 43 base64url chars), shown once at creation.
-- token_prefix is the first 12 characters, for display. scopes is a JSON array of API_TOKEN_SCOPES.
-- A token acts as its creator (audit actor_user_id = created_by, actor_role 'agent') and can never do
-- more than the creator's current roles allow.
CREATE TABLE api_tokens(id TEXT PRIMARY KEY, name TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, token_prefix TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, scopes TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL, last_used_at INTEGER, expires_at INTEGER, revoked_at INTEGER, revoked_by TEXT) STRICT;
CREATE INDEX ix_api_tokens_creator ON api_tokens(created_by, created_at);
