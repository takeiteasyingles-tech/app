import preact from '@preact/preset-vite';
import { defineConfig, type Plugin } from 'vite';

// Student PWA: web/ → dist/web (Workers Static Assets). Screens are lazy chunks (screens/registry.ts);
// preact + signals get their own long-lived vendor chunk. The PWA plugin (injectManifest) comes with S9.

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

export default defineConfig({
  root: 'web',
  plugins: [preact(), preloadFonts()],
  server: {
    // `vite` alone serves the UI; /api goes to `wrangler dev` (port 8787).
    proxy: { '/api': 'http://localhost:8787', '/m': 'http://localhost:8787' },
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
