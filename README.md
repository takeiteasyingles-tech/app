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
