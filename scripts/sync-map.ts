/**
 * Copies the map workstream's Sainte-Canard export into the shared package,
 * where the server (fs) and the client (Vite asset imports) both load it:
 *
 *   art/map/export/map_v1.json, map_v1_heights.bin, map_v1_ground.bin
 *   apps/client/public/models/props/colliders.json
 *     -> packages/shared/src/maps/sainte-canard/
 *
 * One copy for both sides keeps the colliders identical; the join handshake
 * still compares a hash. `npm test` fails when the copy is stale.
 *
 * Usage: npm run map:sync
 */
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
export const MAP_SOURCES: readonly [string, string][] = [
  ['art/map/export/map_v1.json', 'map_v1.json'],
  ['art/map/export/map_v1_heights.bin', 'map_v1_heights.bin'],
  ['art/map/export/map_v1_ground.bin', 'map_v1_ground.bin'],
  ['apps/client/public/models/props/colliders.json', 'colliders.json'],
];
const dest = `${root}packages/shared/src/maps/sainte-canard/`;
mkdirSync(dest, { recursive: true });
for (const [src, name] of MAP_SOURCES) {
  if (!existsSync(root + src)) throw new Error(`missing ${src}: build the map first (sh art/map/build.sh)`);
  copyFileSync(root + src, dest + name);
  console.log(`copied ${src} -> packages/shared/src/maps/sainte-canard/${name}`);
}
