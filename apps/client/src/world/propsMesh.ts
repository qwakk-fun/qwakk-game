/**
 * Buildings, ramps, crates and rocks as instanced meshes: one draw call per kind.
 */
import * as THREE from 'three/webgpu';
import type { BoxKind, MapDef } from '@qwakk/shared';
import { toonMaterial } from '../render/materials.ts';
import { WORLD_COLORS } from '../render/palette.ts';

const KIND_COLOR: Record<Exclude<BoxKind, 'boundary'>, number> = {
  foundation: WORLD_COLORS.foundation,
  wall: WORLD_COLORS.wall,
  floor: WORLD_COLORS.floor,
  roof: WORLD_COLORS.roof,
  stairs: WORLD_COLORS.stairs,
  ramp: WORLD_COLORS.ramp,
  crate: WORLD_COLORS.crate,
  cover: WORLD_COLORS.cover,
  block: WORLD_COLORS.block,
};

export function createPropsGroup(map: MapDef): THREE.Group {
  const group = new THREE.Group();
  group.name = 'props';
  const unitBox = new THREE.BoxGeometry(1, 1, 1);
  const m = new THREE.Matrix4();
  const p = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();

  for (const kind of Object.keys(KIND_COLOR) as (keyof typeof KIND_COLOR)[]) {
    const boxes = map.boxes.filter((b) => b.kind === kind);
    if (boxes.length === 0) continue;
    const mesh = new THREE.InstancedMesh(unitBox, toonMaterial(KIND_COLOR[kind]), boxes.length);
    boxes.forEach((b, i) => {
      p.set(b.c[0], b.c[1], b.c[2]);
      q.set(b.q[0], b.q[1], b.q[2], b.q[3]);
      s.set(b.h[0] * 2, b.h[1] * 2, b.h[2] * 2);
      mesh.setMatrixAt(i, m.compose(p, q, s));
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.castShadow = kind !== 'foundation';
    mesh.receiveShadow = true;
    mesh.name = `props:${kind}`;
    mesh.computeBoundingSphere();
    group.add(mesh);
  }

  if (map.rocks.length > 0) {
    const rockGeo = new THREE.IcosahedronGeometry(1, 1);
    const rocks = new THREE.InstancedMesh(rockGeo, toonMaterial(WORLD_COLORS.rock), map.rocks.length);
    map.rocks.forEach((r, i) => {
      p.set(r.c[0], r.c[1], r.c[2]);
      q.setFromEuler(new THREE.Euler(i * 0.7, i * 1.3, 0));
      s.setScalar(r.r);
      rocks.setMatrixAt(i, m.compose(p, q, s));
    });
    rocks.instanceMatrix.needsUpdate = true;
    rocks.castShadow = true;
    rocks.receiveShadow = true;
    rocks.name = 'props:rocks';
    rocks.computeBoundingSphere();
    group.add(rocks);
  }
  return group;
}
