// Paths, slot layout and the fixed determinism constants shared by the parity harness and tools/e2e.
// A slot N is a fully isolated environment: its own ports, build dir, Miniflare persist dir, generated
// wrangler config and output dirs, so several critics can run the harness at the same time.
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
export const PARITY_DIR = join(REPO_ROOT, 'tools', 'parity');
export const OUT_ROOT = join(PARITY_DIR, 'out');
export const FIXTURE_FILE = join(PARITY_DIR, 'fixtures', 'state.v6.json');
export const PROTO_DIR = join(REPO_ROOT, 'prototipo');
export const FONTS_DIR = join(REPO_ROOT, 'packages', 'ui', 'fonts');
export const FONTS_CSS = join(REPO_ROOT, 'packages', 'ui', 'css', 'fonts.css');

export type AppName = 'app' | 'admin';
export const APP_DIRS: Record<AppName, string> = {
  app: join(REPO_ROOT, 'apps', 'app'),
  admin: join(REPO_ROOT, 'apps', 'admin'),
};

/** Browser clock on both sides (and, shifted, the Worker clock): 2026-09-15 12:00 in São Paulo. */
export const FROZEN_ISO = '2026-09-15T12:00:00-03:00';
export const FROZEN_MS = Date.parse(FROZEN_ISO);

export const VIEWPORTS = {
  mobile: { width: 375, height: 812, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
  desktop: { width: 1440, height: 900, isMobile: false, hasTouch: false, deviceScaleFactor: 1 },
} as const;
export type ViewportName = keyof typeof VIEWPORTS;
export const isViewport = (v: string): v is ViewportName => v in VIEWPORTS;

export interface Slot {
  n: number;
  /** node:http static server for prototipo/. */
  protoPort: number;
  /** wrangler dev of the app (or admin) Worker. */
  appPort: number;
  inspectorPort: number;
  /** Relative to apps/app, exactly as `npm run seed -- --persist-to` resolves it. */
  persistRel: string;
  persistAbs: string;
  /** Generated wrangler config, .dev.vars and worker entry shim. */
  genDir: (app: AppName) => string;
  /** vite outDir of the slot build. */
  distDir: (app: AppName) => string;
  origin: string;
  protoOrigin: string;
}

export function slot(n: number): Slot {
  if (!Number.isInteger(n) || n < 0 || n > 99) throw new Error(`--slot must be an integer 0..99 (got ${n})`);
  const persistRel = `.wrangler/parity-slot${n}`;
  return {
    n,
    protoPort: 8100 + n,
    appPort: 8200 + n,
    inspectorPort: 9200 + n,
    persistRel,
    persistAbs: join(APP_DIRS.app, persistRel),
    genDir: (app) => join(OUT_ROOT, 'slots', `slot${n}`, app),
    distDir: (app) => join(APP_DIRS[app], 'dist', `web-slot${n}`),
    origin: `http://localhost:${8200 + n}`,
    protoOrigin: `http://127.0.0.1:${8100 + n}`,
  };
}

/** runId = slot + seed, safe as a directory name. */
export function runIdOf(n: number, seed: string): string {
  return `slot${n}-${seed.replace(/[^A-Za-z0-9_.-]+/g, '_').slice(0, 60)}`;
}

export const runDirs = (runId: string) => ({
  run: join(OUT_ROOT, runId),
  pairs: join(OUT_ROOT, runId, 'pairs'),
  shots: join(OUT_ROOT, runId, 'shots'),
  key: join(OUT_ROOT, `${runId}-key`),
});
