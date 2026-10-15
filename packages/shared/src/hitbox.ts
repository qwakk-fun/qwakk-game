/**
 * Server hitboxes: a head sphere and a body capsule per player, stance aware.
 * Never the skinned mesh. Ray tests are analytic and deterministic.
 *
 * Hitboxes follow the VISUAL duck in each stance, not the movement capsule:
 * the head top is at 1.62 m standing and 1.30 m crouched (art), while the
 * crouched movement capsule is only 1.15 m tall so ducks fit under low cover.
 * The tuft is not part of the head. Heights are from the feet.
 */
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

/** Nearest hit of a ray against one player's hitboxes within maxT, or null. */
export function rayHitbox(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, target: HitTarget, maxT: number): RayHit | null {
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
