// `npm test -w @tie/app` runs every suite of the app: the web unit tests (vite.config.ts, root web/)
// and the worker slices, each with its own config (workerd pool or the node:sqlite D1 stand-in).
import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config';

const WORKER_PROJECTS = [
  './worker/src/account/vitest.config.mjs',
  './worker/src/game/vitest.config.mjs',
  './worker/src/learning/test/vitest.config.mjs',
  './worker/src/ai/test/vitest.config.mjs',
  './worker/test/srs-extras/vitest.config.mjs',
  './worker/test/integration/vitest.config.mjs',
];

export default defineConfig({
  test: {
    passWithNoTests: true,
    projects: [mergeConfig(viteConfig, { test: { name: 'web' } }), ...WORKER_PROJECTS],
  },
});
