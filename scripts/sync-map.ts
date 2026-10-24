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
 *   Duck Plaza (the hub):
 *     art/map/export/duck-plaza/map_v1.json, map_v1_heights.bin, map_v1_ground.bin
 *     apps/client/public/models/props/colliders.json merged with
 *     art/map/export/duck-plaza/plaza_colliders.json (the plaza props, their own file)
 *       -> packages/shared/src/maps/duck-plaza/
 *
 * One copy for both sides keeps the colliders identical; the join handshake
 * still compares a hash. `npm test` fails when a copy is stale.
 *
 * Usage: npm run map:sync
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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

/**
 * Every shipped map: id (the folder under packages/shared/src/maps/), its
 * sources, and extra collider files merged into its colliders.json (props
 * that only this map uses, kept out of the kit's shared file).
 */
export const MAPS: readonly { id: string; sources: readonly [string, string][]; extraColliders?: readonly string[] }[] = [
  { id: 'sainte-canard', sources: MAP_SOURCES },
  { id: 'canard-quarter', sources: sources('art/map/export/canard-quarter/') },
  { id: 'pond-keep', sources: sources('art/map/export/pond-keep/') },
  { id: 'duck-plaza', sources: sources('art/map/export/duck-plaza/'), extraColliders: ['art/map/export/duck-plaza/plaza_colliders.json'] },
];

type ColliderDoc = { kinds?: Record<string, unknown>; props: Record<string, unknown> } & Record<string, unknown>;

/** The kit's colliders.json with extra prop collider files merged in (the kit wins on a name clash). Deterministic bytes. */
export function mergedColliders(base: Uint8Array, extras: readonly Uint8Array[]): Uint8Array {
  const doc = JSON.parse(new TextDecoder().decode(base)) as ColliderDoc;
  for (const raw of extras) {
    const extra = JSON.parse(new TextDecoder().decode(raw)) as ColliderDoc;
    doc.kinds = { ...(extra.kinds ?? {}), ...(doc.kinds ?? {}) };
    doc.props = { ...extra.props, ...doc.props };
  }
  return new TextEncoder().encode(JSON.stringify(doc));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  for (const map of MAPS) {
    const dest = `${root}packages/shared/src/maps/${map.id}/`;
    mkdirSync(dest, { recursive: true });
    for (const [src, name] of map.sources) {
      if (!existsSync(root + src)) throw new Error(`missing ${src}: build the map first (sh art/map/build.sh)`);
      if (name === 'colliders.json' && map.extraColliders?.length) {
        writeFileSync(dest + name, mergedColliders(readFileSync(root + src), map.extraColliders.map((p) => readFileSync(root + p))));
        console.log(`merged ${src} + ${map.extraColliders.join(', ')} -> packages/shared/src/maps/${map.id}/${name}`);
        continue;
      }
      copyFileSync(root + src, dest + name);
      console.log(`copied ${src} -> packages/shared/src/maps/${map.id}/${name}`);
    }
  }
}
