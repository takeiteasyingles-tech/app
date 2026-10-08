# CLAUDE.md

This file guides Claude Code (claude.ai/code) when it works in this repository.

## What this is

**Take It Easy** is an English course for Portuguese speakers. This repo is its **production rebuild on Cloudflare**: two Workers (`tie-app` and `tie-admin`) that share one D1 database (`tie-db`), one R2 bucket (`tie-media`) and Workers AI. It is an npm-workspaces TypeScript monorepo: Hono on the Workers, Preact with `@preact/signals` and Vite on the web side, Zod for every contract.

`prototipo/` holds the original clickable prototype. It is the **read-only reference** the production app reproduces; see the last section.

Specs live in `docs/spec/`:
- `01-features.md`: inventory of the student app's features.
- `02-data.md`: data model.
- `03-design-ai.md`: design and AI behaviour.
- `04-architecture.md`: **authoritative** for architecture, API, schema and security.
- `05-foundation-notes.md`: conventions, plus the **accepted deviations** from the prototype.
- `06-open-issues.md`: issues resolved and accepted.

Deployment is in `docs/DEPLOY.md`.

## Ground rules

- **Never edit `prototipo/`.** The seed, the parity harness and the tests read it as the source of truth.
- **Golden rule.** The student app reproduces the prototype 1:1: same hash routes, same DOM and CSS classes (`packages/ui/css/tie.css` is a verbatim copy of the prototype's CSS; additive rules go in `tie-ext.css`), the same pt-BR copy and the same behaviour. Production may differ only where `01-features.md` marks an item **PROD**, or where a row in `05-foundation-notes.md` § "Accepted production deviations" allows it. If you add a deviation, record it there.
- **Brand vocabulary** (UI copy): pontos, sequência, meta, medalha. Never write "XP" or "ofensiva".
- **Language.** UI copy is Brazilian Portuguese. Code, comments and docs in the production code are English.
- **Placeholders in content.** `{N}` is the student's name, `{A}` / `{oA}` is the assistant's name, alone or with its article ("a Maggie" / "o Robert").
- **The server is the source of truth.** Gating (`need()`), grading, points, quotas and SRS unlocks run on the server. The client applies changes optimistically and rolls them back if the server refuses.
- **Every AI feature works in demo mode.** When the `AI` binding is missing, a call fails or the quota runs out, the server falls back to the shared demo engine (`packages/shared/src/demo`) and returns `source:'demo'`. Local dev always runs this way.
- **Security invariants** (spec 04 §5):
  - The CSP is strict: no `innerHTML`, no inline scripts.
  - Zod validates every body. Admin bodies use `.strict()`; app bodies use `.strip()`.
  - Every non-GET request must pass the same-origin `Origin` / `Sec-Fetch-Site` check.
  - Every admin mutation is written to the audit log in the same D1 batch.
  - The R2 bucket is private; media goes out only through `/m/*`.
  - The client bundle carries no secrets and no assistant persona or prompt.
- **Housekeeping.** Never commit `.env` or `.dev.vars`. Do not create scratch files at the repo root; use `tools/*/out/`, which is git-ignored.

## Workspace layout

```
packages/
  shared/      @tie/shared: pure TS for browser, Workers and Node
               contracts/ (Zod request/response + path consts per API area), content/ (schema, compile),
               state.ts (TieState v7 = the prototype's store.s), domain/ (norm, gating, personalize,
               guide, game, srs, daytime), demo/ (offline AI: rules, replies, report, pronounce),
               authz.ts (roles and permissions), constants.ts, errors.ts, ids.ts
  ui/          @tie/ui: css/tie.css (verbatim) + tie-ext.css + self-hosted fonts, icons.tsx (generated
               from the prototype's icons.js), shared components, avatar2d, fx, nav
  worker-core/ @tie/worker-core: Hono app factory, security headers, CSRF, rate limits, config guard,
               validation, D1 helpers, audit, idempotency, auth (pbkdf2, sessions, cookies, turnstile,
               media token), R2 serveObject/upload, service interfaces
  db/          migrations/0001_auth … 0005_hardening.sql (one history, shared by both Workers)
  seed/        @tie/seed: loads prototipo/ in node:vm, extracts constants with acorn, emits SQL,
               uploads media to R2, publishes content snapshots; bootstrapAdmin.ts
apps/
  app/         tie-app: worker/src (routes/*, ai/, game/, learning/, account/, retention.ts cron)
               web/src (main.tsx, shell.tsx = port of draw(), router.ts = the prototype's ROUTES,
               store/ (state signal + actions), api/, core/ (speech, sound, aiClient, outbox),
               screens/<name>/ lazy chunks) + web/sw (Workbox service worker)
  admin/       tie-admin: worker/src (routes/*, lib/) + web/src (admin SPA, hash routes in router.ts)
tools/
  parity/      visual-parity harness: prototype vs app screenshots in isolated "slots"
  e2e/         Playwright specs (smoke, U1..U6) + src/fullSmoke.ts (cross-worker smoke)
  icons/       PWA icon generation
```

## Commands

Run everything from the repo root (PowerShell 5.1: chain with `;`, not `&&`). Requires Node 24 and npm 11. After `npm install`, if needed, run `npm install-scripts approve esbuild workerd`.

| Task | Command |
|---|---|
| Typecheck / test / build all | `npm run typecheck` · `npm test` · `npm run build` |
| Lint / format (Biome) | `npm run lint` · `npm run lint:fix` · `npm run format` |
| One workspace | `npm test -w @tie/app`, `npm run typecheck -w @tie/shared`, … |
| One vitest file | `cd apps/app; npx vitest run hardening` (name filter) |
| Local dev env | copy `apps/app/.dev.vars.example` → `.dev.vars` (same for `apps/admin`) |
| Seed local D1/R2 | `npm run seed -- --local` (migrations + content + media + publish) |
| Local admin account | `npm run seed:bootstrap-admin -- --local` (prints a `#/convite/<token>` URL) |
| Dev servers | `npm run dev:app` (:8787) · `npm run dev:admin` (:8788, same persist dir as the app) |
| Dev with real Workers AI | `$env:CLOUDFLARE_API_TOKEN=…; npm run dev:ai -w @tie/app` |
| Visual parity | `npm run parity -- --slot <N> --routes all --viewports mobile,desktop --seed <s> [--app admin]` then `npm run parity:reveal` |
| E2E (Playwright) | `npm run e2e -- [--slot 7] [--skip-build] [--force-seed] [U3-trilha …]` |
| Full cross-worker smoke | `npm run smoke:full -- [--slot 8] [--skip-build]` |
| Bundle budgets / AI model check | `npm run budgets -w @tie/app` · `npm run check:models -w @tie/app` |
| Deploy | see `docs/DEPLOY.md` (`npm run deploy -w @tie/app`, `npm run deploy -w @tie/admin`) |

Notes:
- `npm run dev:*` uses `wrangler dev --env local`, which has every binding except the remote-only `AI`. Local dev therefore needs no Cloudflare token and runs the AI in demo mode (`/api/health` → `{ai:false}`).
- `wrangler.jsonc` `vars` are **production** values. Local values come from `.dev.vars`: a localhost `APP_ORIGIN`, the Turnstile test keys, and `COOKIE_PREFIX=` (empty, because browsers drop `__Host-` cookies over plain http). The `env.local` block must mirror the top-level bindings and vars; `tools/parity/test/hardening.test.ts` enforces this. A deploy that still carries dev values answers 500 (`worker-core/src/config.ts`).
- **Slots.** The parity harness, the e2e specs and the smoke each run in an isolated slot N:
  - app on `:8200+N`; the smoke's admin on `:8300+N`;
  - persist dir `apps/app/.wrangler/parity-slot<N>`;
  - build output `apps/<app>/dist/web-slot<N>`;
  - output under `tools/parity/out/slots/slot<N>`.

  A slot is reseeded only when the seed inputs change. Admin runs (parity `--app admin`, admin tests) can leave edited or republished content in a slot, and the e2e specs assert seeded content, so run `npm run e2e -- --force-seed` after them. Never use the default dev ports for automated runs.
- Workers tests run inside workerd (`@cloudflare/vitest-plugin`, with D1 migrations applied) or against a `node:sqlite` D1 stand-in. Each slice has its own `vitest.config.mjs`, listed in `apps/app/vitest.config.ts`.
- git is not on PATH in this environment. Use GitHub Desktop's: `$env:Path = "$env:LOCALAPPDATA\GitHubDesktop\app-3.6.6\resources\app\git\cmd;$env:Path"`.

## Architecture (big picture)

**Requests.** Each Worker serves its SPA through Workers Static Assets (SPA fallback). The Worker code only runs for `run_worker_first` paths:
- tie-app: `/api/*` and `/m/*`;
- tie-admin: `/admin-api/*` and `/m/*`.

`createApp()` (worker-core) applies, in order: request id, security headers and CSP, the config guard, CSRF, a JSON body limit, and the services. Errors map to `ApiError` codes with pt-BR messages. Routes declare their contract from `@tie/shared/contracts` and validate with `vJson` / `vParam`.

**Auth.**
- Login is email + password. Passwords are PBKDF2-SHA256 at 100k iterations. Login and signup also check Turnstile.
- Session cookies:
  - app: `__Host-tie_s`, 30 days, sliding;
  - admin: `__Host-tie_adm`, 8h absolute, 30 min idle.
- Roles: `super_admin` > `admin` > `editor` (content) / `moderator` (users and UGC). Permissions are defined in `shared/authz.ts`.
- The super_admin is created by `seed:bootstrap-admin` with no password and an invite link.

**Client state.**
- `GET /api/me/state` builds `TieState` v7 in a single D1 batch. It has the prototype's `store.s` shape, with stable-id keys: `scores[phraseId]`, `exAns[itemId]`.
- The web store (`apps/app/web/src/store`) holds it as a signal. Actions update it optimistically, call the API, and then settle or roll back.
- Points come back as an `AwardResult`, which plays the same effects as the prototype's `game.award()`.
- Writes that may happen offline carry an `Idempotency-Key` and go through the IndexedDB outbox (`core/outbox.ts`, Background Sync).

**Routing and screens.**
- The hash routes and the `ROUTES` table are kept verbatim from the prototype (`#/episodio/1/5`).
- `shell.tsx` ports `draw()`: the guards (no user → `entrar`, no profile → `cadastro/<step>`) and the layout (desktop sidebar at ≥900px, phone tab bar).
- Each screen is a lazy chunk registered in `screens/registry.ts`, with the chrome (tabs, theme, nav) that the prototype's `render()` returned.

**Content pipeline.**
- Content lives in D1 tables. The admin edits it (`/admin-api/content/*`). **Publish** compiles Zod-validated snapshots (`catalog.json`, `ep/{n}.json`, `ebook/{n}.json`, `extra/{id}.json`) to R2 under `content/{ver}/`, where `ver` is the sha256 of the set, and moves `app_settings['content.current']`.
- Clients read `/api/content/manifest` (no-cache, ETag) and then the immutable versioned files.
- Media is keyed by content as `media/{sha8}/…` and served by `/m/*` with Range and ETag support, behind the signed `tie_m` cookie. User uploads (`users/…`) are served only to their owner or to staff.
- Rollback and media-in-use checks consider every retained release.

**AI** (spec 04 §3.1).
- The server builds the persona, context, history and script itself; the client sends only `{session_id, text, turn}`.
- Models (tutor, ASR, TTS, guard) are listed in `app_settings` (`ai.model.*`), with defaults in `shared/constants.ts` `DEFAULT_MODELS`.
- The quota is in minutes per plan per month. Exceeding it returns `429 quota_exceeded`, and the client switches to demo mode.
- Llama Guard runs in `waitUntil`; unsafe turns go to the moderation queue.

**Game and SRS.**
- `shared/domain/game.ts` and the app's `worker/src/game` hold the rules: points, sequência, meta, levels, medalhas and daily missions. Each award is keyed in a ledger, so repeats do not pay twice.
- Finishing episode step 4 unlocks review cards for the episode's `visual` words; finishing step 8 unlocks cards for its `awayExp` expressions.

**Ops.**
- The tie-app cron (`17 6 * * *`) removes old Mic transcripts (`retention.transcripts_days`), expired sessions and expired one-time tokens.
- The audit log is append-only and stores salted IP hashes.
- Each Worker has four rate limiters (`RL_AUTH`, `RL_AI`, `RL_API`, `RL_UPLOAD`).

## Conventions

- Contracts are the single source of truth for paths and shapes. Change them **additively** in `packages/shared/src/contracts`, then use them on both sides (`call(api.x, …)` on the web, the route's `api.x.path` on the Worker).
- Logic shared by client and server belongs in `@tie/shared/domain`. It is pure, and it is parity-tested against the prototype's functions, which the tests load in `node:vm` (`packages/shared/test`).
- Plain SQL through `worker-core/db.ts` (`one`, `all`, batches); no ORM. Tables are STRICT, timestamps are unix ms, ids are text. A schema change is a new numbered migration in `packages/db/migrations`; never edit an applied one.
- No `innerHTML` anywhere. Icons are JSX (`@tie/ui` icons) and fonts are self-hosted.
- Every new admin mutation needs a permission (`authz.ts`) and an audit row in the same batch.
- Formatting is Biome: 2 spaces, 120 columns, LF.

## `prototipo/` (read-only reference)

The original single-page PWA prototype: plain browser JS that attaches every file to `window.TIE`, with no build step. Never edit it. To look at it, open `prototipo/index.html`, or run `python -m http.server 8080 --directory prototipo`. The parity harness serves it on `:8100+N`.

Where things live:
- `js/core/store.js`: state (`localStorage` key `tie.v6`) and the `ROUTES` table.
- `js/app.js`: `draw()`, which holds the guards and the layout.
- `js/screens/*.js`: the screens.
- `js/data/*.js`: content.
  - `curriculum.js` holds `STEPS` and `EPS`. Its text was ported verbatim from the v3.2 design file, so do not reword it.
  - The other content files are `onboarding.js`, `extras.js`, `maggie.js`, `mic-clips.js` and `assistants.js`. The assistants are Maggie, Robert, Becky, Zach and Barbara, from the character guides in `prototipo/personagens/*.pdf`.
- `js/core/{personalize,guide,game,review,ai}.js`: the domain logic that `@tie/shared` ports.
- `assets/`: media. The seed uploads it to R2, except `temp/`, `prototipo.zip` and `personagens/`, which are scratch material.

The prototype's AI server (`/api/tutor` and the rest) was never in this repo. Its demo mode (`data/maggie.js` scripts and the `RULES` regex checker) is what `packages/shared/src/demo` reproduces.
