import { fileURLToPath } from 'node:url';
import preact from '@preact/preset-vite';
import { defineConfig, type Plugin, type ProxyOptions } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// Student PWA: web/ → dist/web (Workers Static Assets). Screens are lazy chunks (screens/registry.ts);
// preact + signals get their own long-lived vendor chunk.
// Service worker: vite-plugin-pwa injectManifest builds web/sw/sw.ts into dist/web/sw.js with the
// precache list; the manifest stays the hand-written web/public/manifest.webmanifest, and the shell
// registers the worker itself (web/sw/register.ts), so no register script is injected.

const OUT_DIR = fileURLToPath(new URL('./dist/web', import.meta.url));

function pwa() {
  return VitePWA({
    strategies: 'injectManifest',
    srcDir: 'sw',
    filename: 'sw.ts',
    outDir: OUT_DIR,
    injectRegister: false,
    manifest: false,
    includeManifestIcons: false,
    injectManifest: {
      globDirectory: OUT_DIR,
      // The shell: HTML, JS/CSS chunks, fonts, icons and the login background. Media and content are
      // runtime-cached by the worker (they are cookie-gated and versioned).
      globPatterns: ['**/*.{html,js,css,woff2,webmanifest}', 'icons/*.{png,svg}', 'img/*.webp'],
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
  plugins: [preact(), preloadFonts(), pwa()],
  server: {
    // `vite` alone serves the UI; /api goes to `wrangler dev` (port 8787). The worker's CSRF check
    // wants Origin == the worker origin, so the proxy rewrites the browser's vite Origin to it.
    proxy: { '/api': workerProxy(WORKER_DEV), '/m': workerProxy(WORKER_DEV) },
  },
  build: {
    outDir: '../dist/web',
    emptyOutDir: true,
    target: 'es2022',
    assetsInlineLimit: 0,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [{ name: 'vendor', test: /node_modules[\\/](preact|@preact[\\/]signals)/ }],
        },
      },
    },
  },
});
