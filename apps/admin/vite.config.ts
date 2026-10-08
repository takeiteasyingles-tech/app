import preact from '@preact/preset-vite';
import { defineConfig, type Plugin, type ProxyOptions } from 'vite';

// Admin SPA: web/ → dist/web (Workers Static Assets). Mirrors apps/app/vite.config.ts without the PWA.

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

const WORKER_DEV = 'http://localhost:8788';

/** Dev proxy to `wrangler dev` that presents the worker's own origin. */
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
  plugins: [preact(), preloadFonts()],
  server: {
    port: 5174,
    // The worker's CSRF check wants Origin == the worker origin, so the proxy rewrites it (spec 05 #7).
    proxy: { '/admin-api': workerProxy(WORKER_DEV), '/m': workerProxy(WORKER_DEV) },
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
