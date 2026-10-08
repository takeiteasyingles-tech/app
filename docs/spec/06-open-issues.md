# Spec 06: Open issues carried into the hardening phase (Workflow 3)

Collected from the stage A reviewers and the integration agent. Every item must be fixed or explicitly accepted in Workflow 3.

## Missing features and ops
- **Retention cron.** There is no scheduled handler. Add one that:
  - deletes transcripts older than `retention.transcripts_days`;
  - deletes expired sessions and one-time tokens.

  Add `triggers.crons` to the wrangler config.
- **Local dev needs a token.** `wrangler dev` with the real `apps/app/wrangler.jsonc` asks for `CLOUDFLARE_API_TOKEN`, because the `ai` binding is remote-only. Add a dev env without `ai`, or document the requirement.
- **Model ids are unverified.** Check the Workers AI model ids against the account catalog at deploy time (`wrangler ai models list`).
- **Admin has no tests.**

## Security and privacy (from the S9, S1 and S7 minors)

### Service worker cache
- **Problem:** logout only clears the `me` and `manifest` caches. Premium extras and `/api/me/export` stay in Cache Storage.
- **Fix:** clear every user-scoped cache on logout. Never cache `/api/me/export`.

### Offline outbox
- **Problem:** it replays non-idempotent writes, the server ignores `Idempotency-Key`, and replay drops 401 responses.
- **Fix:** do both of these:
  - honor `Idempotency-Key` on the server, or only queue idempotent endpoints;
  - keep queued items on 401 until the user logs in again.

### Media routes
`/m/*` has no `RL_API` rate limit.

### Seeding
`seed --remote` overwrites admin edits to content. A remote run must only insert missing rows, unless `--force` is passed.

### Auth (S1)
| Area | Issue |
|---|---|
| Password reset | Reset tokens can race when issued in the same millisecond. |
| Lockout | `failed_logins` never decays. |
| Reset progress | "Zerar progresso" deletes flagged sessions that still have pending moderation items. |
| Signup | The duplicate-email check (409) runs before Turnstile, which lets anyone enumerate registered emails without passing Turnstile. |

### AI (S7)
| Area | Issue |
|---|---|
| Moderation evidence | Llama Guard flags and self-reports share one pin budget, so a flood of either can push the other's evidence out. |
| Moderation query | The flagged-session EXISTS check scans the whole pending queue. |
| Quota | `signAttempt` bills quota before it throws when `MEDIA_TOKEN_KEY` is missing. |

## Game integrity
### Game engine (S4)
- `award()` uses 3 D1 batches and scans the whole ledger to count kinds and days. Use the indexes and counters instead.
- Seed `point_rules.daily_cap` for `maggie_turn` and `maggie_session`.

### Progress and e-book tests (S2/S3)
- E-book test endpoints ignore the trilha unlock.
- Submit returns `show` (the expected answers) every time.
- A reset deletes the test results, so the trilha loses its score.
- IA attempts are deduplicated by issue time, which can drop a real attempt.
- demo/script scores are client-attested.

### Spaced repetition and extras (S5/S6)
- Karaoke picks are not locked after the first try.
- The due-only grade gate can be bypassed.
- `card` has no daily cap.
- The IA dub token check is cosmetic.
- Concurrent grades can lose a `reps` increment.

## Parity harness (S11)
- The lock is released before `key.json` is written.
- Stale-lock takeover can race.
- The slot `.dev.vars` needs an empty `COOKIE_PREFIX`.
- The fixture ledger sums to 265 points, but the state says 340.
- `concluido-1` is captured while episode 1 is not done.
