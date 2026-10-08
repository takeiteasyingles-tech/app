import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import preact from '@preact/preset-vite';
import { defineConfig, type Plugin, type ProxyOptions } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { slimSchemas } from './scripts/slimSchemas.ts';

// Student PWA: web/ → dist/web (Workers Static Assets). Screens are lazy chunks (screens/registry.ts);
// preact + signals get their own long-lived vendor chunk.
// Service worker: vite-plugin-pwa injectManifest builds web/sw/sw.ts into dist/web/sw.js with the
// precache list; the manifest stays the hand-written web/public/manifest.webmanifest, and the shell
// registers the worker itself (web/sw/register.ts), so no register script is injected.
// Budgets (initial JS ≤60 KB gzip, each screen ≤25 KB): `npm run budgets -w @tie/app` after a build.

const APP_DIR = fileURLToPath(new URL('.', import.meta.url));
const OUT_DIR = resolve(APP_DIR, 'dist/web');

function pwa() {
  // No outDir / globDirectory: both default to vite's build.outDir, so `--outDir` builds get their own
  // sw.js and precache list (pinning them to dist/web wrote another build's worker there).
  return VitePWA({
    strategies: 'injectManifest',
    srcDir: 'sw',
    filename: 'sw.ts',
    injectRegister: false,
    manifest: false,
    includeManifestIcons: false,
    injectManifest: {
      // The shell: HTML, JS/CSS chunks, fonts and icons. Media and content are runtime-cached by the
      // worker (they are cookie-gated and versioned). The sign-in photos (img/, 500 KB for both sizes)
      // stay out: signing in needs the network anyway, and every install downloaded both.
      globPatterns: ['**/*.{html,js,css,woff2,webmanifest}', 'icons/*.{png,svg}'],
      globIgnores: ['sw.js', 'workbox-*.js', '**/*.map'],
      maximumFileSizeToCacheInBytes: 1024 * 1024,
    },
    devOptions: { enabled: false },
  });
}

/** Preloads the latin subsets of the self-hosted fonts (hashed names are only known after bundling). */
function preloadFonts(): Plugin {
  return {
    name: 'tie:preload-fonts',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(_html, ctx) {
        const files = Object.keys(ctx.bundle ?? {}).filter((f) =>
          /\/(archivo|figtree)-latin-(?!ext-)[\w-]+\.woff2$/.test(f),
        );
        return files.map((f) => ({
          tag: 'link',
          attrs: { rel: 'preload', href: `/${f}`, as: 'font', type: 'font/woff2', crossorigin: '' },
          injectTo: 'head' as const,
        }));
      },
    },
  };
}

/**
 * The screens worth fetching with the shell. #/entrar (a first visit) paints nothing before its chunk;
 * #/inicio is not here: its first paint is the shell's chrome and its largest one waits for
 * catalog.json, so preloading it only took bandwidth from the sign-in photo.
 */
const LANDING_SCREENS = [/[\\/]screens[\\/]entrada[\\/]Entrar\.tsx$/];

/**
 * modulepreloads the landing screens' lazy chunks (and the shared chunks they import), and preloads
 * their CSS, from index.html: they download with the shell instead of a round trip after main.tsx runs
 * (about 0.5 s of FCP on a slow 4G phone). Their CSS is only fetched (as=style), not applied: it still
 * applies when the screen loads, as before. The other screens stay lazy.
 */
function preloadLandingScreens(): Plugin {
  return {
    name: 'tie:preload-landing-screens',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        const bundle = ctx.bundle ?? {};
        const chunks = Object.values(bundle).filter((c) => c.type === 'chunk');
        const already = new Set([...html.matchAll(/(?:src|href)="\/([^"]+)"/g)].map((m) => m[1]));
        const js = new Set<string>();
        const css = new Set<string>();
        const visit = (fileName: string) => {
          const c = bundle[fileName];
          if (c?.type !== 'chunk' || js.has(fileName) || already.has(fileName)) return;
          js.add(fileName);
          for (const f of c.viteMetadata?.importedCss ?? []) css.add(f);
          for (const i of c.imports) visit(i);
        };
        for (const test of LANDING_SCREENS) {
          // By module, not facadeModuleId: a lazy screen chunk re-exports its module (no facade).
          const chunk = chunks.find((c) => c.type === 'chunk' && c.moduleIds.some((id) => test.test(id)));
          if (!chunk) throw new Error(`preload-landing-screens: no chunk for ${test}`);
          visit(chunk.fileName);
        }
        return [
          ...[...js].map((f) => ({
            tag: 'link',
            attrs: { rel: 'modulepreload', crossorigin: '', href: `/${f}` },
            injectTo: 'head' as const,
          })),
          ...[...css]
            .filter((f) => !already.has(f))
            .map((f) => ({
              tag: 'link',
              attrs: { rel: 'preload', as: 'style', href: `/${f}` },
              injectTo: 'head' as const,
            })),
        ];
      },
    },
  };
}

/**
 * A relative `--outDir` resolves from apps/app (where dist/ and wrangler.jsonc live), not from vite's
 * root web/: `vite build --outDir dist/web-perf` writes apps/app/dist/web-perf, not web/dist/web-perf.
 */
function outDirFromApp(): Plugin {
  return {
    name: 'tie:out-dir-from-app',
    apply: 'build',
    config(cfg) {
      const out = cfg.build?.outDir;
      if (out && !isAbsolute(out)) return { build: { outDir: resolve(APP_DIR, out) } };
      return undefined;
    },
  };
}

const WORKER_DEV = 'http://localhost:8787';

/** Dev proxy to `wrangler dev` that presents the worker's own origin (spec 05 #7). */
function workerProxy(target: string): ProxyOptions {
  return {
    target,
    changeOrigin: true,
    configure(proxy) {
      proxy.on('proxyReq', (req) => {
        if (req.getHeader('origin')) req.setHeader('origin', target);
      });
    },
  };
}

export default defineConfig({
  root: 'web',
  plugins: [outDirFromApp(), preact(), slimSchemas(), preloadFonts(), preloadLandingScreens(), pwa()],
  server: {
    // `vite` alone serves the UI; /api goes to `wrangler dev` (port 8787). The worker's CSRF check
    // wants Origin == the worker origin, so the proxy rewrites the browser's vite Origin to it.
    proxy: { '/api': workerProxy(WORKER_DEV), '/m': workerProxy(WORKER_DEV) },
  },
  build: {
    outDir: OUT_DIR,
    emptyOutDir: true,
    target: 'es2022',
    assetsInlineLimit: 0,
    rolldownOptions: {
      output: {
        codeSplitting: {
          // zod is not bundled at all (slimSchemas); scripts/budgets.ts fails if it comes back.
          groups: [{ name: 'vendor', test: /node_modules[\\/](preact|@preact[\\/]signals)/ }],
        },
      },
    },
  },
});
