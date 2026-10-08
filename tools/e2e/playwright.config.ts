// E2E against one isolated slot (E2E_SLOT, default 7; `npm run e2e -- --slot <N>` sets it).
// The browser is Playwright's Chromium when installed, else the system Chrome, else Edge (the parity
// harness's own detection; PARITY_BROWSER_CHANNEL forces one). No download needed.
import { defineConfig } from '@playwright/test';
import { detectChannel } from '../parity/src/determinism';
import { BASE_URL } from './src/slotEnv';

const channel = detectChannel;

export default defineConfig({
  testDir: './specs',
  outputDir: './out/test-results',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { outputFolder: './out/report', open: 'never' }]],
  globalSetup: './src/globalSetup.ts',
  use: {
    baseURL: BASE_URL,
    channel: channel(),
    headless: process.env.PARITY_HEADED !== '1',
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    reducedMotion: 'reduce',
    serviceWorkers: 'block',
    actionTimeout: 15_000,
    navigationTimeout: 20_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'mobile',
      use: { viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
    },
  ],
});
