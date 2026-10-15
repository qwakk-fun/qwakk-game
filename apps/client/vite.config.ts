import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// Test builds (VITE_DEVTOOLS=1) also ship the dev-only map viewer; public builds never do.
const devtools = process.env.VITE_DEVTOOLS === '1';
const page = (name: string): string => fileURLToPath(new URL(name, import.meta.url));

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
    rollupOptions: {
      input: devtools ? { main: page('./index.html'), mapview: page('./mapview.html') } : { main: page('./index.html') },
    },
  },
});
