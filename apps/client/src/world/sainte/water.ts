/**
 * Sea plane at the sea level and the river La Mare as a ribbon along its
 * centerline at the map's water heights. Cosmetic only: wading is a sim rule.
 */
import * as THREE from 'three/webgpu';
import type { WaterDef } from '@qwakk/shared';

const SEA_COLOR = 0x2fa7c9;
const RIVER_COLOR = 0x45b4c4;

function waterMaterial(color: number, opacity: number): THREE.MeshToonNodeMaterial {
  const m = new THREE.MeshToonNodeMaterial({ color, transparent: true, opacity });
  m.depthWrite = false;
  return m;
}

export function createSea(level: number): THREE.Mesh {
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000, 1, 1), waterMaterial(SEA_COLOR, 0.86));
  sea.rotation.x = -Math.PI / 2;
  sea.position.y = level;
  sea.name = 'sea';
  sea.renderOrder = 1;
  return sea;
}

/** River ribbon: one quad strip along the centerline, a little wider than the bed so it meets the banks. */
export function createRiver(w: WaterDef): THREE.Mesh | null {
  const pts = w.river;
  if (pts.length < 2) return null;
  const half = w.riverHalfWidth + 2.5;
  const positions: number[] = [];
  const index: number[] = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i] as WaterDef['river'][number];
    const a = pts[Math.max(0, i - 1)] as WaterDef['river'][number];
    const b = pts[Math.min(pts.length - 1, i + 1)] as WaterDef['river'][number];
    // Miter direction: average of the neighboring segment directions.
    let dx = b.x - a.x;
    let dz = b.z - a.z;
    const len = Math.hypot(dx, dz) || 1;
    dx /= len;
    dz /= len;
    const nx = -dz;
    const nz = dx;
    positions.push(p.x + nx * half, p.water, p.z + nz * half, p.x - nx * half, p.water, p.z - nz * half);
    if (i > 0) {
      const k = (i - 1) * 2;
      index.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(index);
  geo.computeVertexNormals();
  // Normals of a flat ribbon can flip with the winding: force them up.
  const n = geo.getAttribute('normal') as THREE.BufferAttribute;
  for (let i = 0; i < n.count; i++) n.setXYZ(i, 0, 1, 0);
  const mat = waterMaterial(RIVER_COLOR, 0.82);
  mat.side = THREE.DoubleSide;
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'river';
  mesh.renderOrder = 1;
  return mesh;
}
