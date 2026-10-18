import { actionOf, DM, TICK_RATE, type DmKillcam, type DmReplayPose } from '@qwakk/shared';
import type { Seat } from './arena.ts';

function pose(seat: Seat): DmReplayPose {
  const s = seat.sim;
  return { x: s.x, y: s.y, z: s.z, yaw: s.yaw, pitch: s.pitch, crouch: s.crouch,
    grounded: !!s.grounded, alive: !!s.alive, weapon: s.weapon, act: actionOf(s), aim: s.aim };
}

/** Room-local history; only a killer/victim pair can leave the server, after death. */
export class DmReplayHistory {
  private frames: { at: number; seats: Map<string, { life: number; pose: DmReplayPose }> }[] = [];
  private nextTick = 0;

  clear(): void { this.frames = []; this.nextTick = 0; }

  remove(id: string): void { for (const frame of this.frames) frame.seats.delete(id); }

  record(tick: number, seats: Iterable<Seat>): void {
    if (tick < this.nextTick) return;
    this.nextTick = Math.max(tick, this.nextTick + TICK_RATE / DM.replayHz);
    const at = tick * 1000 / TICK_RATE;
    this.frames.push({ at, seats: new Map([...seats].map(s => [s.id, { life: s.life, pose: pose(s) }])) });
    while (this.frames.length > Math.ceil(DM.replaySeconds * DM.replayHz) + 1 || this.frames[0]!.at < at - DM.replaySeconds * 1000) this.frames.shift();
  }

  forDeath(tick: number, killer: Seat | null, victim: Seat): DmKillcam | null {
    if (!killer || killer === victim || victim.sim.alive || !killer.sim.alive) return null;
    const at = tick * 1000 / TICK_RATE;
    const frames: DmKillcam['frames'] = [];
    for (const frame of this.frames) {
      if (frame.at >= at || frame.at < at - DM.replaySeconds * 1000) continue;
      const k = frame.seats.get(killer.id), v = frame.seats.get(victim.id);
      if (k?.life !== killer.life || v?.life !== victim.life || !k.pose.alive || !v.pose.alive) continue;
      frames.push({ at: frame.at, killer: { ...k.pose }, victim: { ...v.pose } });
    }
    // An immediate spawn kill still shows the attacker, without replaying an older life.
    if (!frames.length) frames.push({ at: at - 200, killer: pose(killer), victim: { ...pose(victim), alive: true } });
    frames.push({ at, killer: pose(killer), victim: pose(victim) });
    return { killerId: killer.id, victimId: victim.id, victimLife: victim.life, frames };
  }
}
