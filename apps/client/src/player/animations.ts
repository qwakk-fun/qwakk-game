/**
 * Animation clips from models/duck_anims.glb (same skeleton as duck.glb).
 * Clips are split into a lower-body set (locomotion drives hips and legs) and
 * an upper-body set (Spine and everything above: aim, reload), so the aim
 * layer fully overrides the torso while the legs keep walking.
 */
import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export const REQUIRED_CLIPS = [
  'Idle',
  'Walk_F', 'Walk_B', 'Walk_L', 'Walk_R',
  'Run_F', 'Run_B', 'Run_L', 'Run_R',
  'Sprint',
  'Crouch_Idle', 'Crouch_Walk',
  'Jump_Start', 'Fall_Loop', 'Land',
  'Death_A', 'Death_B',
  'Hit_React',
  'Rifle_Aim', 'Pistol_Aim',
  'Rifle_Reload', 'Pistol_Reload',
] as const;
export const OPTIONAL_CLIPS = ['Rifle_Fire', 'Pistol_Fire', 'Quack', 'Equip'] as const;

/** Bones of the upper-body layer: Spine and everything below it in the hierarchy (arms, neck, head, jaw). */
export const UPPER_BONES = new Set([
  'Spine', 'Spine1', 'Spine2', 'Neck', 'Head', 'Jaw', 'HeadTop_End',
  'LeftShoulder', 'LeftArm', 'LeftForeArm', 'LeftHand',
  'RightShoulder', 'RightArm', 'RightForeArm', 'RightHand',
  'LeftHandThumb1', 'LeftHandThumb2', 'LeftHandThumb3', 'LeftHandIndex1', 'LeftHandIndex2', 'LeftHandIndex3', 'LeftHandMiddle1', 'LeftHandMiddle2', 'LeftHandMiddle3',
  'RightHandThumb1', 'RightHandThumb2', 'RightHandThumb3', 'RightHandIndex1', 'RightHandIndex2', 'RightHandIndex3', 'RightHandMiddle1', 'RightHandMiddle2', 'RightHandMiddle3',
]);

export interface ClipSet {
  /** Full clips by name. */
  full: Map<string, THREE.AnimationClip>;
  /** Lower-body only (hips and legs). */
  lower: Map<string, THREE.AnimationClip>;
  /** Upper-body only. */
  upper: Map<string, THREE.AnimationClip>;
  missing: string[];
}

const URL = `${import.meta.env.BASE_URL}models/duck_anims.glb`;
let promise: Promise<ClipSet | null> | null = null;
let loaded: ClipSet | null = null;

function boneOf(track: THREE.KeyframeTrack): string {
  return track.name.split('.')[0] ?? '';
}

function split(clip: THREE.AnimationClip, upper: boolean): THREE.AnimationClip {
  const tracks = clip.tracks.filter((t) => UPPER_BONES.has(boneOf(t)) === upper);
  return new THREE.AnimationClip(`${clip.name}${upper ? '@upper' : '@lower'}`, clip.duration, tracks);
}

/** Load the clips if the file exists. Resolves to null when it does not. */
export function loadClips(): Promise<ClipSet | null> {
  if (promise) return promise;
  promise = (async () => {
    try {
      const head = await fetch(URL, { method: 'HEAD' });
      if (!head.ok || (head.headers.get('content-type') ?? '').includes('text/html')) return null;
      const gltf = await new GLTFLoader().loadAsync(URL);
      const full = new Map<string, THREE.AnimationClip>();
      for (const c of gltf.animations) full.set(c.name, c);
      const lower = new Map<string, THREE.AnimationClip>();
      const upper = new Map<string, THREE.AnimationClip>();
      for (const [name, c] of full) {
        lower.set(name, split(c, false));
        upper.set(name, split(c, true));
      }
      const missing = REQUIRED_CLIPS.filter((n) => !full.has(n));
      if (missing.length) console.warn('[anims] duck_anims.glb is missing clips:', missing.join(', '));
      loaded = { full, lower, upper, missing };
      return loaded;
    } catch (err) {
      console.warn('[anims] could not load duck_anims.glb, using procedural animation', err);
      return null;
    }
  })();
  return promise;
}

export function clips(): ClipSet | null {
  return loaded;
}
