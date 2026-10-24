/**
 * The katana's feel on the client (Hunt Season v3). Feedback only: the
 * server decides every hit, every number and every kill.
 *
 *   - Our own duck (predicted, `local`): the swing's whoosh and slash arc,
 *     and the same arc test as the server's (shared raid/arc.ts) against the
 *     hunters as drawn: on a predicted hit the cut freezes a moment
 *     (hit-stop: our duck's clips and the hunters it touched hold still),
 *     sparks fly and the camera gives a small kick. The quack's ring, the
 *     storm's spin, the dash's whoosh.
 *   - Friends (from their pose action): the same swings and rings, heard
 *     where they stand.
 *   - The server's numbers (`hits`, Msg.RaidHits): damage numbers, the combo
 *     counter, crit flashes. Our kills burst into feathers that fly to our
 *     duck (cosmetic; the XP is granted by the server at the run's end).
 */
import * as THREE from 'three/webgpu';
import { Act, bladeArcHits, BladeEvent, BLADE, BLADE_SHAPES, heavyShape, QUACK, type BladeShape, type HitTarget, type PlayerSim } from '@qwakk/shared';
import { RaidHitFlags } from '@qwakk/shared/net';
import type { Sound } from '../../audio/sound.ts';
import type { TpsCamera } from '../../camera/tpsCamera.ts';
import type { Effects } from '../../fx/effects.ts';
import type { BladeHud } from '../../hud/raid/bladeHud.ts';
import { fxMaterial, type MeleeArt } from '../../player/meleeArt.ts';
import { toonMaterial } from '../../render/materials.ts';

export interface BladeFeelDeps {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  cam: TpsCamera;
  sound: Sound;
  fx: Effects;
  hud: BladeHud;
  art(): MeleeArt | null;
  /** Hunters as drawn (the same list our predicted shots use). */
  targets(): HitTarget[];
  /** A predicted cut touched these hunters: they flinch and hold still a moment. */
  hunterHit(id: string, seconds: number): void;
  /** Our duck's clips hold still a moment. */
  hitStop(seconds: number): void;
  /** Where our duck is drawn (feathers fly there). */
  myPos(): THREE.Vector3;
}

interface Arc {
  obj: THREE.Object3D;
  mats: THREE.MeshBasicNodeMaterial[];
  age: number;
  life: number;
  grow: number;
  base: number;
}

interface Feather {
  obj: THREE.Object3D;
  v: THREE.Vector3;
  age: number;
  spin: number;
}

/** Hit-stop lengths (s): light cuts, the finisher and the heavy spin. */
const STOP = { light: 0.055, heavy: 0.095 };

export class BladeFeel {
  private readonly d: BladeFeelDeps;
  private readonly arcs: Arc[] = [];
  private readonly feathers: Feather[] = [];
  private readonly remoteActs = new Map<string, { act: number; t: number; fired: boolean }>();
  private readonly tmp = new THREE.Vector3();
  private readonly tmp2 = new THREE.Vector3();
  private storm: THREE.Object3D | null = null;
  private stormT = 0;
  /** Stats for the e2e (predicted hits, swings, quacks, storms, dashes, numbers shown). */
  readonly stats = { swings: 0, predictedHits: 0, multiHits: 0, quacks: 0, storms: 0, dashes: 0, numbers: 0, crits: 0, feathers: 0, bestCombo: 0, streaks: 0, mostKilledAtOnce: 0, mostHitAtOnce: 0 };

  constructor(deps: BladeFeelDeps) {
    this.d = deps;
  }

  // ---- our own duck (predicted) ----------------------------------------------------

  /** A blade event of our predicted step (live steps only). */
  local(kind: number, step: number, charge: number, s: PlayerSim): void {
    const d = this.d;
    const at = this.tmp.set(s.x, s.y + 1, s.z);
    if (kind === BladeEvent.Slash || kind === BladeEvent.Heavy) {
      this.stats.swings++;
      const shape = kind === BladeEvent.Heavy ? heavyShape(charge) : step === 1 ? BLADE_SHAPES.slash1 : step === 2 ? BLADE_SHAPES.slash2 : BLADE_SHAPES.slash3;
      d.sound.swing(kind === BladeEvent.Heavy ? 4 : step);
      this.arc(s.x, s.y, s.z, s.yaw, shape, kind === BladeEvent.Heavy ? 0 : step);
      this.predictHits(s, shape, kind === BladeEvent.Heavy || step === 3);
    } else if (kind === BladeEvent.Quack) {
      this.stats.quacks++;
      d.sound.quackShock();
      this.shockwave(s.x, s.y, s.z);
      d.fx.toonPop(at.set(s.x, s.y + 0.3, s.z), 1.3, false);
      d.cam.shake(0.05);
    } else if (kind === BladeEvent.StormStart) {
      this.stats.storms++;
      d.sound.stormStart();
      d.fx.toonPop(at, 1.2, true);
      d.cam.kick(0.02, 0);
    } else if (kind === BladeEvent.Storm) {
      d.sound.stormPulse();
      this.arc(s.x, s.y, s.z, s.yaw + Math.random() * 6.28, BLADE_SHAPES.storm, 0, 0.12);
      this.predictHits(s, BLADE_SHAPES.storm, false, true);
    } else if (kind === BladeEvent.Dash && step === 1) {
      this.stats.dashes++;
      d.sound.dash();
      d.fx.toonPop(at.set(s.x, s.y + 0.2, s.z), 0.5, false);
    }
  }

  /** The server's arc test on the hunters as we draw them: feedback for a cut that probably landed. */
  private predictHits(s: PlayerSim, shape: BladeShape, heavy: boolean, quiet = false): void {
    const hits = bladeArcHits(s.x, s.y, s.z, s.yaw, shape, this.d.targets());
    if (hits.length === 0) return;
    this.stats.predictedHits += hits.length;
    if (hits.length >= 2) this.stats.multiHits++;
    const stop = heavy ? STOP.heavy : STOP.light;
    if (!quiet) {
      this.d.hitStop(stop);
      this.d.sound.cutHit(heavy, hits.length);
      // A small kick, scaled down (the owner asked for gentle shake): more targets, a touch more.
      this.d.cam.kick(0.006 + 0.002 * Math.min(4, hits.length), (Math.random() - 0.5) * 0.004);
      this.d.cam.shake(heavy ? 0.035 : 0.015);
    }
    for (const h of hits) {
      this.d.hunterHit(h.id, quiet ? 0.03 : stop);
      this.tmp2.set(h.x - s.x, 0, h.z - s.z).normalize();
      this.d.fx.impact(this.tmp.set(h.x, h.y + 0.1, h.z), this.tmp2);
    }
  }

  // ---- friends (from their pose action) ---------------------------------------------

  /** A friend's pose action this frame: swings and rings at the moments their sim makes them. */
  remote(id: string, act: number, x: number, y: number, z: number, yaw: number, dt: number): void {
    let r = this.remoteActs.get(id);
    if (!r) {
      r = { act: -1, t: 0, fired: false };
      this.remoteActs.set(id, r);
    }
    if (act !== r.act) {
      r.act = act;
      r.t = 0;
      r.fired = false;
    } else r.t += dt;
    if (r.fired) return;
    const pos = this.tmp.set(x, y + 1, z);
    const step = act === Act.Slash1 ? 1 : act === Act.Slash2 ? 2 : act === Act.Slash3 ? 3 : 0;
    if (step > 0 && r.t >= BLADE.light[step - 1]!.impact / 30 - 0.03) {
      r.fired = true;
      this.d.sound.swing(step, pos);
      this.arc(x, y, z, yaw, step === 1 ? BLADE_SHAPES.slash1 : step === 2 ? BLADE_SHAPES.slash2 : BLADE_SHAPES.slash3, step);
    } else if (act === Act.Heavy && r.t >= BLADE.heavy.impact / 30 - 0.03) {
      r.fired = true;
      this.d.sound.swing(4, pos);
      this.arc(x, y, z, yaw, heavyShape(0.5), 0);
    } else if (act === Act.Quack && r.t >= QUACK.impact / 30 - 0.03) {
      r.fired = true;
      this.d.sound.quack(undefined, 0.45);
      this.shockwave(x, y, z);
    } else if (act === Act.Dash) {
      r.fired = true;
      this.d.sound.dash(pos);
    } else if (act === Act.Storm) {
      r.fired = true;
      this.d.sound.stormPulse(pos);
    }
  }

  forget(id: string): void {
    this.remoteActs.delete(id);
  }

  // ---- the server's numbers -----------------------------------------------------------

  /** Msg.RaidHits: [combo, meter, n, then n x (damage, flags, x, y, z cm)]. */
  hits(data: number[], now: number): void {
    const combo = data[0] ?? 0;
    const n = data[2] ?? 0;
    let crit = false;
    let killed = 0;
    for (let i = 0; i < n; i++) {
      if (((data[3 + i * 5 + 1] ?? 0) & RaidHitFlags.Killed) !== 0) killed++;
      const o = 3 + i * 5;
      const flags = data[o + 1] ?? 0;
      const c = (flags & RaidHitFlags.Crit) !== 0;
      crit ||= c;
      this.d.hud.number((data[o + 2] ?? 0) / 100, (data[o + 3] ?? 0) / 100, (data[o + 4] ?? 0) / 100, data[o] ?? 0, c, (flags & RaidHitFlags.Killed) !== 0, (flags & RaidHitFlags.Skill) !== 0, (flags & RaidHitFlags.Crate) !== 0);
      this.stats.numbers++;
      if (c) this.stats.crits++;
    }
    // One server tick's hits come together: a swing that cut several shows up here.
    this.stats.mostKilledAtOnce = Math.max(this.stats.mostKilledAtOnce, killed);
    this.stats.mostHitAtOnce = Math.max(this.stats.mostHitAtOnce, n);
    if (crit) this.d.sound.headshot();
    this.d.hud.setCombo(combo, now);
    this.stats.bestCombo = Math.max(this.stats.bestCombo, combo);
  }

  /** A hunter we bagged: a burst of feathers that fly to our duck (XP is the server's, at the run's end). */
  kill(x: number, y: number, z: number, elite: boolean): void {
    const n = elite ? 5 : 2;
    const art = this.d.art()?.feather ?? null;
    for (let i = 0; i < n; i++) {
      const obj = art ? art.clone() : new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.22, 0.02), toonMaterial(0xffd43b));
      obj.position.set(x, y + 1.1, z);
      obj.scale.setScalar(elite ? 0.7 : 0.5);
      this.d.scene.add(obj);
      const a = Math.random() * Math.PI * 2;
      this.feathers.push({ obj, v: new THREE.Vector3(Math.cos(a) * 2.2, 2.4 + Math.random() * 1.6, Math.sin(a) * 2.2), age: 0, spin: (Math.random() - 0.5) * 12 });
    }
    this.stats.feathers += n;
  }

  streak(n: number, now: number): void {
    this.stats.streaks++;
    this.d.hud.streak(n, now);
    this.d.sound.streak(n);
  }

  // ---- effects ------------------------------------------------------------------------

  /**
   * A slash arc on the ground plane around the duck: the art's SlashArc
   * (a 200 degree crescent centered on +Z) scaled to the swing's reach, or a
   * procedural crescent. Step 1 tilts one way, 2 the other, 3 stands up
   * (the overhead chop), 0 lies flat (the heavy spin, a storm pulse).
   */
  private arc(x: number, y: number, z: number, yaw: number, shape: BladeShape, step: number, life = 0.2): void {
    const art = this.d.art()?.slashArc ?? null;
    let a = this.arcs.find((q) => q.age >= q.life);
    if (!a) {
      const obj = art ? art.clone() : greyArc();
      const mats: THREE.MeshBasicNodeMaterial[] = [];
      obj.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        const mat = (m.material as THREE.MeshBasicNodeMaterial).clone();
        m.material = mat;
        mats.push(mat);
      });
      obj.visible = false;
      this.d.scene.add(obj);
      a = { obj, mats, age: 1, life: 1, grow: 0, base: 1 };
      this.arcs.push(a);
    }
    const o = a.obj;
    const reach = shape.reach;
    o.visible = true;
    o.position.set(x - Math.sin(yaw) * shape.ahead, y + (step === 3 ? 0.2 : 0.95), z - Math.cos(yaw) * shape.ahead);
    // The art faces +Z; the duck faces -Z at yaw 0.
    o.rotation.set(0, yaw + Math.PI, 0, 'YXZ');
    if (step === 1) o.rotation.z = 0.35;
    else if (step === 2) o.rotation.z = -0.35;
    else if (step === 3) o.rotation.x = -Math.PI / 2;
    a.base = step === 3 ? shape.reach * 0.75 : reach;
    o.scale.setScalar(a.base * 0.8);
    a.age = 0;
    a.life = life;
    a.grow = 0.3;
    for (const m of a.mats) m.opacity = 1;
    // A full spin (heavy, storm): two crescents back to back would need a second mesh; the 200 degree arc turns over its life instead.
    a.obj.userData.spin = shape.half >= Math.PI - 1e-3 ? (step === 0 ? 9 : 0) : 0;
  }

  /** The quack's ring: grows from the feet out to the shockwave's reach and fades (art Shockwave, or a ring). */
  private shockwave(x: number, y: number, z: number): void {
    const art = this.d.art()?.shockwave ?? null;
    const obj = art ? art.clone() : greyRing();
    const mats: THREE.MeshBasicNodeMaterial[] = [];
    obj.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const mat = (m.material as THREE.MeshBasicNodeMaterial).clone();
      m.material = mat;
      mats.push(mat);
    });
    obj.position.set(x, y + 0.05, z);
    obj.scale.setScalar(0.5);
    this.d.scene.add(obj);
    this.arcs.push({ obj, mats, age: 0, life: 0.38, grow: BLADE_SHAPES.quack.reach, base: 0.5 });
    obj.userData.ring = true;
    obj.userData.disposable = true;
  }

  /** Every frame: arcs fade, rings grow, the storm spins around us, feathers fly home. */
  frame(dt: number, storming: boolean, me: THREE.Vector3, yaw: number): void {
    for (let i = this.arcs.length - 1; i >= 0; i--) {
      const a = this.arcs[i]!;
      if (a.age >= a.life) continue;
      a.age += dt;
      const k = Math.min(1, a.age / a.life);
      if (a.obj.userData.ring) a.obj.scale.setScalar(a.base + (a.grow - a.base) * (1 - (1 - k) * (1 - k)));
      else a.obj.scale.setScalar(a.base * (0.8 + 0.25 * k));
      if (a.obj.userData.spin) a.obj.rotation.y += a.obj.userData.spin * dt;
      for (const m of a.mats) m.opacity = 1 - k;
      if (a.age >= a.life) {
        a.obj.visible = false;
        if (a.obj.userData.disposable) {
          a.obj.removeFromParent();
          this.arcs.splice(i, 1);
        }
      }
    }
    // The Blade Storm: a spinning crescent pair around our duck while it lasts.
    if (storming) {
      if (!this.storm) {
        const art = this.d.art()?.slashArc ?? null;
        const g = new THREE.Group();
        for (let k = 0; k < 2; k++) {
          const c = art ? art.clone() : greyArc();
          c.rotation.y = k * Math.PI;
          g.add(c);
        }
        // Two rings of crescents at the waist and the knees: a whirl around the duck.
        for (let k = 0; k < 2; k++) {
          const c = art ? art.clone() : greyArc();
          c.rotation.y = Math.PI / 2 + k * Math.PI;
          c.position.y = -0.45;
          c.scale.setScalar(0.8);
          g.add(c);
        }
        g.scale.setScalar(BLADE_SHAPES.storm.reach * 0.85);
        this.d.scene.add(g);
        this.storm = g;
      }
      this.stormT += dt;
      this.storm.visible = true;
      this.storm.position.set(me.x, me.y + 0.85, me.z);
      this.storm.rotation.set(0, yaw - this.stormT * 15.7, 0);
    } else if (this.storm) {
      this.storm.visible = false;
      this.stormT = 0;
    }
    for (let i = this.feathers.length - 1; i >= 0; i--) {
      const f = this.feathers[i]!;
      f.age += dt;
      const p = f.obj.position;
      if (f.age < 0.35) {
        // Burst out and up, slowing.
        p.addScaledVector(f.v, dt);
        f.v.multiplyScalar(Math.exp(-dt * 4));
      } else {
        // Then home in on the duck, faster and faster.
        const to = this.tmp.set(me.x - p.x, me.y + 1.1 - p.y, me.z - p.z);
        const dist = to.length();
        const speed = 6 + (f.age - 0.35) * 30;
        if (dist < 0.4 || f.age > 2.5) {
          f.obj.removeFromParent();
          this.feathers.splice(i, 1);
          this.d.sound.feather();
          continue;
        }
        p.addScaledVector(to.normalize(), Math.min(dist, speed * dt));
      }
      f.obj.rotation.y += f.spin * dt;
      f.obj.rotation.z = Math.sin(f.age * 9) * 0.5;
    }
  }

  dispose(): void {
    for (const a of this.arcs) a.obj.removeFromParent();
    for (const f of this.feathers) f.obj.removeFromParent();
    this.storm?.removeFromParent();
  }
}

/** A 200 degree crescent on the XZ plane centered on +Z, radius 1 (the art's SlashArc stand-in). */
function greyArc(): THREE.Object3D {
  const geo = new THREE.RingGeometry(0.78, 1.0, 28, 1, Math.PI / 2 - (100 * Math.PI) / 180, (200 * Math.PI) / 180);
  geo.rotateX(-Math.PI / 2);
  const cols = new Float32Array(geo.attributes.position!.count * 3);
  for (let i = 0; i < cols.length / 3; i++) {
    cols[i * 3] = 1;
    cols[i * 3 + 1] = 0.9;
    cols[i * 3 + 2] = 0.45;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  const m = new THREE.Mesh(geo, fxMaterial());
  m.frustumCulled = false;
  return m;
}

function greyRing(): THREE.Object3D {
  const geo = new THREE.RingGeometry(0.85, 1.0, 40);
  geo.rotateX(-Math.PI / 2);
  const cols = new Float32Array(geo.attributes.position!.count * 3).fill(0.9);
  geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  const m = new THREE.Mesh(geo, fxMaterial());
  m.frustumCulled = false;
  return m;
}
