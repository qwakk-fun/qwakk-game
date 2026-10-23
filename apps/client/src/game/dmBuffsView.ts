/**
 * Draws the deathmatch buffs on the ducks this client receives: the kill
 * stack aura, the hero's cape and gold aura, and the small moments around
 * them (take-off burst, landing puff, hero sparkles, embers at five stacks).
 * Everything rides the avatars (hidden with them when no pose arrives) or is
 * spawned only at a duck that is drawn, so nothing shows about a duck the
 * server did not send. Reads only the public `dmBuff` field and poses.
 */
import * as THREE from 'three/webgpu';
import { isHero, killStacks, KILL_STACKS } from '@qwakk/shared';
import type { PlayerState } from '@qwakk/shared/net';
import type { Sound } from '../audio/sound.ts';
import { DuckAura, glowDotTexture } from '../fx/dmAura.ts';
import { HeroCape } from '../fx/heroCape.ts';
import { ParticleSystem } from '../fx/particles.ts';
import type { Avatar } from '../player/avatar.ts';
import { BRAND } from '../render/palette.ts';

export interface BuffDuck {
  id: string;
  avatar: Avatar;
  state: PlayerState;
  /** On the ground now (predicted for the local duck, from the pose for others). */
  grounded: boolean;
  local: boolean;
}

interface Tracked {
  aura: DuckAura | null;
  cape: HeroCape | null;
  last: THREE.Vector3;
  has: boolean;
  speed: number;
  rise: number;
  air: number;
  wasGrounded: boolean;
  sparkle: number;
  seen: number;
}

const GOLD = new THREE.Color(BRAND.yellow);
const ORANGE = new THREE.Color(BRAND.beak);
const WHITE = new THREE.Color(0xfff6d8);
const DUST = new THREE.Color(0xd8cfb8);

export class DmBuffsView {
  private readonly ducks = new Map<string, Tracked>();
  private readonly sparks: ParticleSystem;
  private readonly dust: ParticleSystem;
  private readonly sound: Sound;
  private readonly tmp = new THREE.Vector3();
  private frameNo = 0;

  constructor(scene: THREE.Scene, sound: Sound) {
    this.sound = sound;
    const sparkMat = new THREE.MeshBasicNodeMaterial({ map: glowDotTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    this.sparks = new ParticleSystem(new THREE.PlaneGeometry(1, 1), sparkMat, 400, true);
    this.sparks.mesh.renderOrder = 3;
    const dustMat = new THREE.MeshBasicNodeMaterial({ map: glowDotTexture(), transparent: true, depthWrite: false, opacity: 0.7 });
    this.dust = new ParticleSystem(new THREE.PlaneGeometry(1, 1), dustMat, 160, true);
    scene.add(this.sparks.mesh, this.dust.mesh);
  }

  /** Every frame, after the avatars moved. `hidden`: the killcam is up (current buffs would mislead). */
  frame(dt: number, ducks: readonly BuffDuck[], camera: THREE.Camera, hidden: boolean): void {
    this.frameNo++;
    for (const d of ducks) this.duck(d, dt, hidden);
    for (const [id, t] of this.ducks) {
      if (t.seen === this.frameNo) continue;
      t.aura?.dispose();
      t.cape?.dispose();
      this.ducks.delete(id);
    }
    this.sparks.mesh.visible = !hidden;
    this.dust.mesh.visible = !hidden;
    this.sparks.update(dt, camera);
    this.dust.update(dt, camera);
  }

  private duck(d: BuffDuck, dt: number, hidden: boolean): void {
    let t = this.ducks.get(d.id);
    if (!t) {
      t = { aura: null, cape: null, last: new THREE.Vector3(), has: false, speed: 0, rise: 0, air: 0, wasGrounded: true, sparkle: 0, seen: 0 };
      this.ducks.set(d.id, t);
    }
    t.seen = this.frameNo;
    const obj = d.avatar.object;
    const alive = d.state.alive === 1;
    const stacks = alive ? killStacks(d.state) : 0;
    const hero = alive && isHero(d.state);
    const drawn = obj.visible && !hidden;

    // Motion from the drawn position (local and remote alike).
    const p = obj.position;
    if (t.has && dt > 0) {
      const k = 1 - Math.exp(-dt * 10);
      const vx = (p.x - t.last.x) / dt, vy = (p.y - t.last.y) / dt, vz = (p.z - t.last.z) / dt;
      if (Math.abs(vx) + Math.abs(vz) < 40 && Math.abs(vy) < 40) {
        t.speed += (Math.hypot(vx, vz) - t.speed) * k;
        t.rise += (vy - t.rise) * k;
      }
    }
    t.last.copy(p);
    t.has = true;

    // Aura: kill stacks, or gold for the hero.
    if ((stacks > 0 || hero) && !t.aura) {
      t.aura = new DuckAura();
      obj.add(t.aura.object);
    }
    if (t.aura) {
      t.aura.set(stacks, hero);
      t.aura.update(dt);
      if (hidden) t.aura.object.visible = false;
    }

    // Cape on the upper spine while the duck wears it (re-hung when its model loads).
    if (hero && !t.cape) t.cape = new HeroCape();
    if (!hero && t.cape) {
      t.cape.dispose();
      t.cape = null;
    }
    const flying = hero && !d.grounded;
    if (t.cape) {
      if (t.cape.object.parent !== obj) t.cape.attach(obj);
      t.cape.follow(d.avatar.bone('Spine2'), obj);
      t.cape.update(dt, t.speed, flying, t.rise);
      t.cape.object.visible = !hidden;
    }

    // Take-off burst and landing puff.
    if (hero && drawn) {
      if (t.wasGrounded && !d.grounded && t.rise > 0.5) this.takeOff(p, d.local);
      if (!t.wasGrounded && d.grounded && t.air > 0.45) this.land(p, d.local);
    }
    t.air = d.grounded ? 0 : t.air + dt;
    t.wasGrounded = d.grounded;

    // Ambient particles: hero sparkles (a trail while flying), embers at five stacks.
    if (!drawn) return;
    const rate = hero ? (flying ? 45 : 18) : stacks >= KILL_STACKS.max ? 9 : 0;
    t.sparkle += rate * dt;
    while (t.sparkle >= 1) {
      t.sparkle -= 1;
      if (hero) this.sparkle(p, flying);
      else this.ember(p);
    }
  }

  private sparkle(at: THREE.Vector3, flying: boolean): void {
    const a = Math.random() * Math.PI * 2;
    const r = 0.25 + Math.random() * 0.35;
    this.sparks.spawn({
      x: at.x + Math.cos(a) * r,
      y: at.y + 0.2 + Math.random() * 1.4,
      z: at.z + Math.sin(a) * r,
      vx: (Math.random() - 0.5) * 0.4,
      vy: flying ? -0.4 - Math.random() * 0.6 : 0.5 + Math.random() * 0.8,
      vz: (Math.random() - 0.5) * 0.4,
      life: flying ? 0.35 + Math.random() * 0.3 : 0.6 + Math.random() * 0.6,
      size: 0.04 + Math.random() * 0.05,
      grow: 0.3,
      gravity: 0,
      drag: 1.5,
      color: Math.random() < 0.15 ? WHITE : GOLD,
      spin: 0,
    });
  }

  private ember(at: THREE.Vector3): void {
    const a = Math.random() * Math.PI * 2;
    this.sparks.spawn({
      x: at.x + Math.cos(a) * 0.4,
      y: at.y + 0.1 + Math.random() * 0.4,
      z: at.z + Math.sin(a) * 0.4,
      vx: 0,
      vy: 0.8 + Math.random() * 0.8,
      vz: 0,
      life: 0.7 + Math.random() * 0.4,
      size: 0.05 + Math.random() * 0.05,
      grow: 0.2,
      gravity: -0.5,
      drag: 1,
      color: ORANGE,
      spin: 0,
    });
  }

  /** A gold ring of sparks shooting out and a little dust from the ground. */
  private takeOff(at: THREE.Vector3, local: boolean): void {
    for (let i = 0; i < 26; i++) {
      const a = (i / 26) * Math.PI * 2;
      this.sparks.spawn({
        x: at.x, y: at.y + 0.15, z: at.z,
        vx: Math.cos(a) * (3.2 + Math.random()), vy: 0.6 + Math.random() * 1.2, vz: Math.sin(a) * (3.2 + Math.random()),
        life: 0.45 + Math.random() * 0.25, size: 0.12 + Math.random() * 0.06, grow: 0.4, gravity: 2, drag: 3.5,
        color: i % 3 === 0 ? WHITE : GOLD, spin: 0,
      });
    }
    this.puff(at, 10, 2.2);
    this.sound.heroTakeOff(local ? undefined : this.tmp.copy(at));
  }

  private land(at: THREE.Vector3, local: boolean): void {
    this.puff(at, 18, 2.8);
    this.sound.heroLand(local ? undefined : this.tmp.copy(at));
  }

  private puff(at: THREE.Vector3, count: number, speed: number): void {
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + Math.random() * 0.3;
      this.dust.spawn({
        x: at.x + Math.cos(a) * 0.3, y: at.y + 0.1, z: at.z + Math.sin(a) * 0.3,
        vx: Math.cos(a) * speed * (0.7 + Math.random() * 0.5), vy: 0.3 + Math.random() * 0.5, vz: Math.sin(a) * speed * (0.7 + Math.random() * 0.5),
        life: 0.5 + Math.random() * 0.35, size: 0.35 + Math.random() * 0.25, grow: 2.2, gravity: 0, drag: 4,
        color: DUST, spin: 0,
      });
    }
  }

  dispose(): void {
    for (const t of this.ducks.values()) {
      t.aura?.dispose();
      t.cape?.dispose();
    }
    this.ducks.clear();
    for (const s of [this.sparks, this.dust]) {
      s.mesh.removeFromParent();
      s.mesh.geometry.dispose();
      (s.mesh.material as THREE.Material).dispose();
    }
  }
}
