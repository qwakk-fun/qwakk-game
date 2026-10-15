/**
 * Sea, sky light and a sun whose shadow box follows the player.
 */
import * as THREE from 'three/webgpu';
import { WORLD_COLORS } from '../render/palette.ts';

export interface Environment {
  sun: THREE.DirectionalLight;
  /** Keep the shadow frustum centered on the local player. */
  follow(target: THREE.Vector3): void;
}

const SUN_OFFSET = new THREE.Vector3(60, 110, 40);

export function createEnvironment(scene: THREE.Scene, shadows: boolean): Environment {
  scene.add(new THREE.HemisphereLight(0xeaf6ff, 0x8a7a55, 1.4));

  const sun = new THREE.DirectionalLight(0xfff3d6, 2.2);
  sun.position.copy(SUN_OFFSET);
  sun.castShadow = shadows;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = -45;
  sc.right = 45;
  sc.top = 45;
  sc.bottom = -45;
  sc.near = 10;
  sc.far = 300;
  sun.shadow.bias = -0.001;
  sun.shadow.normalBias = 0.08;
  scene.add(sun);
  scene.add(sun.target);

  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(4000, 4000),
    new THREE.MeshToonNodeMaterial({ color: WORLD_COLORS.water, transparent: true, opacity: 0.88 }),
  );
  water.rotation.x = -Math.PI / 2;
  water.position.y = 0;
  water.receiveShadow = false;
  water.name = 'water';
  scene.add(water);

  // Snap the shadow center to texel-sized steps so shadows do not shimmer while moving.
  const snapped = new THREE.Vector3();
  const texel = (sc.right - sc.left) / sun.shadow.mapSize.x;
  return {
    sun,
    follow(target) {
      snapped.set(Math.round(target.x / texel) * texel, Math.round(target.y / texel) * texel, Math.round(target.z / texel) * texel);
      sun.target.position.copy(snapped);
      sun.position.copy(snapped).add(SUN_OFFSET);
    },
  };
}
