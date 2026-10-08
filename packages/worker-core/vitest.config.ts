// Two projects: fast unit tests in Node (test/, fake D1) and integration tests inside workerd
// (test-workerd/) against a local D1 with the real migrations and a local R2 bucket.
import { fileURLToPath } from 'node:url';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

const migrationsDir = fileURLToPath(new URL('../db/migrations', import.meta.url));

export default defineConfig({
  test: {
    projects: [
      { test: { name: 'node', include: ['test/**/*.test.ts'] } },
      {
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
          name: 'workerd',
          include: ['test-workerd/**/*.test.ts'],
          setupFiles: ['./test-workerd/setup.ts'],
        },
      },
    ],
  },
});
