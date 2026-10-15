/**
 * Duck visuals. Today: a placeholder built from primitives (yellow body, orange
 * beak, dot eyes) so facing is obvious. Later: the rigged GLB.
 *
 * GLB hook: `apps/client/public/models/duck.glb`. On start, `loadDuckGlb()`
 * checks for it; when present every avatar swaps its placeholder for a clone
 * of the GLB (see Avatar.setModel). Its feet are put on y = 0 and it is turned
 * to face -z (the sim's forward at yaw 0; the art faces +z).
 */
import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { outlineMaterial, skinnedOutlineMaterial, toonFrom, toonMaterial } from '../render/materials.ts';
import { BRAND } from '../render/palette.ts';

export const DUCK_GLB_URL = `${import.meta.env.BASE_URL}models/duck.glb`;

/** Named parts the avatar animates procedurally. */
export interface DuckParts {
  root: THREE.Group;
  body: THREE.Object3D;
  head: THREE.Object3D;
  footL: THREE.Object3D;
  footR: THREE.Object3D;
}

function withOutline(mesh: THREE.Mesh, thickness = 0.035): THREE.Group {
  const g = new THREE.Group();
  g.add(mesh);
  const hull = new THREE.Mesh(mesh.geometry, outlineMaterial());
  hull.scale.setScalar(1 + thickness / 0.3);
  hull.castShadow = false;
  g.add(hull);
  return g;
}

interface DuckGeometry {
  body: THREE.BufferGeometry;
  skull: THREE.BufferGeometry;
  beak: THREE.BufferGeometry;
  eye: THREE.BufferGeometry;
  tuft: THREE.BufferGeometry;
  foot: THREE.BufferGeometry;
}

let geometry: DuckGeometry | null = null;

/** Placeholder geometry is shared by every duck (like the materials), so nothing per duck needs disposing. */
function duckGeometry(): DuckGeometry {
  geometry ??= {
    body: new THREE.CapsuleGeometry(0.34, 0.5, 6, 16),
    skull: new THREE.SphereGeometry(0.27, 20, 14),
    beak: new THREE.BoxGeometry(0.2, 0.08, 0.26),
    eye: new THREE.SphereGeometry(0.045, 10, 8),
    tuft: new THREE.TorusGeometry(0.07, 0.025, 6, 12, Math.PI * 1.4),
    foot: new THREE.BoxGeometry(0.16, 0.06, 0.26),
  };
  return geometry;
}

/** Primitive duck, about 1.75 m tall, feet at y = 0, facing -z. */
export function createPlaceholderDuck(): DuckParts {
  const geo = duckGeometry();
  const yellow = toonMaterial(BRAND.yellow);
  const orange = toonMaterial(BRAND.beak);
  const dark = toonMaterial(BRAND.dark);

  const root = new THREE.Group();
  root.name = 'duck';

  const bodyMesh = new THREE.Mesh(geo.body, yellow);
  bodyMesh.castShadow = true;
  const body = withOutline(bodyMesh);
  body.position.y = 0.72;
  body.scale.set(1, 1, 0.92);
  root.add(body);

  const head = new THREE.Group();
  head.position.set(0, 1.42, -0.04);
  const skull = new THREE.Mesh(geo.skull, yellow);
  skull.castShadow = true;
  head.add(withOutline(skull));
  const beak = new THREE.Mesh(geo.beak, orange);
  beak.position.set(0, -0.04, -0.3);
  beak.castShadow = true;
  head.add(beak);
  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(geo.eye, dark);
    eye.position.set(side * 0.12, 0.06, -0.22);
    head.add(eye);
  }
  const tuft = new THREE.Mesh(geo.tuft, yellow);
  tuft.position.set(0, 0.3, 0.02);
  tuft.rotation.set(0, Math.PI / 2, 0);
  head.add(tuft);
  root.add(head);

  const footL = new THREE.Mesh(geo.foot, orange);
  footL.position.set(-0.14, 0.03, -0.04);
  footL.castShadow = true;
  const footR = new THREE.Mesh(geo.foot, orange);
  footR.position.set(0.14, 0.03, -0.04);
  footR.castShadow = true;
  root.add(footL, footR);

  return { root, body, head, footL, footR };
}

let glbPromise: Promise<THREE.Object3D | null> | null = null;

/** Load duck.glb once if it exists. Resolves to null when there is no file. */
export function loadDuckGlb(): Promise<THREE.Object3D | null> {
  if (glbPromise) return glbPromise;
  glbPromise = (async () => {
    try {
      const head = await fetch(DUCK_GLB_URL, { method: 'HEAD' });
      const type = head.headers.get('content-type') ?? '';
      // Vite's dev server answers unknown paths with index.html, so check the type too.
      if (!head.ok || type.includes('text/html')) return null;
      const gltf = await new GLTFLoader().loadAsync(DUCK_GLB_URL);
      const model = gltf.scene;
      // The art is authored in meters at game size (1.62 m to the head top), so
      // no rescale: the server hitboxes are matched to it. Only put the feet on y = 0.
      const box = new THREE.Box3().setFromObject(model);
      model.position.y -= box.min.y;
      model.rotation.y = Math.PI;
      // The art's toon recipe: two-band toon shading and an inverted-hull outline.
      const skinned: THREE.SkinnedMesh[] = [];
      model.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.castShadow = true;
        mesh.material = Array.isArray(mesh.material) ? mesh.material.map(toonFrom) : toonFrom(mesh.material);
        if ((o as THREE.SkinnedMesh).isSkinnedMesh) skinned.push(o as THREE.SkinnedMesh);
      });
      for (const mesh of skinned) {
        const hull = new THREE.SkinnedMesh(mesh.geometry, skinnedOutlineMaterial());
        hull.bind(mesh.skeleton, mesh.bindMatrix);
        hull.castShadow = false;
        hull.name = `${mesh.name}-outline`;
        mesh.parent?.add(hull);
      }
      const wrapper = new THREE.Group();
      wrapper.name = 'duck-glb';
      wrapper.add(model);
      return wrapper;
    } catch (err) {
      console.warn('[duck] could not load duck.glb, keeping the placeholder', err);
      return null;
    }
  })();
  return glbPromise;
}

/** A per-avatar copy of the loaded GLB (skinned meshes need SkeletonUtils.clone). */
export function cloneDuckGlb(source: THREE.Object3D): THREE.Object3D {
  return cloneSkinned(source);
}
