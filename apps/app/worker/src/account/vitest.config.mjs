// Auth & account integration tests (slice S1). They run inside workerd against a local D1 with the
// real migrations, a local R2 bucket and the Rate Limiting bindings, calling a Hono app built from
// the S1 route modules only (so other slices' in-progress routes cannot break them).
//   npx vitest run --config apps/app/worker/src/account/vitest.config.mjs
import { fileURLToPath } from 'node:url';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

const root = fileURLToPath(new URL('.', import.meta.url));
const migrationsDir = fileURLToPath(new URL('../../../../../packages/db/migrations', import.meta.url));

const cacheRoot = fileURLToPath(new URL('../../../../../', import.meta.url));

export default defineConfig({
  // Vite's cache goes to the root node_modules, never next to the sources.
  cacheDir: `${cacheRoot}node_modules/.vite/account`,
  root,
  plugins: [
    cloudflareTest(async () => ({
      miniflare: {
        compatibilityDate: '2026-09-15',
        compatibilityFlags: ['nodejs_compat'],
        d1Databases: ['DB'],
        r2Buckets: ['MEDIA'],
        ratelimits: {
          RL_AUTH: { namespace_id: '1001', simple: { limit: 5, period: 60 } },
          RL_AI: { namespace_id: '1002', simple: { limit: 20, period: 60 } },
          RL_API: { namespace_id: '1003', simple: { limit: 100, period: 10 } },
          RL_UPLOAD: { namespace_id: '1004', simple: { limit: 5, period: 60 } },
        },
        bindings: {
          TEST_MIGRATIONS: await readD1Migrations(migrationsDir),
          // Local-dev values (see apps/app/.dev.vars.example); Turnstile's test secret passes offline.
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
    name: 'account',
    include: ['test/**/*.test.ts'],
    setupFiles: ['./test/setup.ts'],
  },
});
