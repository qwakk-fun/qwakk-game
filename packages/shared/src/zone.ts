/**
 * The safe zone: the circle plan (final circle first, from the map's
 * weighted candidates, then grown outward so every circle contains the next)
 * and the timeline (wait, shrink, damage per phase). Pure and seeded, so it is
 * unit tested; the server runs it and sends the result, clients only draw it.
 */
import { ZONE } from './constants.ts';
import type { MapDef } from './map.ts';
import { terrainHeightAt } from './map.ts';
import { dcos, dsin } from './math.ts';
import { createRng } from './rng.ts';

export interface Circle {
  x: number;
  z: number;
  r: number;
}

export interface ZonePhase {
  waitS: number;
  shrinkS: number;
  radius: number;
  dps: number;
}

/** The zone at a moment: where it is now, where it goes, and when (ms since the match start). */
export interface ZoneNow {
  phase: number;
  /** Circle before the shrink, and the target after it. */
  from: Circle;
  to: Circle;
  t0: number;
  t1: number;
  /** Is the target announced? */
  shown: boolean;
  dps: number;
}

/** Share of land (terrain above the sea) inside a circle, sampled on a grid. */
export function landShare(map: MapDef, c: Circle, samples = 14): number {
  let inside = 0;
  let land = 0;
  for (let i = 0; i < samples; i++) {
    for (let j = 0; j < samples; j++) {
      const x = c.x - c.r + ((i + 0.5) / samples) * 2 * c.r;
      const z = c.z - c.r + ((j + 0.5) / samples) * 2 * c.r;
      if ((x - c.x) ** 2 + (z - c.z) ** 2 > c.r * c.r) continue;
      inside++;
      if (terrainHeightAt(map.terrain, x, z) > 0.5) land++;
    }
  }
  return inside === 0 ? 1 : land / inside;
}

/** Loot spots of the map inside a circle (where the houses and the ducks are). */
export function lootInside(map: MapDef, c: Circle): number {
  let n = 0;
  const r2 = c.r * c.r;
  for (const p of map.br?.loot ?? []) if ((p.x - c.x) ** 2 + (p.z - c.z) ** 2 <= r2) n++;
  return n;
}

/**
 * Circles for phases 0..n-1 (circle k is where phase k ends). Seeded: the
 * same seed and map give the same plan.
 */
export function planCircles(map: MapDef, seed: number, phases: readonly ZonePhase[] = ZONE.phases): Circle[] {
  const rng = createRng((seed ^ 0x5a17c1e5) >>> 0);
  const n = phases.length;
  const out: Circle[] = new Array(n);
  const cands = map.br?.finalCandidates ?? [];
  let fx = 0;
  let fz = 0;
  if (cands.length > 0) {
    let total = 0;
    for (const c of cands) total += c.weight;
    let u = rng() * total;
    let pick = cands[0] as (typeof cands)[number];
    for (const c of cands) {
      u -= c.weight;
      if (u < 0) {
        pick = c;
        break;
      }
    }
    const a = rng() * 6.283185307179586;
    const d = Math.sqrt(rng()) * pick.r * 0.5;
    fx = pick.x + dcos(a) * d;
    fz = pick.z + dsin(a) * d;
  }
  const lastR = (phases[n - 1] as ZonePhase).radius;
  out[n - 1] = { x: fx, z: fz, r: lastR };
  const half = map.size / 2;
  for (let k = n - 2; k >= 0; k--) {
    const next = out[k + 1] as Circle;
    const r = (phases[k] as ZonePhase).radius;
    const slack = r - next.r;
    let best: Circle | null = null;
    let bestScore = -1;
    for (let tries = 0; tries < 10; tries++) {
      const a = rng() * 6.283185307179586;
      const d = (0.25 + rng() * 0.6) * slack;
      let x = next.x + dcos(a) * d;
      let z = next.z + dsin(a) * d;
      // Keep big circles over the island: the center may not wander far out.
      const lim = Math.max(0, half - r * 0.9);
      x = Math.max(-lim, Math.min(lim, x));
      z = Math.max(-lim, Math.min(lim, z));
      // Clamping can break containment: pull back toward the next circle until it fits.
      const ox = x - next.x;
      const oz = z - next.z;
      const off = Math.sqrt(ox * ox + oz * oz);
      if (off > slack) {
        x = next.x + (ox / off) * slack;
        z = next.z + (oz / off) * slack;
      }
      const c = { x, z, r };
      // Enough land first (circles up to landCheckMaxRadius), then the most loot spots
      // inside: the populated part of the island, so the ducks meet soon.
      const share = r > ZONE.landCheckMaxRadius ? 1 : landShare(map, c);
      const score = (share >= ZONE.minLandShare ? 1e6 : share * 1e5) + lootInside(map, c);
      if (score > bestScore) {
        best = c;
        bestScore = score;
      }
    }
    out[k] = best as Circle;
  }
  return out;
}

/** Total length of the zone timeline (s). */
export function zoneDuration(phases: readonly ZonePhase[] = ZONE.phases): number {
  let t = 0;
  for (const p of phases) t += p.waitS + p.shrinkS;
  return t;
}

/** The zone at `tMs` since the match start. */
export function zoneAt(plan: readonly Circle[], tMs: number, phases: readonly ZonePhase[] = ZONE.phases): ZoneNow {
  let start = 0;
  let from: Circle = { x: 0, z: 0, r: ZONE.startRadius };
  for (let k = 0; k < phases.length; k++) {
    const p = phases[k] as ZonePhase;
    const to = plan[k] as Circle;
    const t0 = start + p.waitS * 1000;
    const t1 = t0 + p.shrinkS * 1000;
    if (tMs < t1 || k === phases.length - 1) {
      const shown = k === 0 ? tMs >= ZONE.firstShownS * 1000 : true;
      return { phase: k, from, to, t0, t1, shown, dps: k === 0 ? 0 : p.dps };
    }
    from = to;
    start = t1;
  }
  const last = plan[plan.length - 1] as Circle;
  return { phase: phases.length - 1, from: last, to: last, t0: 0, t1: 0, shown: true, dps: (phases[phases.length - 1] as ZonePhase).dps };
}

/** The circle as it is at `tMs` (interpolated during a shrink). Phase 0 uses its own damage rule: none. */
export function circleAt(z: { from: Circle; to: Circle; t0: number; t1: number }, tMs: number): Circle {
  if (tMs <= z.t0) return z.from;
  if (tMs >= z.t1) return z.to;
  const u = (tMs - z.t0) / Math.max(1, z.t1 - z.t0);
  return { x: z.from.x + (z.to.x - z.from.x) * u, z: z.from.z + (z.to.z - z.from.z) * u, r: z.from.r + (z.to.r - z.from.r) * u };
}

/** Outside the circle? */
export function outsideCircle(c: Circle, x: number, z: number): boolean {
  const dx = x - c.x;
  const dz = z - c.z;
  return dx * dx + dz * dz > c.r * c.r;
}
