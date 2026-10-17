/**
 * The admin UI build (npm run build:admin): a separate bundle in
 * apps/admin/dist, never in the public client (apps/client/dist). The game
 * server serves it under /admin to a logged-in admin only (apps/server/src/admin).
 * Not an npm workspace (no package.json): it builds with the repo's Vite.
 */
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: '/admin/',
  publicDir: false,
  build: {
    outDir: fileURLToPath(new URL('./dist', import.meta.url)),
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: false,
    // The admin CSP allows no inline script: no module preload polyfill.
    modulePreload: { polyfill: false },
    assetsInlineLimit: 0,
  },
});
