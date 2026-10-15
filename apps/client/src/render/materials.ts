/**
 * Toon materials: a 2-band ramp (lit and shade) in the brand palette.
 * One shared gradient texture keeps every material on the same look.
 */
import * as THREE from 'three/webgpu';

let gradient: THREE.DataTexture | null = null;

function toonGradient(): THREE.DataTexture {
  if (gradient) return gradient;
  // Two bands: shade and lit. Nearest filtering keeps the hard toon edge.
  const data = new Uint8Array([150, 150, 150, 255, 255, 255, 255, 255]);
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

let outline: THREE.MeshBasicNodeMaterial | null = null;

/** Inverted hull outline for characters only (thin dark line, echoes the brand line work). Shared. */
export function outlineMaterial(): THREE.MeshBasicNodeMaterial {
  outline ??= new THREE.MeshBasicNodeMaterial({ color: 0x151619, side: THREE.BackSide });
  return outline;
}
