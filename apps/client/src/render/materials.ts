/**
 * Toon materials: a 2-band ramp (lit and shade) in the brand palette.
 * One shared gradient texture keeps every material on the same look.
 */
import * as THREE from 'three/webgpu';
import { normalLocal, positionLocal } from 'three/tsl';

let gradient: THREE.DataTexture | null = null;

function toonGradient(): THREE.DataTexture {
  if (gradient) return gradient;
  // Two bands: shade and lit (the art recipe: shadow = base color times #d9a6a0).
  // Nearest filtering keeps the hard toon edge.
  const data = new Uint8Array([0xd9, 0xa6, 0xa0, 255, 255, 255, 255, 255]);
  gradient = new THREE.DataTexture(data, 2, 1, THREE.RGBAFormat);
  gradient.minFilter = THREE.NearestFilter;
  gradient.magFilter = THREE.NearestFilter;
  gradient.generateMipmaps = false;
  gradient.needsUpdate = true;
  return gradient;
}

/**
 * Materials are shared and live as long as the page: one per color, so adding
 * and removing ducks never creates or leaks GPU programs. Do not dispose them.
 */
const toonCache = new Map<string, THREE.MeshToonNodeMaterial>();

export function toonMaterial(color: number, options: { vertexColors?: boolean } = {}): THREE.MeshToonNodeMaterial {
  const key = `${color}:${options.vertexColors ? 1 : 0}`;
  let m = toonCache.get(key);
  if (!m) {
    m = new THREE.MeshToonNodeMaterial({ color, gradientMap: toonGradient() });
    if (options.vertexColors) m.vertexColors = true;
    toonCache.set(key, m);
  }
  return m;
}

/** The same toon look for an imported material: keeps its color and texture. */
export function toonFrom(src: THREE.Material): THREE.MeshToonNodeMaterial {
  const s = src as THREE.MeshStandardMaterial;
  const m = new THREE.MeshToonNodeMaterial({ color: s.color ?? new THREE.Color(0xffffff), gradientMap: toonGradient() });
  if (s.map) m.map = s.map;
  if (s.vertexColors) m.vertexColors = true;
  m.side = s.side;
  return m;
}

let outline: THREE.MeshBasicNodeMaterial | null = null;

/** Inverted hull outline for characters only (thin dark line, echoes the brand line work). Shared. */
export function outlineMaterial(): THREE.MeshBasicNodeMaterial {
  outline ??= new THREE.MeshBasicNodeMaterial({ color: 0x151619, side: THREE.BackSide });
  return outline;
}

let skinnedOutline: THREE.MeshBasicNodeMaterial | null = null;

/**
 * Outline for skinned meshes: back faces pushed out along the (skinned) normal
 * by 7.5 mm, in the brand dark. Skinning runs before positionNode, so the hull
 * follows the animation.
 */
export function skinnedOutlineMaterial(): THREE.MeshBasicNodeMaterial {
  if (skinnedOutline) return skinnedOutline;
  const m = new THREE.MeshBasicNodeMaterial({ color: 0x151619, side: THREE.BackSide });
  m.positionNode = positionLocal.add(normalLocal.mul(0.0075));
  skinnedOutline = m;
  return m;
}
