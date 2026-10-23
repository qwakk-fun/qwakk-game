/**
 * Server hitboxes: a head sphere and a body capsule per player, stance aware.
 * Never the skinned mesh. Ray tests are analytic and deterministic.
 *
 * Hitboxes follow the VISUAL duck in each stance, not the movement capsule:
 * the head top is at 1.62 m standing and 1.30 m crouched (art), while the
 * crouched movement capsule is only 1.15 m tall so ducks fit under low cover.
 * The tuft is not part of the head. Heights are from the feet.
 */
import { dcos, dsin } from './math.ts';
export const HITBOX = {
  // Head sphere center and radius; body capsule segment (lo..hi) and radius.
  stand: { headY: 1.36, headR: 0.26, bodyLo: 0.35, bodyHi: 1.0, bodyR: 0.33 },
  crouch: { headY: 1.04, headR: 0.26, bodyLo: 0.3, bodyHi: 0.72, bodyR: 0.33 },
} as const;

export interface HitTarget {
  id: string;
  x: number;
  y: number;
  z: number;
  crouch: number;
  /**
   * Not a duck (Hunt Season hunters, traps): its own head sphere and body
   * capsule (raid/hunters.ts), turned by `yaw`. Ducks never carry one: every
   * duck uses HITBOX above.
   */
  shape?: HitShape;
  /** The facing of a `shape` target (sim yaw: forward is (-sin, -cos)). */
  yaw?: number;
}

/**
 * A non-duck hitbox in the target's own frame: `f` is meters forward (along
 * its facing), `y` meters up from the feet. Head sphere [f, y, r]; body
 * capsule from [f0, y0] to [f1, y1] with radius r (vertical for people,
 * lying along the body for a dog).
 */
export interface HitShape {
  head: readonly [number, number, number];
  body: readonly [number, number, number, number, number];
}

export interface RayHit {
  t: number;
  head: boolean;
}

/** Ray (origin o, unit dir d) vs sphere. Returns the entry distance or -1. */
export function raySphere(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, cx: number, cy: number, cz: number, r: number): number {
  const mx = ox - cx;
  const my = oy - cy;
  const mz = oz - cz;
  const b = mx * dx + my * dy + mz * dz;
  const c = mx * mx + my * my + mz * mz - r * r;
  if (c > 0 && b > 0) return -1;
  const disc = b * b - c;
  if (disc < 0) return -1;
  const t = -b - Math.sqrt(disc);
  return t < 0 ? 0 : t;
}

/** Ray vs vertical capsule (segment from y0 to y1 at x, z, radius r). Returns the entry distance or -1. */
export function rayVerticalCapsule(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, x: number, y0: number, y1: number, z: number, r: number): number {
  // Infinite cylinder part (axis along y).
  let best = -1;
  const px = ox - x;
  const pz = oz - z;
  const a = dx * dx + dz * dz;
  if (a > 1e-12) {
    const b = px * dx + pz * dz;
    const c = px * px + pz * pz - r * r;
    const disc = b * b - a * c;
    if (disc >= 0) {
      const t = (-b - Math.sqrt(disc)) / a;
      const y = oy + dy * t;
      if (t >= 0 && y >= y0 && y <= y1) best = t;
      else if (c <= 0 && oy >= y0 && oy <= y1) best = 0; // starts inside
    }
  }
  // End caps.
  for (const cy of [y0, y1]) {
    const t = raySphere(ox, oy, oz, dx, dy, dz, x, cy, z, r);
    if (t >= 0 && (best < 0 || t < best)) best = t;
  }
  return best;
}

/**
 * Ray vs a capsule around the segment a..b (radius r). Returns the entry
 * distance or -1. Used for non-duck hitboxes (a dog's body lies along it).
 */
export function rayCapsule(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, ax: number, ay: number, az: number, bx: number, by: number, bz: number, r: number): number {
  const abx = bx - ax;
  const aby = by - ay;
  const abz = bz - az;
  const len2 = abx * abx + aby * aby + abz * abz;
  let best = -1;
  if (len2 > 1e-12) {
    // Infinite cylinder around the axis: remove the axis component from the ray and the offset.
    const aox = ox - ax;
    const aoy = oy - ay;
    const aoz = oz - az;
    const dAb = (dx * abx + dy * aby + dz * abz) / len2;
    const oAb = (aox * abx + aoy * aby + aoz * abz) / len2;
    const px = dx - abx * dAb;
    const py = dy - aby * dAb;
    const pz = dz - abz * dAb;
    const qx = aox - abx * oAb;
    const qy = aoy - aby * oAb;
    const qz = aoz - abz * oAb;
    const a = px * px + py * py + pz * pz;
    const b = px * qx + py * qy + pz * qz;
    const c = qx * qx + qy * qy + qz * qz - r * r;
    if (a > 1e-12) {
      const disc = b * b - a * c;
      if (disc >= 0) {
        const t = (-b - Math.sqrt(disc)) / a;
        const u = oAb + dAb * t;
        if (t >= 0 && u >= 0 && u <= 1) best = t;
        else if (c <= 0 && oAb >= 0 && oAb <= 1) best = 0;
      }
    }
  }
  for (const [cx, cy, cz] of [[ax, ay, az], [bx, by, bz]] as const) {
    const t = raySphere(ox, oy, oz, dx, dy, dz, cx, cy, cz, r);
    if (t >= 0 && (best < 0 || t < best)) best = t;
  }
  return best;
}

/** A non-duck target (raid/hunters.ts shapes): its head sphere and body capsule, turned by its yaw. */
function rayShape(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, target: HitTarget, shape: HitShape, maxT: number): RayHit | null {
  // Forward of a sim yaw is (-sin, -cos); dsin/dcos like everything shared.
  const yaw = target.yaw ?? 0;
  const fx = -dsin(yaw);
  const fz = -dcos(yaw);
  const [hf, hy, hr] = shape.head;
  const [f0, y0, f1, y1, br] = shape.body;
  const head = hr > 0 ? raySphere(ox, oy, oz, dx, dy, dz, target.x + fx * hf, target.y + hy, target.z + fz * hf, hr) : -1;
  const body = rayCapsule(ox, oy, oz, dx, dy, dz, target.x + fx * f0, target.y + y0, target.z + fz * f0, target.x + fx * f1, target.y + y1, target.z + fz * f1, br);
  let t = -1;
  let isHead = false;
  if (head >= 0) {
    t = head;
    isHead = true;
  }
  if (body >= 0 && (t < 0 || body < t)) {
    t = body;
    isHead = false;
  }
  if (t < 0 || t > maxT) return null;
  return { t, head: isHead };
}

/** Nearest hit of a ray against one player's hitboxes within maxT, or null. */
export function rayHitbox(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, target: HitTarget, maxT: number): RayHit | null {
  if (target.shape) return rayShape(ox, oy, oz, dx, dy, dz, target, target.shape, maxT);
  const h = target.crouch ? HITBOX.crouch : HITBOX.stand;
  const head = raySphere(ox, oy, oz, dx, dy, dz, target.x, target.y + h.headY, target.z, h.headR);
  const body = rayVerticalCapsule(ox, oy, oz, dx, dy, dz, target.x, target.y + h.bodyLo, target.y + h.bodyHi, target.z, h.bodyR);
  let t = -1;
  let isHead = false;
  if (head >= 0) {
    t = head;
    isHead = true;
  }
  if (body >= 0 && (t < 0 || body < t)) {
    t = body;
    isHead = false;
  }
  if (t < 0 || t > maxT) return null;
  return { t, head: isHead };
}
