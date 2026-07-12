import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

/**
 * Strip `.woff` (legacy) font assets from the build — every browser we
 * target supports `.woff2`, and woff files are ~30% larger. This is the
 * simplest way to keep fontsource's "woff + woff2" CSS while only shipping
 * woff2. The plugin runs during the `generateBundle` hook and rewrites
 * any CSS asset in place: it removes both the `url(...woff)` source and
 * the corresponding asset entry.
 */
function dropWoff(): Plugin {
  return {
    name: 'vreen:drop-woff',
    apply: 'build',
    generateBundle(_opts, bundle) {
      const dropped: string[] = [];
      // 1. Remove .woff asset entries.
      for (const [name, file] of Object.entries(bundle)) {
        if (!name.endsWith('.woff')) continue;
        if (file.type === 'asset' || (file as { fileName?: string }).fileName) {
          delete bundle[name];
          dropped.push(name);
        }
      }
      // 2. Strip `url(....woff)` fragments from CSS bundles.
      for (const [name, file] of Object.entries(bundle)) {
        if (!name.endsWith('.css')) continue;
        const src = (file as { source?: unknown }).source;
        if (typeof src !== 'string') continue;
        // Drop entire `, url(...woff) format('woff')` continuations.
        const next = src.replace(
          /,\s*url\(\s*[^)]*\.woff\s*\)\s*format\(['"]woff['"]\s*\)/g,
          '',
        );
        if (next !== src) (file as { source: string }).source = next;
      }
      if (dropped.length) {
        // eslint-disable-next-line no-console
        console.log(`[vreen:drop-woff] removed ${dropped.length} legacy .woff file(s)`);
      }
    },
  };
}

export default defineConfig({
  // Use relative paths so the bundle works under file:// (Electron) as well
  // as HTTP (Vite dev server, static hosting).
  base: './',
  plugins: [react(), dropWoff()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: false,
  },
  optimizeDeps: {
    // Avoid esbuild pre-bundling issues with non-ASCII Windows paths
    exclude: ['lucide-react'],
  },
  build: {
    target: 'es2020',
    sourcemap: true,
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three'],
          r3f: ['@react-three/fiber', '@react-three/drei'],
          post: ['@react-three/postprocessing', 'postprocessing'],
        },
      },
    },
  },
});
