// `npm run fixture:check -w @tie/parity`: validates fixtures/state.v6.json in the prototype (Hoje renders
// without the error card) and against fixtureToSql. Uses only the prototype port of FIXTURE_SLOT (default 0).
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './specs',
  outputDir: './out/test-results',
  workers: 1,
  timeout: 120_000,
  reporter: [['list']],
});
