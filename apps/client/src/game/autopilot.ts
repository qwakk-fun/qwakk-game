/**
 * Hands-free input for tests and phone checks (dev tools only).
 * - 'circle': run in wide circles, sprint in bursts, hop now and then.
 * - 'fight': find the nearest duck in line of sight, aim at its chest, fire
 *   bursts and strafe. It reads only what the player sees (drawn positions,
 *   world ray casts), like the server bots.
 */
import { aimOrigin, Button, dashTimer, isBladeDuck, Mode, MOVE_QUERY_GROUPS, quackTimer, SIGHT_QUERY_GROUPS, STORM, stormMeter, WeaponId, weaponStats, type PlayerSim, type SimWorld } from '@qwakk/shared';
import type { BrAutopilotView } from './brClient.ts';

export interface SeenDuck {
  id: string;
  x: number;
  y: number;
  z: number;
}

export class Autopilot {
  private t = 0;
  private burst = 0;
  private pause = 0;
  private strafe = 1;
  private lastPlaneD = Infinity;
  private goalId: string | null = null;
  private lastPos = { x: 0, z: 0 };
  private readonly skip = new Set<string>();
  private usePresses = 0;
  private useId: string | null = null;

  /** A straight walk at knee and chest height is free (no wall in the way). */
  private walkable(me: PlayerSim, x: number, z: number): boolean {
    const dx = x - me.x;
    const dz = z - me.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.5) return true;
    for (const h of [0.5, 1.2]) {
      const hit = this.sim.world.castRay(new this.sim.rapier.Ray({ x: me.x, y: me.y + h, z: me.z }, { x: dx / d, y: 0, z: dz / d }), d, true, undefined, MOVE_QUERY_GROUPS);
      if (hit && hit.timeOfImpact < d - 0.6) return false;
    }
    return true;
  }
  private readonly sim: SimWorld;
  private readonly tmp = { x: 0, y: 0, z: 0 };

  constructor(sim: SimWorld) {
    this.sim = sim;
  }

  circle(view: { yaw: number; pitch: number }): { mx: number; mz: number; buttons: number } {
    this.t += 1;
    view.yaw += 0.025;
    const sprint = Math.floor(this.t / 90) % 2 === 0 ? Button.Sprint : 0;
    const jump = this.t % 70 === 0 ? Button.Jump : 0;
    return { mx: Math.sin(this.t / 50) * 0.4, mz: 1, buttons: sprint | jump };
  }

  /**
   * Hunt Season (Pond Keep): fight the hunters it sees (as fight()), revive
   * a knocked friend close by (hold E), else hold a spot inside the gate
   * (the hunters come through it once it breaks).
   */
  raid(me: PlayerSim, view: { yaw: number; pitch: number }, v: { hunters: readonly SeenDuck[]; knocked: { x: number; z: number } | null; home: { x: number; z: number }; core: { x: number; z: number; r: number }; rally?: { x: number; z: number } | null; crates?: { x: number; z: number }[]; gate?: { x: number; z: number; nx: number; nz: number } | null }): { mx: number; mz: number; buttons: number } {
    // Knocked and alone: the second wind (hold E).
    if (me.down) return { mx: 0, mz: 0, buttons: Button.Use };
    // v3: a katana duck cuts its way to the objective.
    if (isBladeDuck(me)) return this.blade(me, view, v.hunters, v.rally ?? null, v.crates ?? [], v.knocked, v.gate ?? null, v.core);
    if (v.knocked && Math.hypot(v.knocked.x - me.x, v.knocked.z - me.z) < 18) {
      const near = v.hunters.some((h) => Math.hypot(h.x - me.x, h.z - me.z) < 12);
      if (!near) {
        const d = Math.hypot(v.knocked.x - me.x, v.knocked.z - me.z);
        const want = Math.atan2(-(v.knocked.x - me.x), -(v.knocked.z - me.z));
        const dy = ((want - view.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
        view.yaw += Math.max(-0.2, Math.min(0.2, dy));
        view.pitch = -0.3;
        return d > 1.4 ? { mx: 0, mz: 1, buttons: 0 } : { mx: 0, mz: 0, buttons: Button.Use };
      }
    }
    // Nobody in sight: hold the spot inside the gate, going round the core's plinth rather than over it.
    return this.fight(me, view, v.hunters, this.aroundCore(me, v.home, v.core));
  }

  private holdT = 0;
  private stuckT = 0;
  private lastXZ = { x: 0, z: 0 };

  /**
   * Hunt Season v3 with the katana: run at the nearest hunter in sight
   * (within 30 m), cut with taps of Fire (light combos), hold for a heavy
   * spin into a crowd, dash to close in, quack when surrounded, let the
   * Blade Storm go when it is full; snipers far up a tower get the pistol.
   * With nobody near: to the next supply crate (it hits it too) or the
   * objective's marker.
   */
  private blade(me: PlayerSim, view: { yaw: number; pitch: number }, hunters: readonly SeenDuck[], rally: { x: number; z: number } | null, crates: { x: number; z: number }[], knocked: { x: number; z: number } | null, gate: { x: number; z: number; nx: number; nz: number } | null, core: { x: number; z: number; r: number }): { mx: number; mz: number; buttons: number } {
    this.t++;
    let best: SeenDuck | null = null;
    let bestD = 30;
    let near = 0;
    for (const h of hunters) {
      const d = Math.hypot(h.x - me.x, h.z - me.z);
      if (d < 3.4) near++;
      if (d >= bestD || Math.abs(h.y - me.y) > 3.5) continue;
      if (d > 3) {
        const o = { x: me.x, y: me.y + 1.2, z: me.z };
        const tx = h.x - o.x;
        const ty = h.y + 1 - o.y;
        const tz = h.z - o.z;
        const len = Math.hypot(tx, ty, tz);
        const hit = this.sim.world.castRay(new this.sim.rapier.Ray(o, { x: tx / len, y: ty / len, z: tz / len }), len, true, undefined, SIGHT_QUERY_GROUPS);
        if (hit && hit.timeOfImpact < len - 0.6) continue;
      }
      best = h;
      bestD = d;
    }
    // A sniper high up a tower: the pistol (2), else the katana (1).
    const high = best && best.y - me.y > 3;
    let buttons = 0;
    if (high && me.weapon === WeaponId.Katana && this.t % 10 === 0) buttons |= Button.Slot2;
    if (!high && me.weapon !== WeaponId.Katana && this.t % 10 === 0) buttons |= Button.Slot1;
    let goal: { x: number; z: number } | null = best;
    if (!best) {
      // A friend down close by: revive it.
      if (knocked && Math.hypot(knocked.x - me.x, knocked.z - me.z) < 12) {
        goal = knocked;
        if (Math.hypot(knocked.x - me.x, knocked.z - me.z) < 1.4) return { mx: 0, mz: 0, buttons: Button.Use };
      } else {
        let c: { x: number; z: number } | null = null;
        for (const k of crates) if (!c || Math.hypot(k.x - me.x, k.z - me.z) < Math.hypot(c.x - me.x, c.z - me.z)) c = k;
        goal = c ?? rally;
      }
    }
    if (!goal) return { mx: 0, mz: 0, buttons };
    // Out of the castle (or back in): through the gate and over the drawbridge, never at a wall.
    if (gate) {
      const across = (p: { x: number; z: number }): number => (p.x - gate.x) * gate.nx + (p.z - gate.z) * gate.nz;
      const along = (p: { x: number; z: number }): number => (p.x - gate.x) * -gate.nz + (p.z - gate.z) * gate.nx;
      const inside = Math.abs(me.x - core.x) < 18 && Math.abs(me.z - core.z) < 18 && across(me) < 0;
      const goalOut = across(goal) > 0 || Math.abs(goal.x - core.x) > 18 || Math.abs(goal.z - core.z) > 18;
      const inGateway = Math.abs(along(me)) < 3 && across(me) > -4 && across(me) < 19;
      if (goalOut && inside && !inGateway) goal = { x: gate.x - gate.nx * 3, z: gate.z - gate.nz * 3 };
      else if (goalOut && inGateway) goal = { x: gate.x + gate.nx * 21, z: gate.z + gate.nz * 21 };
      else if (!goalOut && !inside && across(me) > 0 && !inGateway) goal = { x: gate.x + gate.nx * 20, z: gate.z + gate.nz * 20 };
    }
    const d = Math.hypot(goal.x - me.x, goal.z - me.z);
    const want = Math.atan2(-(goal.x - me.x), -(goal.z - me.z));
    const dy = ((want - view.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    view.yaw += Math.max(-0.3, Math.min(0.3, dy));
    view.pitch = high ? Math.max(-0.3, Math.min(0.6, Math.atan2((best!.y + 1.2) - (me.y + 1.5), d))) : -0.12;
    // Stuck against something for a while: hop.
    if (this.t % 30 === 0) {
      this.stuckT = Math.hypot(me.x - this.lastXZ.x, me.z - this.lastXZ.z) < 0.6 && d > 3 ? this.stuckT + 1 : 0;
      this.lastXZ = { x: me.x, z: me.z };
    }
    const hop = this.stuckT > 0 && this.t % 30 === 15 ? Button.Jump : 0;
    const crateNear = !best && crates.some((k) => Math.hypot(k.x - me.x, k.z - me.z) < 2.6);
    if (high && me.weapon === WeaponId.Pistol) {
      // Pistol: stand, aim, tap.
      return { mx: 0, mz: d > 60 ? 1 : 0, buttons: buttons | (Math.abs(dy) < 0.05 && this.t % 6 === 0 ? Button.Fire : 0) };
    }
    if (!best && !crateNear) return { mx: 0, mz: d > 4 ? 1 : 0, buttons: buttons | hop | (d > 12 ? Button.Sprint : 0) | (d > 14 && dashTimer(me) === 0 && this.t % 45 === 0 ? Button.Dash : 0) };
    // In the fight (or at a crate).
    if (best && bestD > 4 && bestD < 9 && dashTimer(me) === 0 && Math.abs(dy) < 0.3) buttons |= Button.Dash;
    if (near >= 4 && quackTimer(me) === 0) buttons |= Button.Quack;
    if (near >= 2 && stormMeter(me) >= STORM.meterFull) buttons |= Button.Storm;
    const reach = crateNear ? 2.6 : 2.4;
    if ((best ? bestD : 0) < reach + 0.6) {
      if (near >= 3 && this.holdT === 0 && this.t % 50 === 0) this.holdT = 34;
      if (this.holdT > 0) {
        this.holdT--;
        buttons |= Button.Fire;
      } else if (this.t % 3 === 0) buttons |= Button.Fire;
    }
    return { mx: 0, mz: best && bestD > 1.6 ? 1 : 0, buttons: buttons | hop };
  }

  /** The home spot, or a point beside the core first when the straight way runs over its plinth. */
  private aroundCore(me: PlayerSim, home: { x: number; z: number }, core: { x: number; z: number; r: number }): { x: number; z: number } {
    const dx = home.x - me.x;
    const dz = home.z - me.z;
    const len2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((core.x - me.x) * dx + (core.z - me.z) * dz) / len2));
    const px = me.x + dx * t - core.x;
    const pz = me.z + dz * t - core.z;
    const clear = core.r + 2;
    if (Math.hypot(px, pz) >= clear) return home;
    // Step out sideways from the line on the duck's side of the core.
    const l = Math.sqrt(len2);
    let sx = -dz / l;
    let sz = dx / l;
    if (sx * (me.x - core.x) + sz * (me.z - core.z) < 0) {
      sx = -sx;
      sz = -sz;
    }
    return { x: core.x + sx * (clear + 1.5), z: core.z + sz * (clear + 1.5) };
  }

  fight(me: PlayerSim, view: { yaw: number; pitch: number }, ducks: readonly SeenDuck[], home?: { x: number; z: number }): { mx: number; mz: number; buttons: number } {
    this.t += 1;
    if (this.t % 25 === 0) this.strafe = -this.strafe;
    const o = aimOrigin(this.sim, me, 1, this.tmp);
    let best: SeenDuck | null = null;
    let bestD = Infinity;
    for (const d of ducks) {
      const dist = Math.hypot(d.x - me.x, d.z - me.z);
      if (dist >= bestD || dist > 90) continue;
      const tx = d.x - o.x;
      const ty = d.y + 1.05 - o.y;
      const tz = d.z - o.z;
      const len = Math.hypot(tx, ty, tz);
      const hit = this.sim.world.castRay(new this.sim.rapier.Ray(o, { x: tx / len, y: ty / len, z: tz / len }), len, true, undefined, SIGHT_QUERY_GROUPS);
      if (hit && hit.timeOfImpact < len - 0.4) continue;
      best = d;
      bestD = dist;
    }
    if (!best) {
      // Wander toward the arena center (the deathmatch play area), or the given home spot.
      const c = home ?? this.sim.map.arena;
      const yaw = Math.atan2(me.x - c.x, me.z - c.z);
      view.yaw += Math.max(-0.1, Math.min(0.1, ((yaw - view.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI));
      view.pitch *= 0.9;
      this.burst = 0;
      const hop = this.t % 45 === 0 ? Button.Jump : 0;
      return { mx: 0, mz: Math.hypot(me.x - c.x, me.z - c.z) > 12 ? 1 : 0.3, buttons: hop | (me.mag0 === 0 && me.reload === 0 ? Button.Reload : 0) };
    }
    const w = weaponStats(me.weapon);
    const p = w.pattern[Math.min(Math.floor(me.spray), w.pattern.length - 1)] ?? [0, 0];
    const tx = best.x - o.x;
    const ty = best.y + 1.05 - o.y;
    const tz = best.z - o.z;
    const wantYaw = Math.atan2(-tx, -tz) + p[1] * 0.6;
    const wantPitch = Math.atan2(ty, Math.hypot(tx, tz)) - p[0] * 0.6;
    const dy = ((wantYaw - view.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    view.yaw += Math.max(-0.25, Math.min(0.25, dy));
    view.pitch += Math.max(-0.2, Math.min(0.2, wantPitch - view.pitch));
    let buttons = 0;
    const onTarget = Math.abs(dy) < 0.04 && Math.abs(wantPitch - view.pitch) < 0.04;
    if (this.pause > 0) this.pause--;
    else if (onTarget || this.burst > 0) {
      buttons |= Button.Fire;
      if (++this.burst > 12) {
        this.burst = 0;
        this.pause = 8;
      }
    }
    if (me.mag0 === 0 && me.reload === 0) buttons |= Button.Reload;
    return { mx: this.burst > 0 ? 0 : this.strafe, mz: bestD > 25 ? 0.7 : 0, buttons };
  }

  /**
   * Battle royale: jump out once over land, dive to the ground, then walk to
   * the nearest item and pick it up, then wander toward the zone.
   */
  br(me: PlayerSim, view: { yaw: number; pitch: number }, v: BrAutopilotView, target: { x: number; z: number } | null = null): { mx: number; mz: number; buttons: number } {
    this.t += 1;
    const toggle = this.t % 2 === 0;
    if (v.inPlane) {
      view.pitch = -0.25;
      // With a target: jump when the plane is closest to it (still over land); else soon after take-off.
      let go = v.planeTime > 2.5;
      if (target && v.plane) {
        const d = Math.hypot(v.plane.x - target.x, v.plane.z - target.z);
        go = d < 140 || (this.lastPlaneD < d && this.lastPlaneD < 400);
        this.lastPlaneD = d;
      }
      return { mx: 0, mz: 0, buttons: v.canJump && go && toggle ? Button.Deploy : 0 };
    }
    if (me.mode === Mode.Freefall || me.mode === Mode.Glide) {
      view.pitch = -0.35;
      if (!target) return { mx: 0, mz: 1, buttons: 0 };
      const want = Math.atan2(-(target.x - me.x), -(target.z - me.z));
      const dy = ((want - view.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      view.yaw += Math.max(-0.08, Math.min(0.08, dy));
      const d = Math.hypot(target.x - me.x, target.z - me.z);
      // Glide on (S brakes when overhead), dive once close.
      return { mx: 0, mz: d < 40 ? 1 : d < 90 ? -0.5 : 0, buttons: 0 };
    }
    // Press E on the prompt's item, unless it does not fit or nothing happens after a few presses
    // (a crate takes two: open, then take, with the lid in between).
    if (v.holdOpen) return { mx: 0, mz: 0, buttons: 0 };
    if (v.promptId && v.promptId !== this.useId) {
      this.useId = v.promptId;
      this.usePresses = 0;
    }
    if (v.promptId && !this.skip.has(v.promptId)) {
      if (v.promptBlocked || this.usePresses > 12) this.skip.add(v.promptId);
      else {
        if (toggle) this.usePresses++;
        return { mx: 0, mz: 0, buttons: toggle ? Button.Use : 0 };
      }
    }
    // Stuck for a second and a half: give up on that item.
    if (this.t % 45 === 0) {
      if (this.goalId && Math.hypot(me.x - this.lastPos.x, me.z - this.lastPos.z) < 1) this.skip.add(this.goalId);
      this.lastPos = { x: me.x, z: me.z };
    }
    let best: { id: string; x: number; z: number } | null = null;
    let bestD = 40;
    const focus = v.focus ? v.items.find((it) => it.id === v.focus) : undefined;
    for (const it of focus ? [focus] : v.items) {
      if (this.skip.has(it.id) && it !== focus) continue;
      const d = Math.hypot(it.x - me.x, it.z - me.z);
      if (d < bestD && Math.abs(it.y - me.y) < 1.5 && this.walkable(me, it.x, it.z)) {
        best = it;
        bestD = d;
      }
    }
    this.goalId = best?.id ?? null;
    const goal = best ?? v.zone ?? { x: 0, z: 0 };
    const want = Math.atan2(-(goal.x - me.x), -(goal.z - me.z));
    const dy = ((want - view.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    view.yaw += Math.max(-0.15, Math.min(0.15, dy));
    view.pitch = best ? -0.25 : -0.1;
    // Hop now and then so low walls do not stop it.
    const hop = this.t % 45 === 0 ? Button.Jump : 0;
    return { mx: 0, mz: best && bestD < 1.2 ? 0 : 1, buttons: hop | (best ? 0 : Button.Sprint) };
  }
}
