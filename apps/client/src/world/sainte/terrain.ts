/**
 * Sainte-Canard terrain: the same height grid and triangle split as the
 * Rapier heightfield (what you see is what you stand on), colored per vertex
 * from the map's ground paint, cut into chunks so off-screen parts are culled.
 * The vertex colors are the flat look (and the far color of the textured
 * ground, `groundMaterial.ts`, which replaces the material once its textures load).
 */
import * as THREE from 'three/webgpu';
import type { TerrainDef } from '@qwakk/shared';
import { envMaterial } from './gltf.ts';
import { GROUND_COLORS, gridNormals, isSteep, STEEP_ROCK } from './groundPaint.ts';

export { GROUND_COLORS } from './groundPaint.ts';

const CHUNKS = 5;

/** Small stable per-vertex brightness jitter so big fields do not look flat. */
function jitter(i: number): number {
  let h = Math.imul(i ^ 0x5bd1e995, 0x27d4eb2d);
  h ^= h >>> 15;
  return ((h >>> 0) / 4294967296 - 0.5) * 0.07;
}

export function createSainteTerrain(t: TerrainDef, ground: Uint8Array, legend: readonly string[]): THREE.Group {
  const n = t.cells;
  const w = n + 1;
  const half = (n * t.cellSize) / 2;

  // Full-grid positions and normals first, so chunk seams shade identically.
  const pos = new Float32Array(w * w * 3);
  for (let r = 0; r < w; r++) {
    for (let c = 0; c < w; c++) {
      const i = r * w + c;
      pos[i * 3] = -half + c * t.cellSize;
      pos[i * 3 + 1] = t.heights[i] ?? 0;
      pos[i * 3 + 2] = -half + r * t.cellSize;
    }
  }
  const nrm = gridNormals(t);
  const palette = legend.map((name) => new THREE.Color(GROUND_COLORS[name] ?? GROUND_COLORS.grass));
  const fallback = new THREE.Color(GROUND_COLORS.grass);
  const col = new Float32Array(w * w * 3);
  const tmp = new THREE.Color();
  for (let i = 0; i < w * w; i++) {
    tmp.copy(palette[ground[i] ?? 0] ?? fallback);
    // Steep faces read as rock, whatever the paint says.
    if (isSteep(nrm[i * 3 + 1] ?? 1, pos[i * 3 + 1] ?? 0)) tmp.lerp(palette[legend.indexOf('rock')] ?? tmp, STEEP_ROCK);
    tmp.multiplyScalar(1 + jitter(i));
    col[i * 3] = tmp.r;
    col[i * 3 + 1] = tmp.g;
    col[i * 3 + 2] = tmp.b;
  }

  const material = envMaterial({ key: 'terrain', vertexColors: true });
  const group = new THREE.Group();
  group.name = 'terrain';
  const step = Math.ceil(n / CHUNKS);
  for (let cr = 0; cr < CHUNKS; cr++) {
    for (let cc = 0; cc < CHUNKS; cc++) {
      const r0 = cr * step;
      const c0 = cc * step;
      const r1 = Math.min(n, r0 + step);
      const c1 = Math.min(n, c0 + step);
      if (r1 <= r0 || c1 <= c0) continue;
      const cw = c1 - c0 + 1;
      const ch = r1 - r0 + 1;
      const p = new Float32Array(cw * ch * 3);
      const nn = new Float32Array(cw * ch * 3);
      const cl = new Float32Array(cw * ch * 3);
      for (let r = 0; r < ch; r++) {
        for (let c = 0; c < cw; c++) {
          const src = ((r0 + r) * w + (c0 + c)) * 3;
          const dst = (r * cw + c) * 3;
          for (let k = 0; k < 3; k++) {
            p[dst + k] = pos[src + k] as number;
            nn[dst + k] = nrm[src + k] as number;
            cl[dst + k] = col[src + k] as number;
          }
        }
      }
      // Same split as the Rapier heightfield: diagonal from (r, c + 1) to (r + 1, c).
      const index = new Uint32Array((cw - 1) * (ch - 1) * 6);
      let k = 0;
      for (let r = 0; r < ch - 1; r++) {
        for (let c = 0; c < cw - 1; c++) {
          const a = r * cw + c;
          const b = a + 1;
          const d = a + cw;
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
      geo.setAttribute('position', new THREE.BufferAttribute(p, 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(nn, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(cl, 3));
      geo.setIndex(new THREE.BufferAttribute(index, 1));
      geo.computeBoundingSphere();
      geo.computeBoundingBox();
      const mesh = new THREE.Mesh(geo, material);
      mesh.receiveShadow = true;
      mesh.name = `terrain:${cr}:${cc}`;
      group.add(mesh);
    }
  }
  return group;
}
