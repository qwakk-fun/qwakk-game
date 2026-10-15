/**
 * Line of sight for the anti-wallhack culling: can a viewer plausibly see a
 * target right now? Conservative on purpose (a visible duck must never be
 * hidden): rays from the viewer's eye and from where its third-person camera
 * can be (both shoulders, pulled back) to several points on the target,
 * widened by a margin. Only opaque static geometry blocks (walls, hedges,
 * terrain); bushes, wire and fences do not. Rays that start inside a
 * collider ignore it (a camera clipped into a wall still sees out).
 */
import { OPAQUE_QUERY_GROUPS, type SimWorld } from '@qwakk/shared';

export interface ViewPoint {
  x: number;
  y: number;
  z: number;
  yaw: number;
  crouch: number;
}

export interface TargetPoint {
  x: number;
  y: number;
  z: number;
  crouch: number;
}

/** Shoulder offset and arm length of the client camera (camera/tpsCamera.ts), plus a little slack. */
const CAM = { side: 0.8, up: 0.35, back: 3.2 } as const;
/** Half width used for the target's side points: wider than the duck, so it shows a moment early. */
const MARGIN = 0.6;

export class Visibility {
  private readonly sim: SimWorld;
  private readonly from: { x: number; y: number; z: number }[] = [0, 1, 2].map(() => ({ x: 0, y: 0, z: 0 }));
  private readonly to: { x: number; y: number; z: number }[] = [0, 1, 2, 3, 4].map(() => ({ x: 0, y: 0, z: 0 }));
  private readonly dir = { x: 0, y: 0, z: 0 };
  /** Ray count since the last reset (benchmark). */
  rays = 0;

  constructor(sim: SimWorld) {
    this.sim = sim;
  }

  /** Is the segment a to b free of opaque geometry? */
  clear(ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean {
    const dx = bx - ax;
    const dy = by - ay;
    const dz = bz - az;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d < 0.05) return true;
    const dir = this.dir;
    dir.x = dx / d;
    dir.y = dy / d;
    dir.z = dz / d;
    this.rays++;
    const hit = this.sim.world.castRay(new this.sim.rapier.Ray({ x: ax, y: ay, z: az }, dir), d, false, undefined, OPAQUE_QUERY_GROUPS);
    return !hit || hit.timeOfImpact > d - 0.3;
  }

  canSee(v: ViewPoint, t: TargetPoint): boolean {
    const eyeY = v.y + (v.crouch ? 1.0 : 1.55);
    const fx = -Math.sin(v.yaw);
    const fz = -Math.cos(v.yaw);
    const rx = Math.cos(v.yaw);
    const rz = -Math.sin(v.yaw);
    const from = this.from;
    from[0] = { x: v.x, y: eyeY, z: v.z };
    from[1] = { x: v.x + rx * CAM.side - fx * CAM.back, y: eyeY + CAM.up, z: v.z + rz * CAM.side - fz * CAM.back };
    from[2] = { x: v.x - rx * CAM.side - fx * CAM.back, y: eyeY + CAM.up, z: v.z - rz * CAM.side - fz * CAM.back };

    // Target points: head, chest, feet, and both sides of the chest (perpendicular to the line of sight).
    let px = t.x - v.x;
    let pz = t.z - v.z;
    const pl = Math.hypot(px, pz) || 1;
    px /= pl;
    pz /= pl;
    const headY = t.y + (t.crouch ? 1.1 : 1.45);
    const chestY = t.y + (t.crouch ? 0.65 : 0.9);
    const to = this.to;
    to[0] = { x: t.x, y: chestY, z: t.z };
    to[1] = { x: t.x, y: headY, z: t.z };
    to[2] = { x: t.x + pz * MARGIN, y: chestY, z: t.z - px * MARGIN };
    to[3] = { x: t.x - pz * MARGIN, y: chestY, z: t.z + px * MARGIN };
    to[4] = { x: t.x, y: t.y + 0.25, z: t.z };

    for (const a of from) {
      for (const b of to) {
        if (this.clear(a.x, a.y, a.z, b.x, b.y, b.z)) return true;
      }
    }
    return false;
  }

  /** One cheap ray: eye to chest (predictive checks). */
  quick(v: ViewPoint, t: TargetPoint): boolean {
    return this.clear(v.x, v.y + (v.crouch ? 1.0 : 1.55), v.z, t.x, t.y + 0.9, t.z);
  }
}
