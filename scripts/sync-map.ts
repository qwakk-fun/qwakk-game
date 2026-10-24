/**
 * Copies the map workstream's exports into the shared package, where the
 * server (fs) and the client (Vite asset imports) both load them:
 *
 *   Yelova (battle royale):
 *     art/map/export/map_v1.json, map_v1_heights.bin, map_v1_ground.bin
 *     apps/client/public/models/props/colliders.json
 *       -> packages/shared/src/maps/sainte-canard/
 *   Kavren (deathmatch):
 *     art/map/export/canard-quarter/map_v1.json, map_v1_heights.bin, map_v1_ground.bin
 *     apps/client/public/models/props/colliders.json
 *       -> packages/shared/src/maps/canard-quarter/
 *   Pond Keep (Hunt Season):
 *     art/map/export/pond-keep/map_v1.json, map_v1_heights.bin, map_v1_ground.bin
 *     apps/client/public/models/props/colliders.json
 *       -> packages/shared/src/maps/pond-keep/
 *
 * One copy for both sides keeps the colliders identical; the join handshake
 * still compares a hash. `npm test` fails when a copy is stale.
 *
 * Usage: npm run map:sync
 */
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const COLLIDERS = 'apps/client/public/models/props/colliders.json';

/** [source, file name in the map folder] for one map export folder. */
function sources(exportDir: string): readonly [string, string][] {
  return [
    [`${exportDir}map_v1.json`, 'map_v1.json'],
    [`${exportDir}map_v1_heights.bin`, 'map_v1_heights.bin'],
    [`${exportDir}map_v1_ground.bin`, 'map_v1_ground.bin'],
    [COLLIDERS, 'colliders.json'],
  ];
}

/** Yelova's files (kept for existing imports). */
export const MAP_SOURCES: readonly [string, string][] = sources('art/map/export/');

/** Every shipped map: id (the folder under packages/shared/src/maps/) and its sources. */
export const MAPS: readonly { id: string; sources: readonly [string, string][] }[] = [
  { id: 'sainte-canard', sources: MAP_SOURCES },
  { id: 'canard-quarter', sources: sources('art/map/export/canard-quarter/') },
  { id: 'pond-keep', sources: sources('art/map/export/pond-keep/') },
];

for (const map of MAPS) {
  const dest = `${root}packages/shared/src/maps/${map.id}/`;
  mkdirSync(dest, { recursive: true });
  for (const [src, name] of map.sources) {
    if (!existsSync(root + src)) throw new Error(`missing ${src}: build the map first (sh art/map/build.sh)`);
    copyFileSync(root + src, dest + name);
    console.log(`copied ${src} -> packages/shared/src/maps/${map.id}/${name}`);
  }
}
