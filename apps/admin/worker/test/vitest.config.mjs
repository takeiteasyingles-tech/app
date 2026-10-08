// Admin backend tests (slice A1). They run inside workerd against a local D1 with the real
// migrations, a local R2 bucket and the Rate Limiting bindings, calling the real admin app
// (worker/src/index.ts buildAdminApp). Run from the repo root:
//   npx vitest run --config apps/admin/worker/test/vitest.config.mjs
// (.mjs so the worker tsconfig, which has no Node types, does not typecheck it.)
import { fileURLToPath } from 'node:url';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

const here = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));

export default defineConfig({
  // Vite's cache goes to the root node_modules, never next to the sources.
  cacheDir: `${repoRoot}node_modules/.vite/admin-worker`,
  root: here,
  plugins: [
    cloudflareTest(async () => ({
      miniflare: {
        compatibilityDate: '2026-09-15',
        compatibilityFlags: ['nodejs_compat'],
        d1Databases: ['DB'],
        r2Buckets: ['MEDIA'],
        // RL_AUTH keeps the production limit (tests use a fresh IP per request); the others are
        // raised so the authz matrix can call every endpoint as every role.
        ratelimits: {
          RL_AUTH: { namespace_id: '2001', simple: { limit: 5, period: 60 } },
          RL_AI: { namespace_id: '2002', simple: { limit: 10000, period: 60 } },
          RL_API: { namespace_id: '2003', simple: { limit: 10000, period: 10 } },
          RL_UPLOAD: { namespace_id: '2004', simple: { limit: 10000, period: 60 } },
        },
        bindings: {
          TEST_MIGRATIONS: await readD1Migrations(`${repoRoot}packages/db/migrations`),
          // Local-dev values (see apps/admin/.dev.vars.example); Turnstile's test secret passes offline.
          APP_ORIGIN: 'http://localhost',
          COOKIE_PREFIX: '',
          TURNSTILE_SITEKEY: '1x00000000000000000000AA',
          TURNSTILE_SECRET: '1x0000000000000000000000000000000AA',
          MEDIA_TOKEN_KEY: 'test-media-token-key-0123456789abcdef',
          IP_HASH_SALT: 'test-ip-hash-salt-0123456789abcdef',
        },
      },
    })),
  ],
  test: {
    name: 'admin-worker',
    include: ['**/*.test.ts'],
    setupFiles: ['./setup.ts'],
    // Every test calls the real Worker (PBKDF2, D1, R2) and the authz matrix makes hundreds of
    // calls; vitest's 5 s default made the suite flaky under load.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
