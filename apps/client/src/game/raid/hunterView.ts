/**
 * How a hunter looks on screen: the real model from the art (hunterAssets.ts:
 * skinned, layered clips, LODs, the defeat stars and poof) or, until it loads
 * or when it is missing, a greybox hunter (a capsule with a blaze-orange cap
 * and a gun), both behind one interface. The telegraphs are part of it: the
 * rifleman's laser and glint, the boss's wind-up glint, and a small health bar.
 * Hunters face the sim's -z at yaw 0 like the ducks.
 */
import * as THREE from 'three/webgpu';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { HunterAct, HunterKind } from '@qwakk/shared';
import { toonMaterial } from '../../render/materials.ts';
import type { HunterArt } from './hunterAssets.ts';

export interface HunterLook {
  readonly object: THREE.Object3D;
  update(dt: number, act: number, speed: number, pitch: number, camDist: number): void;
  /** A hit landed (a short flinch). */
  hit(): void;
  /** Where its shots start (world). */
  muzzle(out: THREE.Vector3): THREE.Vector3;
  /** The point above its head (health bar). */
  headTop(out: THREE.Vector3): THREE.Vector3;
  dispose(): void;
}

const BLAZE = 0xff6a13;
const CAMO: Record<number, number> = { [HunterKind.Rifleman]: 0x5d6b3d, [HunterKind.Trapper]: 0x6b5236, [HunterKind.Decoy]: 0x4f6a52, [HunterKind.Boss]: 0x5a3b2a, [HunterKind.Dog]: 0xb07a3c, [HunterKind.Sniper]: 0x3f5a2c };

/** The sniper's ghillie hood: a tuft of leafy blobs over the head (it wears the rifleman's body). */
function ghillie(scale = 1): THREE.Group {
  const g = new THREE.Group();
  const mats = [toonMaterial(0x4b6b2f), toonMaterial(0x6f8a3a), toonMaterial(0x3a5226)];
  const blobs: [number, number, number, number][] = [[0, 0.06, 0, 0.17], [0.11, 0.0, 0.05, 0.11], [-0.11, 0.01, 0.04, 0.12], [0.04, 0.02, 0.13, 0.1], [-0.05, -0.02, -0.12, 0.12], [0.08, -0.06, -0.08, 0.09]];
  blobs.forEach(([x, y, z, r], i) => {
    const m = new THREE.Mesh(new THREE.IcosahedronGeometry(r * scale, 0), mats[i % mats.length]!);
    m.position.set(x * scale, y * scale, z * scale);
    g.add(m);
  });
  return g;
}

/** Greybox: simple shapes with the readable parts (the cap, the gun), and procedural motion. */
class GreyboxHunter implements HunterLook {
  readonly object = new THREE.Group();
  private readonly body = new THREE.Group();
  private readonly gun = new THREE.Group();
  private readonly hat = new THREE.Group();
  private readonly muzzleTip = new THREE.Object3D();
  private readonly top = new THREE.Object3D();
  private readonly kind: number;
  private t = Math.random() * 10;
  private fall = 0;
  private flinch = 0;
  private fire = 0;
  private lastAct = -1;

  constructor(kind: number) {
    this.kind = kind;
    const camo = toonMaterial(CAMO[kind] ?? 0x5d6b3d);
    const blaze = toonMaterial(BLAZE);
    const skin = toonMaterial(0xe8b48f);
    const dark = toonMaterial(0x2a2a2e);
    const dog = kind === HunterKind.Dog;
    const s = kind === HunterKind.Boss ? 1.24 : 1;
    if (dog) {
      const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.55, 4, 10), camo);
      torso.rotation.x = Math.PI / 2;
      torso.position.set(0, 0.62, 0.05);
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 12, 10), camo);
      head.position.set(0, 0.88, -0.46);
      const vest = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.18, 0.4), blaze);
      vest.position.set(0, 0.72, 0);
      for (const [x, z] of [[-0.12, -0.25], [0.12, -0.25], [-0.12, 0.3], [0.12, 0.3]] as const) {
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.5, 6), camo);
        leg.position.set(x, 0.25, z);
        this.body.add(leg);
      }
      this.body.add(torso, head, vest);
      this.top.position.set(0, 1.15, -0.3);
      this.muzzleTip.position.set(0, 0.85, -0.6);
    } else {
      const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.24 * s, 0.85 * s, 4, 12), camo);
      torso.position.y = 0.78 * s;
      const vest = new THREE.Mesh(new THREE.CylinderGeometry(0.26 * s, 0.26 * s, 0.4 * s, 12), blaze);
      vest.position.y = 1.05 * s;
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.18 * s, 14, 10), skin);
      head.position.y = 1.55 * s;
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.17 * s, 0.19 * s, 0.14 * s, 12), blaze);
      const brim = new THREE.Mesh(new THREE.BoxGeometry(0.3 * s, 0.03 * s, 0.2 * s), blaze);
      brim.position.set(0, -0.05 * s, -0.16 * s);
      this.hat.add(cap, brim);
      if (kind === HunterKind.Sniper) this.hat.add(ghillie());
      this.hat.position.y = 1.72 * s;
      const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.08, kind === HunterKind.Boss ? 1.1 : 0.95), dark);
      barrel.position.z = -0.4;
      this.gun.add(barrel);
      this.gun.position.set(0.22 * s, 1.25 * s, -0.15);
      this.muzzleTip.position.set(0, 0, -0.9);
      this.gun.add(this.muzzleTip);
      this.body.add(torso, vest, head, this.hat, this.gun);
      this.top.position.y = 1.97 * s + 0.1;
    }
    this.body.traverse((o) => ((o as THREE.Mesh).castShadow = true));
    this.object.add(this.body, this.top);
    if (dog) this.object.add(this.muzzleTip);
  }

  update(dt: number, act: number, speed: number, pitch: number): void {
    this.t += dt * (1 + speed);
    if (act !== this.lastAct && act === HunterAct.Fire) this.fire = 1;
    this.lastAct = act;
    this.fire = Math.max(0, this.fire - dt * 6);
    this.flinch = Math.max(0, this.flinch - dt * 5);
    const down = act === HunterAct.Down;
    this.fall = down ? Math.min(1, this.fall + dt * 2.2) : 0;
    const moving = act === HunterAct.Walk || act === HunterAct.Run;
    this.body.position.y = moving ? Math.abs(Math.sin(this.t * 5)) * 0.06 : 0;
    // Falls over backwards (a toony plank), the hat pops off and lands in front.
    this.body.rotation.x = this.kind === HunterKind.Dog ? 0 : this.fall * (Math.PI / 2.1) + this.flinch * 0.15;
    this.body.rotation.z = this.kind === HunterKind.Dog ? this.fall * Math.PI : 0;
    this.hat.position.z = -this.fall * 1.2;
    this.hat.position.y = (this.kind === HunterKind.Boss ? 2.13 : 1.72) + Math.sin(Math.min(1, this.fall) * Math.PI) * 0.8;
    const aiming = act === HunterAct.Aim || act === HunterAct.Fire;
    this.gun.rotation.x = aiming ? pitch + this.fire * 0.25 : act === HunterAct.Reload ? 0.9 : act === HunterAct.Hammer ? Math.sin(this.t * 8) * 0.8 - 0.6 : -0.6;
  }

  hit(): void {
    this.flinch = 1;
  }

  muzzle(out: THREE.Vector3): THREE.Vector3 {
    return this.muzzleTip.getWorldPosition(out);
  }

  headTop(out: THREE.Vector3): THREE.Vector3 {
    return this.top.getWorldPosition(out);
  }

  dispose(): void {
    this.object.removeFromParent();
    this.object.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
  }
}

/** Clips split into a lower body part and an upper body part (Spine and below), so aim, reload and throw layer over walking. */
interface SplitClip {
  lower: THREE.AnimationClip;
  upper: THREE.AnimationClip;
}

const splitCache = new WeakMap<THREE.AnimationClip, SplitClip>();

function splitClip(clip: THREE.AnimationClip, upperBones: Set<string>): SplitClip {
  let s = splitCache.get(clip);
  if (!s) {
    const bone = (t: THREE.KeyframeTrack): string => t.name.split('.')[0] ?? '';
    s = {
      lower: new THREE.AnimationClip(`${clip.name}@lower`, clip.duration, clip.tracks.filter((t) => !upperBones.has(bone(t)))),
      upper: new THREE.AnimationClip(`${clip.name}@upper`, clip.duration, clip.tracks.filter((t) => upperBones.has(bone(t)))),
    };
    splitCache.set(clip, s);
  }
  return s;
}

/** The real hunter: a skinned clone, a mixer with a body layer and an upper layer, LODs, the defeat effects attached. */
class ModelHunter implements HunterLook {
  readonly object = new THREE.Group();
  private readonly mixer: THREE.AnimationMixer;
  private readonly actions = new Map<string, THREE.AnimationAction>();
  private readonly weights = new Map<THREE.AnimationAction, number>();
  private readonly lods: THREE.Object3D[][] = [[], [], []];
  private readonly lodUntil: number[];
  private readonly spine: THREE.Object3D | null;
  private readonly muzzleNode: THREE.Object3D | null;
  private readonly topNode: THREE.Object3D | null;
  private readonly clips: Map<string, THREE.AnimationClip>;
  private readonly upperBones = new Set<string>();
  private readonly dog: boolean;
  private base = '';
  private upper = '';
  private lastAct = -1;
  private oneShotLeft = 0;
  private flinch = 0;

  constructor(kind: number, art: HunterArt, phone: boolean) {
    this.dog = kind === HunterKind.Dog;
    // The sniper wears the rifleman's model with a ghillie hood on its head.
    const model = cloneSkinned(art.models.get(kind === HunterKind.Sniper ? HunterKind.Rifleman : kind)!);
    if (kind === HunterKind.Sniper) {
      const head = model.getObjectByName('HeadTop') ?? model.getObjectByName('Head');
      const hood = ghillie();
      if (head) head.add(hood);
      else {
        hood.position.y = 1.72;
        model.add(hood);
      }
    }
    this.object.add(model);
    this.clips = this.dog ? art.dogClips : art.clips;
    this.mixer = new THREE.AnimationMixer(model);
    this.lodUntil = art.manifest.lods.until.map((d) => d * (phone ? 0.6 : 1));
    model.traverse((o) => {
      const m = /^LOD(\d)/.exec(o.name);
      if (m && (o as THREE.Mesh).isMesh) this.lods[Number(m[1])]?.push(o);
    });
    this.spine = model.getObjectByName('Spine2') ?? null;
    this.muzzleNode = model.getObjectByName('Muzzle') ?? model.getObjectByName('Head') ?? null;
    this.topNode = model.getObjectByName('HeadTop') ?? null;
    model.getObjectByName('Spine')?.traverse((o) => this.upperBones.add(o.name));
    // The defeat stars and poof, and the decoy in the thrower's hand, on their joints (hidden until a clip scales them up).
    const attach = this.dog ? art.manifest.attach.dog : art.manifest.attach.hunter;
    for (const [name, src] of [['Stars', art.stars], ['Poof', art.poof], ['Decoy', art.decoy]] as const) {
      const pose = attach[name];
      if (!pose || !src) continue;
      const joint = model.getObjectByName(pose.node);
      if (!joint) continue;
      const c = src.clone();
      c.position.fromArray(pose.position);
      c.quaternion.fromArray(pose.quaternion);
      joint.add(c);
    }
    this.play('Idle', 'Idle');
  }

  private action(name: string): THREE.AnimationAction | null {
    let a = this.actions.get(name);
    if (a) return a;
    const [clipName, part] = name.split('@') as [string, string | undefined];
    const clip = this.clips.get(clipName);
    if (!clip) return null;
    const use = part && !this.dog ? splitClip(clip, this.upperBones)[part as 'lower' | 'upper'] : clip;
    a = this.mixer.clipAction(use);
    const once = /^(Fire|Reload|Throw|Hit|Defeat|Bite|Whistle)$/.test(clipName);
    if (once) {
      a.setLoop(THREE.LoopOnce, 1);
      a.clampWhenFinished = true;
    }
    a.setEffectiveWeight(0);
    a.play();
    this.actions.set(name, a);
    this.weights.set(a, 0);
    return a;
  }

  /** The body clip and the upper body clip ('' for the body clip's own upper half). */
  private play(base: string, upper: string, restart = false): void {
    if (this.dog) upper = '';
    const baseKey = this.dog ? base : `${base}@lower`;
    const upperKey = this.dog ? '' : upper ? `${upper}@upper` : `${base}@upper`;
    for (const [key, a] of this.actions) this.weights.set(a, key === baseKey || key === upperKey ? 1 : 0);
    for (const key of [baseKey, upperKey]) {
      if (!key) continue;
      const a = this.action(key);
      if (!a) continue;
      this.weights.set(a, 1);
      if (restart) a.reset().play();
    }
    this.base = base;
    this.upper = upper;
  }

  update(dt: number, act: number, speed: number, pitch: number, camDist: number): void {
    const changed = act !== this.lastAct;
    this.lastAct = act;
    let base = this.base;
    let upper = this.upper;
    let restart = false;
    const move = speed > 0.2 ? (speed > 2.6 ? 'Run' : 'Walk') : 'Idle';
    switch (act) {
      case HunterAct.Down:
        base = 'Defeat';
        upper = '';
        restart = changed;
        break;
      case HunterAct.Bite:
        base = this.dog ? 'Bite' : move;
        restart = changed;
        break;
      case HunterAct.Whistle:
        base = 'Whistle';
        upper = '';
        restart = changed;
        break;
      case HunterAct.Hammer:
        base = this.dog ? 'Bite' : 'Taunt';
        upper = '';
        restart = changed || (this.actions.get(this.dog ? 'Bite' : 'Taunt@lower')?.isRunning() === false);
        break;
      case HunterAct.Aim:
      case HunterAct.Kneel:
        base = this.dog ? 'Idle' : move;
        upper = act === HunterAct.Aim ? 'Aim' : '';
        break;
      case HunterAct.Fire:
        base = move;
        upper = 'Fire';
        restart = changed;
        break;
      case HunterAct.Reload:
        base = move;
        upper = 'Reload';
        restart = changed;
        break;
      case HunterAct.Throw:
        base = move;
        upper = 'Throw';
        restart = changed;
        break;
      default:
        base = this.dog ? (speed > 0.2 ? 'Run' : 'Idle') : move;
        upper = '';
    }
    if (restart || base !== this.base || upper !== this.upper) this.play(base, upper, restart);
    // Clip speed follows the ground speed (authored 1.4 m/s walk, 3.6 run; the dog 4.5).
    const authored = this.dog ? 4.5 : base === 'Run' ? 3.6 : 1.4;
    for (const [key, a] of this.actions) {
      const target = this.weights.get(a) ?? 0;
      const w = a.getEffectiveWeight();
      a.setEffectiveWeight(w + (target - w) * Math.min(1, dt * 12));
      if (key.startsWith('Walk') || key.startsWith('Run')) a.timeScale = Math.max(0.4, speed / authored);
    }
    this.mixer.update(dt);
    this.flinch = Math.max(0, this.flinch - dt * 6);
    // Aim pitch: the whole upper body (hands on the gun) turns about the model's x axis; negative raises the muzzle.
    if (this.spine && (act === HunterAct.Aim || act === HunterAct.Fire)) this.spine.rotateX(-pitch * 0.9);
    if (this.spine && this.flinch > 0) this.spine.rotateX(this.flinch * 0.2);
    let lod = 2;
    if (camDist < (this.lodUntil[0] ?? 18)) lod = 0;
    else if (camDist < (this.lodUntil[1] ?? 40)) lod = 1;
    this.lods.forEach((list, i) => list.forEach((o) => (o.visible = i === lod)));
  }

  hit(): void {
    this.flinch = 1;
  }

  muzzle(out: THREE.Vector3): THREE.Vector3 {
    return this.muzzleNode ? this.muzzleNode.getWorldPosition(out) : this.object.getWorldPosition(out).setY(out.y + 1.3);
  }

  headTop(out: THREE.Vector3): THREE.Vector3 {
    if (this.topNode) return this.topNode.getWorldPosition(out).setY(out.y + 0.12);
    return this.object.getWorldPosition(out).setY(out.y + (this.dog ? 1.15 : 2.05));
  }

  dispose(): void {
    this.mixer.stopAllAction();
    this.object.removeFromParent();
  }
}

/** A hunter look: the model when the art is in, the greybox otherwise. */
export function createHunterLook(kind: number, art: HunterArt | null, phone: boolean): HunterLook {
  const body = kind === HunterKind.Sniper ? HunterKind.Rifleman : kind;
  if (art && art.models.has(body) && (kind === HunterKind.Dog ? art.dogClips.size > 0 : art.clips.size > 0)) {
    try {
      return new ModelHunter(kind, art, phone);
    } catch (err) {
      console.warn('[hunters] model failed, greybox instead', err);
    }
  }
  return new GreyboxHunter(kind);
}

export function isGreybox(look: HunterLook): boolean {
  return look instanceof GreyboxHunter;
}
