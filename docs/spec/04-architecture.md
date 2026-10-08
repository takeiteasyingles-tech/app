# Spec 04: Production architecture (Cloudflare Workers + D1 + R2 + Workers AI)

**Fixed decisions:**
- Hosting: two Workers on *.workers.dev, `tie-app` (student PWA + `/api`) and `tie-admin` (admin SPA + `/admin-api`).
- Shared resources: one D1 (`tie-db`), one R2 bucket (`tie-media`), and the Workers AI binding.
- Auth: email + password (PBKDF2) + Turnstile.
- Roles: super_admin (diego.perez@digitalsolvers.com), admin, editor (content), moderator (users/UGC).
- Plans: no billing. The admin creates plans with an AI-minute quota and features and assigns them to users.
- Package manager: **npm workspaces** (pnpm is not installed).
- Shell: Windows/PowerShell. Use git from GitHub Desktop: `$env:Path = "$env:LOCALAPPDATA\GitHubDesktop\app-3.6.6\resources\app\git\cmd;$env:Path"`.

## 0. Key decisions
- **Client state.** The client keeps a `TieState` (v7) with the same shape as the prototype's `store.s`, built by the server (`GET /api/me/state`). Index-based keys become stable-ID keys (`scores[phraseId]`, `exAns[itemId]`). This keeps the screen port mechanical.
- **Hash routing stays.** The ROUTES table from `prototipo/js/core/store.js` is kept verbatim (e.g. `#/episodio/1/5`). URLs match the prototype, so the parity harness can hit the same route on both.
- **Seed extraction.** Some constants live inside closures: SEASONS (`curso.js`), FOCUS (`personalize.js`), POINTS/LEVELS/BADGES (`game.js`), GRADES (`review.js`). The seed extracts them with acorn.
- **AI contract.** The client contract stays identical. The server builds the persona, ctx, history and script itself (prompt-injection hardening).
- **PBKDF2.** Workers WebCrypto caps PBKDF2 at 100k iterations, so the hash uses exactly 100k. Format: `pbkdf2-sha256$100000$<salt b64>$<hash b64>`. This likely needs Workers Paid (CPU). Check at deploy time.

## 1. Monorepo layout
```
takeiteasy/
  package.json (workspaces: packages/*, apps/*, tools/*)  tsconfig.base.json  biome.json  .gitattributes (* text=auto eol=lf)
  prototipo/                       # read-only reference, NEVER edit
  docs/spec/                       # these specs
  packages/
    shared/ (@tie/shared)          # pure TS (browser + Workers + Node)
      src/contracts/{auth,me,progress,ebook,srs,extras,game,mic,ai,content,admin}.ts   # Zod req/res + path consts
      src/content/{schema.ts,compile.ts}
      src/state.ts                 # TieState v7 + defaults (mirror of store.fresh())
      src/domain/{norm,gating,personalize,guide,game,srs,daytime}.ts
      src/demo/{rules,analyze,pronWatch,hints,demoReply,demoReport,demoPronounce,align}.ts
      src/{authz,errors,ids}.ts
      test/*.test.ts               # parity tests vs prototype functions loaded in node:vm
    ui/ (@tie/ui)
      css/tie.css (verbatim copy of prototipo/css/tie.css, plus additive rules in css/tie-ext.css)  css/fonts.css  fonts/*.woff2
      src/icons.tsx (generated from prototipo/js/ui/icons.js)  src/components/*.tsx  src/avatar2d.ts  src/fx.ts
    db/  migrations/0001_auth.sql 0002_content.sql 0003_user_state.sql 0004_ops.sql
    worker-core/ (@tie/worker-core)
      src/{env.ts,app.ts,headers.ts,csrf.ts,ratelimit.ts,validate.ts,errors.ts,db.ts,time.ts,audit.ts,flags.ts}
      src/auth/{pbkdf2,sessions,cookies,turnstile,mediaToken}.ts
      src/r2/{serveObject,upload}.ts
      src/services/{award,srs,quota,content}.ts   # interfaces + stub impls (slices fill in)
    seed/  src/{loadPrototype,extract,emitSql,uploadMedia,publish,fixtureToSql,bootstrapAdmin}.ts  src/transform/*.ts  prompts/*.md
  apps/
    app/   wrangler.jsonc  vite.config.ts  worker/src/index.ts  worker/src/routes/*.ts  worker/src/ai/*  worker/src/game/*
           web/index.html  web/public/{manifest.webmanifest,icons/*}  web/sw/sw.ts
           web/src/{main.tsx,shell.tsx,router.ts,store/,api/,core/(speech,sound,aiClient,outbox)}
           web/src/screens/{entrada,cadastro,inicio,trilha,ebook,player,concluido,extra,maggie,revisao,conquistas,perfil}/
    admin/ wrangler.jsonc  vite.config.ts  worker/src/routes/*.ts  web/src/screens/*
  tools/
    parity/  playwright.config.ts  src/{routes,servePrototype,determinism,capture,pair,reveal}.ts  fixtures/state.v6.json  out/ (ignored)
    e2e/     specs/*.spec.ts
    icons/   genIcons.ts (@resvg/resvg-js)
```

### Stack
- **Workers:** Hono + `@hono/zod-validator`. Plain SQL through a thin typed `db.ts`, no ORM.
- **Frontend:** Preact 10 + `@preact/signals` + Vite.
- **PWA:** vite-plugin-pwa (`injectManifest`, Workbox).
- **Tooling:** Biome, Vitest, Playwright.

### Wrangler config (both workers)
- `d1_databases` DB (tie-db)
- `r2_buckets` MEDIA (tie-media)
- `ai` AI
- `ratelimits` RL_AUTH / RL_AI / RL_API / RL_UPLOAD
- `assets {directory:"dist/web", binding:"ASSETS", not_found_handling:"single-page-application", run_worker_first:["/api/*","/m/*"]}`. Admin uses `/admin-api/*`.
- `placement {mode:"smart"}`
- Secrets: TURNSTILE_SECRET, MEDIA_TOKEN_KEY, IP_HASH_SALT.
- Vars: TURNSTILE_SITEKEY, APP_ORIGIN.
- Local dev: Turnstile test keys (sitekey `1x00000000000000000000AA`, secret `1x0000000000000000000000000000000AA`).

## 2. D1 schema
All timestamps are unix ms. IDs are text. All tables are STRICT.

```sql
-- 0001_auth.sql
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
```

### Award keys
Awards are idempotent via `INSERT OR IGNORE`.

| Kind | Award key | Note |
|---|---|---|
| step | `step:{ep}:{n}` | |
| episode | `episode:{ep}` | |
| ex_right | `ex:{itemId}` | Awarded only when the server-graded answer is correct |
| mic_try / mic_good | `mic_try:{phraseId}` / `mic_good:{phraseId}` | |
| song | `song:{ep}` | |
| maggie_turn | `mturn:{sessionId}:{idx}` | Max 20 per session |
| maggie_session | `msess:{id}` | |
| extra | `extra:{id}` | |
| dub | `dub:{id}` | |
| card | `card:{cardId}:{date}` | |
| quiz_hit | `quiz:{scope}:{q}:{date}` | |
| test_pass | `test_pass:{ebook}` | |
| mission | `mission:{date}:{k}` | |
| word | `word:{normKey}` | |
| karaoke gap | `kgap:{track}:{line}` | |

`point_rules.daily_cap` limits the soft, client-attested kinds.

### Game engine
A single `db.batch` does three things:
1. Touches the streak in the user's timezone.
2. Inserts the ledger row.
3. Updates the goal.

Then it evaluates missions and badges (`INSERT OR IGNORE`) and returns `{awarded, points, levelUp, goalHit, newBadges}`. The client uses that to play the same toasts and confetti as the prototype.

Local dates use `Intl.DateTimeFormat('en-CA',{timeZone})`.

## 3. API surface

**Student API** (`/api`):
- Session cookie `__Host-tie_s`. It falls back to `tie_s` on plain-HTTP localhost via the `COOKIE_PREFIX` var.
- Every non-GET request must carry a same-origin `Origin`.

| Endpoint | Purpose | Authz |
|---|---|---|
| GET /api/health | `{ai, model}` | public |
| POST /api/auth/signup, /login, /logout | Turnstile + PBKDF2 + session. Signup stores `tz` and terms acceptance | public, RL_AUTH |
| POST /api/auth/reset/consume | Set a new password from an admin-issued one-time link | public, RL_AUTH |
| POST /api/auth/password | Change password; revokes the user's other sessions | user |
| GET /api/me/state | TieState v7, built with one `db.batch` | user |
| GET /api/me/summary | game summary, missions, plan, quota | user |
| PUT /api/me/profile | Partial update; also sets `onb_step` | user |
| POST /api/me/profile/complete | Mark onboarding complete | user |
| PATCH /api/me/settings | Update settings | user |
| POST, DELETE /api/me/photo | ≤2 MB, magic bytes checked; goes to the moderation queue | user, RL_UPLOAD |
| POST /api/me/reset-progress | Reset progress | user |
| GET /api/me/export | LGPD data export | user |
| DELETE /api/me | Delete account | user |
| GET /api/content/manifest | Current content version | user |
| GET /api/content/v/:ver/:file | Versioned snapshots, Cache API, immutable; premium content gated by plan | user |
| POST /api/progress/step-ok, /advance, /episode-done | Server runs the shared `need()`, unlocks SRS cards at steps 4/8, awards points | user |
| POST /api/progress/exercise {itemId, choice} | Server grades | user |
| POST /api/progress/mic {phraseId, score source} | Record a mic score | user |
| POST /api/ebooks/:n/download | Mark e-book downloaded | user |
| PUT /api/ebooks/:n/test/answers | Save test answers | user |
| POST /api/ebooks/:n/test/submit | Submit test | user |
| GET /api/srs/queue | Review queue | user |
| POST /api/srs/cards | Add card | user |
| POST /api/srs/cards/:id/grade | Grade card | user |
| POST /api/extras/:id/seen, /dub | Extras progress | user |
| POST /api/extras/challenge | Challenge result | user |
| POST /api/karaoke/gap | Karaoke gap fill | user |
| POST /api/game/event {kind, key} | Soft awards (song, quiz_hit, word) with caps | user |
| POST /api/mic/sessions | Start a session → `{id, opener, quotaLeftS}` | user + quota |
| POST /api/mic/sessions/:id/end | End a session | owner |
| GET /api/mic/sessions(/:id) | List / read sessions | owner |
| POST /api/tutor, /report, /pronounce, /tts | AI calls | user, RL_AI, quota |
| POST /api/reports | User reports → moderation queue | user |
| GET /m/* | R2 media with Range. Content uses a signed `tie_m` HMAC cookie (12h); uploads are served to their owner or an admin | see Purpose |

**Admin API** (`/admin-api`):
- Cookie `__Host-tie_adm`: 8h absolute, 30 min idle.

| Endpoints | Minimum role |
|---|---|
| auth/login, logout, me, invite/accept | — |
| users list, search, detail | moderator |
| users suspend | moderator |
| users delete | admin |
| users plan, reset-link, progress-reset | admin |
| roles: grant editor/moderator | admin |
| roles: grant admin | super_admin |
| mic transcripts | moderator (every read is audited) |
| plans CRUD | admin |
| content CRUD (episodes, mic-phrases, exercises, items, ebooks, test-questions, extras, albums, tracks, assistants, missions, blobs, option-lists) | editor |
| persona, prompts, gamification rules | admin |
| preview / publish | editor |
| releases, rollback | admin |
| media (≤60 MB, MIME allowlist; delete only if unreferenced) | editor |
| moderation queue + decisions | moderator |
| audit | admin |
| flags, settings, stats | admin |

Every admin mutation calls `audit()` with a JSON diff.

Bootstrap: `npm run seed:bootstrap-admin` creates the super_admin `diego.perez@digitalsolvers.com` with no password, plus an `admin_invite` token, and prints the invite URL once.

### Content snapshots
On publish, `compile.ts` builds Zod-validated JSON files:
- `catalog.json`: steps, seasons, titles, cast, option lists, focus, public assistant fields (NO persona), extras metadata, albums, Mic modes / openers / follow / missions / pron / help, points / levels / badges.
- `ep/{n}.json`
- `ebook/{n}.json`
- `extra/{id}.json`

The files go to R2 under `content/{ver}/`, where `ver` is the sha256 of the set, and `app_settings['content.current']` points at that version.

Clients fetch:
1. The manifest, no-cache with an ETag.
2. The versioned files: private, immutable, served through the Cache API with R2 as fallback.

## 3.1 Workers AI
Model IDs live in `app_settings`, so they can be swapped without a deploy.

| Use | Model |
|---|---|
| Tutor + report | `@cf/meta/llama-3.3-70b-instruct-fp8-fast` with JSON schema `response_format`; retry once on `@cf/meta/llama-3.1-8b-instruct-fast` |
| ASR | `@cf/openai/whisper-large-v3-turbo` (`language: en`) |
| TTS | `@cf/deepgram/aura-1` |
| Guard | `@cf/meta/llama-guard-3-8b` |

TTS speaker per assistant: Maggie→asteria, Robert→orion, Becky→luna, Zach→arcas, Barbara→athena. All model IDs must be verified against the account catalog.

### Tutor
1. Zod strips the client body down to `{session_id, text, turn}`.
2. The persona comes from D1. The template comes from `ai_prompts.tutor_system`. The context comes from the shared `personalize.tutorContext`. The script comes from the mission or openers. History is the last 12 rows of `mic_turns`.
3. User text is capped at 500 chars, has control characters stripped, and goes only in the user message inside `<learner>` delimiters.
4. The output is Zod-validated against the client contract and its arrays are clamped. `feedback.original` is set to the user text.
5. On any failure the server runs `demoReply` and returns `source:'demo'`.
6. Turns are persisted. Llama Guard runs in `waitUntil`; if it says unsafe, a moderation item is created and the session is flagged.

### Pronounce
1. Validate the RIFF header: PCM16, mono, 16k, ≤15s, ≤700 KB as b64.
2. Transcribe with Whisper.
3. Score with the deterministic word-Levenshtein in `align.ts` (0–10). `pronWatch` supplies the tips.

### TTS
- Text ≤400 chars. The speaker comes from an allowlist.
- Audio is cached in R2 at `tts/{sha256}.mp3` and in the Cache API.

### Quota
- Limit: `plans.ai_minutes_month*60`. Period: YYYY-MM in the user's timezone.
- Reservation is a conditional `UPDATE ... WHERE seconds_used + ? <= limit`. When it fails, the API returns `429 quota_exceeded` and the client switches to demo mode.
- What each call bills:
  - Tutor: `min(now - billed_until, 120)` s.
  - Pronounce: audio seconds.
  - TTS: `ceil(chars/15)` on a cache miss.
- Every call writes `ai_usage_events`.

## 4. Seed (`packages/seed`, `npm run seed -- --local|--remote`)
1. **Load the prototype data.** `vm.createContext` with `window = sandbox` and `TIE = {u:{esc, sub, pick:a=>a[0], shuffle:a=>a, today}, store:{s:{profile:null}}}`. Run `data/curriculum.js`, `onboarding.js`, `extras.js`, `maggie.js`, `mic-clips.js`, `assistants.js`. Skip `store.js`, which touches `location`.
2. **Extract hardcoded constants.** Parse with acorn and extract FOCUS, SEASONS, POINTS, LEVELS, BADGES and GRADES. Badge tests map to rule JSON through an explicit table; the seed fails if a badge has no mapping.
3. **Transform.**
   - Deterministic IDs: `e1-mic-0`, `e1-ex0`, `e1-ex0-i3`, `eb1-t14`.
   - `EP_GAPS` folds into `lyrics[i].gap`.
   - The 20 TITLES become episodes. Status is `title_only`, except episodes 1, 2 and 5, which are published.
   - GENRES are stored with `scope` = format.
   - LEAD, FIVE, REAL and CHAT go to ebook 1. TEST goes to `ebook_test_questions`.
   - Plans: Grátis (60 min, default) and Premium (600 min).
   - Prompts come from `prompts/*.md`.
   - A test checks the shared `norm()` against the prototype for every `acc` and `show` value.
4. **Media.** Walk `prototipo/assets/**`, excluding `temp/`, the zip and `personagens/`. Key each file by content: `media/{sha8}/{relpath}`. Upload with `wrangler r2 object put` (`--local` / `--remote`) and skip unchanged files using `.seed-uploaded.json`. Rewrite every `assets/...` reference to a `media_id`.
5. **Emit SQL.** Write `out/content.sql` in chunks of ≤100 KB per statement, then run `wrangler d1 execute --file`.
6. **Publish.** Run `compile` and upload `content/{ver}/*` to R2.
7. **Fixtures.** `fixtureToSql` turns a v6 prototype state into rows for a test user (used by the parity harness).

## 5. Security and performance
- **CSP** (also in `_headers`):
  ```
  default-src 'self'; script-src 'self' https://challenges.cloudflare.com;
  frame-src https://challenges.cloudflare.com; style-src 'self'; img-src 'self' data: blob:;
  media-src 'self' blob:; font-src 'self'; connect-src 'self'; worker-src 'self';
  manifest-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'
  ```
  Preact sets inline styles through the CSSOM, which `style-src 'self'` allows.
- **Other headers:** HSTS, nosniff, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: microphone=(self), camera=(), geolocation=()`, COOP same-origin, CORP same-origin.
- **No innerHTML.** Fonts are self-hosted and icons are JSX.
- **Passwords:**
  - PBKDF2-SHA256 at 100k iterations with a 16-byte salt; constant-time compare.
  - Login against an unknown email runs a dummy hash, so timing doesn't reveal which emails exist.
  - 10 failed logins lock the account for 15 minutes.
- **Session tokens:**
  - 32 random bytes; only the SHA-256 is stored.
  - App sessions: 30 days, sliding. Admin sessions: 8h absolute, 30 min idle.
  - Rotated on login and on password change.
- **Turnstile:** verified on the server with `remoteip` and `action`.
- **CSRF:** `Origin` must equal the app origin, and `Sec-Fetch-Site` must be same-origin. Requests must be `application/json`, except multipart uploads.
- **Rate limits:**

| Binding | Limit | Key |
|---|---|---|
| RL_AUTH | 5 / 60s | ip+email |
| RL_AI | 20 / 60s | user |
| RL_API | 100 / 10s | user |
| RL_UPLOAD | 5 / 60s | user |

- **Validation:** Zod everywhere. Admin bodies use `.strict()`; app bodies use `.strip()`.
- **R2:** the bucket is private. `serveObject` handles Range, ETag and If-None-Match. Uploads are checked by magic bytes, size and allowlist.
- **Audit log:** append-only, with salted IP hashes.
- **Retention cron:** deletes transcripts older than `retention.transcripts_days` (default 180), plus expired sessions and one-time tokens.
- **Performance:**
  - Hashed static assets are immutable; HTML is no-cache. The Worker only runs on `/api/*` and `/m/*`.
  - Lazy route chunks. Budgets: initial JS ≤60 KB gzip; each screen ≤25 KB.
  - `/api/me/state` makes a single `db.batch` round trip.
  - Smart Placement.
- **Service worker** (Workbox `injectManifest`):
  - Precache the shell.
  - Content versions: CacheFirst.
  - `/api/me` GET: NetworkFirst with a 3s timeout.
  - `/m/*`: CacheFirst with RangeRequestsPlugin and Expiration (60 entries / 30 days).
  - Offline writes go to an IndexedDB outbox with `Idempotency-Key`, replayed by Background Sync.
- **Icons:** `genIcons.ts` renders `icon.svg` to 192, 512, maskable 512, apple-touch 180 and favicon 32. Manifest `start_url` is `/#/inicio`.

## 6. Build order
**F0 (foundation).**
- Workspace and the 4 migrations.
- `@tie/shared` in full, with parity tests.
- `@tie/worker-core`.
- `@tie/ui`.
- Both app shells with all bindings, the router (copied ROUTES), the shell (port of `draw()`) and a lazy screen registry.
- Service interfaces with stubs.

**Parallel slices** (each owns disjoint directories):

| Slice | Owns |
|---|---|
| S1 Auth & account | `routes/{auth,me,uploads}`, screens `entrada`, `cadastro`, `perfil` |
| S2 Player | `routes/progress`, screens `player`, `concluido`, `core/{speech,sound}` |
| S3 Trilha & e-book | `routes/ebook`, screens `trilha`, `ebook` |
| S4 Game | `game/*`, `routes/game`, screens `inicio`, `conquistas` (implements AwardService) |
| S5 SRS | `routes/srs`, `services/srs.impl`, screen `revisao` |
| S6 Extras | `routes/extras`, screen `extra` |
| S7 AI backend | `ai/*`, `routes/{ai,mic,reports}` (implements QuotaService) |
| S8 Mic frontend | screen `maggie`, `core/aiClient`, `ui/avatar2d` |
| S9 Content, media & PWA | seed, `compile`, `routes/{content,media}`, `sw`, icons |
| S10 Admin | `apps/admin/**` |
| S11 Parity & e2e | `tools/parity`, `tools/e2e` |

**I1 (integration):** wire the real service implementations, run the full seed, run parity and e2e, fix what breaks.

## 7. Visual-parity harness (`tools/parity`)
1. **Fixture.** `fixtures/state.v6.json` is a full prototype v6 state:
   - an onboarded profile;
   - ep1 at step 6, some scores and exAns;
   - a 12-card deck;
   - 2 Mic sessions with reports;
   - 340 points, streak 3;
   - `phone=false`, `free=false`.
2. **Prototype side.** A node:http static server on `prototipo/` at :8081. `addInitScript` sets `localStorage['tie.v6']`.
3. **New app side.**
   - `npm run build -w apps/app`.
   - Seed into a separate persist dir: `seed --local --persist-to .wrangler/parity`, then `fixtureToSql`, which maps prototype keys to stable IDs and inserts a session with a known token.
   - `wrangler dev --local --port 8787`.
   - `context.addCookies` with that session.
4. **Determinism, applied the same way on both sides.**
   - `page.clock.install` fixed at 2026-09-15T12:00:00-03:00.
   - A seeded `Math.random` (mulberry32).
   - `reducedMotion: 'reduce'`.
   - `/api/health` routed to `{ai:false}`.
   - Google Fonts requests routed to the same self-hosted woff2 files.
   - Hide `#devtoggle`; set `caret-color: transparent`.
   - Before each shot: pause videos at time 0, wait for `document.fonts.ready` and network idle, then settle for 2 animation frames.
5. **Routes.** entrar, cadastro/1..7, inicio, trilha, ebook/1 and its five / real / lead / teste pages, episodio/1/1..10, concluido/1, extra, extra/woods-and-beans, assistir, extra/musica/season-one, extra/desafio, maggie, maggie/relatorio/{id}, revisao, perfil, conquistas.
   - Each route is captured at 375x812 (isMobile, DSF 2) and at 1440x900.
6. **Blind pairs.**
   - `pairId = sha1(route+viewport)`. `swap = HMAC(seed, pairId)[0] & 1`.
   - Output: `out/<run>/pairs/<pairId>/{A.png, B.png, meta.json}`, where `meta.json` holds only the route and viewport.
   - The key, with pixelmatch diff % and diff PNGs, goes to `out/<run>-key/key.json`. The critic never reads it.
   - `reveal.ts` merges the critic's votes with the key.
