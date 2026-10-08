# Spec 06: Open issues carried into the hardening phase (Workflow 3)

Collected from the stage A reviewers and the integration agent. Every item is now either fixed (with
a test) or accepted below with the reason. Schema changes for the fixes are in
`packages/db/migrations/0005_hardening.sql`.

## Resolved

### Missing features and ops
| Item | Resolution | Tests |
|---|---|---|
| Retention cron | `apps/app/worker/src/retention.ts`, run by the Worker's `scheduled` handler; `triggers.crons` = `17 6 * * *` in `apps/app/wrangler.jsonc`. Deletes `mic_turns` older than `retention.transcripts_days` (default 180; turns of sessions with a pending moderation item are kept as evidence), clears the excerpt of decided moderation items after the same period, deletes expired `sessions` and `one_time_tokens`, and prunes `idempotency_keys` (8 days) and `attempt_uses` (1 day). Deletes run in chunks of 5000 rows. | `worker/test/integration/hardening.test.ts` (runs the real `scheduled` handler) |
| Local dev needs a token | Both `wrangler.jsonc` files have an `env.local` with every binding except `ai`. `npm run dev` is `wrangler dev --env local` (demo AI, no token); `npm run dev:ai` keeps the binding. The parity harness drops `env` from its generated config. | `tools/parity/test/hardening.test.ts` (env.local mirrors the bindings, minus `ai`) |
| Model ids are unverified | `apps/app/scripts/checkModels.ts` (`npm run check:models -w @tie/app`) checks `DEFAULT_MODELS` (plus any ids passed as arguments) against `wrangler ai models list --json`. `npm run deploy` runs it first and refuses to deploy a missing id. | `apps/app/web/test/checkModels.test.ts` |
| Admin has no tests | The admin backend suite existed but `npm test -w @tie/admin` ran vitest from `web/` and found nothing. `apps/admin/vitest.config.ts` now runs `worker/test` (workerd, real migrations); the script no longer passes `--passWithNoTests`. | 89 admin tests in the root `npm test` |

### Security and privacy
| Item | Resolution | Tests |
|---|---|---|
| Service worker cache | Logout (SW message and page side) deletes every runtime cache: `me`, `manifest`, `content` (plan-gated files) and `media` (premium media) — `USER_CACHES` in `web/sw/protocol.ts`. `GET /api/me/export` is excluded from the NetworkFirst route, so it is never cached. | `apps/app/web/test/outbox.test.ts` |
| Offline outbox: non-idempotent replays | Both halves: (1) the server honors `Idempotency-Key` on every queueable path (`worker-core/src/idempotency.ts`, mounted on `/api/*` in the app Worker): the first 2xx answer of a (user, key) is stored and replayed with `Idempotent-Replayed: true`; a failed write frees its key; the same key on another route, or still running, is 409. (2) The queueable list (`OUTBOX_PATHS`) moved to `@tie/shared/constants`, so the SW, the store and the server use one list, and it only holds writes that are meaningful without an immediate answer. | `worker/test/integration/hardening.test.ts`, `apps/app/web/test/outbox.test.ts` |
| Offline outbox: 401 dropped | A replay answered 401 keeps the entry (and everything behind it) until someone signs in; `afterAuth` flushes the outbox. Queued writes carry `X-Tie-User` (the account they were made for); the server refuses a replay under another account with 409 and the SW drops it. An explicit logout still empties the outbox (shared device). | `apps/app/web/test/outbox.test.ts`, `apps/app/web/test/actions.test.ts`, integration test above |
| `/m/*` has no rate limit | `routes/media.ts` checks `RL_API` first, keyed `m:u:<user>` from a valid `tie_m` cookie, else `m:ip:<ip>` (its own prefix, so video Range requests never eat into the user's `/api` budget). | `worker/test/integration/hardening.test.ts` |
| `seed --remote` overwrites admin edits | `seedPlan()` in `packages/seed/src/index.ts`: a remote seed without `--force` inserts only missing content rows (`ON CONFLICT DO NOTHING`) and does not republish once `content.current` exists. `--force` (or a local seed) keeps the old upsert + publish behaviour. | `packages/seed/test/seed.test.ts` |

### Auth (S1)
| Item | Resolution | Tests |
|---|---|---|
| Reset token race | The claim stores a per-request random nonce (`one_time_tokens.claim`); every dependent statement checks `CLAIMED_BY` (the nonce), not `used_at = now`. Applied to the app's reset/consume and the admin invite accept. | `account/test/hardening.test.ts`, `apps/admin/worker/test/auth.test.ts` (two consumers in one frozen millisecond: one wins, the loser writes nothing) |
| `failed_logins` never decays | `failedLoginQuery` moved to `worker-core/src/auth/lockout.ts` (app and admin share it). `users.failed_at` stamps each failure; a failure more than `FAILED_LOGIN_DECAY_MS` (1 h) after the previous one restarts the count. | both auth suites |
| Reset progress deletes evidence | "Zerar progresso" keeps flagged Mic sessions that still have a pending moderation item (the admin reset already kept flagged ones). Retention prunes them once the item is decided. | `account/test/hardening.test.ts` |
| Signup enumeration | Turnstile is verified before the duplicate-email lookup. | `account/test/hardening.test.ts` (a failing Turnstile on a taken email answers `turnstile_failed`, not `email_taken`) |

### AI (S7)
| Item | Resolution | Tests |
|---|---|---|
| One pin budget | Two budgets: `MAX_GUARD_PINNED_SESSIONS` (Llama Guard) and `MAX_REPORT_PINNED_SESSIONS` (self-reports) in `ai/context.ts`. | `ai/test/routes.test.ts` |
| Flagged-session EXISTS scans the queue | The lookups are scoped to the user (`subject_user_id`), and `ix_mod_subject(subject_user_id, status)` (migration 0005) makes that an index range. | `ai/test/routes.test.ts` |
| `signAttempt` bills before throwing | `/api/pronounce` refuses before reserving quota when `MEDIA_TOKEN_KEY` is missing, and refunds if signing fails. | `ai/test/routes.test.ts` |

### Game integrity
| Item | Resolution | Tests |
|---|---|---|
| `award()` uses 3 batches and scans the ledger | One D1 batch in the common path: rules, levels, badges and the user's timezone are read in the same transaction as the writes. The timezone is guessed (last seen per isolate, else São Paulo) and every write is guarded by it, so a wrong guess writes nothing and retries once. Per-kind totals come from `user_kind_counts` and goal days from `user_stats.goal_days` (both kept by triggers, also on deletes); the per-session Mic turn count is an index range on `award_key`. A second batch runs only when a mission bonus or a badge is due. | `game/test/hardening.test.ts` (round-trip count, wrong-tz retry, counters vs ledger) |
| Seed daily caps | `point_rules.daily_cap`: `maggie_turn` 100, `maggie_session` 8, `card` 100 (seed `SERVER_CAPS`, migration 0005 for existing rows with NULL, engine fallback `SERVER_DAILY_CAPS` for a missing row). | `game/test/hardening.test.ts`, `packages/seed/test/seed.test.ts` |
| E-book test endpoints ignore the trilha unlock | Saving answers and submitting need every published episode of the e-book done (the Trilha's `ExtrasNode` rule); otherwise 409 `gated`. | `learning/test/ebook.test.ts`, `learning/test/routes.test.ts` |
| Submit returns `show` every time | `show` (the expected answer) is sent with the first graded submit only; later results carry `''` and the client falls back to the published e-book file. | `learning/test/ebook.test.ts` |
| IA attempts deduplicated by issue time | Attempt tokens are single use: `attempt_uses` (keyed by the token signature) is claimed in the same transaction as the score write. Two real attempts always both count, in any order or issued in the same millisecond; a replay counts nothing. Also applied to the dub endpoint. | `learning/test/scored.test.ts`, `worker/test/srs-extras/extras.test.ts` |
| Karaoke picks not locked | `karaoke_picks(user_id, track_id, line)` stores the first pick; only a right first pick earns `ex_right`. Later picks are graded for the screen and never paid. Cleared by "Zerar progresso", included in the export. | `worker/test/srs-extras/extras.test.ts` |
| Due-only grade gate bypass | The grade reads the card ("was it due?") and updates it in one transaction, so the gate is judged on the row the update changes; `card` points also have a daily cap (100). | `worker/test/srs-extras/srs.test.ts`, `game/test/hardening.test.ts` |
| `card` has no daily cap | See above. | |
| Concurrent grades lose `reps` | `UPDATE … SET reps = reps + 1` in the same batch. | `worker/test/srs-extras/srs.test.ts` |

### Parity harness (S11)
| Item | Resolution | Tests |
|---|---|---|
| Lock released before `key.json` | `writeRunOutputs()` (key.json or shots/index.json) runs inside the `try`, before `cleanup()` releases the slot lock. | `tools/parity/test/hardening.test.ts` |
| Stale-lock takeover race | Takeover is serialized through a short-lived `<lock>.takeover` side lock (O_EXCL), and staleness is re-checked while holding it; a side lock left by a crash (> 30 s) is cleared. | `tools/parity/test/hardening.test.ts` |
| Slot `.dev.vars` needs `COOKIE_PREFIX=""` | `slotDevVars()` forces `COOKIE_PREFIX=""` (and the slot `APP_ORIGIN`) whatever the app's `.dev.vars` says. | `tools/parity/test/hardening.test.ts` |
| Fixture ledger 265 vs 340 | The prototype's `game.log` never records mission bonuses. `fixtureToSql` adds `mission:{date}:{k}` rows for each day's completed missions, sharing that day's missing points, so the ledger sums to 340 (and each day to its `daily.points`). | `tools/parity/test/hardening.test.ts` |
| `concluido-1` captured mid-episode | New fixture user `ep1-done` (episode 1 finished, every step passed); `concluido-1` is captured as that user. | `tools/parity/test/hardening.test.ts`, `tools/parity/test/fixture.test.ts` |

## Accepted

- **A reset deletes the e-book test results.** Prototype parity: `store.resetProgress()` resets
  `testAns`, `testDone` and `testScore` together with the episodes. After a reset the episodes that
  open the test are not done either, so a kept score would point at a test the trilha has locked
  again. `test_pass` points are keyed per e-book and the ledger is cleared by the same reset, so
  passing again pays once, exactly like the first time.
- **demo/script Mic scores are client-attested.** There is no audio on the server in demo mode, so
  there is nothing to verify against. The exposure is bounded: 'script' stores the phrase's scripted
  result (the client's number is ignored), 'demo' rows are flagged `mic_scores.source = 'demo'`, and
  neither ever awards more than `mic_try` (`mic_good` needs a server-signed 'ia' attempt).
- **The IA dub token check can be sidestepped by sending `source: 'demo'`.** The `dub` award is once
  per extra and does not depend on the score or the source, so no points ride on it; the score only
  feeds the learner's own running average (`dub_avg`), shown to them alone. What the token does
  guarantee (an 'ia' score is the server's, and each real attempt counts once) is enforced and tested.
  Refusing demo scores would break dubbing whenever the AI is down, which spec 03 requires to keep working.
