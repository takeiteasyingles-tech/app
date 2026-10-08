// Unit tests (test/*.test.ts) for the harness logic: pairs, reveal, routes, fixture isolation, clock
// shim. specs/ holds the Playwright fixture check (npm run fixture:check), not run by vitest.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
