# Spec 05: Notes from the foundation verifier, for the slice agents

The foundation (F0) has been built and verified. The first section lists known issues; each slice applies the ones that fall in its area. The second section lists conventions every slice follows.

## Known minor issues

### Assigned to a slice

| # | Area | Issue | Fix | Owner |
|---|---|---|---|---|
| 1 | Assistants content | `AssistantRow` (admin contract) leaves out `persona`, but the `persona` column is `NOT NULL`. | Create requires an optional `persona`; insert `''` when it is absent. Editing `persona` requires the `ai.persona` permission. | S10 |
| 2 | `@tie/ui` `Flow` | `Flow` resets when the identity of the `items` array changes. | Memoize `items` in screens, or key `Flow` on the joined ids. | S6 |
| 3 | Staff passwords | Only 6 characters are required. | Add `StaffPassword` (min 10) for admin invite accept and admin password change. | S10 |
| 4 | Content schema | `Episode.sceneImage` and `Ebook.teaser` have no columns. | `compile.ts` reads them from the `content_blobs` keys `scene_images` and `ebook_teasers`, and the seed must create those blobs. | S9 |

### Assigned to the integration agent

| # | Area | Issue | Fix |
|---|---|---|---|
| 5 | `csrf.ts` | It accepts the request's own origin as well as `APP_ORIGIN`. | When `APP_ORIGIN` is set and is not local, compare only against it. |
| 6 | `upload.ts` | Any `ftyp` file counts as mp4. | Allowlist the major brands; reject heic, avif and mov. |
| 7 | Vite dev proxy | Origin mismatch blocks requests. | Rewrite `Origin` in the proxy, or develop against the wrangler-served build. |
| 8 | `npm` `allowScripts` | Install scripts for esbuild and workerd are not allowed. | Add `allowScripts` for esbuild and workerd. |

`wrangler.jsonc` vars are empty and the dev values live only in `.dev.vars.example`. Every dev, parity or e2e script must copy `.dev.vars.example` to `.dev.vars` when it is missing.

## Conventions for parallel slices

- **Ownership.** Only touch your owned directories. Shared contracts live in `@tie/shared`. If a contract must change, make an additive change and report it.
- **Dependencies.** They are installed at the root. Do not run `npm install` unless you must (`-w <ws>`, and retry on a lock error).
- **Local servers.** Never run anything on the default ports when the parity harness provides slots. Use the slot ports, persist dirs and out dirs it assigns to you.
- **Typecheck and tests.** Scope them to your own workspace or files. Other slices are being edited at the same time, so errors in other slices' directories are not yours to fix.
