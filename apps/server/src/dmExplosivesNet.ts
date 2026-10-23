/**
 * Who hears what about the deathmatch explosives (anti-wallhack rules, as for
 * shots in gameRoom.ts flushShots):
 *
 * - A throw or a launch (Msg.Proj with the thrower's pid, position and
 *   velocity) goes only to the thrower and to viewers who see the thrower
 *   (they receive its pose anyway). Everyone else within earshot gets a
 *   Msg.ShotHint (KillWeapon.Grenade or Rocket, a direction, a loudness) and
 *   nothing that places the thrower: no flight, since a flight traces back.
 * - A grenade at rest is shown (Msg.Proj with pid 0 and no velocity) to the
 *   viewers who did not get it yet and see its spot within
 *   EXPLOSIVE.restRevealRange: the spot is all they learn.
 * - An explosion is loud and public within earshot (Msg.Boom): kind and
 *   position, never the thrower.
 *
 * Pure apart from the host it is given, so it is unit tested without a room.
 */
import { EXPLOSIVE, ExplosiveKind } from '@qwakk/shared';
import { KillWeapon, Msg } from '@qwakk/shared/net';
import type { Seat } from './arena.ts';
import type { BlastInfo, LiveFlight } from './dmExplosives.ts';

export interface NetViewer {
  readonly sessionId: string;
  send(type: string, message: unknown): void;
}

export interface ExplosivesNetHost {
  viewers(): Iterable<NetViewer>;
  /** Where the viewer looks from, or null (a spectator without a seat: hears everything, sees what `sees` says). */
  viewpoint(viewerId: string): { x: number; y: number; z: number } | null;
  /** Does the viewer receive this duck's pose (gameRoom.viewerSees)? */
  sees(viewerId: string, targetId: string): boolean;
  /** A clear opaque line from the viewer's eye to this point. */
  seesSpot(viewerId: string, x: number, y: number, z: number): boolean;
}

const cm = (v: number): number => Math.round(v * 100);

/** World angle (three.js yaw convention) from (fx, fz) toward (tx, tz), in milliradians (as gameRoom.angleMilli). */
function angleMilli(fx: number, fz: number, tx: number, tz: number): number {
  return Math.round(Math.atan2(-(tx - fx), -(tz - fz)) * 1000);
}

export class ExplosivesNet {
  private readonly host: ExplosivesNetHost;
  /** Flight id to the viewers that were told about it. */
  private readonly told = new Map<number, Set<string>>();

  constructor(host: ExplosivesNetHost) {
    this.host = host;
  }

  launched(live: LiveFlight, owner: Seat): void {
    const f = live.flight;
    const data = [live.id, f.kind, owner.pid, cm(f.x), cm(f.y), cm(f.z), cm(f.vx), cm(f.vy), cm(f.vz)];
    const grenade = f.kind === ExplosiveKind.Grenade;
    const hear = grenade ? EXPLOSIVE.throwHear : EXPLOSIVE.launchHear;
    const weapon = grenade ? KillWeapon.Grenade : KillWeapon.Rocket;
    const told = new Set<string>();
    for (const v of this.host.viewers()) {
      const id = v.sessionId;
      if (id === owner.id || this.host.sees(id, owner.id)) {
        v.send(Msg.Proj, data);
        told.add(id);
        continue;
      }
      const vp = this.host.viewpoint(id);
      if (!vp) continue;
      const d2 = (owner.sim.x - vp.x) ** 2 + (owner.sim.z - vp.z) ** 2;
      if (d2 > hear * hear) continue;
      const loud = d2 < (hear * 0.2) ** 2 ? 2 : d2 < (hear * 0.55) ** 2 ? 1 : 0;
      v.send(Msg.ShotHint, [[weapon, angleMilli(vp.x, vp.z, owner.sim.x, owner.sim.z), loud]]);
    }
    this.told.set(live.id, told);
  }

  rested(live: LiveFlight): void {
    const f = live.flight;
    const told = this.told.get(live.id) ?? new Set<string>();
    this.told.set(live.id, told);
    const r2 = EXPLOSIVE.restRevealRange ** 2;
    let data: number[] | null = null;
    for (const v of this.host.viewers()) {
      const id = v.sessionId;
      if (told.has(id)) continue;
      const vp = this.host.viewpoint(id);
      if (vp && (f.x - vp.x) ** 2 + (f.z - vp.z) ** 2 > r2) continue;
      if (!this.host.seesSpot(id, f.x, f.y + 0.1, f.z)) continue;
      data ??= [live.id, f.kind, 0, cm(f.x), cm(f.y), cm(f.z), 0, 0, 0];
      v.send(Msg.Proj, data);
      told.add(id);
    }
  }

  boom(b: BlastInfo): void {
    this.told.delete(b.id);
    const data = [b.id, b.kind, cm(b.x), cm(b.y), cm(b.z)];
    const hear2 = EXPLOSIVE.boomHear ** 2;
    for (const v of this.host.viewers()) {
      const vp = this.host.viewpoint(v.sessionId);
      if (vp && (b.x - vp.x) ** 2 + (b.z - vp.z) ** 2 > hear2) continue;
      v.send(Msg.Boom, data);
    }
  }

  /** Round over: forget every flight. */
  clear(): void {
    this.told.clear();
  }
}
