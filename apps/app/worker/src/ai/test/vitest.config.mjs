// S7 tests. Runs inside workerd against a local D1 with the real migrations and a local R2 bucket;
// env.AI is a mock per test. Run from the repo root:
//   npx vitest run --config apps/app/worker/src/ai/test/vitest.config.mjs
// (.mjs so the worker tsconfig, which has no Node types, does not typecheck it.)
import { fileURLToPath } from 'node:url';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

const here = fileURLToPath(new URL('.', import.meta.url));
const migrationsDir = fileURLToPath(new URL('../../../../../../packages/db/migrations', import.meta.url));

const cacheRoot = fileURLToPath(new URL('../../../../../../', import.meta.url));

export default defineConfig({
  // Vite's cache goes to the root node_modules, never next to the sources.
  cacheDir: `${cacheRoot}node_modules/.vite/ai`,
  root: here,
  plugins: [
    cloudflareTest(async () => ({
      miniflare: {
        compatibilityDate: '2026-09-15',
        d1Databases: ['DB'],
        r2Buckets: ['MEDIA'],
        bindings: { TEST_MIGRATIONS: await readD1Migrations(migrationsDir) },
      },
    })),
  ],
  test: {
    name: 'ai-workerd',
    include: ['**/*.test.ts'],
    setupFiles: ['./setup.ts'],
  },
});
