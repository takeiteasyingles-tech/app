// Game engine tests run inside workerd against a local D1 with the real migrations (the ledger
// trigger, STRICT tables and FKs are what the engine relies on).
//   npx vitest run --config apps/app/worker/src/game/vitest.config.mjs
import { fileURLToPath } from 'node:url';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

const root = fileURLToPath(new URL('.', import.meta.url));
const migrationsDir = fileURLToPath(new URL('../../../../../packages/db/migrations', import.meta.url));

const cacheRoot = fileURLToPath(new URL('../../../../../', import.meta.url));

export default defineConfig({
  // Vite's cache goes to the root node_modules, never next to the sources.
  cacheDir: `${cacheRoot}node_modules/.vite/game`,
  root,
  plugins: [
    cloudflareTest(async () => ({
      miniflare: {
        compatibilityDate: '2026-09-15',
        d1Databases: ['DB'],
        bindings: { TEST_MIGRATIONS: await readD1Migrations(migrationsDir) },
      },
    })),
  ],
  test: {
    name: 'game',
    include: ['test/**/*.test.ts'],
    setupFiles: ['./test/setup.ts'],
  },
});
