// S2/S3 learning tests (Node, D1 stand-in over node:sqlite with the real migrations). From the repo root:
//   npx vitest run --config apps/app/worker/src/learning/test/vitest.config.mjs
// (.mjs so the worker tsconfig, which has no Node types, does not typecheck it.) The Vite cache goes
// to the root node_modules, never next to the sources.
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const here = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = fileURLToPath(new URL('../../../../../../', import.meta.url));

export default defineConfig({
  root: here,
  cacheDir: `${repoRoot}node_modules/.vite/learning`,
  test: {
    name: 'learning',
    environment: 'node',
    include: ['**/*.test.ts'],
  },
});
