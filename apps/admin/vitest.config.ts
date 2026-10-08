// `npm test -w @tie/admin` runs the admin backend suite (worker/test, inside workerd with the real
// migrations). Without this file vitest picked up vite.config.ts (root web/) and found no tests.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    passWithNoTests: false,
    projects: ['./worker/test/vitest.config.mjs'],
  },
});
