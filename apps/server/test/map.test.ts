/**
 * Yelova map determinism: two loads give the same terrain and the same
 * collider list (hash), the terrain lookup matches the Rapier heightfield,
 * collider kinds map to the right groups, and the shipped copy of the map
 * files matches the map workstream's export.
 */
import { existsSync, readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  buildMapDef,
  CG,
  createSimWorld,
  initPhysics,
  mapDefHash,
  MOVE_QUERY_GROUPS,
  simSelfTestHashOn,
  terrainHeightAt,
} from '@qwakk/shared';
import { loadSainteCanard } from '../src/maps.ts';

const root = new URL('../../../', import.meta.url);
const shipped = new URL('packages/shared/src/maps/sainte-canard/', root);

beforeAll(async () => {
  await initPhysics();
});

function load() {
  const read = (f: string) => readFileSync(new URL(f, shipped));
  return buildMapDef('sainte-canard', JSON.parse(read('map_v1.json').toString()), new Uint8Array(read('map_v1_heights.bin')), JSON.parse(read('colliders.json').toString()));
}

describe('Yelova map', () => {
  it('two loads give identical terrain and collider lists, and every collider kind is known', () => {
    const a = load();
    const b = load();
    expect(mapDefHash(a.def)).toBe(mapDefHash(b.def));
    expect(a.def.shapes.length).toBeGreaterThan(6000);
    expect(a.extras.unknownKinds).toEqual([]);
    expect(a.def.br?.loot.length).toBeGreaterThan(500);
    expect(a.def.br?.flight.paths.length).toBeGreaterThan(0);
  });

  it('terrainHeightAt matches the Rapier heightfield', () => {
    const def = load().def;
    // Terrain only: drop the props so the rays meet the ground.
    const sim = createSimWorld({ ...def, shapes: [], boxes: [] });
    let worst = 0;
    for (let i = 0; i < 400; i++) {
      const x = -400 + ((i * 37.13) % 800);
      const z = -400 + ((i * 91.71) % 800);
      const hit = sim.world.castRay(new sim.rapier.Ray({ x, y: 100, z }, { x: 0, y: -1, z: 0 }), 200, true, undefined, MOVE_QUERY_GROUPS);
      expect(hit).not.toBeNull();
      worst = Math.max(worst, Math.abs(100 - hit!.timeOfImpact - terrainHeightAt(def.terrain, x, z)));
    }
    expect(worst).toBeLessThan(1e-3);
    sim.dispose();
  });

  it('collider kinds: wire blocks movement only, hedges block movement and sight, bushes only sight', () => {
    const def = load().def;
    const bits = (kind: string) => def.shapes.find((s) => s.kind === kind)?.bits;
    expect(bits('wire')).toBe(CG.Move);
    expect(bits('fence')).toBe(CG.Move);
    expect(bits('hedge')).toBe(CG.Move | CG.Sight | CG.Opaque);
    expect(bits('foliage')).toBe(CG.Sight);
    expect(bits('wall')).toBe(CG.Move | CG.Bullet | CG.Sight | CG.Opaque);
  });

  it('the sim scenario on this map is repeatable (the e2e compares it with Chrome)', () => {
    const def = loadSainteCanard().def;
    expect(simSelfTestHashOn(def, 200)).toBe(simSelfTestHashOn(load().def, 200));
  });

  it('the shipped copy matches the map export (run npm run map:sync after a map rebuild)', () => {
    const pairs: [string, string][] = [
      ['art/map/export/map_v1.json', 'map_v1.json'],
      ['art/map/export/map_v1_heights.bin', 'map_v1_heights.bin'],
      ['art/map/export/map_v1_ground.bin', 'map_v1_ground.bin'],
      ['apps/client/public/models/props/colliders.json', 'colliders.json'],
    ];
    for (const [src, name] of pairs) {
      const s = new URL(src, root);
      if (!existsSync(s)) continue; // the server image has no art/
      expect(readFileSync(new URL(name, shipped)).equals(readFileSync(s)), `${name} is stale: npm run map:sync`).toBe(true);
    }
  });
});
