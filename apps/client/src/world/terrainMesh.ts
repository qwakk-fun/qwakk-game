/**
 * Terrain mesh built from the same height grid as the Rapier heightfield, with
 * the same triangle split, so what you see is what you stand on.
 */
import * as THREE from 'three/webgpu';
import type { TerrainDef } from '@qwakk/shared';
import { toonMaterial } from '../render/materials.ts';
import { WORLD_COLORS } from '../render/palette.ts';

export function createTerrainMesh(t: TerrainDef): THREE.Mesh {
  const n = t.cells;
  const w = n + 1;
  const half = (n * t.cellSize) / 2;
  const positions = new Float32Array(w * w * 3);
  const colors = new Float32Array(w * w * 3);
  for (let r = 0; r < w; r++) {
    for (let c = 0; c < w; c++) {
      const i = r * w + c;
      positions[i * 3] = -half + c * t.cellSize;
      positions[i * 3 + 1] = t.heights[i] ?? 0;
      positions[i * 3 + 2] = -half + r * t.cellSize;
    }
  }
  // Triangles: split each cell along (r, c + 1) to (r + 1, c), like the Rapier heightfield.
  const index = new Uint32Array(n * n * 6);
  let k = 0;
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const a = r * w + c;
      const b = a + 1;
      const d = a + w;
      const e = d + 1;
      index[k++] = a;
      index[k++] = d;
      index[k++] = b;
      index[k++] = b;
      index[k++] = d;
      index[k++] = e;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setIndex(new THREE.BufferAttribute(index, 1));
  geo.computeVertexNormals();

  // Color by height and slope: wet sand, sand, grass, rock on steep faces.
  const normals = geo.getAttribute('normal') as THREE.BufferAttribute;
  const sand = new THREE.Color(WORLD_COLORS.sand);
  const grass = new THREE.Color(WORLD_COLORS.grass);
  const grassDark = new THREE.Color(WORLD_COLORS.grassDark);
  const rock = new THREE.Color(WORLD_COLORS.rock);
  const tmp = new THREE.Color();
  for (let i = 0; i < w * w; i++) {
    const h = positions[i * 3 + 1] ?? 0;
    const ny = normals.getY(i);
    if (h < 1.6) tmp.copy(sand);
    else if (ny < 0.78) tmp.copy(rock);
    else tmp.copy(h > 14 ? grassDark : grass);
    if (h < 0) tmp.multiplyScalar(0.8);
    colors[i * 3] = tmp.r;
    colors[i * 3 + 1] = tmp.g;
    colors[i * 3 + 2] = tmp.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  const mesh = new THREE.Mesh(geo, toonMaterial(0xffffff, { vertexColors: true }));
  mesh.receiveShadow = true;
  mesh.name = 'terrain';
  return mesh;
}
