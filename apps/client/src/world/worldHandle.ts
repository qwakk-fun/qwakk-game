/**
 * The world a game runs in, built from what the server says: the greybox
 * island from its seed (deathmatch), or Sainte-Canard from the shipped map
 * files (battle royale), checked against the server's map hash first. Both
 * give the same SimWorld the server built, so prediction matches.
 */
import * as THREE from 'three/webgpu';
import { createSimWorld, generateMap, terrainHeightAt, type MapDef, type SimWorld } from '@qwakk/shared';
import type { RenderContext } from '../render/renderer.ts';
import { createEnvironment } from './environment.ts';
import { createPropsGroup } from './propsMesh.ts';
import { createTerrainMesh } from './terrainMesh.ts';
import { createSainteWorld, loadSainteCanard, type MapAssets, type SainteWorld } from './sainte/index.ts';

export interface WorldHandle {
  map: MapDef;
  sim: SimWorld;
  /** Sainte-Canard only: props, terrain and sky facade. */
  sainte: SainteWorld | null;
  assets: MapAssets | null;
  groundAt(x: number, z: number): number;
  /** Keep the sun's shadow box on the player. */
  follow(pos: THREE.Vector3): void;
  /** Per frame, after the camera is placed. */
  update(camera: THREE.PerspectiveCamera, dt: number): void;
  dispose(): void;
}

export class MapMismatchError extends Error {}

export interface WorldOptions {
  quality: 'high' | 'low';
  shadows: boolean;
  onProgress?: (text: string) => void;
}

export async function buildWorld(ctx: RenderContext, mapId: string, seed: number, mapHash: string, opts: WorldOptions): Promise<WorldHandle> {
  const { scene } = ctx;
  if (mapId === 'sainte-canard') {
    opts.onProgress?.('Loading Sainte-Canard...');
    const assets = await loadSainteCanard();
    if (mapHash && assets.hash !== mapHash) throw new MapMismatchError(`map files differ from the server (${assets.hash} vs ${mapHash})`);
    const sim = createSimWorld(assets.def);
    opts.onProgress?.('Building the village...');
    const sainte = await createSainteWorld(scene, assets, { quality: opts.quality, shadows: opts.shadows });
    opts.onProgress?.('Warming up...');
    await sainte.warmup(ctx.renderer, ctx.camera);
    return {
      map: assets.def,
      sim,
      sainte,
      assets,
      groundAt: (x, z) => sainte.groundAt(x, z),
      follow: (p) => sainte.env.follow(p),
      update: (camera, dt) => sainte.update(camera, dt),
      dispose: () => {
        sainte.dispose();
        sim.dispose();
      },
    };
  }
  const map = generateMap(seed);
  const sim = createSimWorld(map);
  const terrain = createTerrainMesh(map.terrain);
  const props = createPropsGroup(map);
  scene.add(terrain, props);
  const env = createEnvironment(scene, opts.shadows);
  return {
    map,
    sim,
    sainte: null,
    assets: null,
    groundAt: (x, z) => terrainHeightAt(map.terrain, x, z),
    follow: (p) => env.follow(p),
    update: () => undefined,
    dispose: () => {
      terrain.removeFromParent();
      props.removeFromParent();
      sim.dispose();
    },
  };
}
