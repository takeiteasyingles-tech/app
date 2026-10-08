// Production build of apps/<app> into its slot outDir (apps/<app>/dist/web-slot<N>), from the app's own
// vite.config.ts. Only two things change: outDir, and the PWA plugin is dropped (the harness blocks
// service workers anyway; `npm run perf` builds with it). Runs in a child process so vite's config
// bundling stays out of the harness.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { APP_DIRS, type AppName } from './config';
import { binOf, runNode } from './proc';

const SELF = fileURLToPath(import.meta.url);

export async function buildApp(app: AppName, outDir: string, opts: { tag?: string } = {}): Promise<void> {
  const tsx = binOf('tsx', join('dist', 'cli.mjs'));
  if (!existsSync(tsx)) throw new Error(`tsx not found at ${tsx}`);
  await runNode(tsx, [SELF, '--child', app, outDir], { cwd: APP_DIRS[app], tag: opts.tag ?? `build:${app}` });
  if (!existsSync(join(outDir, 'index.html'))) throw new Error(`build produced no ${join(outDir, 'index.html')}`);
}

async function child(app: AppName, outDir: string) {
  const { build, loadConfigFromFile } = await import('vite');
  const appDir = APP_DIRS[app];
  const loaded = await loadConfigFromFile(
    { command: 'build', mode: 'production' },
    join(appDir, 'vite.config.ts'),
    appDir,
  );
  if (!loaded) throw new Error(`no vite config in ${appDir}`);
  const cfg = loaded.config;
  const flat: unknown[] = [];
  const walk = (p: unknown) => (Array.isArray(p) ? p.forEach(walk) : flat.push(p));
  walk(cfg.plugins ?? []);
  const plugins = flat.filter(
    (p) =>
      p && typeof p === 'object' && !('then' in p) && !/^vite-plugin-pwa/.test((p as { name?: string }).name ?? ''),
  );
  await build({
    ...cfg,
    configFile: false,
    root: join(appDir, 'web'),
    plugins: plugins as never,
    logLevel: 'warn',
    build: { ...cfg.build, outDir, emptyOutDir: true },
  });
  console.log(`built ${app} → ${outDir}`);
}

if (process.argv[2] === '--child') {
  child(process.argv[3] as AppName, process.argv[4] as string).catch((err) => {
    console.error(err instanceof Error ? (err.stack ?? err.message) : err);
    process.exitCode = 1;
  });
}
