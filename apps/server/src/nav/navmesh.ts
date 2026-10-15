/**
 * The bot navmesh: built once per map with recast-navigation (WASM, runs in
 * Node), cached on disk keyed by the map hash, loaded on later starts.
 *
 * Cache directory: QWAKK_NAV_CACHE, else apps/server/.navcache/, else the OS
 * temp directory when that is not writable (read-only container images).
 */
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { Worker } from 'node:worker_threads';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { exportNavMesh, importNavMesh, init as initRecast, type NavMesh } from 'recast-navigation';
import { generateTiledNavMesh } from 'recast-navigation/generators';
import { BODY, MOVE, type MapDef } from '@qwakk/shared';
import { navGeometry } from './geometry.ts';

/** Bump when the build settings change, so old caches are not reused. */
const NAV_VERSION = 4;

/** Recast settings. Most fields are in voxels (cs wide, ch tall). */
export const NAV_CONFIG = (() => {
  const cs = 0.2;
  const ch = 0.2;
  return {
    cs,
    ch,
    tileSize: 128,
    borderSize: 3,
    walkableSlopeAngle: MOVE.maxSlopeClimbDeg,
    walkableHeight: Math.ceil(BODY.standHeight / ch),
    walkableClimb: Math.ceil(MOVE.stepHeight / ch),
    // 2 voxels (0.4 m): at least the duck's radius, so gaps the capsule cannot pass are cut,
    // and fine enough that the 1.4 m trench floor keeps a corridor.
    walkableRadius: Math.ceil(BODY.radius / cs),
    maxEdgeLen: Math.round(12 / cs),
    maxSimplificationError: 1.3,
    minRegionArea: 12,
    mergeRegionArea: 40,
    maxVertsPerPoly: 6,
    detailSampleDist: 2.1,
    detailSampleMaxError: 0.4,
  };
})();

let ready: Promise<void> | null = null;

export function initNav(): Promise<void> {
  ready ??= initRecast();
  return ready;
}

/**
 * Build a navmesh from the map (or from a rectangle of it, x0 z0 x1 z1, for
 * tests). Deterministic: same map, same bytes.
 */
export function buildNavMesh(map: MapDef, rect?: [number, number, number, number]): NavMesh {
  const { positions, indices } = navGeometry(map);
  const half = map.size / 2;
  const [x0, z0, x1, z1] = rect ?? [-half, -half, half, half];
  const result = generateTiledNavMesh(positions, indices, {
    ...NAV_CONFIG,
    bounds: [
      [x0, -8, z0],
      [x1, 60, z1],
    ],
  });
  if (!result.success || !result.navMesh) throw new Error(`navmesh build failed: ${result.success ? 'no mesh' : result.error}`);
  return result.navMesh;
}

function cacheDirs(): string[] {
  const dirs: string[] = [];
  if (process.env.QWAKK_NAV_CACHE) dirs.push(process.env.QWAKK_NAV_CACHE);
  dirs.push(fileURLToPath(new URL('../../.navcache/', import.meta.url)));
  dirs.push(join(tmpdir(), 'qwakk-navcache'));
  return dirs;
}

export interface NavLoad {
  navMesh: NavMesh;
  /** 'cache' or 'built'. */
  source: string;
  ms: number;
  file: string | null;
}

function cacheName(map: MapDef, mapHash: string): string {
  return `${map.id}-${mapHash || map.seed}-v${NAV_VERSION}.bin`;
}

/** The cached navmesh for this map hash, or null. */
export async function loadCachedNavMesh(map: MapDef, mapHash: string): Promise<NavLoad | null> {
  await initNav();
  const t0 = performance.now();
  for (const dir of cacheDirs()) {
    const file = join(dir, cacheName(map, mapHash));
    if (!existsSync(file)) continue;
    try {
      const { navMesh } = importNavMesh(new Uint8Array(readFileSync(file)));
      return { navMesh, source: 'cache', ms: performance.now() - t0, file };
    } catch {
      // Unreadable cache: rebuild.
    }
  }
  return null;
}

/** Write the navmesh bytes to the first writable cache directory, removing older builds of the same map. */
function saveCache(map: MapDef, mapHash: string, bytes: Uint8Array): string | null {
  const name = cacheName(map, mapHash);
  for (const dir of cacheDirs()) {
    try {
      mkdirSync(dir, { recursive: true });
      const file = join(dir, name);
      writeFileSync(file, bytes);
      for (const old of readdirSync(dir)) if (old !== name && old.startsWith(`${map.id}-`) && old.endsWith('.bin')) rmSync(join(dir, old), { force: true });
      return file;
    } catch {
      // Not writable: try the next directory.
    }
  }
  return null;
}

/** Load the cached navmesh, or build it here (blocking, about a minute) and cache it. Tests and tools. */
export async function loadOrBuildNavMesh(map: MapDef, mapHash: string): Promise<NavLoad> {
  const cached = await loadCachedNavMesh(map, mapHash);
  if (cached) return cached;
  const t0 = performance.now();
  const navMesh = buildNavMesh(map);
  const file = saveCache(map, mapHash, exportNavMesh(navMesh));
  return { navMesh, source: 'built', ms: performance.now() - t0, file };
}

/**
 * Sainte-Canard for the server: from the cache, or built on a worker thread
 * so the server keeps running rooms meanwhile (bots steer without paths until
 * it is ready).
 */
export async function loadOrBuildInBackground(map: MapDef, mapHash: string): Promise<NavLoad> {
  const cached = await loadCachedNavMesh(map, mapHash);
  if (cached) return cached;
  const t0 = performance.now();
  const bytes = await new Promise<Uint8Array>((resolve, reject) => {
    const w = new Worker(new URL('./buildWorker.ts', import.meta.url));
    w.once('message', (b: Uint8Array) => {
      resolve(b);
      void w.terminate();
    });
    w.once('error', reject);
  });
  const { navMesh } = importNavMesh(bytes);
  const file = saveCache(map, mapHash, bytes);
  return { navMesh, source: 'built (worker)', ms: performance.now() - t0, file };
}
