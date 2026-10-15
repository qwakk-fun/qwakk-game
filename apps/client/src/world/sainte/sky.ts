/**
 * Sky, fog and light for the big map: a gradient sky dome that follows the
 * camera, a few toon clouds, distance fog that hides the prop cull distances,
 * a hemisphere light and a sun whose shadow box follows the player (only
 * ducks cast real-time shadows; the map receives them).
 */
import * as THREE from 'three/webgpu';
import { envGradientMap } from './gltf.ts';

export const SKY = {
  zenith: 0x5fb6e8,
  horizon: 0xcdebf6,
  fog: 0xc6e6f3,
  fogNear: 160,
  fogFar: 760,
} as const;

export interface SainteEnvironment {
  sun: THREE.DirectionalLight;
  /** Keep the shadow box centered on the local player. */
  follow(target: THREE.Vector3): void;
  /** Keep the sky dome around the camera. */
  update(camera: THREE.Camera, dt: number): void;
  dispose(): void;
}

const SUN_OFFSET = new THREE.Vector3(70, 120, 45);

function skyDome(): THREE.Mesh {
  const geo = new THREE.SphereGeometry(1200, 32, 16);
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  const top = new THREE.Color(SKY.zenith);
  const low = new THREE.Color(SKY.horizon);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const h = Math.max(0, pos.getY(i) / 1200);
    c.copy(low).lerp(top, Math.pow(h, 0.55));
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const mat = new THREE.MeshBasicNodeMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'sky';
  mesh.renderOrder = -10;
  mesh.frustumCulled = false;
  return mesh;
}

/** Puffy toon clouds: a handful of flattened white blobs high above the island. */
function clouds(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'clouds';
  const mat = new THREE.MeshToonNodeMaterial({ color: 0xffffff, gradientMap: envGradientMap(), fog: false });
  const blob = new THREE.IcosahedronGeometry(1, 1);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 14; i++) {
    const cloud = new THREE.Group();
    const a = rnd() * Math.PI * 2;
    const r = 250 + rnd() * 650;
    cloud.position.set(Math.cos(a) * r, 230 + rnd() * 90, Math.sin(a) * r);
    const parts = 3 + Math.floor(rnd() * 3);
    for (let k = 0; k < parts; k++) {
      const m = new THREE.Mesh(blob, mat);
      const s = 14 + rnd() * 16;
      m.scale.set(s * 1.6, s * 0.55, s);
      m.position.set((k - parts / 2) * s * 1.3, rnd() * 4, (rnd() - 0.5) * s);
      cloud.add(m);
    }
    g.add(cloud);
  }
  return g;
}

export function createSainteEnvironment(scene: THREE.Scene, shadows: boolean): SainteEnvironment {
  scene.background = new THREE.Color(SKY.horizon);
  scene.fog = new THREE.Fog(SKY.fog, SKY.fogNear, SKY.fogFar);
  const hemi = new THREE.HemisphereLight(0xeaf6ff, 0x8a7a55, 1.35);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xfff3d6, 2.3);
  sun.position.copy(SUN_OFFSET);
  sun.castShadow = shadows;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = -45;
  sc.right = 45;
  sc.top = 45;
  sc.bottom = -45;
  sc.near = 10;
  sc.far = 320;
  sun.shadow.bias = -0.001;
  sun.shadow.normalBias = 0.08;
  scene.add(sun, sun.target);

  const dome = skyDome();
  const cloudGroup = clouds();
  scene.add(dome, cloudGroup);

  const snapped = new THREE.Vector3();
  const texel = (sc.right - sc.left) / sun.shadow.mapSize.x;
  let drift = 0;
  return {
    sun,
    follow(target) {
      snapped.set(Math.round(target.x / texel) * texel, Math.round(target.y / texel) * texel, Math.round(target.z / texel) * texel);
      sun.target.position.copy(snapped);
      sun.position.copy(snapped).add(SUN_OFFSET);
    },
    update(camera, dt) {
      dome.position.copy(camera.position);
      // Clouds drift slowly around the island (no wrap-around pop).
      drift += dt;
      cloudGroup.rotation.y = drift * 0.004;
    },
    dispose() {
      scene.remove(hemi, sun, sun.target, dome, cloudGroup);
      dome.geometry.dispose();
    },
  };
}
