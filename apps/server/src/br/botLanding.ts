/**
 * Bot drop planning: where to land (a loot spot, weighted by how busy and
 * rich its zone is, by how far it is from the public plane route and by the
 * announced first circle), when to jump, and how to fly there. Server only.
 *
 * The flight is the fast drop a good player does: dive in freefall straight
 * at the spot, open the glider at the last height from which a diving glide
 * still reaches it (or where it opens by itself), then dive the glider down
 * and spiral over the spot instead of braking above it (braking sinks only
 * 3 m/s, which kept bots hanging over their spot for half a minute).
 */
import { Button, DROP, DT, Mode, overLand, planeAt, terrainHeightAt, type Circle, type MapDef, type PlaneRoute, type PlayerSim } from '@qwakk/shared';

export interface LandingPlan {
  x: number;
  z: number;
  /** Seconds after the plane starts its path. */
  jumpAt: number;
}

const HEAT: Record<string, number> = { hot: 3, medium: 2, quiet: 1.2 };
/**
 * How far sideways from the route a bot picks a spot (m). A fast drop
 * (freefall, then the glider from where it opens by itself) covers about
 * 120 m sideways; farther spots need an early glider and a long flight.
 */
const REACH = 170;
/** Spot weight inside and outside the announced first circle. */
const IN_CIRCLE = 1.8;
const OUT_CIRCLE = 0.35;
/** Glide ratios (forward per meter down): diving and cruising. */
const DIVE_RATIO = DROP.glideDiveForward / DROP.glideDiveSink;
const CRUISE_RATIO = DROP.glideForward / DROP.glideSink;
/** Height the glider loses while it brakes a full-speed fall (m, about a second at DROP.sinkRate). */
const OPEN_LOSS = 22;
/** Spiral over the spot within this radius (m) while there is height to lose. */
const ORBIT_R = 14;

const rand = (a: number, b: number): number => a + Math.random() * (b - a);

/** Distance from (x, z) to the route line and the time the plane is closest to it. */
function closestOnRoute(r: PlaneRoute, x: number, z: number): { d: number; t: number } {
  const along = Math.max(0, Math.min(r.length, (x - r.fromX) * r.dirX + (z - r.fromZ) * r.dirZ));
  const px = r.fromX + r.dirX * along;
  const pz = r.fromZ + r.dirZ * along;
  return { d: Math.hypot(x - px, z - pz), t: along / r.speed };
}

/**
 * Pick a landing spot. `taken` are the spots other bots of this match chose:
 * spots near them weigh less (much less right next to one), so bots spread
 * over the island and seldom land on top of each other. `circle` is the announced first
 * circle (public), when it is up; spots the plane passed before `notBefore`
 * (seconds) are behind it and weigh little.
 */
export function planLanding(map: MapDef, route: PlaneRoute | null, taken: { x: number; z: number }[] = [], circle: Circle | null = null, notBefore = 0): LandingPlan {
  const br = map.br;
  const loot = br?.loot ?? [];
  if (!route || !br || loot.length === 0) return { x: 0, z: 0, jumpAt: 1 };
  // Weight per zone: heat x tier, fading with the distance from the route.
  const zoneWeight = br.zones.map((zn) => (HEAT[zn.drop] ?? 1) * (0.6 + zn.tier * 0.4));
  const weights: number[] = [];
  let total = 0;
  for (const p of loot) {
    const { d, t } = closestOnRoute(route, p.x, p.z);
    let w = (zoneWeight[p.zone] ?? 1) * Math.max(0, 1 - d / REACH) ** 1.5;
    if (t > route.ejectS) w *= 0.02;
    if (t < notBefore + 0.5) w *= 0.02;
    if (p.container !== 0) w *= 1.3;
    if (circle) w *= Math.hypot(p.x - circle.x, p.z - circle.z) < circle.r * 0.9 ? IN_CIRCLE : OUT_CIRCLE;
    for (const t2 of taken) {
      if (Math.abs(t2.x - p.x) > 110 || Math.abs(t2.z - p.z) > 110) continue;
      const d2 = Math.hypot(t2.x - p.x, t2.z - p.z);
      if (d2 < 40) w *= 0.03;
      else if (d2 < 110) w *= 0.3;
    }
    weights.push(w);
    total += w;
  }
  let u = Math.random() * total;
  let pick = loot[0]!;
  for (let i = 0; i < loot.length; i++) {
    u -= weights[i]!;
    if (u <= 0) {
      pick = loot[i]!;
      break;
    }
  }
  const { t } = closestOnRoute(route, pick.x, pick.z);
  // Jump about when the plane passes the spot: the duck keeps a little of the plane's way and dives sideways.
  let jumpAt = Math.max(0.5, notBefore, Math.min(route.ejectS - 0.3, t - 0.6 + rand(-0.6, 0.4)));
  // Only over land: walk the jump time forward until the plane is over land.
  for (let k = 0; k < 40 && !landAt(map, route, jumpAt); k++) jumpAt = Math.min(route.ejectS, jumpAt + 0.5);
  const plan = { x: pick.x + rand(-2, 2), z: pick.z + rand(-2, 2), jumpAt };
  taken.push({ x: plan.x, z: plan.z });
  return plan;
}

function landAt(map: MapDef, r: PlaneRoute, t: number): boolean {
  const p = planeAt(r, t);
  return overLand(map, p.x, p.z);
}

export interface DropSteer {
  /** Facing (the drop flies where the duck looks). */
  yaw: number;
  mz: number;
  buttons: number;
}

/**
 * Steering in the air toward (tx, tz). Freefall dives at the spot and opens
 * the glider once a diving glide from any lower would fall short of it.
 * Gliding cruises while the spot is far for the height left, dives when
 * there is height to spare and spirals over the spot until it is low, then
 * brakes for the touchdown.
 */
export function dropSteer(map: MapDef, self: PlayerSim, tx: number, tz: number, tick: number): DropSteer {
  const dx = tx - self.x;
  const dz = tz - self.z;
  const d = Math.hypot(dx, dz);
  const bearing = Math.atan2(-dx, -dz);
  const h = self.y - terrainHeightAt(map.terrain, self.x, self.z);
  if (self.mode === Mode.Freefall) {
    // Keep falling while a diving glide opened now could still reach the spot (with a margin, and the
    // height the glider loses while it slows the fall). Opens late, so the long part is the fast fall.
    const reach = Math.max(0, h - OPEN_LOSS) * DIVE_RATIO * 0.85;
    const fallen = self.air * DT * DROP.freefallSpeed * 0.5;
    if (d > reach && fallen > DROP.minFallBeforeOpen + 1) return { yaw: bearing, mz: 0, buttons: tick % 2 === 0 ? Button.Deploy : 0 };
    return { yaw: bearing, mz: d > 3 ? 1 : 0, buttons: 0 };
  }
  // Glide.
  if (h < 5) return { yaw: bearing, mz: d < 6 ? -1 : 0, buttons: 0 };
  // Too far for a dive from here: cruise (the best ratio).
  if (d > h * DIVE_RATIO * 0.9) return { yaw: bearing, mz: d > h * CRUISE_RATIO ? 0 : 0.3, buttons: 0 };
  // Height to spare: dive at the spot, and spiral around it once there (about 110 degrees off the bearing).
  if (d < ORBIT_R) return { yaw: bearing + 1.9, mz: 1, buttons: 0 };
  return { yaw: bearing, mz: 1, buttons: 0 };
}
