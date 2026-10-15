/**
 * Weapon models. Uses the art files when present, procedural greybox guns
 * otherwise; both follow the same contract, so nothing else changes when the
 * files land:
 *   models/weapons/rifle.glb, pistol.glb: origin at the grip, barrel +Z,
 *   meters, child nodes Muzzle, Grip, Support (left-hand IK target), Eject.
 *   models/weapons/attach.json: { rifle: {position, quaternion}, pistol: {...} }
 *   in RightHand bone space (used when the duck has animation clips).
 */
import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { WeaponId } from '@qwakk/shared';
import { toonFrom, toonMaterial } from '../render/materials.ts';
import { BRAND } from '../render/palette.ts';

const BASE = `${import.meta.env.BASE_URL}models/weapons/`;
const FILES = ['rifle.glb', 'pistol.glb'] as const;

export interface WeaponInstance {
  root: THREE.Object3D;
  muzzle: THREE.Object3D;
  grip: THREE.Object3D;
  support: THREE.Object3D;
  eject: THREE.Object3D;
}

export interface AttachPose {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
}

interface Library {
  models: (THREE.Object3D | null)[];
  attach: (AttachPose | null)[];
}

let library: Library = { models: [null, null], attach: [null, null] };
let loading: Promise<Library> | null = null;

async function exists(url: string): Promise<boolean> {
  try {
    const r = await fetch(url, { method: 'HEAD' });
    const type = r.headers.get('content-type') ?? '';
    // Vite's dev server answers unknown paths with index.html.
    return r.ok && !type.includes('text/html');
  } catch {
    return false;
  }
}

/** Load whatever weapon art exists. Safe to call many times. */
export function loadWeaponLibrary(): Promise<Library> {
  if (loading) return loading;
  loading = (async () => {
    const loader = new GLTFLoader();
    const models = await Promise.all(
      FILES.map(async (f) => {
        if (!(await exists(BASE + f))) return null;
        try {
          const g = await loader.loadAsync(BASE + f);
          g.scene.traverse((o) => {
            const mesh = o as THREE.Mesh;
            if (!mesh.isMesh) return;
            mesh.castShadow = true;
            // Same toon shading as the ducks. No outline hull: the guns have hard edges, which crack a pushed hull.
            mesh.material = Array.isArray(mesh.material) ? mesh.material.map(toonFrom) : toonFrom(mesh.material);
          });
          return g.scene;
        } catch (err) {
          console.warn('[weapons] could not load', f, err);
          return null;
        }
      }),
    );
    const attach: (AttachPose | null)[] = [null, null];
    if (await exists(BASE + 'attach.json')) {
      try {
        const j = (await (await fetch(BASE + 'attach.json')).json()) as Record<string, { position?: number[]; quaternion?: number[] }>;
        (['rifle', 'pistol'] as const).forEach((k, i) => {
          const a = j[k];
          if (a?.position && a.quaternion) {
            attach[i] = {
              position: new THREE.Vector3().fromArray(a.position),
              quaternion: new THREE.Quaternion().fromArray(a.quaternion),
            };
          }
        });
      } catch (err) {
        console.warn('[weapons] bad attach.json', err);
      }
    }
    library = { models, attach };
    return library;
  })();
  return loading;
}

export function attachPose(weapon: number): AttachPose | null {
  return library.attach[weapon] ?? null;
}

function node(name: string, x: number, y: number, z: number): THREE.Object3D {
  const o = new THREE.Object3D();
  o.name = name;
  o.position.set(x, y, z);
  return o;
}

/** Greybox gun built to the same contract as the art files. */
function procedural(weapon: number): THREE.Object3D {
  const dark = toonMaterial(0x2b2d33);
  const accent = toonMaterial(BRAND.yellow);
  const root = new THREE.Group();
  root.userData.procedural = true;
  const box = (w: number, h: number, d: number, x: number, y: number, z: number, m: THREE.Material) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    root.add(mesh);
  };
  if (weapon === WeaponId.Rifle) {
    box(0.06, 0.08, 0.56, 0, 0.06, 0.16, dark); // receiver and barrel shroud
    box(0.03, 0.03, 0.2, 0, 0.07, 0.52, dark); // barrel
    box(0.05, 0.12, 0.06, 0, -0.02, 0.04, accent); // magazine
    box(0.045, 0.07, 0.18, 0, 0.03, -0.2, dark); // stock
    box(0.04, 0.09, 0.04, 0, -0.03, -0.02, dark); // grip
    box(0.02, 0.03, 0.06, 0, 0.115, 0.12, accent); // sight
    root.add(node('Muzzle', 0, 0.07, 0.63), node('Grip', 0, 0, 0), node('Support', 0, 0.02, 0.24), node('Eject', 0.04, 0.08, 0.1));
  } else {
    box(0.04, 0.06, 0.2, 0, 0.06, 0.06, dark); // slide
    box(0.035, 0.1, 0.045, 0, 0.0, 0, dark); // grip
    box(0.012, 0.012, 0.02, 0, 0.095, 0.13, accent); // front sight
    root.add(node('Muzzle', 0, 0.065, 0.17), node('Grip', 0, 0, 0), node('Support', -0.03, -0.01, 0.02), node('Eject', 0.03, 0.08, 0.05));
  }
  return root;
}

function find(root: THREE.Object3D, name: string, fallback: THREE.Object3D): THREE.Object3D {
  return root.getObjectByName(name) ?? fallback;
}

/** A new instance of a weapon (art if loaded, greybox otherwise). */
export function createWeapon(weapon: number): WeaponInstance {
  const src = library.models[weapon];
  const root = src ? src.clone(true) : procedural(weapon);
  root.name = weapon === WeaponId.Rifle ? 'rifle' : 'pistol';
  return {
    root,
    muzzle: find(root, 'Muzzle', root),
    grip: find(root, 'Grip', root),
    support: find(root, 'Support', root),
    eject: find(root, 'Eject', root),
  };
}

/** Free a greybox gun's own geometry (art guns share geometry with the loaded file: kept). */
export function disposeWeapon(w: WeaponInstance): void {
  if (!w.root.userData.procedural) return;
  w.root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) mesh.geometry.dispose();
  });
}

/** True once real art is loaded for this weapon (avatars swap their greybox gun). */
export function hasWeaponArt(weapon: number): boolean {
  return library.models[weapon] != null;
}
