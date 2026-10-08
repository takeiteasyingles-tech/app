# tools/parity: blind visual-parity harness

Captures the same routes in the prototype (`prototipo/`) and in the new app, under identical
determinism, and writes them as blind A/B pairs for a critic. Each run uses an isolated **slot**, so
several runs can go at once.

```powershell
npm run parity -- --slot 9 --routes entrar,inicio --viewports mobile,desktop --seed abc
npm run parity -- --slot 8 --routes all --seed abc --workers 4
npm run parity -- --slot 7 --shots-only --app admin --routes login,dashboard,users,user-detail   # or --routes all
npm run parity:reveal -- --run slot9-abc --votes votes.json     # {"<pairId>": "A" | "B" | "tie"}
```

## Slot N

| Resource | Value |
|---|---|
| Prototype static server | `127.0.0.1:8100+N` |
| `wrangler dev` (app or admin) | `localhost:8200+N`, inspector `9200+N` |
| Build | `apps/<app>/dist/web-slot<N>` (the app's vite config, minus the PWA plugin) |
| Database + R2 | `apps/app/.wrangler/parity-slot<N>` (`--persist-to`) |
| Generated wrangler config, `.dev.vars`, logs | `tools/parity/out/slots/slot<N>/<app>/` |
| Pairs | `tools/parity/out/<runId>/pairs/<pairId>/{A.png,B.png,meta.json}` |
| Key (never show it to critics) | `tools/parity/out/<runId>-key/{key.json,diff/*.png}` |

`runId = slot<N>-<seed>`.

## What a run does

1. Takes the slot lock. A second run on the same slot waits for the first one to finish. The run's
   output dirs are cleared only once the lock is held.
2. Builds the app into the slot's build directory.
3. Seeds the database with `npm run seed -- --local --persist-to .wrangler/parity-slot<N>`.
   - It skips the seed when the slot was already seeded from the same inputs.
   - Seeds from different slots run one at a time, because they share `packages/seed/out`.
4. Applies the fixture users with `fixtureToSql`:
   - standing users: `main` (Ana, with the prototype's own ids: Mic session `56xdhnp`, cards
     `fx-card-NNN`), `fresh` (signed in, no profile), and `ep1-s7` to `ep1-s10` (episode 1 advanced);
   - **one user per capture job** (route × viewport), e.g. `U_PARITY__INICIO_MOBILE` /
     `ana+inicio-mobile@parity.test`, cloned from the route's standing user with its own session
     token, Mic session ids and card ids. Whatever an app screen writes while it is captured cannot
     leak into another route, just as each prototype route starts from fresh localStorage. The
     prototype side of the job gets that same state (same email, same session ids; the
     `maggie-relatorio` hash follows the job's session id). Per-route users of earlier runs are deleted;
   - a super_admin and an editor (`editor@parity.test`, editor role only), each with an admin session.

   Admin shots (`--app admin`) take ids from `ADMIN_ROUTES` in `src/routes.ts`: `login` (signed out),
   `dashboard`, `users`, `user-detail` (Ana), `plans`, `content-*`, `media`, `moderation`, `audit`,
   `releases`, `settings`, `account` as the super_admin, and `editor-*` (the same screens as the editor).
   Anything that is not an id is a raw hash, captured as the super_admin.

   No two users share a primary key (an upsert would move the row to the last user applied);
   `npm test -w @tie/parity` checks that on a real SQLite with the D1 schema and the content seed.
5. Starts the servers and captures every route at every viewport on both sides.
6. Writes the pairs and the key, then stops the servers.

Ctrl+C at any point (build, seed, fixture apply, the wrangler readiness wait or the capture) kills
every child process this run started and frees its locks before exiting.

## Determinism (both sides)

- **Clock.** The browser clock is fixed at 2026-09-15T12:00-03:00. The Worker clock is shifted to the same instant by a generated entry shim; pass `--real-clock` to turn that off.
- **Randomness.** `Math.random` is a mulberry32 seeded from the route and viewport.
- **Motion and service workers.** Motion is reduced and service workers are blocked.
- **Health and AI.** `/api/health` answers `{ai:false}`. The Workers AI binding is dropped from the generated config, so the app runs in demo mode offline.
- **Fonts.** The prototype's Google Fonts requests are served from `packages/ui/fonts`.
- **Hidden UI.** `#devtoggle` is hidden and the caret is transparent.
- **Before each shot.** Videos are paused at 0. The harness waits for fonts, network idle and any toasts to clear, then for two animation frames.
- **Full page.** `.app` is pinned to `100dvh` and content scrolls inside `.scroll` (and the live-grid panes), so a plain full-page shot would show only the first screen. Before each shot the viewport height is grown until no inner scroller that grows with it still overflows. Fixed-height scrollers are detected and ignored. The cap is 16000 device px. The same steps run on both sides, and the height used is stored in the key (`contentHeight`, `capped`).
- **Worker clock shim.** It is a function, not a class, so `Date()` called without `new` still returns a string.

A screen that errors still gets a screenshot. Errors go to the key only.

## Fixture

`fixtures/state.v6.json` is generated by driving the prototype itself, then validated:

```powershell
npm run fixture:gen -w @tie/parity     # regenerate
npm run fixture:check -w @tie/parity   # validate: Hoje renders in the prototype; every user owns its own rows in D1
npm test -w @tie/parity                # unit tests: pairs/swap/reveal, routes, fixture ownership, clock shim
```

Every fixture user's password is `FIXTURE_PASSWORD` in `src/fixture/state.ts`. It is only for local test databases.

## Browser

The harness uses Playwright's Chromium if it is installed, otherwise the system Chrome, otherwise
Edge. Set `PARITY_BROWSER_CHANNEL` to force one.
