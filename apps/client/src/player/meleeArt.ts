/**
 * Hunt Season katana art (art/melee/README.md, published to
 * `public/models/melee/`): the katana and its scabbard (`katana.glb`: Blade,
 * Grip, Tip, TrailStart, TrailEnd, KatanaSeat), the duck's melee clips
 * (`duck_melee_anims.glb`, the same skeleton as duck.glb), the effects
 * (`melee_fx.glb`: SlashArc, Shockwave, EliteRing, Feather) and the contract
 * as data (`melee.json`: attach poses, clip events, arcs, the dash curve).
 * Loaded once per page when a Hunt Season run starts; whatever is missing
 * leaves the greybox in place (a box blade, procedural swing arcs).
 */
import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { toonFrom, toonMaterial } from '../render/materials.ts';

const BASE = `${import.meta.env.BASE_URL}models/melee/`;

export interface AttachPose {
  node: string;
  position: [number, number, number];
  quaternion: [number, number, number, number];
}

export interface MeleeManifest {
  attach: { katana: AttachPose; scabbard: AttachPose; seat: AttachPose };
  clips: Record<string, { seconds: number; loop: boolean; layer: string; events?: Record<string, number> }>;
  upperBones: string[];
}

export interface MeleeArt {
  manifest: MeleeManifest | null;
  /** The katana (origin at the grip, blade along +Y), cloned per duck. Greybox: a box blade. */
  katana: THREE.Object3D;
  /** The scabbard (with its KatanaSeat), cloned per duck; null in greybox. */
  scabbard: THREE.Object3D | null;
  /** Clips by name, the upper body halves as `Name@upper`. Empty in greybox. */
  clips: Map<string, THREE.AnimationClip>;
  /** Effects (additive, vertex colored), cloned per use. Null in greybox (procedural rings stand in). */
  slashArc: THREE.Object3D | null;
  shockwave: THREE.Object3D | null;
  eliteRing: THREE.Object3D | null;
  feather: THREE.Object3D | null;
  greybox: boolean;
}

let promise: Promise<MeleeArt> | null = null;
let loaded: MeleeArt | null = null;

/** A plain box katana: the readable part is the long bright blade (greybox). */
function greyKatana(): THREE.Object3D {
  const g = new THREE.Group();
  g.name = 'Katana';
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.82, 0.05), toonMaterial(0xdfe7ee));
  blade.position.y = 0.48;
  blade.name = 'Blade';
  const guard = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.02, 10), toonMaterial(0xffd43b));
  guard.position.y = 0.06;
  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.2, 8), toonMaterial(0x151619));
  const start = new THREE.Object3D();
  start.name = 'TrailStart';
  start.position.y = 0.16;
  const end = new THREE.Object3D();
  end.name = 'TrailEnd';
  end.position.y = 0.86;
  g.add(blade, guard, grip, start, end);
  return g;
}

/** The additive material the effects ask for (vertex colors hold the glow ramp). */
export function fxMaterial(): THREE.MeshBasicNodeMaterial {
  return new THREE.MeshBasicNodeMaterial({ vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
}

function exists(url: string): Promise<boolean> {
  return fetch(url, { method: 'HEAD' })
    .then((r) => r.ok && !(r.headers.get('content-type') ?? '').includes('text/html'))
    .catch(() => false);
}

export function loadMeleeArt(): Promise<MeleeArt> {
  promise ??= (async (): Promise<MeleeArt> => {
    const grey: MeleeArt = { manifest: null, katana: greyKatana(), scabbard: null, clips: new Map(), slashArc: null, shockwave: null, eliteRing: null, feather: null, greybox: true };
    try {
      const res = await fetch(`${BASE}melee.json`);
      if (!res.ok || (res.headers.get('content-type') ?? '').includes('text/html')) return (loaded = grey);
      const manifest = (await res.json()) as MeleeManifest;
      if (!(await exists(`${BASE}katana.glb`))) return (loaded = grey);
      const loader = new GLTFLoader();
      const [kat, anims, fx] = await Promise.all([
        loader.loadAsync(`${BASE}katana.glb`),
        loader.loadAsync(`${BASE}duck_melee_anims.glb`).catch(() => null),
        loader.loadAsync(`${BASE}melee_fx.glb`).catch(() => null),
      ]);
      kat.scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        m.material = Array.isArray(m.material) ? m.material.map(toonFrom) : toonFrom(m.material);
        m.castShadow = true;
      });
      const katana = kat.scene.getObjectByName('Katana') ?? grey.katana;
      katana.removeFromParent();
      katana.position.set(0, 0, 0);
      katana.quaternion.identity();
      const scabbard = kat.scene.getObjectByName('Scabbard') ?? null;
      scabbard?.removeFromParent();
      const clips = new Map<string, THREE.AnimationClip>();
      const upper = new Set(manifest.upperBones ?? []);
      for (const c of anims?.animations ?? []) {
        clips.set(c.name, c);
        clips.set(`${c.name}@upper`, new THREE.AnimationClip(`${c.name}@upper`, c.duration, c.tracks.filter((t) => upper.has(t.name.split('.')[0] ?? ''))));
        clips.set(`${c.name}@lower`, new THREE.AnimationClip(`${c.name}@lower`, c.duration, c.tracks.filter((t) => !upper.has(t.name.split('.')[0] ?? ''))));
      }
      const pick = (name: string): THREE.Object3D | null => {
        const o = fx?.scene.getObjectByName(name) ?? null;
        if (!o) return null;
        o.removeFromParent();
        o.traverse((x) => {
          const m = x as THREE.Mesh;
          if (!m.isMesh) return;
          const src = m.material as THREE.MeshStandardMaterial;
          // The feather is a toon pickup; the rest glow (additive, vertex colors).
          m.material = name === 'Feather' ? toonFrom(src) : fxMaterial();
          m.castShadow = false;
          m.frustumCulled = false;
        });
        return o;
      };
      loaded = { manifest, katana, scabbard, clips, slashArc: pick('SlashArc'), shockwave: pick('Shockwave'), eliteRing: pick('EliteRing'), feather: pick('Feather'), greybox: false };
      return loaded;
    } catch (err) {
      console.warn('[melee] art not loaded, greybox katana', err);
      return (loaded = grey);
    }
  })();
  return promise;
}

/** The art if it is in (null before the first load finished). */
export function meleeArt(): MeleeArt | null {
  return loaded;
}
