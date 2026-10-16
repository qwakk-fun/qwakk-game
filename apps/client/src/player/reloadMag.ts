/**
 * The magazine during a reload: it leaves the gun, rides in the left hand,
 * drops to the ground, and a fresh one comes from the pouch and is seated.
 * Driven by the reload clip's time and the art's timeline (attach.json
 * `reload`), so it stays in step with the clip, and the clip is as long as
 * the server's reload. Purely visual: ammo is decided by the server.
 *
 * Hand-overs re-parent the `Mag` node keeping its world pose, then ease it
 * into its new local pose over a few frames, so a hand that is a little off
 * (IK reach, frame timing) never pops.
 */
import * as THREE from 'three/webgpu';
import type { MagTimeline, WeaponInstance } from './weaponModel.ts';

type Where = 'gun' | 'hand' | 'none';

/** Moments worth a sound: the magazine leaves the gun, a fresh one is taken, it is seated. */
export type MagEvent = 'out' | 'fresh' | 'in';

/** Seconds to ease a re-parented magazine into its new pose. */
const SETTLE = 0.08;
/** Dropped magazines: gravity (toony, a bit heavy), time on the ground, at most this many per duck. */
const GRAVITY = 14;
const GROUND_LIFE = 2.2;
const SHRINK = 0.3;
const MAX_DROPS = 3;

interface Drop {
  obj: THREE.Object3D;
  vel: THREE.Vector3;
  spin: THREE.Vector3;
  groundY: number;
  /** Seconds on the ground (-1 while falling). */
  rest: number;
  /** Seconds since dropped (safety cap). */
  age: number;
}

/** Where the magazine is `t` seconds into the reload clip. */
export function magWhere(tl: MagTimeline, t: number | null): Where {
  if (t === null || t < tl.out || t >= tl.in) return 'gun';
  if (t < tl.drop) return 'hand';
  if (t < tl.fresh) return 'none';
  return 'hand';
}

const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();

export class ReloadMag {
  private where: Where = 'gun';
  private inst: WeaponInstance | null = null;
  private settle = 0;
  private readonly settlePos = new THREE.Vector3();
  private readonly settleQuat = new THREE.Quaternion();
  private readonly lastWorld = new THREE.Vector3();
  private readonly vel = new THREE.Vector3();
  private hasLast = false;
  private readonly drops: Drop[] = [];
  /** Called on magazine events (sounds). */
  onEvent: ((e: MagEvent) => void) | null = null;

  /**
   * One frame. `t`: seconds into the reload clip (timeline time), or null when
   * not reloading. `hand`: the LeftHand bone. `world`: where dropped mags go.
   * `groundY`: the duck's feet height (dropped mags land there). `right`: the
   * duck's right in world space (mags are tossed that way, toward the camera).
   */
  update(dt: number, inst: WeaponInstance | null, tl: MagTimeline | null, t: number | null, hand: THREE.Object3D | null, world: THREE.Object3D | null, groundY: number, right: THREE.Vector3): void {
    if (inst !== this.inst) {
      // Weapon switched (or swapped for new art): put the old gun's magazine back.
      this.reset();
      this.inst = inst;
    }
    this.updateDrops(dt);
    const mag = inst?.mag;
    if (!inst || !mag || !inst.magSeat || !tl || !hand) return;
    if (t === null && this.where !== 'gun') {
      // Reload cancelled (fire, switch) or over: the magazine is simply back in the gun.
      this.reset();
      return;
    }
    const want = magWhere(tl, t);
    const changed = want !== this.where;
    if (changed) this.go(want, inst, tl, hand, world, groundY, right);

    // Track the hand-held magazine's world velocity (for the toss).
    if (this.where === 'hand') {
      mag.getWorldPosition(_p);
      if (this.hasLast && dt > 0) this.vel.subVectors(_p, this.lastWorld).divideScalar(dt);
      this.lastWorld.copy(_p);
      this.hasLast = true;
    } else this.hasLast = false;

    // The settle starts on the next frame: the hand-over frame keeps the world pose exactly.
    if (this.settle > 0 && !changed) {
      this.settle = Math.max(0, this.settle - dt);
      const target = this.where === 'hand' ? tl.hand : inst.magSeat;
      const k = 1 - this.settle / SETTLE;
      const s = k * k * (3 - 2 * k);
      mag.position.lerpVectors(this.settlePos, target.position, s);
      mag.quaternion.slerpQuaternions(this.settleQuat, target.quaternion, s);
    }
  }

  private go(want: Where, inst: WeaponInstance, tl: MagTimeline, hand: THREE.Object3D, world: THREE.Object3D | null, groundY: number, right: THREE.Vector3): void {
    const mag = inst.mag as THREE.Object3D;
    const from = this.where;
    this.where = want;
    if (from === 'gun') this.onEvent?.('out');
    else if (from === 'none' && want === 'hand') this.onEvent?.('fresh');
    else if (from === 'hand' && want === 'gun') this.onEvent?.('in');
    if (want === 'none') {
      // Old magazine away: a loose copy falls; the node hides until the fresh one.
      if (world && from !== 'none') this.drop(mag, world, groundY, right, from === 'gun');
      mag.visible = false;
      return;
    }
    if (want === 'hand') {
      if (from === 'none') {
        // Fresh magazine from the pouch: straight into the hand.
        hand.add(mag);
        mag.position.copy(tl.hand.position);
        mag.quaternion.copy(tl.hand.quaternion);
        mag.visible = true;
        this.settle = 0;
        return;
      }
      hand.attach(mag);
      this.beginSettle(mag);
      return;
    }
    // Back in the gun: seated by the clip, or snapped back when the reload was cancelled.
    inst.root.attach(mag);
    mag.visible = true;
    if (from === 'hand') this.beginSettle(mag);
    else this.seat(inst);
  }

  private beginSettle(mag: THREE.Object3D): void {
    this.settlePos.copy(mag.position);
    this.settleQuat.copy(mag.quaternion);
    this.settle = SETTLE;
  }

  private seat(inst: WeaponInstance): void {
    const mag = inst.mag;
    if (!mag || !inst.magSeat) return;
    if (mag.parent !== inst.root) inst.root.add(mag);
    mag.position.copy(inst.magSeat.position);
    mag.quaternion.copy(inst.magSeat.quaternion);
    mag.visible = true;
    this.settle = 0;
  }

  /** Put the current gun's magazine back in place (reload cancelled, weapon switched, death). */
  reset(): void {
    if (this.inst) this.seat(this.inst);
    this.where = 'gun';
    this.hasLast = false;
  }

  private drop(mag: THREE.Object3D, world: THREE.Object3D, groundY: number, right: THREE.Vector3, fromGun: boolean): void {
    if (this.drops.length >= MAX_DROPS) this.removeDrop(0);
    const obj = mag.clone(true);
    mag.updateWorldMatrix(true, false);
    mag.matrixWorld.decompose(obj.position, obj.quaternion, obj.scale);
    world.updateWorldMatrix(true, false);
    if (world.parent) {
      // Into the world's space (the scene is normally the root, so this is a no-op).
      obj.applyMatrix4(new THREE.Matrix4().copy(world.matrixWorld).invert());
    }
    world.add(obj);
    const vel = new THREE.Vector3();
    if (fromGun) {
      // Pistol: released, it slides out of the grip along the magazine axis.
      vel.set(0, 0, -1.6).applyQuaternion(mag.getWorldQuaternion(_q)).addScaledVector(right, 0.7);
    } else {
      // Rifle: tossed from the hand, outward to the duck's right.
      vel.copy(this.hasLast ? this.vel : vel).clampLength(0, 3);
      vel.addScaledVector(right, 1.8);
      vel.y += 1.2;
    }
    const spin = new THREE.Vector3((Math.random() - 0.5) * 10, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 10);
    this.drops.push({ obj, vel, spin, groundY, rest: -1, age: 0 });
  }

  private updateDrops(dt: number): void {
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const d = this.drops[i] as Drop;
      d.age += dt;
      if (d.rest < 0) {
        d.vel.y -= GRAVITY * dt;
        d.obj.position.addScaledVector(d.vel, dt);
        _e.set(d.spin.x * dt, d.spin.y * dt, d.spin.z * dt);
        d.obj.quaternion.multiply(_q.setFromEuler(_e));
        if (d.obj.position.y <= d.groundY + 0.03) {
          d.obj.position.y = d.groundY + 0.03;
          d.rest = 0;
        }
      } else d.rest += dt;
      const left = GROUND_LIFE - Math.max(0, d.rest);
      if (left < SHRINK) d.obj.scale.setScalar(Math.max(0.001, left / SHRINK));
      if (left <= 0 || d.age > 6) this.removeDrop(i);
    }
  }

  private removeDrop(i: number): void {
    const [d] = this.drops.splice(i, 1);
    d?.obj.removeFromParent();
  }

  /** Dropped magazines in flight or on the ground (tests, debugging). */
  get dropCount(): number {
    return this.drops.length;
  }

  /** Where the magazine is right now (tests, debugging). */
  get state(): Where {
    return this.where;
  }

  dispose(): void {
    while (this.drops.length) this.removeDrop(0);
  }
}
