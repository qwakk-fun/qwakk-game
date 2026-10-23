/**
 * The deathmatch rocket launcher, drawn in code (no art asset yet): a fat
 * olive tube with a brand yellow band, a beak orange warhead peeking out of
 * the front and a grip. Built in gun space like the guns (barrel along +Z),
 * so it rides the rifle's place in the duck's hands. `muzzle` is the tube's
 * front end (flash and the drawn rocket start there).
 */
import * as THREE from 'three/webgpu';
import { toonMaterial } from '../render/materials.ts';
import { BRAND } from '../render/palette.ts';

export interface LauncherInstance {
  root: THREE.Group;
  muzzle: THREE.Object3D;
}

/** Geometry per launcher (a procedural rifle's dispose frees what hangs under it); the toon materials are shared. */
function parts() {
  const tube = new THREE.CylinderGeometry(0.075, 0.075, 0.95, 10);
  tube.rotateX(Math.PI / 2);
  const band = new THREE.CylinderGeometry(0.082, 0.082, 0.07, 10);
  band.rotateX(Math.PI / 2);
  const tip = new THREE.ConeGeometry(0.06, 0.14, 8);
  tip.rotateX(Math.PI / 2);
  const grip = new THREE.BoxGeometry(0.045, 0.13, 0.06);
  const mats = [toonMaterial(0x5d6b3a), toonMaterial(BRAND.yellow), toonMaterial(BRAND.beak), toonMaterial(0x2b2a26)] as const;
  return { tube, band, tip, grip, mats };
}

export function createLauncher(): LauncherInstance {
  const p = parts();
  const [olive, yellow, orange, dark] = p.mats;
  const root = new THREE.Group();
  root.name = 'RocketLauncher';
  const tube = new THREE.Mesh(p.tube, olive);
  tube.position.z = 0.18;
  const bandFront = new THREE.Mesh(p.band, yellow);
  bandFront.position.z = 0.6;
  const bandBack = new THREE.Mesh(p.band, yellow);
  bandBack.position.z = -0.24;
  const tip = new THREE.Mesh(p.tip, orange);
  tip.position.z = 0.64;
  const grip = new THREE.Mesh(p.grip, dark);
  grip.position.set(0, -0.1, 0.02);
  const front = new THREE.Mesh(p.grip, dark);
  front.position.set(0, -0.1, 0.32);
  root.add(tube, bandFront, bandBack, tip, grip, front);
  for (const m of root.children) m.castShadow = true;
  const muzzle = new THREE.Object3D();
  muzzle.position.z = 0.66;
  root.add(muzzle);
  return { root, muzzle };
}
