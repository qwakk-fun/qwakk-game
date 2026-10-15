/**
 * Rapier world built from a MapDef. Client and server build the exact same
 * static colliders, so the character controller gives the same answers on both.
 *
 * Players never collide with each other in this phase: every query filters to
 * the WORLD group, so each player's step only depends on its own state, its
 * input and the static map. That is what makes per-player rollback cheap.
 */
import RAPIER from '@dimforge/rapier3d-compat';
import { BODY, MOVE } from './constants.ts';
import { CG, MOVE_QUERY_GROUPS, SOLID_BITS, staticGroups } from './collision.ts';
import type { MapDef } from './map.ts';
import { greyboxBits } from './mapV1.ts';

export type Rapier = typeof RAPIER;

/** Movement probes: act as a player, collide only with what blocks movement. */
const PROBE_GROUPS = (CG.Player << 16) | CG.Move;
/** Query filter used by every movement query: act as a player, hit only what blocks movement. */
export const PLAYER_QUERY_GROUPS = MOVE_QUERY_GROUPS;

let initPromise: Promise<void> | null = null;

/** Load the Rapier WASM module once. Safe to call many times. */
export function initPhysics(): Promise<void> {
  if (!initPromise) initPromise = RAPIER.init();
  return initPromise;
}

export interface CapsuleDims {
  halfHeight: number;
  radius: number;
  /** Distance from the feet to the capsule center. */
  centerY: number;
}

function capsuleFor(height: number): CapsuleDims {
  const radius = BODY.radius;
  const halfHeight = (height - 2 * radius) / 2;
  return { radius, halfHeight, centerY: MOVE.skinOffset + radius + halfHeight };
}

export const STAND_CAPSULE = capsuleFor(BODY.standHeight);
export const CROUCH_CAPSULE = capsuleFor(BODY.crouchHeight);

export interface SimWorld {
  rapier: Rapier;
  world: RAPIER.World;
  controller: RAPIER.KinematicCharacterController;
  /** Collider moved to the player being stepped (one per stance). */
  probeStand: RAPIER.Collider;
  probeCrouch: RAPIER.Collider;
  /** Standing shape used for the stand-up headroom test. */
  standShape: RAPIER.Capsule;
  map: MapDef;
  dispose(): void;
}

/**
 * Convert our row-major (row = z, col = x) grid into Rapier's column-major
 * heights matrix, where Rapier rows run along z and columns along x.
 */
function rapierHeights(map: MapDef): Float32Array {
  const n = map.terrain.cells + 1;
  const src = map.terrain.heights;
  const out = new Float32Array(n * n);
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      out[r + c * n] = src[r * n + c] ?? 0;
    }
  }
  return out;
}

/** Build the static world. Requires initPhysics() to have resolved. */
export function createSimWorld(map: MapDef): SimWorld {
  const R = RAPIER;
  const world = new R.World({ x: 0, y: 0, z: 0 });

  // Terrain heightfield, centered at the origin like the map.
  const n = map.terrain.cells;
  const span = n * map.terrain.cellSize;
  const hf = R.ColliderDesc.heightfield(n, n, rapierHeights(map), { x: span, y: 1, z: span }, R.HeightFieldFlags.FIX_INTERNAL_EDGES)
    .setCollisionGroups(staticGroups(SOLID_BITS));
  world.createCollider(hf);

  for (const b of map.boxes) {
    const desc = R.ColliderDesc.cuboid(b.h[0], b.h[1], b.h[2])
      .setTranslation(b.c[0], b.c[1], b.c[2])
      .setRotation({ x: b.q[0], y: b.q[1], z: b.q[2], w: b.q[3] })
      .setCollisionGroups(staticGroups(greyboxBits(b.kind)));
    world.createCollider(desc);
  }
  for (const r of map.rocks) {
    world.createCollider(R.ColliderDesc.ball(r.r).setTranslation(r.c[0], r.c[1], r.c[2]).setCollisionGroups(staticGroups(SOLID_BITS)));
  }
  // Loaded maps: prop colliders, in file order (client and server build the same list).
  for (const s of map.shapes) {
    let desc: RAPIER.ColliderDesc | null;
    if (s.type === 'box' && s.h) desc = R.ColliderDesc.cuboid(s.h[0], s.h[1], s.h[2]);
    else if (s.type === 'capsule') desc = R.ColliderDesc.capsule(s.hh ?? 0, s.r ?? 0.1);
    else if (s.type === 'cylinder') desc = R.ColliderDesc.cylinder(s.hh ?? 0, s.r ?? 0.1);
    else if (s.type === 'hull' && s.pts) desc = R.ColliderDesc.convexHull(new Float32Array(s.pts));
    else desc = null;
    if (!desc) continue;
    desc.setTranslation(s.c[0], s.c[1], s.c[2]).setRotation({ x: s.q[0], y: s.q[1], z: s.q[2], w: s.q[3] }).setCollisionGroups(staticGroups(s.bits));
    world.createCollider(desc);
  }

  const probeStand = world.createCollider(
    R.ColliderDesc.capsule(STAND_CAPSULE.halfHeight, STAND_CAPSULE.radius).setTranslation(0, -1000, 0).setCollisionGroups(PROBE_GROUPS),
  );
  const probeCrouch = world.createCollider(
    R.ColliderDesc.capsule(CROUCH_CAPSULE.halfHeight, CROUCH_CAPSULE.radius).setTranslation(0, -1000, 0).setCollisionGroups(PROBE_GROUPS),
  );

  const controller = world.createCharacterController(MOVE.skinOffset);
  controller.setUp({ x: 0, y: 1, z: 0 });
  controller.setSlideEnabled(true);
  controller.setApplyImpulsesToDynamicBodies(false);
  controller.enableAutostep(MOVE.stepHeight, MOVE.stepMinWidth, false);
  controller.enableSnapToGround(MOVE.snapToGround);
  controller.setMaxSlopeClimbAngle((MOVE.maxSlopeClimbDeg * Math.PI) / 180);
  controller.setMinSlopeSlideAngle((MOVE.minSlopeSlideDeg * Math.PI) / 180);

  // One step builds the broad-phase so scene queries see every collider.
  world.step();

  const standShape = new R.Capsule(STAND_CAPSULE.halfHeight, STAND_CAPSULE.radius - 0.02);

  return {
    rapier: R,
    world,
    controller,
    probeStand,
    probeCrouch,
    standShape,
    map,
    dispose() {
      world.removeCharacterController(controller);
      world.free();
    },
  };
}

/** Cast a ray against the static world. Returns the hit distance or null. `groups` picks what blocks it (collision.ts). */
export function castWorldRay(sim: SimWorld, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxDist: number, groups: number = PLAYER_QUERY_GROUPS, solid = true): number | null {
  const ray = new sim.rapier.Ray({ x: ox, y: oy, z: oz }, { x: dx, y: dy, z: dz });
  const hit = sim.world.castRay(ray, maxDist, solid, undefined, groups);
  return hit ? hit.timeOfImpact : null;
}

/**
 * Feet height for a player standing at (x, z), found by casting the standing
 * capsule down from `fromY`. Includes the controller's skin offset.
 */
export function groundHeightAt(sim: SimWorld, x: number, fromY: number, z: number): number {
  const startY = fromY + STAND_CAPSULE.centerY;
  const hit = sim.world.castShape(
    { x, y: startY, z },
    { x: 0, y: 0, z: 0, w: 1 },
    { x: 0, y: -1, z: 0 },
    sim.standShape,
    0,
    200,
    true,
    undefined,
    PLAYER_QUERY_GROUPS,
  );
  if (!hit) return fromY;
  // The probe is 2 cm thinner than the real capsule; add that back plus the
  // skin, plus 1 cm so the first step settles onto the ground.
  return Math.fround(fromY - hit.time_of_impact + 0.02 + MOVE.skinOffset + 0.01);
}
