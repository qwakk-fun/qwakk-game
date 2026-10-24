/**
 * Pond Keep's geometry for Hunt Season, derived once from the map's `raid`
 * markup (markup.ts) when the map loads: the drawbridge and gate frames, the
 * cannons' facings, the courtyard and island outlines, the lever. Pure and
 * deterministic (sqrt and products only for anything the duck sim reads), so
 * the client and the server derive the same numbers.
 *
 * Moving parts and the duck sim (the CLAUDE.md determinism rule): no collider
 * a duck walks against ever changes while a run plays.
 *   - The drawbridge deck is a static walkable box for ducks. A raised
 *     drawbridge is the KEEP_CLOSED bit the server sets in every duck's
 *     `dmBuff` (raid/man.ts): the sim then refuses a step onto the deck,
 *     the same on both sides from that tick on (like the trap root).
 *   - The main gate holds two static duck-only leaves (CG.DuckOnly) beside
 *     the wicket door ducks pass through; hunters are kept out by their own
 *     mover and route rules (server), never by a duck collider.
 *   - What a raised bridge or the gate blocks for bullets and sight (the
 *     hunters' shots and eyes, the server's hit traces) is a toggled
 *     collider with Bullet and Sight bits only: no duck movement query sees
 *     it, so toggling it on the server cannot move a duck.
 */
import { BODY } from '../constants.ts';
import { CG } from '../collision.ts';
import { insidePoly, type Vec2 } from '../brMapData.ts';
import type { Quat, ShapeDef, Vec3 } from '../map.ts';
import { dcos, dsin } from '../math.ts';
import type { RaidMarkup } from './markup.ts';

/** Reach of the keep's controls and the duck rules (client simulated or shown: constants). */
export const KEEP = {
  /** A duck mans a cannon from this close to its stand spot (m, flat) and this close in height. */
  cannonReach: 1.6,
  cannonReachY: 1.3,
  /** A duck pulls the drawbridge lever from this close (m). */
  leverReach: 1.8,
  /** Hold Use within this of the gate's line (m, either side, along its width plus 1 m) to repair it. */
  gateReach: 3.4,
  /** The wicket door in the main gate that ducks pass through: half its width and its height (m). */
  wicketHalf: 0.75,
  wicketHeight: 2.2,
  /** Ducks keep this far off a closed drawbridge deck (m): the capsule radius. */
  bridgeMargin: BODY.radius,
} as const;

export interface KeepCannon {
  /** Mount (the base on the tower). */
  x: number;
  y: number;
  z: number;
  /** Straight out from the core (sim yaw: forward is (-sin, -cos)). */
  yaw: number;
  /** Where a duck stands to man it. */
  ux: number;
  uy: number;
  uz: number;
}

export interface KeepGeometry {
  mark: RaidMarkup;
  core: { x: number; y: number; z: number; r: number };
  /** The deck: hinge, unit direction out over the moat (dx, dz), across it (px, pz), length, half width. */
  bridge: { x: number; y: number; z: number; dx: number; dz: number; px: number; pz: number; len: number; halfW: number };
  /** The gate: center at its foot, outward normal (nx, nz), along it (tx, tz), half width, height. */
  gate: { x: number; y: number; z: number; nx: number; nz: number; tx: number; tz: number; halfW: number; height: number };
  cannons: KeepCannon[];
  lever: Vec3;
  /** Courtyard and island outlines ([x, z]). */
  keep: Vec2[];
  island: Vec2[];
}

/** Convex hull (monotone chain), counter-clockwise. */
function hull(pts: readonly Vec2[]): Vec2[] {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o: Vec2, a: Vec2, b: Vec2): number => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: Vec2[] = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper: Vec2[] = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i]!;
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, q) <= 0) upper.pop();
    upper.push(q);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

/** An octagon around (x, z): the outline fallback when a map gives too few points. */
function octagon(x: number, z: number, r: number): Vec2[] {
  const k = r * Math.SQRT1_2;
  return [[x + r, z], [x + k, z + k], [x, z + r], [x - k, z + k], [x - r, z], [x - k, z - k], [x, z - r], [x + k, z - k]];
}

/** Push a point away from (cx, cz) by `by` meters. */
function outward(cx: number, cz: number, x: number, z: number, by: number): Vec2 {
  const dx = x - cx;
  const dz = z - cz;
  const d = Math.sqrt(dx * dx + dz * dz) || 1;
  return [x + (dx / d) * by, z + (dz / d) * by];
}

/** Derive the keep's geometry from its markup. Deterministic. */
export function buildKeep(mark: RaidMarkup): KeepGeometry {
  const [cx, cy, cz] = mark.core;
  const b = mark.drawbridge;
  // The deck runs from the hinge toward the middle of its walk outline (the yaw only if that is degenerate).
  let wx = 0;
  let wz = 0;
  for (const [x, z] of b.walk) {
    wx += x / b.walk.length;
    wz += z / b.walk.length;
  }
  let dx = wx - b.hingeX;
  let dz = wz - b.hingeZ;
  let dl = Math.sqrt(dx * dx + dz * dz);
  if (dl < 0.5) {
    dx = dsin(b.yaw);
    dz = dcos(b.yaw);
    dl = 1;
  }
  dx /= dl;
  dz /= dl;
  const bridge = { x: b.hingeX, y: b.hingeY, z: b.hingeZ, dx, dz, px: -dz, pz: dx, len: b.length, halfW: b.width / 2 };
  // The gate faces out along the bridge.
  const gm = mark.gate;
  const gate = { x: gm.x, y: gm.y, z: gm.z, nx: dx, nz: dz, tx: -dz, tz: dx, halfW: gm.width / 2, height: gm.height };
  const cannons: KeepCannon[] = mark.cannons.map(([x, y, z, yaw], i) => {
    const u = mark.cannonUse[i] ?? [x, y, z];
    // The markup's yaw (a duck's yaw: it looks along (-sin, -cos)) when it points out of the keep, else straight out from the core.
    const out = -Math.sin(yaw) * (x - cx) - Math.cos(yaw) * (z - cz) > 0;
    return { x, y, z, yaw: out ? yaw : Math.atan2(-(x - cx), -(z - cz)), ux: u[0], uy: u[1], uz: u[2] };
  });
  const lever: Vec3 = mark.lever ?? [gate.x - gate.nx * 3 + gate.tx * (gate.halfW + 1.2), gate.y, gate.z - gate.nz * 3 + gate.tz * (gate.halfW + 1.2)];
  const reach = Math.max(8, ...cannons.map((c) => Math.hypot(c.x - cx, c.z - cz)), Math.hypot(gate.x - cx, gate.z - cz));
  const keepPts: Vec2[] = cannons.map((c) => [c.x, c.z]);
  const keep = mark.keep ?? (keepPts.length >= 3 ? hull(keepPts) : octagon(cx, cz, reach));
  const islandPts: Vec2[] = [
    ...cannons.map((c) => outward(cx, cz, c.x, c.z, 3)),
    [b.hingeX + dx * 1.5, b.hingeZ + dz * 1.5],
    ...mark.raftLanes.map((l) => outward(cx, cz, l.to[0], l.to[1], 1.5)),
  ];
  const island = mark.island ?? (islandPts.length >= 3 ? hull(islandPts) : octagon(cx, cz, reach + 4));
  return { mark, core: { x: cx, y: cy, z: cz, r: mark.coreRadius }, bridge, gate, cannons, lever, keep, island };
}

// ---- tests on positions ---------------------------------------------------------

/** On the drawbridge deck (its rectangle grown by `margin`). Exact float products: the duck sim uses it. */
export function onDeck(g: KeepGeometry, x: number, z: number, margin: number): boolean {
  const b = g.bridge;
  const rx = x - b.x;
  const rz = z - b.z;
  const u = rx * b.dx + rz * b.dz;
  const v = rx * b.px + rz * b.pz;
  return u >= -margin && u <= b.len + margin && v <= b.halfW + margin && v >= -b.halfW - margin;
}

/** In the gateway or on the deck: from the gate's line out to the deck's far end (hunters there go in the moat when the bridge rises). */
export function inGateway(g: KeepGeometry, x: number, z: number, margin = 0.6): boolean {
  const b = g.bridge;
  const rx = x - b.x;
  const rz = z - b.z;
  const u = rx * b.dx + rz * b.dz;
  const v = rx * b.px + rz * b.pz;
  const gateU = (g.gate.x - b.x) * b.dx + (g.gate.z - b.z) * b.dz;
  return u >= gateU - 0.2 && u <= b.len + margin && Math.abs(v) <= b.halfW + margin;
}

/** Inside the walls: in the courtyard outline and not in the gateway outside the gate's line. */
export function inKeep(g: KeepGeometry, x: number, z: number): boolean {
  return insidePoly(g.keep, x, z) && !inGateway(g, x, z, 0);
}

/** On the castle's island (inside the moat). */
export function onIsland(g: KeepGeometry, x: number, z: number): boolean {
  return insidePoly(g.island, x, z);
}

/** The cannon a duck at (x, y, z) can man (its stand spot within reach), nearest first; -1 for none. */
export function cannonInReach(g: KeepGeometry, x: number, y: number, z: number): number {
  let best = -1;
  let bestD = KEEP.cannonReach * KEEP.cannonReach;
  for (let i = 0; i < g.cannons.length; i++) {
    const c = g.cannons[i]!;
    const ddx = x - c.ux;
    const ddz = z - c.uz;
    const d = ddx * ddx + ddz * ddz;
    if (d <= bestD && Math.abs(y - c.uy) <= KEEP.cannonReachY) {
      best = i;
      bestD = d;
    }
  }
  return best;
}

export function leverInReach(g: KeepGeometry, x: number, y: number, z: number): boolean {
  const [lx, ly, lz] = g.lever;
  return Math.hypot(x - lx, z - lz) <= KEEP.leverReach && Math.abs(y - ly) <= 1.6;
}

/** Close enough to the gate to repair it (either side). */
export function gateInReach(g: KeepGeometry, x: number, y: number, z: number): boolean {
  const gt = g.gate;
  const rx = x - gt.x;
  const rz = z - gt.z;
  const along = rx * gt.tx + rz * gt.tz;
  const across = rx * gt.nx + rz * gt.nz;
  return Math.abs(along) <= gt.halfW + 1 && Math.abs(across) <= KEEP.gateReach && y - gt.y > -1.5 && y - gt.y < gt.height;
}

// ---- colliders -------------------------------------------------------------------

/** Quaternion turning local +z onto the unit direction (dx, dz) about y (half angles from sqrt: exact). */
function yawTo(dx: number, dz: number): Quat {
  const c = Math.sqrt(Math.max(0, (1 + dz) / 2));
  const s = Math.sqrt(Math.max(0, (1 - dz) / 2)) * (dx < 0 ? -1 : 1);
  return [0, s, 0, c];
}

/** Toggled collider names (SimWorld.toggles). */
export const KEEP_TOGGLE = {
  /** The raised drawbridge across the gateway (bullets and sight). Off while the bridge is down. */
  bridgeUp: 'raid.bridgeUp',
  /** The closed main gate (bullets and sight). Off while it is broken. */
  gate: 'raid.gate',
} as const;

/** A box collider of the prop kit in the gate's own frame (colliders.json `castle_gate`). */
export interface KitBox {
  type: string;
  c: Vec3;
  q: Quat;
  h?: Vec3;
}

function qmul(a: Quat, b: Quat): Quat {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [aw * bx + ax * bw + ay * bz - az * by, aw * by - ax * bz + ay * bw + az * bx, aw * bz + ax * by - ay * bx + az * bw, aw * bw - ax * bx - ay * by - az * bz];
}

function rotate(q: Quat, v: Vec3): Vec3 {
  const [qx, qy, qz, qw] = q;
  const [vx, vy, vz] = v;
  const tx = 2 * (qy * vz - qz * vy);
  const ty = 2 * (qz * vx - qx * vz);
  const tz = 2 * (qx * vy - qy * vx);
  return [vx + qw * tx + (qy * tz - qz * ty), vy + qw * ty + (qz * tx - qx * tz), vz + qw * tz + (qx * ty - qy * tx)];
}

/**
 * The keep's own colliders, appended after the map's props (the same order
 * on both sides): the deck (walkable, static; left out when the map's
 * props already carry one, `mapHasDeck`), the gate's leaves beside its
 * wicket (duck only, static: the kit's `castle_gate` boxes when the kit has
 * them, else two leaves and a lintel from the markup), the gate and
 * raised-bridge shields (bullets and sight, toggled on the server; no
 * movement query sees them).
 */
/** Does a static box that blocks movement already carry the deck (its top within 0.4 m of the hinge height over the deck's middle)? */
export function mapHasDeck(g: KeepGeometry, shapes: readonly ShapeDef[]): boolean {
  const b = g.bridge;
  const mx = b.x + (b.dx * b.len) / 2;
  const mz = b.z + (b.dz * b.len) / 2;
  for (const s of shapes) {
    if (s.type !== 'box' || !s.h || (s.bits & CG.Move) === 0) continue;
    // The point in the box's frame (inverse rotation: the conjugate).
    const inv: Quat = [-s.q[0], -s.q[1], -s.q[2], s.q[3]];
    const top: Vec3 = rotate(inv, [mx - s.c[0], b.y - s.c[1], mz - s.c[2]]);
    if (Math.abs(top[0]) > s.h[0] || Math.abs(top[2]) > s.h[2]) continue;
    // Top face height over the hinge (boxes turned about y only, as props are).
    const topY = s.c[1] + s.h[1];
    if (Math.abs(topY - b.y) <= 0.4) return true;
  }
  return false;
}

export function keepShapes(g: KeepGeometry, kitGate: readonly KitBox[] = [], hasDeck = false): ShapeDef[] {
  const out: ShapeDef[] = [];
  const b = g.bridge;
  const qb = yawTo(b.dx, b.dz);
  // The deck ducks walk on (always there, static): the map's own when it has one (Pond Keep's castle_bridge floor), else this one.
  if (!hasDeck) out.push({ type: 'box', kind: 'raid_deck', bits: CG.Move | CG.Bullet | CG.Sight, c: [b.x + (b.dx * b.len) / 2, b.y - 0.15, b.z + (b.dz * b.len) / 2], q: qb, h: [b.halfW, 0.15, b.len / 2] });
  const gt = g.gate;
  const qg = yawTo(gt.nx, gt.nz);
  const leaf = gt.halfW - KEEP.wicketHalf;
  const kit = kitGate.filter((k) => k.type === 'box' && k.h);
  if (kit.length > 0) {
    for (const k of kit) {
      const w = rotate(qg, k.c);
      out.push({ type: 'box', kind: 'raid_wicket', bits: CG.DuckOnly, c: [gt.x + w[0], gt.y + w[1], gt.z + w[2]], q: qmul(qg, k.q), h: [...k.h!] as Vec3 });
    }
  } else if (leaf > 0.1) {
    for (const side of [-1, 1]) {
      const off = side * (KEEP.wicketHalf + leaf / 2);
      out.push({ type: 'box', kind: 'raid_wicket', bits: CG.DuckOnly, c: [gt.x + gt.tx * off, gt.y + gt.height / 2, gt.z + gt.tz * off], q: qg, h: [leaf / 2, gt.height / 2, 0.2] });
    }
  }
  const lintel = gt.height - KEEP.wicketHeight;
  if (kit.length === 0 && lintel > 0.1) out.push({ type: 'box', kind: 'raid_wicket', bits: CG.DuckOnly, c: [gt.x, gt.y + KEEP.wicketHeight + lintel / 2, gt.z], q: qg, h: [Math.min(gt.halfW, KEEP.wicketHalf + 0.05), lintel / 2, 0.2] });
  out.push({ type: 'box', kind: 'raid_gate', bits: CG.Bullet | CG.Sight, toggle: KEEP_TOGGLE.gate, c: [gt.x, gt.y + gt.height / 2, gt.z], q: qg, h: [gt.halfW, gt.height / 2, 0.25] });
  out.push({ type: 'box', kind: 'raid_bridge_up', bits: CG.Bullet | CG.Sight, toggle: KEEP_TOGGLE.bridgeUp, c: [b.x + b.dx * 0.25, b.y + b.len / 2, b.z + b.dz * 0.25], q: qb, h: [b.halfW, b.len / 2, 0.2] });
  return out;
}
