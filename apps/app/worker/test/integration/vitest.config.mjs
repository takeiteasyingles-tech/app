// I1 integration tests: the real worker (worker/src/index.ts, every route module and every real
// service) inside workerd, against a local D1 with the real migrations, a local R2 bucket and the
// rate-limit bindings. Run with the app's tests (`npm test -w @tie/app`) or alone:
//   npx vitest run --config apps/app/worker/test/integration/vitest.config.mjs
import { fileURLToPath } from 'node:url';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

const root = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = fileURLToPath(new URL('../../../../../', import.meta.url));
const migrationsDir = `${repoRoot}packages/db/migrations`;

export default defineConfig({
  root,
  cacheDir: `${repoRoot}node_modules/.vite/integration`,
  plugins: [
    cloudflareTest(async () => ({
      miniflare: {
        compatibilityDate: '2026-09-15',
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
          // Local-dev values (see apps/app/.dev.vars.example). No AI binding: the app runs in demo mode.
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
    name: 'integration',
    include: ['**/*.test.ts'],
  },
});
