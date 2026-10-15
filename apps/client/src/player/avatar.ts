/**
 * One duck in the scene: model, weapon, and the animation state machine.
 *
 * Three layers, in order, every frame:
 * 1. Clips (when models/duck_anims.glb exists): lower body blends 8-way
 *    locomotion by velocity (walk, run, sprint, crouch, air), upper body plays
 *    the weapon's aim pose or its reload. Death clips take over the whole body.
 * 2. Without clips: a procedural pose from the T-pose rest (leg swing, crouch).
 * 3. Procedural on top of both: spine and neck pitch from the camera, recoil
 *    kick, and hand IK (left hand to the gun's Support node; in procedural
 *    mode the right hand to its Grip too).
 *
 * The placeholder duck (no skeleton) just carries the gun.
 */
import * as THREE from 'three/webgpu';
import { BODY, WeaponId } from '@qwakk/shared';
import { clips, type ClipSet } from './animations.ts';
import { cloneDuckGlb, createPlaceholderDuck, type DuckParts } from './duckModel.ts';
import { rotateBoneWorld, twoBoneIK } from './ik.ts';
import { attachPose, createWeapon, disposeWeapon, type WeaponInstance } from './weaponModel.ts';

export interface AvatarPose {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  /** 0 standing to 1 crouched (smoothed here). */
  crouch: number;
  grounded: boolean;
  alive: boolean;
  weapon: number;
  /** 0 idle, 1 reloading, 2 equipping. */
  act: number;
}

const BONES = [
  'Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head',
  'LeftArm', 'LeftForeArm', 'LeftHand', 'RightArm', 'RightForeArm', 'RightHand',
  'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'RightUpLeg', 'RightLeg', 'RightFoot',
] as const;
type BoneName = (typeof BONES)[number];

interface Rig {
  bones: Record<BoneName, THREE.Bone>;
  all: THREE.Bone[];
  rest: THREE.Quaternion[];
  mixer: THREE.AnimationMixer | null;
  lower: Map<string, THREE.AnimationAction>;
  upper: Map<string, THREE.AnimationAction>;
  full: Map<string, THREE.AnimationAction>;
}

/** Weapon hold in avatar space (forward is -z) for the procedural pose: grip offset from the chest pivot. */
const HOLD: Record<number, { grip: THREE.Vector3; yaw: number }> = {
  [WeaponId.Rifle]: { grip: new THREE.Vector3(0.12, -0.06, -0.14), yaw: 0.12 },
  [WeaponId.Pistol]: { grip: new THREE.Vector3(0.04, 0.02, -0.36), yaw: 0.05 },
};
const PIVOT_Y = 0.98;
/** Full-body one-shot accents and their peak weights. */
const ONE_SHOTS: readonly (readonly [string, number])[] = [['Jump_Start', 0.8], ['Land', 0.5], ['Hit_React', 0.6]];

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _axis = new THREE.Vector3();
const _right = new THREE.Vector3();
const _down = new THREE.Vector3(0, -0.3, 0);

export class Avatar {
  readonly object = new THREE.Group();
  private readonly body = new THREE.Group();
  private parts: DuckParts | null;
  private glb: THREE.Object3D | null = null;
  private rig: Rig | null = null;
  private readonly holder = new THREE.Group();
  private readonly weapons: WeaponInstance[];
  private weapon = -1;
  private crouchBlend = 0;
  private walkPhase = 0;
  private lastX = Number.NaN;
  private lastZ = Number.NaN;
  private velX = 0;
  private velZ = 0;
  private airTime = 0;
  private recoil = 0;
  private deathT = -1;
  private lastAct = 0;
  private wasGrounded = true;

  constructor() {
    this.object.add(this.body);
    this.parts = createPlaceholderDuck();
    this.body.add(this.parts.root);
    this.object.add(this.holder);
    this.weapons = [createWeapon(WeaponId.Rifle), createWeapon(WeaponId.Pistol)];
    for (const w of this.weapons) {
      w.root.visible = false;
      this.holder.add(w.root);
    }
  }

  /** Swap the placeholder for the real duck model (and its clips, if loaded). */
  setModel(source: THREE.Object3D): void {
    if (this.parts) this.body.remove(this.parts.root);
    if (this.glb) this.body.remove(this.glb);
    this.parts = null;
    this.glb = cloneDuckGlb(source);
    this.body.add(this.glb);
    this.rig = this.buildRig(this.glb, clips());
    this.weapon = -1; // re-parent the weapon on the next update
  }

  /** Replace greybox guns with freshly loaded art. */
  refreshWeapons(): void {
    for (let i = 0; i < this.weapons.length; i++) {
      const old = this.weapons[i] as WeaponInstance;
      old.root.removeFromParent();
      disposeWeapon(old);
      const w = createWeapon(i);
      w.root.visible = false;
      this.holder.add(w.root);
      this.weapons[i] = w;
    }
    this.weapon = -1;
  }

  private buildRig(root: THREE.Object3D, set: ClipSet | null): Rig | null {
    const found: Partial<Record<BoneName, THREE.Bone>> = {};
    const all: THREE.Bone[] = [];
    root.traverse((o) => {
      if ((o as THREE.Bone).isBone) {
        all.push(o as THREE.Bone);
        if ((BONES as readonly string[]).includes(o.name)) found[o.name as BoneName] = o as THREE.Bone;
      }
    });
    if (BONES.some((b) => !found[b])) return null;
    const rig: Rig = { bones: found as Record<BoneName, THREE.Bone>, all, rest: all.map((b) => b.quaternion.clone()), mixer: null, lower: new Map(), upper: new Map(), full: new Map() };
    if (set && set.full.size > 0) {
      const mixer = new THREE.AnimationMixer(root);
      for (const [name, c] of set.lower) {
        const a = mixer.clipAction(c);
        a.play();
        a.setEffectiveWeight(0);
        rig.lower.set(name, a);
      }
      for (const [name, c] of set.upper) {
        const a = mixer.clipAction(c);
        a.setEffectiveWeight(0);
        rig.upper.set(name, a);
      }
      const quack = set.full.get('Quack');
      if (quack) {
        // Jaw only, so a quack plays over anything.
        const jaw = new THREE.AnimationClip('Quack@jaw', quack.duration, quack.tracks.filter((t) => t.name.startsWith('Jaw.')));
        const a = mixer.clipAction(jaw);
        a.setLoop(THREE.LoopOnce, 1);
        rig.full.set('Quack', a);
      }
      for (const name of ['Death_A', 'Death_B', 'Jump_Start', 'Land', 'Hit_React']) {
        const c = set.full.get(name);
        if (!c) continue;
        const a = mixer.clipAction(c);
        a.setLoop(THREE.LoopOnce, 1);
        // Only deaths hold their last frame. The other one-shots must switch
        // themselves off when done, or a clamped clip keeps pulling the whole
        // body (and the gun) toward its last frame forever.
        a.clampWhenFinished = name.startsWith('Death');
        rig.full.set(name, a);
      }
      rig.mixer = mixer;
    }
    return rig;
  }

  /** A shot: kicks the gun and torso back for a moment. */
  fire(): void {
    this.recoil = 1;
  }

  /** Open the bill (kill celebration). */
  quack(): void {
    const a = this.rig?.full.get('Quack');
    if (a) a.reset().setEffectiveWeight(1).play();
  }

  /** Short flinch when hit. */
  hitReact(): void {
    const a = this.rig?.full.get('Hit_React');
    if (a) a.reset().setEffectiveWeight(0.6).play();
  }

  /** World position of the current gun's muzzle (tracers and flashes start here). */
  muzzleWorld(out: THREE.Vector3): THREE.Vector3 {
    const w = this.weapons[this.weapon] ?? this.weapons[0];
    return (w as WeaponInstance).muzzle.getWorldPosition(out);
  }

  update(p: AvatarPose, dt: number): void {
    this.object.position.set(p.x, p.y, p.z);
    this.object.rotation.set(0, p.yaw, 0);

    // Velocity from drawn motion (works for local and remote players alike).
    if (!Number.isNaN(this.lastX) && dt > 0) {
      const k = 1 - Math.exp(-dt * 12);
      const vx = (p.x - this.lastX) / dt;
      const vz = (p.z - this.lastZ) / dt;
      if (Math.hypot(vx, vz) < 20) {
        this.velX += (vx - this.velX) * k;
        this.velZ += (vz - this.velZ) * k;
      }
    }
    this.lastX = p.x;
    this.lastZ = p.z;
    const speed = Math.hypot(this.velX, this.velZ);
    // Local velocity: forward is -z after the yaw rotation.
    const fx = -Math.sin(p.yaw);
    const fz = -Math.cos(p.yaw);
    const vf = this.velX * fx + this.velZ * fz;
    const vr = this.velX * Math.cos(p.yaw) - this.velZ * Math.sin(p.yaw);

    this.crouchBlend += (p.crouch - this.crouchBlend) * (1 - Math.exp(-dt * BODY.crouchRate * 2));
    this.airTime = p.grounded ? 0 : this.airTime + dt;
    this.recoil = Math.max(0, this.recoil - dt * 9);
    if (!p.alive) this.deathT = this.deathT < 0 ? 0 : this.deathT + dt;
    else this.deathT = -1;
    this.walkPhase += speed * dt * 2.6;

    this.selectWeapon(p.weapon);

    if (this.rig) this.updateRig(this.rig, p, dt, speed, vf, vr);
    else this.updatePlaceholder(p, speed);

    // Fall over when dead without a death clip.
    const deathClip = this.rig?.mixer && this.rig.full.has('Death_A');
    if (this.deathT >= 0 && !deathClip) {
      const t = Math.min(1, this.deathT / 0.35);
      this.body.rotation.x = (Math.PI / 2) * t * t;
      this.body.position.y = 0.25 * t;
      this.holder.visible = false;
    } else if (this.deathT < 0) {
      this.body.rotation.x = 0;
      this.holder.visible = true;
    }
    this.lastAct = p.act;
    this.wasGrounded = p.grounded;
  }

  private selectWeapon(w: number): void {
    if (w === this.weapon) return;
    this.weapon = w;
    const clipMode = !!this.rig?.mixer;
    const pose = attachPose(w);
    this.weapons.forEach((inst, i) => {
      inst.root.visible = i === w;
      if (i !== w) return;
      if (clipMode && this.rig && pose) {
        // Clip mode: the gun rides the right hand, placed by attach.json.
        this.rig.bones.RightHand.add(inst.root);
        inst.root.position.copy(pose.position);
        inst.root.quaternion.copy(pose.quaternion);
      } else {
        this.holder.add(inst.root);
        const h = HOLD[w] ?? (HOLD[0] as { grip: THREE.Vector3; yaw: number });
        // Barrel +Z in gun space; turn it to face forward (-z) and toe it in a little.
        inst.root.position.copy(h.grip);
        inst.root.rotation.set(0, Math.PI + h.yaw, 0);
      }
    });
  }

  private updateHolder(pitch: number, drop: number): void {
    this.holder.position.set(0, PIVOT_Y - drop, 0);
    this.holder.rotation.set(pitch + this.recoil * 0.12, 0, 0, 'YXZ');
    this.holder.position.z = this.recoil * 0.05;
  }

  private updatePlaceholder(p: AvatarPose, speed: number): void {
    const parts = this.parts;
    if (!parts) return;
    const c = this.crouchBlend;
    const move = Math.min(speed / 5, 1) * (p.grounded ? 1 : 0);
    const swing = Math.sin(this.walkPhase) * 0.22 * move;
    parts.footL.position.z = -0.04 + swing;
    parts.footR.position.z = -0.04 - swing;
    parts.footL.position.y = 0.03 + Math.max(0, Math.sin(this.walkPhase)) * 0.08 * move + (p.grounded ? 0 : 0.12);
    parts.footR.position.y = 0.03 + Math.max(0, -Math.sin(this.walkPhase)) * 0.08 * move + (p.grounded ? 0 : 0.12);
    const bob = Math.abs(Math.sin(this.walkPhase)) * 0.05 * move;
    parts.body.scale.y = 1 - c * 0.3;
    parts.body.position.y = 0.72 - c * 0.24 + bob;
    parts.body.rotation.z = Math.sin(this.walkPhase) * 0.08 * move;
    parts.head.position.y = 1.42 - c * 0.5 + bob;
    parts.head.rotation.x = p.pitch * 0.5;
    this.updateHolder(p.pitch, c * 0.4 - 0.2);
  }

  private updateRig(rig: Rig, p: AvatarPose, dt: number, speed: number, vf: number, vr: number): void {
    const b = rig.bones;
    const c = this.crouchBlend;
    const dead = this.deathT >= 0;
    if (rig.mixer) {
      this.blendClips(rig, p, speed, vf, vr, dead);
      rig.mixer.update(dt);
    } else {
      // Procedural: start from the rest pose every frame.
      rig.all.forEach((bone, i) => bone.quaternion.copy(rig.rest[i] as THREE.Quaternion));
      this.body.position.y = -0.3 * c;
    }
    this.object.updateMatrixWorld(true);

    const right = _right.set(1, 0, 0).applyQuaternion(this.object.quaternion);
    if (!rig.mixer && !dead) {
      // Legs: swing around the axis across the direction of travel; bend knees when crouched or in the air.
      const move = Math.min(speed / 5, 1) * (p.grounded ? 1 : 0.2);
      const travel = speed > 0.3 ? _v.set(this.velX, 0, this.velZ).normalize() : _v.set(0, 0, -1).applyQuaternion(this.object.quaternion);
      const swingAxis = _w.set(0, 1, 0).cross(travel).normalize();
      const s = Math.sin(this.walkPhase);
      const air = p.grounded ? 0 : 0.5;
      for (const [up, low, side] of [[b.LeftUpLeg, b.LeftLeg, 1], [b.RightUpLeg, b.RightLeg, -1]] as const) {
        const swing = s * side * 0.55 * move;
        rotateBoneWorld(up, _q.setFromAxisAngle(swingAxis, -swing));
        rotateBoneWorld(up, _q.setFromAxisAngle(right, c * 1.1 + air));
        const knee = Math.max(0, -s * side) * 0.9 * move + c * 1.9 + air * 1.4;
        rotateBoneWorld(low, _q.setFromAxisAngle(right, -knee));
      }
    }
    if (dead) return;

    // Torso and head follow the camera pitch (plus a recoil kick).
    const pitch = p.pitch;
    for (const [bone, share] of [[b.Spine, 0.2], [b.Spine1, 0.2], [b.Spine2, 0.2], [b.Neck, 0.15]] as const) {
      rotateBoneWorld(bone, _q.setFromAxisAngle(right, pitch * share + (bone === b.Spine2 ? this.recoil * 0.08 : 0)));
    }
    rotateBoneWorld(b.Head, _q.setFromAxisAngle(right, pitch * 0.1));

    const inst = this.weapons[this.weapon];
    if (!inst) return;
    if (!rig.mixer || !attachPose(this.weapon)) {
      this.updateHolder(pitch, 0.3 * c);
      this.holder.updateMatrixWorld(true);
      // Right hand to the grip, elbow out and down.
      inst.grip.getWorldPosition(_v);
      b.RightArm.getWorldPosition(_w);
      _w.addScaledVector(right, 0.3).add(_down);
      twoBoneIK(b.RightArm, b.RightForeArm, b.RightHand, _v, _w);
    }
    // Left hand to the support point.
    inst.support.getWorldPosition(_v);
    b.LeftArm.getWorldPosition(_w);
    _w.addScaledVector(right, -0.3).add(_down);
    twoBoneIK(b.LeftArm, b.LeftForeArm, b.LeftHand, _v, _w);
  }

  private blendClips(rig: Rig, p: AvatarPose, speed: number, vf: number, vr: number, dead: boolean): void {
    const W = (name: string, w: number) => rig.lower.get(name)?.setEffectiveWeight(w);
    // One-shot accents fade out over their length, and are off once finished.
    for (const [name, peak] of ONE_SHOTS) {
      const a = rig.full.get(name);
      if (!a) continue;
      if (a.isRunning()) a.setEffectiveWeight(peak * Math.max(0, 1 - a.time / a.getClip().duration));
      else if (a.enabled) a.stop();
    }
    for (const a of rig.lower.values()) a.setEffectiveWeight(0);
    for (const a of rig.upper.values()) a.setEffectiveWeight(0);
    if (dead) {
      const name = this.deathT === 0 ? (Math.random() < 0.5 ? 'Death_A' : 'Death_B') : null;
      if (name) rig.full.get(name)?.reset().setEffectiveWeight(1).play();
      return;
    }
    for (const n of ['Death_A', 'Death_B']) rig.full.get(n)?.stop();
    // Air: jump start on takeoff, fall loop after; land on touchdown.
    if (!p.grounded) {
      if (this.wasGrounded) rig.full.get('Jump_Start')?.reset().setEffectiveWeight(0.8).play();
      W('Fall_Loop', 1);
    } else if (this.crouchBlend > 0.5) {
      const t = Math.min(1, speed / 1.5);
      W('Crouch_Idle', 1 - t);
      W('Crouch_Walk', t);
      const a = rig.lower.get('Crouch_Walk');
      if (a) a.timeScale = Math.max(0.5, speed / 2.3);
    } else if (speed < 0.3) {
      W('Idle', 1);
    } else if (vf > 6.2) {
      W('Sprint', 1);
      const a = rig.lower.get('Sprint');
      if (a) a.timeScale = speed / 7;
    } else {
      if (!this.wasGrounded) rig.full.get('Land')?.reset().setEffectiveWeight(0.5).play();
      // 8-way: weights from the direction of travel in the duck's frame.
      const f = Math.max(0, vf) / speed;
      const bk = Math.max(0, -vf) / speed;
      const r = Math.max(0, vr) / speed;
      const l = Math.max(0, -vr) / speed;
      const sum = f + bk + r + l || 1;
      const run = Math.min(1, Math.max(0, (speed - 2.6) / 2.6));
      const idle = Math.max(0, 1 - speed / 1.2);
      W('Idle', idle);
      const k = 1 - idle;
      for (const [dir, w] of [['F', f], ['B', bk], ['R', r], ['L', l]] as const) {
        W(`Walk_${dir}`, (k * (w / sum)) * (1 - run));
        W(`Run_${dir}`, (k * (w / sum)) * run);
        const wa = rig.lower.get(`Walk_${dir}`);
        if (wa) wa.timeScale = Math.max(0.6, speed / 2.6);
        const ra = rig.lower.get(`Run_${dir}`);
        if (ra) ra.timeScale = Math.max(0.6, speed / 5.2);
      }
    }
    // Upper body: aim pose, or the reload or equip while they run.
    const prefix = this.weapon === WeaponId.Pistol ? 'Pistol' : 'Rifle';
    const reload = rig.upper.get(`${prefix}_Reload`);
    const equip = rig.upper.get('Equip');
    if (p.act === 1 && this.lastAct !== 1 && reload) {
      reload.setLoop(THREE.LoopOnce, 1);
      reload.reset().play();
    }
    if (p.act === 2 && this.lastAct !== 2 && equip) {
      equip.setLoop(THREE.LoopOnce, 1);
      equip.reset().play();
    }
    if (p.act === 1 && reload?.isRunning()) reload.setEffectiveWeight(1);
    else if (p.act === 2 && equip?.isRunning()) equip.setEffectiveWeight(1);
    else {
      const aim = rig.upper.get(`${prefix}_Aim`);
      if (aim) {
        if (!aim.isRunning()) aim.play();
        aim.setEffectiveWeight(1);
      }
    }
  }

  dispose(): void {
    this.object.removeFromParent();
    if (this.rig?.mixer && this.glb) {
      this.rig.mixer.stopAllAction();
      this.rig.mixer.uncacheRoot(this.glb);
    }
    for (const w of this.weapons) disposeWeapon(w);
  }
}
