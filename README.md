# app

## Local development

- Node 24 and npm 11 (npm workspaces). After `npm install`, npm 11 skips the esbuild and workerd
  postinstall scripts until they are approved: `npm install-scripts approve esbuild workerd`
  (`npm install-scripts ls` lists what is pending).
- Copy `apps/app/.dev.vars.example` to `apps/app/.dev.vars` and `apps/admin/.dev.vars.example` to
  `apps/admin/.dev.vars`. They hold the local-dev vars (localhost `APP_ORIGIN`, Turnstile test keys,
  `COOKIE_PREFIX=`) and secrets. The `vars` in each `wrangler.jsonc` are production values only. Fill
  them in before the first deploy: until then, the Workers answer non-local requests with 500 and
  log the reason.
- `npm run typecheck`, `npm run lint`, `npm test` (worker-core also runs `test-workerd/` inside
  workerd against a local D1/R2), `npm run build`.
- `npm run dev:app` / `npm run dev:admin` run `wrangler dev --env local`: every binding except the
  remote-only Workers AI, so no `CLOUDFLARE_API_TOKEN` is needed and the AI runs in demo mode. To use
  the real AI locally, export `CLOUDFLARE_API_TOKEN` and run `npm run dev:ai -w @tie/app` (or `-w @tie/admin`).

## Deploy and seed

The full production runbook (D1, R2, Turnstile, secrets, migrations, seed, bootstrap admin, deploy and
smoke) is in [docs/DEPLOY.md](docs/DEPLOY.md). Before a deploy, `npm run e2e -- --force-seed` and
`npm run smoke:full` (signup → … → admin publish → moderation, both Workers on one local slot) must pass.

- `npm run deploy -w @tie/app` first checks the Workers AI model ids against the account catalog
  (`npm run check:models -w @tie/app`, needs `CLOUDFLARE_API_TOKEN`).
- `npm run seed -- --remote` only inserts missing content rows and publishes only when nothing is
  published yet, so admin edits in production are never overwritten. `--remote --force` overwrites
  the content rows from the prototype and republishes.
- The app Worker runs the retention cron daily (`triggers.crons`): old Mic transcripts
  (`retention.transcripts_days`, default 180), expired sessions and one-time tokens.
