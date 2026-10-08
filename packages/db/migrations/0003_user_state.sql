-- 0003_user_state.sql
CREATE TABLE profiles(user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, full_name TEXT, name TEXT, birth TEXT,
  age_band TEXT, occupation TEXT, area TEXT, level_key TEXT NOT NULL DEFAULT 'zero', goals TEXT NOT NULL DEFAULT '[]', deadline TEXT,
  history TEXT NOT NULL DEFAULT '[]', fails TEXT NOT NULL DEFAULT '[]', formats TEXT NOT NULL DEFAULT '[]', genres TEXT NOT NULL DEFAULT '[]',
  themes TEXT NOT NULL DEFAULT '[]', diffs TEXT NOT NULL DEFAULT '[]', main_diff TEXT, styles TEXT NOT NULL DEFAULT '[]',
  company TEXT, feedback TEXT, days TEXT NOT NULL DEFAULT '[1,2,3,4,5]', minutes INTEGER NOT NULL DEFAULT 20,
  reminders TEXT NOT NULL DEFAULT '["20:00"]', motives TEXT NOT NULL DEFAULT '[]', why TEXT, assistant_key TEXT REFERENCES assistants(key),
  avatar INTEGER NOT NULL DEFAULT 1 CHECK(avatar BETWEEN 1 AND 6), photo_upload TEXT, voice TEXT,
  onb_step INTEGER NOT NULL DEFAULT 1, onb_completed_at INTEGER, updated_at INTEGER NOT NULL) STRICT;
CREATE TABLE user_settings(user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, ts REAL NOT NULL DEFAULT 1,
  sound INTEGER NOT NULL DEFAULT 1, hd INTEGER NOT NULL DEFAULT 0, trans INTEGER NOT NULL DEFAULT 1, slow INTEGER NOT NULL DEFAULT 0,
  remind INTEGER NOT NULL DEFAULT 1, fx INTEGER NOT NULL DEFAULT 1, free INTEGER NOT NULL DEFAULT 0) STRICT;
CREATE TABLE episode_progress(user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, episode_num INTEGER NOT NULL REFERENCES episodes(num),
  furthest_step INTEGER NOT NULL DEFAULT 1 CHECK(furthest_step BETWEEN 1 AND 10), done_at INTEGER, updated_at INTEGER NOT NULL,
  PRIMARY KEY(user_id, episode_num)) STRICT;
CREATE TABLE step_completions(user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, episode_num INTEGER NOT NULL,
  step INTEGER NOT NULL, completed_at INTEGER NOT NULL, PRIMARY KEY(user_id, episode_num, step)) STRICT;
CREATE TABLE mic_scores(user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, phrase_id TEXT NOT NULL REFERENCES mic_phrases(id) ON DELETE CASCADE,
  last_score INTEGER NOT NULL, best_score INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 1, source TEXT NOT NULL,
  updated_at INTEGER NOT NULL, PRIMARY KEY(user_id, phrase_id)) STRICT;
CREATE TABLE exercise_answers(user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, item_id TEXT NOT NULL REFERENCES exercise_items(id) ON DELETE CASCADE,
  choice_idx INTEGER NOT NULL, correct INTEGER NOT NULL, answered_at INTEGER NOT NULL, PRIMARY KEY(user_id, item_id)) STRICT;
CREATE TABLE user_ebooks(user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, ebook_num INTEGER NOT NULL REFERENCES ebooks(num),
  downloaded_at INTEGER NOT NULL, PRIMARY KEY(user_id, ebook_num)) STRICT;
CREATE TABLE ebook_test_answers(user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, question_id TEXT NOT NULL REFERENCES ebook_test_questions(id) ON DELETE CASCADE,
  choice_idx INTEGER, text_value TEXT, correct INTEGER NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY(user_id, question_id)) STRICT;
CREATE TABLE ebook_test_results(user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, ebook_num INTEGER NOT NULL,
  score INTEGER NOT NULL, passed INTEGER NOT NULL, submitted_at INTEGER NOT NULL, PRIMARY KEY(user_id, ebook_num)) STRICT;
CREATE TABLE srs_cards(id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, norm_key TEXT NOT NULL,
  en TEXT NOT NULL, pt TEXT NOT NULL, scene TEXT, note TEXT, source TEXT NOT NULL, due_at INTEGER NOT NULL, reps INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL, UNIQUE(user_id, norm_key)) STRICT;
CREATE INDEX ix_srs_due ON srs_cards(user_id, due_at);
CREATE TABLE user_extras(user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, extra_id TEXT NOT NULL REFERENCES extras(id) ON DELETE CASCADE,
  seen_at INTEGER, dub_avg REAL, dub_count INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(user_id, extra_id)) STRICT;
CREATE TABLE user_stats(user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, points INTEGER NOT NULL DEFAULT 0,
  streak INTEGER NOT NULL DEFAULT 0, last_day TEXT, challenge_best INTEGER NOT NULL DEFAULT 0, last_extra_id TEXT) STRICT;
CREATE TABLE daily_stats(user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, local_date TEXT NOT NULL,
  points INTEGER NOT NULL DEFAULT 0, steps INTEGER NOT NULL DEFAULT 0, cards INTEGER NOT NULL DEFAULT 0, extras INTEGER NOT NULL DEFAULT 0,
  mic INTEGER NOT NULL DEFAULT 0, maggie_sec INTEGER NOT NULL DEFAULT 0, goal_hit INTEGER NOT NULL DEFAULT 0, missions TEXT NOT NULL DEFAULT '{}',
  PRIMARY KEY(user_id, local_date)) STRICT;
CREATE TABLE point_ledger(id INTEGER PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  award_key TEXT NOT NULL, kind TEXT NOT NULL, points INTEGER NOT NULL, local_date TEXT NOT NULL, maggie_sec INTEGER NOT NULL DEFAULT 0,
  meta TEXT, created_at INTEGER NOT NULL, UNIQUE(user_id, award_key)) STRICT;
CREATE INDEX ix_ledger_kind ON point_ledger(user_id, kind);
CREATE INDEX ix_ledger_day ON point_ledger(user_id, local_date, kind);
CREATE TRIGGER trg_ledger_ai AFTER INSERT ON point_ledger BEGIN
  INSERT OR IGNORE INTO user_stats(user_id) VALUES(NEW.user_id);
  UPDATE user_stats SET points = points + NEW.points WHERE user_id = NEW.user_id;
  INSERT OR IGNORE INTO daily_stats(user_id, local_date) VALUES(NEW.user_id, NEW.local_date);
  UPDATE daily_stats SET points = points + NEW.points,
    steps = steps + (NEW.kind IN ('step','episode')), cards = cards + (NEW.kind = 'card'),
    extras = extras + (NEW.kind = 'extra'), mic = mic + (NEW.kind IN ('mic_try','mic_good')),
    maggie_sec = maggie_sec + NEW.maggie_sec
  WHERE user_id = NEW.user_id AND local_date = NEW.local_date;
END;
CREATE TABLE user_badges(user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, badge_id TEXT NOT NULL REFERENCES badges(id),
  earned_at INTEGER NOT NULL, PRIMARY KEY(user_id, badge_id)) STRICT;
CREATE TABLE mic_sessions(id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, assistant_key TEXT NOT NULL,
  mode TEXT NOT NULL CHECK(mode IN('livre','missao','pronuncia','extra')), mission_key TEXT, extra_id TEXT,
  started_at INTEGER NOT NULL, billed_until INTEGER NOT NULL, ended_at INTEGER, secs INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN('open','ended')), report TEXT, report_source TEXT, flagged INTEGER NOT NULL DEFAULT 0) STRICT;
CREATE INDEX ix_mic_sessions_user ON mic_sessions(user_id, started_at DESC);
CREATE INDEX ix_mic_sessions_flagged ON mic_sessions(flagged) WHERE flagged = 1;
CREATE TABLE mic_turns(session_id TEXT NOT NULL REFERENCES mic_sessions(id) ON DELETE CASCADE, idx INTEGER NOT NULL,
  who TEXT NOT NULL CHECK(who IN('me','her','coach')), en TEXT NOT NULL, pt TEXT, feedback TEXT, pron TEXT, words TEXT, source TEXT,
  created_at INTEGER NOT NULL, PRIMARY KEY(session_id, idx)) STRICT;
CREATE TABLE ai_usage_monthly(user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, period TEXT NOT NULL,
  seconds_used INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(user_id, period)) STRICT;
CREATE TABLE ai_usage_events(id INTEGER PRIMARY KEY, user_id TEXT NOT NULL, kind TEXT NOT NULL, model TEXT, seconds INTEGER NOT NULL,
  session_id TEXT, ok INTEGER NOT NULL, latency_ms INTEGER, created_at INTEGER NOT NULL) STRICT;
CREATE INDEX ix_ai_events_user ON ai_usage_events(user_id, created_at);
CREATE INDEX ix_ai_events_time ON ai_usage_events(created_at);
