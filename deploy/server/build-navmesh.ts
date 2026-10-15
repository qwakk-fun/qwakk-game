/**
 * Image build step: bake the Sainte-Canard bot navmesh into the server image,
 * so a container start loads it in milliseconds instead of rebuilding it for
 * about a minute (the runtime user cannot write to /srv, so a runtime cache
 * would land in /tmp and be lost on every restart).
 *
 * Writes <QWAKK_NAV_CACHE>/sainte-canard-<mapHash>-v<N>.bin, the same name the
 * server looks up at start, then reads it back to prove it loads.
 *
 *   QWAKK_NAV_CACHE=/srv/navcache node deploy/server/build-navmesh.ts
 */
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { loadSainteCanard } from '../../apps/server/src/maps.ts';
import { loadCachedNavMesh, loadOrBuildNavMesh } from '../../apps/server/src/nav/navmesh.ts';

const target = process.env.QWAKK_NAV_CACHE;
if (!target) {
  console.error('[nav] set QWAKK_NAV_CACHE to the directory to bake the navmesh into');
  process.exit(1);
}

const map = loadSainteCanard();
const built = await loadOrBuildNavMesh(map.def, map.hash);
console.log(`[nav] ${built.source} in ${Math.round(built.ms)} ms: ${built.file ?? '(not saved)'}`);

if (!built.file || resolve(dirname(built.file)) !== resolve(target) || !existsSync(built.file)) {
  console.error(`[nav] the navmesh was not written to ${target}`);
  process.exit(1);
}
const check = await loadCachedNavMesh(map.def, map.hash);
if (!check || check.file !== built.file) {
  console.error('[nav] the baked navmesh does not load back');
  process.exit(1);
}
console.log(`[nav] baked and verified: ${built.file}`);
process.exit(0);
