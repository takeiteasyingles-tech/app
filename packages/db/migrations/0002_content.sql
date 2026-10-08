-- 0002_content.sql
CREATE TABLE media(id TEXT PRIMARY KEY, r2_key TEXT NOT NULL UNIQUE, kind TEXT NOT NULL CHECK(kind IN('image','audio','video','pdf')),
  mime TEXT NOT NULL, bytes INTEGER NOT NULL, sha256 TEXT NOT NULL, width INTEGER, height INTEGER, duration_ms INTEGER,
  source_path TEXT, created_at INTEGER NOT NULL) STRICT;
CREATE TABLE steps(n INTEGER PRIMARY KEY, name TEXT NOT NULL, pt TEXT NOT NULL, group_label TEXT) STRICT;
CREATE TABLE seasons(n INTEGER PRIMARY KEY, title TEXT NOT NULL, synopsis TEXT) STRICT;
CREATE TABLE cast_members(name TEXT PRIMARY KEY, initials TEXT NOT NULL, color TEXT NOT NULL) STRICT;
CREATE TABLE episodes(num INTEGER PRIMARY KEY, title TEXT NOT NULL, season_n INTEGER REFERENCES seasons(n),
  status TEXT NOT NULL DEFAULT 'title_only' CHECK(status IN('title_only','draft','published')), ebook_num INTEGER,
  synopsis TEXT, intro_media TEXT REFERENCES media(id), song_media TEXT REFERENCES media(id), song_title TEXT,
  scene_media TEXT REFERENCES media(id), scene_note TEXT, dialog_title TEXT, dialog_sub TEXT,
  lyrics TEXT NOT NULL DEFAULT '[]', cast_names TEXT NOT NULL DEFAULT '[]', visual TEXT NOT NULL DEFAULT '[]',
  dialog TEXT NOT NULL DEFAULT '[]', lesson TEXT NOT NULL DEFAULT '[]', pron TEXT, away_exp TEXT NOT NULL DEFAULT '[]',
  away_words TEXT NOT NULL DEFAULT '[]', done TEXT, updated_at INTEGER NOT NULL, updated_by TEXT) STRICT;
CREATE TABLE mic_phrases(id TEXT PRIMARY KEY, episode_num INTEGER NOT NULL REFERENCES episodes(num) ON DELETE CASCADE,
  sort INTEGER NOT NULL, en TEXT NOT NULL, tip TEXT, demo_result INTEGER, blue INTEGER NOT NULL DEFAULT 0, fb TEXT) STRICT;
CREATE INDEX ix_mic_phrases_ep ON mic_phrases(episode_num, sort);
CREATE TABLE exercises(id TEXT PRIMARY KEY, episode_num INTEGER NOT NULL REFERENCES episodes(num) ON DELETE CASCADE,
  sort INTEGER NOT NULL, kind TEXT NOT NULL, title TEXT NOT NULL, intro TEXT, audio TEXT CHECK(audio IN('tts','song')), audio_label TEXT) STRICT;
CREATE INDEX ix_exercises_ep ON exercises(episode_num, sort);
CREATE TABLE exercise_items(id TEXT PRIMARY KEY, exercise_id TEXT NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
  sort INTEGER NOT NULL, q TEXT NOT NULL, opts TEXT NOT NULL, answer_idx INTEGER NOT NULL, fix TEXT, say TEXT) STRICT;
CREATE INDEX ix_ex_items_ex ON exercise_items(exercise_id, sort);
CREATE TABLE ebooks(num INTEGER PRIMARY KEY, title TEXT NOT NULL, eps_label TEXT, scope TEXT, five TEXT NOT NULL DEFAULT '[]',
  real TEXT NOT NULL DEFAULT '[]', lead TEXT NOT NULL DEFAULT '[]', chat TEXT NOT NULL DEFAULT '[]', extras_cards TEXT NOT NULL DEFAULT '[]',
  pdf_media TEXT REFERENCES media(id), pass_score INTEGER NOT NULL DEFAULT 14, updated_at INTEGER NOT NULL) STRICT;
CREATE TABLE ebook_test_questions(id TEXT PRIMARY KEY, ebook_num INTEGER NOT NULL REFERENCES ebooks(num) ON DELETE CASCADE,
  part_idx INTEGER NOT NULL, part_title TEXT NOT NULL, n INTEGER NOT NULL, q TEXT NOT NULL, rev TEXT, ep_num INTEGER, step INTEGER,
  opts TEXT, answer_idx INTEGER, accept TEXT, show TEXT, audio TEXT,
  CHECK((opts IS NOT NULL AND answer_idx IS NOT NULL) OR accept IS NOT NULL)) STRICT;
CREATE UNIQUE INDEX ux_test_q ON ebook_test_questions(ebook_num, n);
CREATE TABLE extras(id TEXT PRIMARY KEY, title TEXT NOT NULL, kind TEXT, format TEXT NOT NULL, genres TEXT NOT NULL, themes TEXT NOT NULL,
  level TEXT, cefr INTEGER, ep_label TEXT, dur TEXT, cover_media TEXT REFERENCES media(id), scene_media TEXT REFERENCES media(id),
  synopsis TEXT, cast_list TEXT NOT NULL, dub TEXT, premiere INTEGER NOT NULL DEFAULT 0, locked INTEGER NOT NULL DEFAULT 0,
  premium INTEGER NOT NULL DEFAULT 0, lines TEXT NOT NULL, vocab TEXT NOT NULL, sort INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'published') STRICT;
CREATE TABLE albums(id TEXT PRIMARY KEY, title TEXT NOT NULL, sub TEXT, level TEXT, img_media TEXT REFERENCES media(id), genres TEXT NOT NULL, sort INTEGER NOT NULL) STRICT;
CREATE TABLE album_tracks(id TEXT PRIMARY KEY, album_id TEXT NOT NULL REFERENCES albums(id) ON DELETE CASCADE, sort INTEGER NOT NULL,
  title TEXT NOT NULL, src_from TEXT, audio_media TEXT REFERENCES media(id), ep_num INTEGER, bpm INTEGER, music_key INTEGER, lines TEXT) STRICT;
CREATE TABLE assistants(key TEXT PRIMARY KEY, name TEXT NOT NULL, full_name TEXT NOT NULL, art TEXT NOT NULL CHECK(art IN('a','o')),
  age INTEGER, aka TEXT NOT NULL, role TEXT, tag TEXT, style TEXT, hello_en TEXT, hello_pt TEXT, voice TEXT NOT NULL,
  tts_speaker TEXT NOT NULL, persona TEXT NOT NULL,
  poster_media TEXT REFERENCES media(id), thumb_media TEXT REFERENCES media(id), sort INTEGER NOT NULL, active INTEGER NOT NULL DEFAULT 1) STRICT;
CREATE TABLE assistant_clips(assistant_key TEXT NOT NULL REFERENCES assistants(key) ON DELETE CASCADE,
  state TEXT NOT NULL CHECK(state IN('idle','talk','talk-happy','talk-soft')), media_id TEXT NOT NULL REFERENCES media(id),
  PRIMARY KEY(assistant_key,state)) STRICT;
CREATE TABLE mic_missions(key TEXT PRIMARY KEY, title TEXT NOT NULL, role TEXT, goal TEXT, turns TEXT NOT NULL, sort INTEGER NOT NULL) STRICT;
CREATE TABLE content_blobs(key TEXT PRIMARY KEY, json TEXT NOT NULL, updated_at INTEGER NOT NULL, updated_by TEXT) STRICT;
CREATE TABLE option_lists(list_key TEXT NOT NULL, scope TEXT NOT NULL DEFAULT '', item_key TEXT NOT NULL, sort INTEGER NOT NULL,
  label TEXT NOT NULL, sub TEXT, icon TEXT, img_media TEXT REFERENCES media(id), extra TEXT,
  PRIMARY KEY(list_key, scope, item_key)) STRICT;
CREATE TABLE ai_prompts(key TEXT PRIMARY KEY, template TEXT NOT NULL, version INTEGER NOT NULL, updated_by TEXT, updated_at INTEGER NOT NULL) STRICT;
CREATE TABLE point_rules(kind TEXT PRIMARY KEY, points INTEGER NOT NULL, daily_cap INTEGER, verifiable INTEGER NOT NULL DEFAULT 1) STRICT;
CREATE TABLE levels(n INTEGER PRIMARY KEY, min_points INTEGER NOT NULL UNIQUE, name TEXT NOT NULL) STRICT;
CREATE TABLE badges(id TEXT PRIMARY KEY, title TEXT NOT NULL, sub TEXT NOT NULL, icon TEXT NOT NULL, rule TEXT NOT NULL, sort INTEGER NOT NULL) STRICT;
CREATE TABLE content_releases(id TEXT PRIMARY KEY, version TEXT NOT NULL UNIQUE, manifest TEXT NOT NULL, notes TEXT,
  published_by TEXT NOT NULL, published_at INTEGER NOT NULL) STRICT;
