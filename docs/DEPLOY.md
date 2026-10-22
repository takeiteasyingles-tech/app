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

Note the **site key** (public) and the **secret key**. The Workers verify the `action` too: `signup`, `login`, `reset` and `reset_request` on tie-app; `login` and `invite` on tie-admin.

## 4. Production vars in wrangler.jsonc

Fill the `vars` block in each file. As in step 1, fill **both** the top-level block and `env.local.vars` with the same values. Local dev overrides them from `.dev.vars`.

`apps/app/wrangler.jsonc`:
```jsonc
"vars": {
  "TURNSTILE_SITEKEY": "<turnstile site key>",
  "APP_ORIGIN": "https://tie-app.<subdomain>.workers.dev",
  "MAIL_FROM": "Take It Easy <no-reply@<your verified domain>>"
}
```
(`MAIL_FROM` is the sender of the password-reset e-mail; see step 5a.)

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

## 5a. Password-reset e-mail (Resend)

"Esqueci a senha" on the student app e-mails a one-time link (`https://tie-app…/#/entrar?reset=<token>`, valid 1 hour, at most 3 per account per hour) through [Resend](https://resend.com)'s HTTP API. Only tie-app sends e-mail; tie-admin needs nothing.

1. Create a Resend account (the free tier sends 100 e-mails/day, 3000/month).
2. Resend → Domains → **Add domain**. Use a domain you control, ideally a subdomain such as `mail.<your domain>` so its reputation is separate from your main mail. Resend shows the DNS records to create at your DNS provider (in Cloudflare: Dashboard → your zone → DNS → Records):
   - **DKIM**: a `TXT` record `resend._domainkey.<domain>` with the public key Resend gives you;
   - **SPF**: an `MX` record `send.<domain>` → `feedback-smtp.<region>.amazonses.com` (priority 10) and a `TXT` record `send.<domain>` → `v=spf1 include:amazonses.com ~all`;
   - **DMARC** (recommended): a `TXT` record `_dmarc.<domain>` → `v=DMARC1; p=none;` (tighten to `quarantine` once mail flows).
   
   Copy the values exactly as Resend shows them (they vary by region), set the Cloudflare records to **DNS only** (grey cloud), and click **Verify** in Resend. Verification usually takes minutes, sometimes up to a few hours.
3. Resend → API Keys → **Create API key**, permission **Sending access**, restricted to that domain. Copy it (`re_…`; shown once).
4. Store it as a secret of tie-app (paste when prompted):
   ```powershell
   cd apps/app
   npx wrangler secret put RESEND_API_KEY
   cd ../..
   ```
5. Set `MAIL_FROM` in `apps/app/wrangler.jsonc`, in **both** the top-level `vars` and `env.local.vars` (they must match; `tools/parity/test/hardening.test.ts` checks it), to an address on the verified domain, e.g. `"Take It Easy <no-reply@mail.<your domain>>"`. The committed value, `onboarding@resend.dev`, is Resend's shared test sender: it only delivers to the e-mail address of the Resend account itself.
6. Deploy tie-app (step 8), then test: on `#/entrar` choose "Esqueci a senha", enter your own address, open the e-mail and set a new password. Resend → Emails shows each send and its delivery status.

Without `RESEND_API_KEY` the app still works: the request answers as usual, nothing is sent, and the Worker logs a warning (`mail not sent: RESEND_API_KEY is not set`, without the link). Staff can still issue a reset link from Admin → Usuários. Locally (`npm run dev:app`) leave the key unset: the reset link is printed in the wrangler console.

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

## 11. Connecting Claude (MCP)

tie-admin serves an MCP endpoint at `https://tie-admin.<subdomain>.workers.dev/admin-api/mcp`. Through it, Claude (Claude Code or Claude Desktop) can read and edit the content draft. It cannot publish. The endpoint needs no extra configuration: it uses the D1 binding, `RL_API` and migration 0007 (`api_tokens`).

1. Sign in to the admin as an admin, open **Configurações → Integrações** and create a token. Choose a name, the permissions and a validity (90 days by default). Copy the `tie_pat_…` value; it is shown only once.
2. Connect Claude Code:
   ```powershell
   claude mcp add --transport http take-it-easy https://tie-admin.<subdomain>.workers.dev/admin-api/mcp --header "Authorization: Bearer <token>"
   ```
   For Claude Desktop, use the `mcp-remote` snippet on the same screen.
3. Smoke test: in Claude Code, `/mcp` lists `take-it-easy` with 13 tools. Ask it to "list the seasons". Its edits appear in Auditoria with the role `agent`.

The tool list, the safety rules and the troubleshooting steps are in `docs/MCP.md`. To cut an agent's access, revoke its token on the same screen.

## Updating later

- Code only: `npm run typecheck; npm test; npm run build` (with `VITE_TURNSTILE_SITEKEY` set for the admin), then `npm run deploy -w @tie/app` and `npm run deploy -w @tie/admin`.
- New migration in `packages/db/migrations/`: `cd apps/app; npx wrangler d1 migrations apply tie-db --remote` **before** you deploy code that depends on it.
  - `0006_step_order` (steps 1-3 become song → e-book → intro) changes the `steps` content rows: right after applying it and deploying both Workers, publish once from Admin → Publicações so `catalog.json` carries the new order. Until then the app shows the old step names on the new step bodies.
- Content is edited and published from the admin panel. Do not re-seed production to change content.
- Rollback: Admin → Publicações → rollback to a previous content release. For code, use `npx wrangler rollback` in the app's directory.
