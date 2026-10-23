/**
 * Hunter art (art/hunters/README.md, published to `public/models/hunters/`):
 * the four hunter looks on one skeleton with their clips in
 * `hunter_anims.glb`, the dog with its own clips, the defeat effects, the
 * decoy and the trap, and `hunters.json` (the contract as data). Loaded once
 * per page when a Hunt Season run starts; anything that fails to load (or is
 * not there) leaves the greybox hunters in place (hunterView.ts), like the
 * duck's placeholder.
 *
 * Materials follow the duck toon recipe: two-band toon shading and a 7.5 mm
 * inverted-hull outline on the skinned meshes.
 */
import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { HunterKind } from '@qwakk/shared';
import { skinnedOutlineMaterial, toonFrom } from '../../render/materials.ts';

const BASE = `${import.meta.env.BASE_URL}models/hunters/`;

export const HUNTER_FILES: Record<number, string> = {
  [HunterKind.Rifleman]: 'hunter_rifleman.glb',
  [HunterKind.Trapper]: 'hunter_trapper.glb',
  [HunterKind.Decoy]: 'hunter_decoy.glb',
  [HunterKind.Boss]: 'hunter_boss.glb',
};

export interface AttachPose {
  node: string;
  position: [number, number, number];
  quaternion: [number, number, number, number];
}

export interface HunterManifest {
  attach: { hunter: Record<string, AttachPose>; dog: Record<string, AttachPose> };
  lods: { until: number[] };
  clips: Record<string, { authoredSpeed?: number; seconds: number; loop: boolean }>;
  dog: { clips: Record<string, { authoredSpeed?: number; seconds: number; loop: boolean }> };
}

export interface HunterArt {
  manifest: HunterManifest;
  /** Per kind: the model (feet on y = 0, facing the sim's -z), cloned per hunter. */
  models: Map<number, THREE.Object3D>;
  /** Hunter clips (hunter_anims.glb) and the dog's own clips. */
  clips: Map<string, THREE.AnimationClip>;
  dogClips: Map<string, THREE.AnimationClip>;
  stars: THREE.Object3D | null;
  poof: THREE.Object3D | null;
  decoy: THREE.Object3D | null;
  trapOpen: THREE.Object3D | null;
  trapSprung: THREE.Object3D | null;
}

let promise: Promise<HunterArt | null> | null = null;

async function exists(url: string): Promise<boolean> {
  try {
    const r = await fetch(url, { method: 'HEAD' });
    return r.ok && !(r.headers.get('content-type') ?? '').includes('text/html');
  } catch {
    return false;
  }
}

/** Toon materials and the skinned outline, as on the ducks. */
function dress(root: THREE.Object3D, outline: boolean): void {
  const skinned: THREE.SkinnedMesh[] = [];
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = true;
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(toonFrom) : toonFrom(mesh.material);
    if ((o as THREE.SkinnedMesh).isSkinnedMesh) skinned.push(o as THREE.SkinnedMesh);
  });
  if (!outline) return;
  for (const mesh of skinned) {
    const hull = new THREE.SkinnedMesh(mesh.geometry, skinnedOutlineMaterial());
    hull.bind(mesh.skeleton, mesh.bindMatrix);
    hull.castShadow = false;
    hull.name = `${mesh.name}-outline`;
    mesh.parent?.add(hull);
  }
}

/** The character turned to face the sim's forward (-z), the art faces +z (like the ducks). */
function facing(scene: THREE.Object3D): THREE.Object3D {
  const wrap = new THREE.Group();
  scene.rotation.y = Math.PI;
  wrap.add(scene);
  return wrap;
}

/** Load every hunter file once. Null when the art is not there (greybox hunters). */
export function loadHunterArt(): Promise<HunterArt | null> {
  promise ??= (async () => {
    try {
      const res = await fetch(`${BASE}hunters.json`);
      if (!res.ok || (res.headers.get('content-type') ?? '').includes('text/html')) return null;
      const manifest = (await res.json()) as HunterManifest;
      if (!(await exists(`${BASE}hunter_anims.glb`))) return null;
      const loader = new GLTFLoader();
      const load = (f: string) => loader.loadAsync(`${BASE}${f}`);
      const [anims, dog, fx, decoy, trap, ...looks] = await Promise.all([
        load('hunter_anims.glb'),
        load('dog.glb'),
        load('hunter_fx.glb').catch(() => null),
        load('decoy.glb').catch(() => null),
        load('trap.glb').catch(() => null),
        ...Object.values(HUNTER_FILES).map((f) => load(f)),
      ]);
      const models = new Map<number, THREE.Object3D>();
      Object.keys(HUNTER_FILES).forEach((k, i) => {
        const g = looks[i]!;
        dress(g.scene, true);
        models.set(Number(k), facing(g.scene));
      });
      dress(dog.scene, true);
      models.set(HunterKind.Dog, facing(dog.scene));
      const clips = new Map(anims.animations.map((c) => [c.name, c] as const));
      const dogClips = new Map(dog.animations.map((c) => [c.name, c] as const));
      const pick = (g: { scene: THREE.Object3D } | null, name: string): THREE.Object3D | null => {
        const o = g?.scene.getObjectByName(name) ?? null;
        if (o) dress(o, false);
        return o;
      };
      const trapRoot = trap?.scene ?? null;
      if (trapRoot) dress(trapRoot, false);
      return {
        manifest,
        models,
        clips,
        dogClips,
        stars: pick(fx, 'Stars'),
        poof: pick(fx, 'Poof'),
        decoy: decoy ? (dress(decoy.scene, false), decoy.scene) : null,
        trapOpen: trapRoot?.getObjectByName('Open') ?? null,
        trapSprung: trapRoot?.getObjectByName('Sprung') ?? null,
      };
    } catch (err) {
      console.warn('[hunters] art not loaded, using the greybox hunters', err);
      promise = null;
      return null;
    }
  })();
  return promise;
}
