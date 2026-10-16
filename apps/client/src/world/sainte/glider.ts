/**
 * Drop and gear cosmetics: the glider canopy a duck opens after freefall,
 * and helmet and vest meshes for the duck's bones.
 */
import * as THREE from 'three/webgpu';
import { toonMaterial, outlineMaterial } from '../../render/materials.ts';
import { BRAND } from '../../render/palette.ts';
export { createBackpackMesh, createHelmetMesh, createVestMesh } from './itemMeshes.ts';

/**
 * A duck-wing glider: a wide yellow canopy with orange tips and a dark rim,
 * on four lines down to the duck's shoulders. Origin at the duck's feet;
 * add it to the avatar object while gliding (mode 3).
 */
export function createGlider(): THREE.Object3D {
  const g = new THREE.Group();
  g.name = 'glider';
  const canopyGeo = new THREE.SphereGeometry(1, 24, 8, 0, Math.PI * 2, 0, Math.PI * 0.32);
  canopyGeo.scale(2.4, 0.9, 1.15);
  // A clone: the shared yellow material must stay single sided.
  const canopyMat = toonMaterial(BRAND.yellow).clone();
  canopyMat.side = THREE.DoubleSide;
  const canopy = new THREE.Mesh(canopyGeo, canopyMat);
  canopy.position.y = 2.15;
  const rim = new THREE.Mesh(canopyGeo, outlineMaterial());
  rim.scale.setScalar(1.025);
  rim.position.y = 2.15;
  const tipGeo = new THREE.SphereGeometry(0.42, 12, 8);
  tipGeo.scale(1, 0.45, 1.3);
  for (const side of [-1, 1]) {
    const tip = new THREE.Mesh(tipGeo, toonMaterial(BRAND.beak));
    tip.position.set(side * 2.2, 2.55, 0);
    g.add(tip);
  }
  g.add(canopy, rim);
  // Lines: thin dark boxes from the canopy edge to the shoulders.
  const lineMat = toonMaterial(BRAND.dark);
  const anchors: [number, number][] = [[-1.7, -0.5], [1.7, -0.5], [-1.7, 0.5], [1.7, 0.5]];
  for (const [x, z] of anchors) {
    const from = new THREE.Vector3(x, 2.55, z);
    const to = new THREE.Vector3(Math.sign(x) * 0.22, 1.2, z * 0.2);
    const len = from.distanceTo(to);
    const line = new THREE.Mesh(new THREE.BoxGeometry(0.018, len, 0.018), lineMat);
    line.position.copy(from).add(to).multiplyScalar(0.5);
    line.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), from.clone().sub(to).normalize());
    g.add(line);
  }
  g.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = true;
  });
  return g;
}
