import { DM, DmPower, groundHeightAt, OPAQUE_QUERY_GROUPS, TICK_RATE, type SimWorld } from '@qwakk/shared';
import type { Seat } from './arena.ts';

export interface PowerPickup { id: string; kind: number; x: number; y: number; z: number; expires: number }

/** At most three objectives on validated spawn ground. Collection is server-authoritative. */
export class DmPowerups {
  readonly pickups = new Map<string, PowerPickup>();
  private nextSpawn = 0;
  private serial = 0;
  private readonly world: SimWorld;
  constructor(world: SimWorld) { this.world = world; }

  reset(tick: number): void {
    this.pickups.clear();
    this.nextSpawn = tick + DM.powerEverySeconds * TICK_RATE;
  }

  step(tick: number, seats: Iterable<Seat>, collected: (seat: Seat, kind: number) => void): void {
    for (const [id, p] of this.pickups) if (tick >= p.expires) this.pickups.delete(id);
    const living = [...seats].filter((s) => s.sim.alive && s.respawnAt < 0);
    if (tick >= this.nextSpawn) {
      this.nextSpawn = tick + DM.powerEverySeconds * TICK_RATE;
      if (this.pickups.size < DM.powerMax) this.spawn(tick, living);
    }
    for (const [id, p] of this.pickups) {
      // One winner per pickup, even if several players arrive in the same tick.
      const nearby = living.filter((s) => s.protect === 0 && Math.hypot(s.sim.x - p.x, s.sim.y + 0.8 - p.y, s.sim.z - p.z) <= DM.powerRadius);
      nearby.sort((a, b) => Math.hypot(a.sim.x - p.x, a.sim.z - p.z) - Math.hypot(b.sim.x - p.x, b.sim.z - p.z) || a.pid - b.pid);
      const seat = nearby.find((s) => this.visible(s, p));
      if (!seat) continue;
      seat.sim.dmPower = p.kind;
      seat.sim.dmPowerTicks = DM.powerDurationSeconds * TICK_RATE;
      seat.sim.dmShield = p.kind === DmPower.Armor ? DM.shieldHp : 0;
      this.pickups.delete(id);
      collected(seat, p.kind);
    }
  }

  private visible(s: Seat, p: PowerPickup): boolean {
    const from = { x: s.sim.x, y: s.sim.y + 0.8, z: s.sim.z };
    const dx = p.x - from.x, dy = p.y - from.y, dz = p.z - from.z;
    const d = Math.hypot(dx, dy, dz);
    if (d < 0.01) return true;
    const ray = new this.world.rapier.Ray(from, { x: dx / d, y: dy / d, z: dz / d });
    const hit = this.world.world.castRay(ray, d, true, undefined, OPAQUE_QUERY_GROUPS);
    return !hit || hit.timeOfImpact >= d;
  }

  private spawn(tick: number, living: Seat[]): void {
    const map = this.world.map;
    const points = map.arenaSpawns.length ? map.arenaSpawns : map.spawns;
    const candidates = points.filter(([x, , z]) =>
      living.every((s) => Math.hypot(s.sim.x - x, s.sim.z - z) >= 8) &&
      [...this.pickups.values()].every((p) => Math.hypot(p.x - x, p.z - z) >= 6));
    const at = candidates[Math.floor(Math.random() * candidates.length)];
    if (!at) return;
    const [x, y, z] = at;
    const ground = groundHeightAt(this.world, x, y + (map.id === 'greybox' ? 3 : 0.3), z);
    const id = String(++this.serial);
    this.pickups.set(id, { id, kind: 1 + Math.floor(Math.random() * 3), x, y: ground + 0.8, z, expires: tick + DM.powerLifetimeSeconds * TICK_RATE });
  }
}
