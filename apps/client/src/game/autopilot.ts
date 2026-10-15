/**
 * Hands-free input for tests and phone checks (dev tools only).
 * - 'circle': run in wide circles, sprint in bursts, hop now and then.
 * - 'fight': find the nearest duck in line of sight, aim at its chest, fire
 *   bursts and strafe. It reads only what the player sees (drawn positions,
 *   world ray casts), like the server bots.
 */
import { aimOrigin, Button, Mode, MOVE_QUERY_GROUPS, SIGHT_QUERY_GROUPS, weaponStats, type PlayerSim, type SimWorld } from '@qwakk/shared';
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

  fight(me: PlayerSim, view: { yaw: number; pitch: number }, ducks: readonly SeenDuck[]): { mx: number; mz: number; buttons: number } {
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
      // Wander toward the arena center.
      const yaw = Math.atan2(me.x, me.z);
      view.yaw += Math.max(-0.1, Math.min(0.1, ((yaw - view.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI));
      view.pitch *= 0.9;
      this.burst = 0;
      return { mx: 0, mz: Math.hypot(me.x, me.z) > 12 ? 1 : 0.3, buttons: me.mag0 === 0 && me.reload === 0 ? Button.Reload : 0 };
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
    if (v.promptId) return { mx: 0, mz: 0, buttons: toggle ? Button.Use : 0 };
    // Stuck for a second and a half: give up on that item.
    if (this.t % 45 === 0) {
      if (this.goalId && Math.hypot(me.x - this.lastPos.x, me.z - this.lastPos.z) < 1) this.skip.add(this.goalId);
      this.lastPos = { x: me.x, z: me.z };
    }
    let best: { id: string; x: number; z: number } | null = null;
    let bestD = 40;
    for (const it of v.items) {
      if (this.skip.has(it.id)) continue;
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
