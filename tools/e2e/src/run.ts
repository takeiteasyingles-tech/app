// npm run e2e -- [--slot <N>] [--skip-build] [--force-seed] [--real-turnstile] [playwright test args…]
// Runs the Playwright specs against slot N (default 7): app on :8200+N, persist dir
// apps/app/.wrangler/parity-slot<N>, build apps/app/dist/web-slot<N>. Global setup brings the slot up
// (build, seed if needed, fixtures, wrangler dev) and tears it down at the end.
// --force-seed wipes the slot's persist dir and reseeds it: use it when an admin run (parity --app
// admin, smoke:full) left edited or republished content there, since the specs assert seeded content.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const E2E_DIR = fileURLToPath(new URL('../', import.meta.url));

function main() {
  const argv = process.argv.slice(2);
  const env: NodeJS.ProcessEnv = { ...process.env };
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] as string;
    if (a === '--slot') env.E2E_SLOT = argv[++i];
    else if (a.startsWith('--slot=')) env.E2E_SLOT = a.slice(7);
    else if (a === '--skip-build') env.E2E_SKIP_BUILD = '1';
    else if (a === '--real-turnstile') env.E2E_REAL_TURNSTILE = '1';
    else if (a === '--force-seed') env.E2E_FORCE_SEED = '1';
    else rest.push(a);
  }
  env.E2E_SLOT ??= '7';
  const require = createRequire(join(E2E_DIR, 'package.json'));
  const cli = join(dirname(require.resolve('@playwright/test/package.json')), 'cli.js');
  const child = spawn(process.execPath, [cli, 'test', '-c', join(E2E_DIR, 'playwright.config.ts'), ...rest], {
    cwd: E2E_DIR,
    env,
    stdio: 'inherit',
    windowsHide: true,
  });
  child.on('close', (code) => {
    process.exitCode = code ?? 1;
  });
}

main();
