/**
 * Hands-free input for tests and phone checks (dev tools only).
 * - 'circle': run in wide circles, sprint in bursts, hop now and then.
 * - 'fight': find the nearest duck in line of sight, aim at its chest, fire
 *   bursts and strafe. It reads only what the player sees (drawn positions,
 *   world ray casts), like the server bots.
 */
import { aimOrigin, Button, PLAYER_QUERY_GROUPS, weaponStats, type PlayerSim, type SimWorld } from '@qwakk/shared';

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
      const hit = this.sim.world.castRay(new this.sim.rapier.Ray(o, { x: tx / len, y: ty / len, z: tz / len }), len, true, undefined, PLAYER_QUERY_GROUPS);
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
}
