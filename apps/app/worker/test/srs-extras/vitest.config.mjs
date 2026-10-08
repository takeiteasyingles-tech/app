// Vitest project for the S5/S6 (SRS + Extras) worker tests. Plain Node (node:sqlite D1 shim with the
// real migrations), no workerd pool. Run from apps/app:
//   npx vitest run --config worker/test/srs-extras/vitest.config.mjs
// I1: list this file in the app's vitest projects (or a test:worker script) so CI runs it.
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const cacheRoot = fileURLToPath(new URL('../../../../../', import.meta.url));

export default defineConfig({
  // Vite's cache goes to the root node_modules, never next to the sources.
  cacheDir: `${cacheRoot}node_modules/.vite/srs-extras`,
  root: fileURLToPath(new URL('.', import.meta.url)),
  test: {
    name: 'srs-extras',
    environment: 'node',
    include: ['**/*.test.ts'],
  },
});
