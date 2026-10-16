/**
 * Image build step: bake the bot navmeshes into the server image (Sainte-Canard
 * for the battle royale, about a minute of one core, and the deathmatch map,
 * a few seconds), so a container start loads them in milliseconds instead of
 * rebuilding them (the runtime user cannot write to /srv, so a runtime cache
 * would land in /tmp and be lost on every restart).
 *
 * Writes <QWAKK_NAV_CACHE>/<mapId>-<mapHash>-v<N>.bin, the names the server
 * looks up at start, then reads each back to prove it loads.
 *
 *   QWAKK_NAV_CACHE=/srv/navcache node deploy/server/build-navmesh.ts
 */
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { dmMapId, GREYBOX, loadMapV1, SAINTE_CANARD } from '../../apps/server/src/maps.ts';
import { loadCachedNavMesh, loadOrBuildNavMesh } from '../../apps/server/src/nav/navmesh.ts';

const target = process.env.QWAKK_NAV_CACHE;
if (!target) {
  console.error('[nav] set QWAKK_NAV_CACHE to the directory to bake the navmeshes into');
  process.exit(1);
}

const ids = [...new Set([SAINTE_CANARD, dmMapId()])].filter((id) => id !== GREYBOX);
for (const id of ids) {
  const map = loadMapV1(id);
  const built = await loadOrBuildNavMesh(map.def, map.hash);
  console.log(`[nav] ${id}: ${built.source} in ${Math.round(built.ms)} ms: ${built.file ?? '(not saved)'}`);
  if (!built.file || resolve(dirname(built.file)) !== resolve(target) || !existsSync(built.file)) {
    console.error(`[nav] the ${id} navmesh was not written to ${target}`);
    process.exit(1);
  }
  const check = await loadCachedNavMesh(map.def, map.hash);
  if (!check || check.file !== built.file) {
    console.error(`[nav] the baked ${id} navmesh does not load back`);
    process.exit(1);
  }
  console.log(`[nav] baked and verified: ${built.file}`);
}
process.exit(0);
