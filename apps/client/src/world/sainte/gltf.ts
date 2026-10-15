/**
 * Cached GLB loading for the map props (meshopt + KHR_mesh_quantization),
 * plus the shared environment toon material and LOD geometry extraction.
 */
import * as THREE from 'three/webgpu';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

export const PROPS_BASE = `${import.meta.env.BASE_URL}models/props/`;

let loader: GLTFLoader | null = null;
const cache = new Map<string, Promise<GLTF>>();

export function loadPropGlb(name: string): Promise<GLTF> {
  let p = cache.get(name);
  if (!p) {
    loader ??= new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
    p = loader.loadAsync(`${PROPS_BASE}${name}.glb`);
    cache.set(name, p);
  }
  return p;
}

/** The toon look for the environment: 2-band ramp with the environment shadow tint (manifest shadowTint.environment). */
export const ENV_SHADOW_TINT = 0xb4bccf;

let envGradient: THREE.DataTexture | null = null;

export function envGradientMap(): THREE.DataTexture {
  if (envGradient) return envGradient;
  const t = ENV_SHADOW_TINT;
  const data = new Uint8Array([(t >> 16) & 255, (t >> 8) & 255, t & 255, 255, 255, 255, 255, 255]);
  envGradient = new THREE.DataTexture(data, 2, 1, THREE.RGBAFormat);
  envGradient.minFilter = THREE.NearestFilter;
  envGradient.magFilter = THREE.NearestFilter;
  envGradient.generateMipmaps = false;
  envGradient.needsUpdate = true;
  return envGradient;
}

const envCache = new Map<string, THREE.MeshToonNodeMaterial>();

/** Environment toon material: a palette texture or a plain color (vertex colors optional). Shared, never disposed. */
export function envMaterial(opts: { map?: THREE.Texture | null; color?: number; vertexColors?: boolean; side?: THREE.Side; key: string }): THREE.MeshToonNodeMaterial {
  let m = envCache.get(opts.key);
  if (m) return m;
  m = new THREE.MeshToonNodeMaterial({ color: opts.color ?? 0xffffff, gradientMap: envGradientMap() });
  if (opts.map) {
    // The palette is 16 px cells: nearest sampling keeps them crisp and stops bleeding.
    opts.map.magFilter = THREE.NearestFilter;
    opts.map.minFilter = THREE.NearestFilter;
    opts.map.generateMipmaps = false;
    opts.map.needsUpdate = true;
    m.map = opts.map;
  }
  if (opts.vertexColors) m.vertexColors = true;
  m.side = opts.side ?? THREE.FrontSide;
  envCache.set(opts.key, m);
  return m;
}

/** First texture found on a loaded GLB (the shared palette). */
export function paletteOf(gltf: GLTF): THREE.Texture | null {
  let tex: THREE.Texture | null = null;
  gltf.scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (tex || !mesh.isMesh) return;
    const mat = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.MeshStandardMaterial | undefined;
    if (mat?.map) tex = mat.map;
  });
  return tex;
}

/**
 * Geometry of a named node (LOD0, LOD1...) in prop space: the node's own
 * matrix carries the quantization scale and offset, so it is baked in, and
 * any parents up to the prop root too.
 */
export function nodeGeometry(gltf: GLTF, nodeName: string): THREE.BufferGeometry | null {
  const node = gltf.scene.getObjectByName(nodeName);
  if (!node) return null;
  gltf.scene.updateMatrixWorld(true);
  const geos: THREE.BufferGeometry[] = [];
  node.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const g = mesh.geometry.clone();
    // Dequantize into plain float attributes so baking the matrix is exact.
    for (const name of Object.keys(g.attributes)) {
      const a = g.getAttribute(name) as THREE.BufferAttribute;
      if (a.normalized || !(a.array instanceof Float32Array) || (a as unknown as { isInterleavedBufferAttribute?: boolean }).isInterleavedBufferAttribute) {
        const out = new Float32Array(a.count * a.itemSize);
        for (let i = 0; i < a.count; i++) for (let k = 0; k < a.itemSize; k++) out[i * a.itemSize + k] = a.getComponent(i, k);
        g.setAttribute(name, new THREE.BufferAttribute(out, a.itemSize));
      }
    }
    g.applyMatrix4(mesh.matrixWorld);
    geos.push(g);
  });
  if (geos.length === 0) return null;
  if (geos.length === 1) return geos[0] as THREE.BufferGeometry;
  return mergeSimple(geos);
}

/** Merge indexed or non-indexed geometries that share position/normal/uv. */
export function mergeSimple(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const parts = geos.map((g) => (g.index ? g.toNonIndexed() : g));
  const names = ['position', 'normal', 'uv', 'color'].filter((n) => parts.every((g) => g.getAttribute(n)));
  const out = new THREE.BufferGeometry();
  for (const n of names) {
    const size = (parts[0] as THREE.BufferGeometry).getAttribute(n).itemSize;
    const total = parts.reduce((s, g) => s + g.getAttribute(n).count, 0);
    const arr = new Float32Array(total * size);
    let off = 0;
    for (const g of parts) {
      const a = g.getAttribute(n) as THREE.BufferAttribute;
      for (let i = 0; i < a.count; i++) for (let k = 0; k < size; k++) arr[off++] = a.getComponent(i, k);
    }
    out.setAttribute(n, new THREE.BufferAttribute(arr, size));
  }
  return out;
}
