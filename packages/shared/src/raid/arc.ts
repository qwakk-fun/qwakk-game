/**
 * Hunt Season katana hit shapes and the sweep that finds what a swing cuts.
 * Pure (no Rapier): the server runs it against the hunters as the duck saw
 * them (lag compensated) and decides; the client runs the same test against
 * the hunters as drawn, for feedback only (the hit-stop, the sparks), never
 * for damage.
 *
 * Shapes are slices of a disc around the duck's feet (or a disc a little in
 * front of it), from the art contract (`apps/client/public/models/melee/
 * melee.json` arcs: the blade's measured reach and sweep), with some reach
 * added for forgiveness: a horde game wants a swing that clearly cuts the
 * hunter it touches on screen. The client draws the slash arc at the same
 * radius. Times and these sizes are constants (the client draws them);
 * upgrades that widen a swing only scale the server's copy (`reachScale`).
 */
import type { HitShape, HitTarget } from '../hitbox.ts';
import { dcos, dsin } from '../math.ts';

export interface BladeShape {
  /** Radius of the slice (m) from its center. */
  reach: number;
  /** Half the slice's angle (rad); Math.PI is a full circle. */
  half: number;
  /** The slice's center, this far ahead of the feet (m). */
  ahead: number;
  /** Turned this far to the duck's right (rad). */
  turn: number;
  /** Height window above the duck's feet (m). */
  lo: number;
  hi: number;
}

const deg = (d: number): number => (d * Math.PI) / 180;

export const BLADE_SHAPES = {
  /** Slash 1 (art: reach 1.34 m, swept 219 deg, a little to the right): a wide cut in front. */
  slash1: { reach: 2.6, half: deg(95), ahead: 0, turn: deg(10), lo: -0.4, hi: 2.4 },
  /** Slash 2 (art: reach 1.33 m, swept 198 deg): the back-cut. */
  slash2: { reach: 2.6, half: deg(95), ahead: 0, turn: deg(-5), lo: -0.4, hi: 2.4 },
  /** Slash 3, the overhead chop (art: a 1.1 m circle 0.86 m ahead): a lunge that splits the line in front. */
  slash3: { reach: 1.9, half: Math.PI, ahead: 1.5, turn: 0, lo: -0.6, hi: 2.6 },
  /** The heavy spin (art: a full turn, 1.61 m): everything around, more with the charge (heavyReach). */
  heavy: { reach: 3.0, half: Math.PI, ahead: 0, turn: 0, lo: -0.6, hi: 2.4 },
  /** One pulse of the Blade Storm (art Ultimate_Spin: 1.69 m). */
  storm: { reach: 3.0, half: Math.PI, ahead: 0, turn: 0, lo: -0.6, hi: 2.4 },
  /** The quack shockwave (art: a ring growing from 0.5 to 4.5 m). */
  quack: { reach: 5.5, half: Math.PI, ahead: 0, turn: 0, lo: -1.2, hi: 3.0 },
} as const satisfies Record<string, BladeShape>;

/** Extra reach of a fully charged heavy spin (m). */
export const HEAVY_EXTRA_REACH = 0.9;
/** How wide the dash cuts along its path (m, around the duck's line). */
export const DASH_CUT_RADIUS = 1.2;

/** The heavy spin's shape for a charge 0 to 1. */
export function heavyShape(charge: number): BladeShape {
  return { ...BLADE_SHAPES.heavy, reach: BLADE_SHAPES.heavy.reach + HEAVY_EXTRA_REACH * Math.max(0, Math.min(1, charge)) };
}

export interface ArcHit {
  id: string;
  /** Distance from the slice's center to the target's body (m). */
  dist: number;
  /** The body point nearest the duck (where sparks fly). */
  x: number;
  y: number;
  z: number;
  /** Hit from behind (the duck stands behind the target's back): a back-stab. */
  back: boolean;
}

/**
 * Every target whose body capsule reaches into the slice: the nearest point
 * of its body axis (on the ground plane) within `reach` plus its radius, at
 * an angle inside the slice (widened by the body's width), and its height
 * overlapping the window. `yaw` is the duck's facing (sim yaw: forward is
 * (-sin, -cos)); `reachScale` widens it (server upgrades). Sorted nearest
 * first.
 */
export function bladeArcHits(x: number, y: number, z: number, yaw: number, shape: BladeShape, targets: readonly HitTarget[], reachScale = 1): ArcHit[] {
  const fx = -dsin(yaw);
  const fz = -dcos(yaw);
  const cx = x + fx * shape.ahead;
  const cz = z + fz * shape.ahead;
  const aim = yaw - shape.turn;
  const ax = -dsin(aim);
  const az = -dcos(aim);
  const reach = shape.reach * reachScale;
  const out: ArcHit[] = [];
  for (const t of targets) {
    const body = t.shape?.body ?? DUCKLIKE.body;
    const ty = t.yaw ?? 0;
    const tfx = -dsin(ty);
    const tfz = -dcos(ty);
    const r = body[4];
    // The body axis in the world (a dog's lies along it).
    const p0x = t.x + tfx * body[0];
    const p0z = t.z + tfz * body[0];
    const p1x = t.x + tfx * body[2];
    const p1z = t.z + tfz * body[2];
    const lo = t.y + Math.min(body[1], body[3]) - r;
    const hi = Math.max(t.y + Math.max(body[1], body[3]) + r, t.y + (t.shape?.head[1] ?? 1.5) + (t.shape?.head[2] ?? 0.2));
    if (hi < y + shape.lo || lo > y + shape.hi) continue;
    // Nearest point of the axis to the slice center (ground plane).
    const sx = p1x - p0x;
    const sz = p1z - p0z;
    const len2 = sx * sx + sz * sz;
    const u = len2 > 1e-8 ? Math.max(0, Math.min(1, ((cx - p0x) * sx + (cz - p0z) * sz) / len2)) : 0;
    const px = p0x + sx * u;
    const pz = p0z + sz * u;
    const dx = px - cx;
    const dz = pz - cz;
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d - r > reach) continue;
    if (shape.half < Math.PI - 1e-6 && d > 1e-3) {
      const cos = (dx * ax + dz * az) / d;
      const ang = Math.acos(Math.max(-1, Math.min(1, cos)));
      const widen = Math.asin(Math.min(1, r / Math.max(r, d)));
      if (ang > shape.half + widen) continue;
    }
    // Behind its back: the duck is on the side the target faces away from.
    const back = (x - t.x) * tfx + (z - t.z) * tfz < -0.2;
    out.push({ id: t.id, dist: Math.max(0, d - r), x: px - (d > 1e-3 ? (dx / d) * r : 0), y: y + 1, z: pz - (d > 1e-3 ? (dz / d) * r : 0), back });
  }
  out.sort((a, b) => a.dist - b.dist);
  return out;
}

/** Targets the dash's path cuts: within DASH_CUT_RADIUS of the segment from (x0, z0) to (x1, z1), at about the duck's height. */
export function dashPathHits(x0: number, y: number, z0: number, x1: number, z1: number, targets: readonly HitTarget[]): string[] {
  const sx = x1 - x0;
  const sz = z1 - z0;
  const len2 = sx * sx + sz * sz;
  const out: string[] = [];
  for (const t of targets) {
    if (Math.abs(t.y - y) > 2.2) continue;
    const u = len2 > 1e-8 ? Math.max(0, Math.min(1, ((t.x - x0) * sx + (t.z - z0) * sz) / len2)) : 0;
    const dx = t.x - (x0 + sx * u);
    const dz = t.z - (z0 + sz * u);
    const r = t.shape?.body[4] ?? 0.3;
    if (dx * dx + dz * dz <= (DASH_CUT_RADIUS + r) ** 2) out.push(t.id);
  }
  return out;
}

/** A target without a shape (never a duck here: ducks are allies in Hunt Season): a person-sized capsule. */
const DUCKLIKE: HitShape = { head: [0, 1.5, 0.2], body: [0, 0.25, 0, 1.3, 0.25] };
