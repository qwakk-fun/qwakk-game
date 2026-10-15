import { defineConfig } from 'vite';

export default defineConfig({
  // Served at qwakk.fun/game later, so every asset URL is rooted there.
  base: '/game/',
  server: {
    port: 5173,
    strictPort: true,
  },
  preview: {
    port: 5173,
    strictPort: true,
  },
  build: {
    target: 'es2022',
    // No source maps in production builds. Flip this locally to debug a build.
    sourcemap: false,
    chunkSizeWarningLimit: 4096,
  },
});
