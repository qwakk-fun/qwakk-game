/**
 * Sainte-Canard world for the client: terrain, water, sky and light, and the
 * instanced props, behind one facade the game calls once per frame. The
 * plane, zone wall, items and glider are separate (game-state driven).
 */
import * as THREE from 'three/webgpu';
import { Container, terrainHeightAt, type PropInstance } from '@qwakk/shared';
import type { MapAssets } from './assets.ts';
import { CRATE_PROPS, CratesView, type CrateSpot } from './crates.ts';
import { SainteProps } from './props.ts';
import { createSainteEnvironment, type SainteEnvironment } from './sky.ts';
import { createSainteTerrain } from './terrain.ts';
import { createRiver, createSea } from './water.ts';

export { loadMapAssets, loadSainteCanard, shippedMapIds, UnknownMapError, type MapAssets } from './assets.ts';
export { PlaneView } from './plane.ts';
export { ZoneWall } from './zoneWall.ts';
export { ItemsView } from './items.ts';
export { CratesView, CrateVariant } from './crates.ts';
export { createBackpackMesh, createGlider, createHelmetMesh, createVestMesh } from './glider.ts';

export interface SainteWorldOptions {
  quality: 'high' | 'low';
  shadows: boolean;
}

export interface SainteWorld {
  env: SainteEnvironment;
  /** The map's loot crates (openable; keyed `pt:<loot point id>`) and dead ducks' crates. */
  crates: CratesView;
  /** Per frame, after the camera is placed and before rendering. */
  update(camera: THREE.PerspectiveCamera, dt: number): void;
  /** Props and terrain only (the renderer's own counters include ducks, effects and HUD meshes). */
  info(): { drawCalls: number; triangles: number; propInstances: number };
  /**
   * Compile every prop, terrain and water pipeline and upload their buffers
   * once, behind the loading screen, so the first glide over new LODs does not
   * hitch (WebGL2 compiles shaders synchronously on first use).
   */
  warmup(renderer: THREE.WebGPURenderer, camera: THREE.PerspectiveCamera): Promise<void>;
  /** Terrain height (no props), for effects and the zone line. */
  groundAt(x: number, z: number): number;
  dispose(): void;
}

/** Build the world into `scene`. Resolves once every prop type has loaded. */
export async function createSainteWorld(scene: THREE.Scene, assets: MapAssets, opts: SainteWorldOptions): Promise<SainteWorld> {
  const { def, extras, ground } = assets;
  const env = createSainteEnvironment(scene, opts.shadows);
  const terrain = createSainteTerrain(def.terrain, ground, extras.groundLegend);
  scene.add(terrain);
  const sea = createSea(def.seaLevel);
  scene.add(sea);
  const river = def.water ? createRiver(def.water) : null;
  if (river) scene.add(river);
  const { statics, crateSpots } = splitCrates(extras.props, assets);
  const props = await SainteProps.create(statics, (def.terrain.cells * def.terrain.cellSize) / 2, opts.quality);
  scene.add(props.group);
  const crates = new CratesView(crateSpots, opts.quality);
  scene.add(crates.group);
  await crates.load(`${import.meta.env.BASE_URL}models/crates/crates.glb`);

  const frustum = new THREE.Frustum();
  const pv = new THREE.Matrix4();
  const terrainTris = (def.terrain.cells * def.terrain.cells * 2) / terrain.children.length;
  let terrainCalls = 0;
  return {
    env,
    crates,
    update(camera, dt) {
      env.update(camera, dt);
      props.update(camera);
      crates.update(dt, camera);
      pv.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      frustum.setFromProjectionMatrix(pv, camera.coordinateSystem);
      terrainCalls = 0;
      for (const c of terrain.children) {
        const g = (c as THREE.Mesh).geometry;
        if (g.boundingSphere && frustum.intersectsSphere(g.boundingSphere)) terrainCalls++;
      }
    },
    info() {
      return { drawCalls: props.stats.drawCalls + crates.drawCalls + terrainCalls + 2, triangles: props.stats.triangles + terrainCalls * terrainTris, propInstances: props.stats.instances };
    },
    async warmup(renderer, camera) {
      props.showAllForWarmup(true);
      crates.showAllForWarmup(true);
      try {
        await renderer.compileAsync(scene, camera);
        renderer.render(scene, camera);
      } finally {
        props.showAllForWarmup(false);
        crates.showAllForWarmup(false);
      }
    },
    groundAt(x, z) {
      return terrainHeightAt(def.terrain, x, z);
    },
    dispose() {
      props.dispose();
      crates.dispose();
      env.dispose();
      for (const o of [terrain, sea, river]) o?.removeFromParent();
      for (const c of terrain.children) (c as THREE.Mesh).geometry.dispose();
      // Water meshes own their geometry and material. The terrain material is the
      // shared environment material (gltf.ts envMaterial): kept for the next game.
      for (const w of [sea, river]) {
        if (!w) continue;
        w.geometry.dispose();
        (w.material as THREE.Material).dispose();
      }
    },
  };
}

/**
 * The map's loot containers become openable crates: every crate prop that
 * sits on a container loot point (same x and z) is drawn by the crates view
 * instead of the static props, keyed by that point. Their colliders stay (the
 * sim builds them from the map data, untouched).
 */
function splitCrates(all: readonly PropInstance[], assets: MapAssets): { statics: PropInstance[]; crateSpots: CrateSpot[] } {
  const key = (x: number, z: number) => `${Math.round(x * 20)},${Math.round(z * 20)}`;
  const points = new Map<string, number>();
  for (const p of assets.def.br?.loot ?? []) if (p.container !== Container.None) points.set(key(p.x, p.z), p.id);
  const statics: PropInstance[] = [];
  const crateSpots: CrateSpot[] = [];
  for (const p of all) {
    const variant = CRATE_PROPS[p.prop];
    const id = variant === undefined ? undefined : points.get(key(p.x, p.z));
    if (variant === undefined || id === undefined) {
      statics.push(p);
      continue;
    }
    points.delete(key(p.x, p.z));
    crateSpots.push({ key: `pt:${id}`, variant, x: p.x, y: p.y, z: p.z, yaw: p.rotY, scale: p.scale });
  }
  return { statics, crateSpots };
}
