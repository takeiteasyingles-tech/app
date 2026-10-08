# Deploying Take It Easy to Cloudflare

Production is two Workers on `*.workers.dev` that share one D1 database, one R2 bucket and Workers AI:

| Worker | Directory | Serves | Origin (example) |
|---|---|---|---|
| `tie-app` | `apps/app` | student PWA (static assets) + `/api/*` + `/m/*` media + the daily retention cron | `https://tie-app.<subdomain>.workers.dev` |
| `tie-admin` | `apps/admin` | admin SPA (static assets) + `/admin-api/*` + `/m/*` | `https://tie-admin.<subdomain>.workers.dev` |

Shared resources: D1 `tie-db` (binding `DB`), R2 `tie-media` (binding `MEDIA`), Workers AI (binding `AI`), and four rate-limit bindings per Worker (`RL_AUTH`, `RL_AI`, `RL_API`, `RL_UPLOAD`).

All commands run from the repo root in PowerShell unless a step says `cd`. `npx wrangler` resolves the repo's pinned wrangler.

## 0. Prerequisites

- Node 24, npm 11, `npm install` done. If npm skipped the postinstall scripts, run `npm install-scripts approve esbuild workerd`.
- A Cloudflare account on the **Workers Paid** plan. Password hashing is PBKDF2 at 100k iterations, which needs more CPU per request than the free plan allows. Rate-limit bindings and Smart Placement also expect a paid account.
- A registered `workers.dev` subdomain. Check it under Dashboard → Workers & Pages → your subdomain. This guide calls it `<subdomain>`.
- Authentication. Either run `npx wrangler login`, or set an API token that has Workers Scripts:Edit, D1:Edit, Workers R2 Storage:Edit and Workers AI:Read:
  ```powershell
  $env:CLOUDFLARE_API_TOKEN = '<token>'
  $env:CLOUDFLARE_ACCOUNT_ID = '<account id>'
  ```
  `npm run deploy -w @tie/app` runs `check:models` (`wrangler ai models list`) first, so it needs the same authentication.
- Run every check locally first. All of these must pass:
  ```powershell
  npm run typecheck; npm test; npm run build
  npm run e2e -- --force-seed
  npm run smoke:full
  ```

## 1. Create the D1 database

```powershell
cd apps/app
npx wrangler d1 create tie-db
cd ../..
```

Copy the printed `database_id` (a UUID) into **every** `database_id` field. There are four, all with the same value:

- `apps/app/wrangler.jsonc`: the top-level `d1_databases[0].database_id` and `env.local.d1_databases[0].database_id`
- `apps/admin/wrangler.jsonc`: the same two fields

The `env.local` block must stay identical to the top-level one; `tools/parity/test/hardening.test.ts` checks this. Local data is keyed by the database id, so once the id changes the local stores look empty. Reseed them afterwards with `npm run seed -- --local` and `npm run e2e -- --force-seed`.

## 2. Create the R2 bucket

R2 must be turned on for the account first: Dashboard → R2 Object Storage → "Enable R2" (accept the R2 plan; this needs a payment method on file). Until you do, `wrangler r2 bucket create` fails with error 10042.

```powershell
npx wrangler r2 bucket create tie-media
```

The bucket stays **private**: no public bucket URL and no custom domain. Media only goes out through the Workers' `/m/*` routes, behind the `tie_m` cookie or a session.

## 3. Turnstile widget

Dashboard → Turnstile → Add widget:

- Name: `Take It Easy`
- Hostnames: `tie-app.<subdomain>.workers.dev` and `tie-admin.<subdomain>.workers.dev` (one widget covers both Workers)
- Widget mode: **Managed**. The app renders it as "interaction-only", so it stays hidden unless Cloudflare needs a click.

Note the **site key** (public) and the **secret key**. The Workers verify the `action` too: `signup`, `login` and `reset` on tie-app; `login` and `invite` on tie-admin.

## 4. Production vars in wrangler.jsonc

Fill the `vars` block in each file. As in step 1, fill **both** the top-level block and `env.local.vars` with the same values. Local dev overrides them from `.dev.vars`.

`apps/app/wrangler.jsonc`:
```jsonc
"vars": {
  "TURNSTILE_SITEKEY": "<turnstile site key>",
  "APP_ORIGIN": "https://tie-app.<subdomain>.workers.dev"
}
```

`apps/admin/wrangler.jsonc`:
```jsonc
"vars": {
  "TURNSTILE_SITEKEY": "<turnstile site key>",
  "APP_ORIGIN": "https://tie-admin.<subdomain>.workers.dev"
}
```

Rules:
- `APP_ORIGIN` is https, has no trailing slash, and is each Worker's **own** origin.
- Do **not** add `COOKIE_PREFIX`. Leaving it out keeps the `__Host-` cookie prefix.
- Never use the Turnstile test keys (`1x00…AA`) in production.

If any of these is wrong, the Workers answer every non-local request with HTTP 500 and log `misconfigured deploy` with the list of problems (`packages/worker-core/src/config.ts`).

The admin Worker builds password-reset links to the student app. It assumes `tie-admin.*` maps to `tie-app.*`. If the app lives elsewhere, either add `"STUDENT_APP_ORIGIN": "https://…"` to the admin `vars` (both blocks), or set `app.origin` later under Admin → Configurações.

## 5. Secrets

Three secrets per Worker. `MEDIA_TOKEN_KEY` and `IP_HASH_SALT` must be **the same on both Workers**, so media cookies and IP hashes line up. Generate the values once:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"   # MEDIA_TOKEN_KEY
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"   # IP_HASH_SALT
```

The Workers do not exist until their first deploy. You can either deploy first (step 8) and add the secrets right after (the Workers answer 500 until then), or let `secret put` create them. Each command prompts for the value; paste it, and never put it on the command line or in a file in the repo:

```powershell
cd apps/app
npx wrangler secret put TURNSTILE_SECRET
npx wrangler secret put MEDIA_TOKEN_KEY
npx wrangler secret put IP_HASH_SALT
cd ../admin
npx wrangler secret put TURNSTILE_SECRET
npx wrangler secret put MEDIA_TOKEN_KEY
npx wrangler secret put IP_HASH_SALT
cd ../..
```

Confirm with `npx wrangler secret list` in each app dir.

## 6. Migrations (remote)

```powershell
cd apps/app
npx wrangler d1 migrations apply tie-db --remote
cd ../..
```

This applies `packages/db/migrations/0001…0005`. The admin config points at the same directory, so there is only one migration history. The seed in step 7 also runs this, but applying migrations on their own first shows any SQL error right away.

## 7. Seed content and media (remote)

```powershell
npm run seed -- --remote
```

The seed reads the content from `prototipo/` (read-only) and then:
1. writes the content and config rows: episodes, Mic phrases, exercises, e-books, extras, albums, assistants, missions, option lists, gamification rules, the plans Grátis (60 min, default) and Premium (600 min), AI prompts and feature flags;
2. uploads every media file to R2 as `media/{sha8}/…`, skipping objects it already uploaded (tracked in `.seed-uploaded.json`);
3. publishes the first release (`content/{ver}/*` in R2, plus `app_settings['content.current']`).

Re-running `--remote` is safe. It only inserts missing rows, and it skips the publish once a release exists, so admin edits are never overwritten. `--remote --force` overwrites the content rows from the prototype and republishes. Only use it on purpose.

Check the result:
```powershell
cd apps/app
npx wrangler d1 execute tie-db --remote --command "SELECT key, value FROM app_settings WHERE key = 'content.current'"
cd ../..
```

## 8. Build and deploy both Workers

`wrangler deploy` uploads `dist/web` as it is; it does not build. Build first. The admin SPA reads its Turnstile site key **at build time**, from `VITE_TURNSTILE_SITEKEY`. The student app reads it at runtime from `/api/auth/config`.

```powershell
npm run build -w @tie/app
$env:VITE_TURNSTILE_SITEKEY = '<turnstile site key>'
npm run build -w @tie/admin
Remove-Item Env:VITE_TURNSTILE_SITEKEY

npm run deploy -w @tie/app     # check:models (Workers AI catalog), then wrangler deploy
npm run deploy -w @tie/admin
```

If `check:models` reports a model id that is missing from the account catalog, do not deploy. Choose a replacement and update `DEFAULT_MODELS` in `packages/shared/src/constants.ts`, or the `ai.model.*` keys under Admin → Configurações after the deploy.

`wrangler deploy` prints each URL. It also registers the tie-app cron (`17 6 * * *`, the retention job).

## 9. Bootstrap the super_admin

```powershell
npm run seed:bootstrap-admin -- --remote --origin https://tie-admin.<subdomain>.workers.dev
```

This creates `diego.perez@digitalsolvers.com` with the `super_admin` role and no password, then prints a one-time invite URL (`…/#/convite/<token>`, valid for 7 days). The URL is shown **only once**; only its SHA-256 is stored. Open it, set a password of at least 10 characters, and you are signed in. Running the command again revokes the unused invite and prints a new one.

Invite the rest of the team from the admin panel (Usuários → Gerar convite).

## 10. Production smoke

1. `https://tie-app.<subdomain>.workers.dev/api/health` returns `{"ai":true,"model":"…"}`. `ai:false` means the AI binding is missing, and the app falls back to demo mode.
2. Check the response headers of the app shell: a CSP, HSTS, `X-Content-Type-Options: nosniff`, and `Set-Cookie` with `__Host-` after you log in.
3. On a phone or in a clean browser profile, create an account (Turnstile passes invisibly), finish the onboarding, open episode 1 and play the intro, open Revisão, open an EXTRA, and run a short Mic conversation. You should see real AI replies, not the "demo" badge. Then open the report.
4. Upload a profile photo under Você.
5. In the admin panel, log in and open the Painel; the numbers should load. Edit a harmless field (for example an episode synopsis), then publish it under Publicações. Reload the app: the change shows up, and `/api/content/manifest` has the new version. Revert the change and publish again, or use Publicações → rollback.
6. Under Moderação, the photo from step 4 is pending. Remove it. The student's photo disappears, and its `/m/users/…` URL answers 404.
7. Check the logs with `npx wrangler tail tie-app` and `npx wrangler tail tie-admin`. There should be no `misconfigured deploy` lines and no unhandled errors.

## Updating later

- Code only: `npm run typecheck; npm test; npm run build` (with `VITE_TURNSTILE_SITEKEY` set for the admin), then `npm run deploy -w @tie/app` and `npm run deploy -w @tie/admin`.
- New migration in `packages/db/migrations/`: `cd apps/app; npx wrangler d1 migrations apply tie-db --remote` **before** you deploy code that depends on it.
- Content is edited and published from the admin panel. Do not re-seed production to change content.
- Rollback: Admin → Publicações → rollback to a previous content release. For code, use `npx wrangler rollback` in the app's directory.
