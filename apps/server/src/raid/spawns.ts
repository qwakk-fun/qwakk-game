/**
 * Where hunters come from and where they go on Pond Keep, from the map's
 * `raid` markup (raid/keep.ts geometry): the trench exits they spawn at, the
 * spots in front of the gate and around the QoreChain core they hammer, the
 * spots on the island where they wait while the drawbridge is up, the
 * trench points riflemen take cover in, and the ducks' spawns. Server only.
 */
import { groundHeightAt, waterSurfaceAt, type KeepGeometry, type SimWorld } from '@qwakk/shared';
import type { BotNav, P3 } from '../nav/botNav.ts';

/** Hunter spawns: the trench exits of the markup, on the ground. */
export function hunterSpawns(sim: SimWorld, g: KeepGeometry): P3[] {
  return g.mark.hunterSpawns.map(([x, y, z]) => ({ x, y: groundHeightAt(sim, x, y + 2, z), z }));
}

/** The ducks' spawns in the courtyard, facing out toward the gate. */
export function duckSpawns(g: KeepGeometry): { x: number; y: number; z: number; yaw: number }[] {
  const { x: cx, z: cz } = g.core;
  return g.mark.duckSpawns.map(([x, y, z]) => {
    const dx = g.gate.x - x;
    const dz = g.gate.z - z;
    const yaw = Math.hypot(dx, dz) > 1 ? Math.atan2(-dx, -dz) : Math.atan2(x - cx, z - cz);
    return { x, y, z, yaw };
  });
}

/**
 * A spot in front of the gate, outside, for slot `slot`: spread across the
 * gate's width in two rows (the front row in the archway, the second on the
 * hinge end of the deck).
 */
export function gateSpot(g: KeepGeometry, slot: number): P3 {
  const gt = g.gate;
  const per = Math.max(2, Math.floor((gt.halfW * 2) / 1.1));
  const row = Math.floor(slot / per) % 3;
  const k = slot % per;
  const along = per > 1 ? -gt.halfW * 0.8 + (k / (per - 1)) * gt.halfW * 1.6 : 0;
  const out = 1.0 + row * 1.1;
  return { x: gt.x + gt.nx * out + gt.tx * along, y: gt.y, z: gt.z + gt.nz * out + gt.tz * along };
}

/** Distance across the gate's line (positive outside) and along it from its middle. */
export function gateFrame(g: KeepGeometry, x: number, z: number): { across: number; along: number } {
  const gt = g.gate;
  const rx = x - gt.x;
  const rz = z - gt.z;
  return { across: rx * gt.nx + rz * gt.nz, along: rx * gt.tx + rz * gt.tz };
}

/** Close enough to hammer the gate (outside it, in front of its width, at its foot). */
export function atGate(g: KeepGeometry, x: number, y: number, z: number): boolean {
  const f = gateFrame(g, x, z);
  return f.across > -0.2 && f.across < 2.9 && Math.abs(f.along) < g.gate.halfW + 0.6 && Math.abs(y - g.gate.y) < 1.5;
}

/** A spot by the core at this angle (on the navmesh when it is ready). */
export function coreSpot(g: KeepGeometry, angle: number, nav: BotNav | null): P3 {
  const c = g.core;
  const r = c.r + 1.0;
  const p = { x: c.x + Math.cos(angle) * r, y: c.y, z: c.z + Math.sin(angle) * r };
  return nav?.closest(p, { x: 2, y: 4, z: 2 }) ?? p;
}

export function atCore(g: KeepGeometry, x: number, y: number, z: number, reach: number): boolean {
  return Math.hypot(x - g.core.x, z - g.core.z) <= g.core.r + reach && Math.abs(y - g.core.y) < 3;
}

/**
 * Where hunters wait on the island while the drawbridge is up: at the raft
 * landing nearest to them (on the island by definition), a few meters
 * inland, spread a little. Without raft lanes: beside the gatehouse on the
 * gate's side, outside the walls.
 */
export function holdSpot(g: KeepGeometry, x: number, z: number, slot: number, nav: BotNav | null): P3 {
  const spread = ((slot % 5) - 2) * 1.1;
  let best: { from: [number, number]; to: [number, number] } | null = null;
  let bestD = Infinity;
  for (const l of g.mark.raftLanes) {
    const d = Math.hypot(l.to[0] - x, l.to[1] - z);
    if (d < bestD) {
      best = l;
      bestD = d;
    }
  }
  let p: P3;
  if (best) {
    const dx = best.to[0] - best.from[0];
    const dz = best.to[1] - best.from[1];
    const d = Math.hypot(dx, dz) || 1;
    p = { x: best.to[0] + (dx / d) * 2.5 - (dz / d) * spread, y: g.gate.y, z: best.to[1] + (dz / d) * 2.5 + (dx / d) * spread };
  } else {
    const gt = g.gate;
    const side = slot % 2 === 0 ? 1 : -1;
    const off = gt.halfW + 7.5 + (Math.floor(slot / 2) % 3) * 1.3;
    p = { x: gt.x + gt.tx * off * side + gt.nx * 2.5, y: gt.y, z: gt.z + gt.tz * off * side + gt.nz * 2.5 };
  }
  return nav?.closest(p, { x: 2, y: 4, z: 2 }) ?? p;
}

/** The raft lanes with their water height (the moat's surface; a raft deck over it is found while riding, travel.ts). */
export function raftLanes(sim: SimWorld, g: KeepGeometry): { from: P3; to: P3; water: number }[] {
  const w = sim.map.water;
  return g.mark.raftLanes.map((l) => {
    const mx = (l.from[0] + l.to[0]) / 2;
    const mz = (l.from[1] + l.to[1]) / 2;
    const water = w ? waterSurfaceAt(w, mx, mz) : groundHeightAt(sim, mx, 40, mz);
    return {
      from: { x: l.from[0], y: groundHeightAt(sim, l.from[0], 40, l.from[1]), z: l.from[1] },
      to: { x: l.to[0], y: groundHeightAt(sim, l.to[0], 40, l.to[1]), z: l.to[1] },
      water,
    };
  });
}

/** Points along the trenches (every 2.5 m, and a step outward of each), where riflemen like to take cover. */
export function trenchPoints(sim: SimWorld, g: KeepGeometry): P3[] {
  const out: P3[] = [];
  for (const line of g.mark.trenches) {
    for (let i = 0; i + 1 < line.length; i++) {
      const [ax, az] = line[i]!;
      const [bx, bz] = line[i + 1]!;
      const len = Math.hypot(bx - ax, bz - az);
      const n = Math.max(1, Math.round(len / 2.5));
      for (let k = 0; k < n; k++) {
        const x = ax + ((bx - ax) * k) / n;
        const z = az + ((bz - az) * k) / n;
        out.push({ x, y: groundHeightAt(sim, x, 40, z), z });
        // And a step out from the castle: behind a parapet or a sandbag line rather than on it (the cover test picks).
        const d = Math.hypot(x - g.core.x, z - g.core.z) || 1;
        const ox = x + ((x - g.core.x) / d) * 1.2;
        const oz = z + ((z - g.core.z) / d) * 1.2;
        out.push({ x: ox, y: groundHeightAt(sim, ox, 40, oz), z: oz });
      }
    }
  }
  return out;
}
