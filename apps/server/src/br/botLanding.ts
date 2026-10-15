/**
 * Bot drop planning: where to land (a loot spot, weighted by how busy and
 * rich its zone is and by how far it is from the public plane route), when
 * to jump, and how to fly there (dive, glide, brake). Server only.
 */
import { Button, DROP, Mode, overLand, planeAt, terrainHeightAt, type MapDef, type PlaneRoute, type PlayerSim } from '@qwakk/shared';

export interface LandingPlan {
  x: number;
  z: number;
  /** Seconds after the plane starts its path. */
  jumpAt: number;
}

const HEAT: Record<string, number> = { hot: 3, medium: 2, quiet: 1.2 };
/** How far sideways from the route a bot is willing to glide (m). */
const REACH = 420;

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
 * spots near them weigh less, so bots spread over the island (a few still
 * pile into the hot zones, like players do).
 */
export function planLanding(map: MapDef, route: PlaneRoute | null, taken: { x: number; z: number }[] = []): LandingPlan {
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
    if (t > route.ejectS) w *= 0.2;
    if (p.container !== 0) w *= 1.3;
    for (const t2 of taken) if (Math.abs(t2.x - p.x) < 110 && Math.abs(t2.z - p.z) < 110 && Math.hypot(t2.x - p.x, t2.z - p.z) < 110) w *= 0.15;
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
  const { d, t } = closestOnRoute(route, pick.x, pick.z);
  // Jump a little before the closest point when the target is far to the side: the glide is diagonal.
  let jumpAt = Math.max(0.5, Math.min(route.ejectS - 0.3, t - d / 90 + rand(-1.2, 0.8)));
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

/**
 * Steering in the air toward (tx, tz): forward input and buttons. Freefall
 * dives while the target is close below; the glider opens when the target is
 * far for the height left. Gliding dives when there is height to spare and
 * brakes over the target.
 */
export function dropSteer(map: MapDef, self: PlayerSim, tx: number, tz: number, tick: number): { mz: number; buttons: number } {
  const d = Math.hypot(tx - self.x, tz - self.z);
  const h = self.y - terrainHeightAt(map.terrain, self.x, self.z);
  if (self.mode === Mode.Freefall) {
    // Freefall covers about 1 m sideways per 3 m down; open early when that is not enough.
    const needGlide = d > (h - DROP.autoOpenHeight) * 0.3 + 20;
    if (needGlide && self.air > 10) return { mz: 0, buttons: tick % 2 === 0 ? Button.Deploy : 0 };
    return { mz: d < 25 ? 1 : 0.6, buttons: 0 };
  }
  // Glide: about 3 m forward per meter down at cruise.
  const spare = h * 3 - d;
  if (d < 6) return { mz: -1, buttons: 0 };
  if (spare > 120) return { mz: 1, buttons: 0 };
  if (spare > 40) return { mz: 0.5, buttons: 0 };
  return { mz: 0, buttons: 0 };
}
