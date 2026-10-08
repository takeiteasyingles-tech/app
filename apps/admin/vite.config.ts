import preact from '@preact/preset-vite';
import { defineConfig, type Plugin } from 'vite';

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

export default defineConfig({
  root: 'web',
  plugins: [preact(), preloadFonts()],
  server: {
    port: 5174,
    proxy: { '/admin-api': 'http://localhost:8788', '/m': 'http://localhost:8788' },
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
