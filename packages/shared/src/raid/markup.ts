/**
 * Hunt Season markup of a castle map (`map_v1.json` "raid", Pond Keep): the
 * QoreChain core, the main gate, the drawbridge, the four bread cannons and
 * where a duck stands to man them, the spawns, the sniper perches, the raft
 * lanes across the moat, the trenches and the wall walk. Pure data, read and
 * validated here like the rest of the map (mapV1.ts calls it), so the client
 * and the server get the same numbers; raid/keep.ts derives the geometry.
 *
 * Positions are meters, `[x, y, z]` or `[x, z]`. A `yaw` is kept as given;
 * the code derives directions from the positions where it can (the bridge
 * from its walk polygon, the gate and the cannons from the core), so a yaw
 * convention mix-up cannot turn the keep around.
 *
 * Optional extras the map may add: `lever` [x, y, z] (the drawbridge lever,
 * else placed beside the gate inside), `keep` and `island` [[x, z], ...]
 * (the courtyard and the island outlines, else derived from the cannons,
 * the bridge and the raft landings).
 */
import type { Vec2 } from '../brMapData.ts';
import type { Vec3 } from '../map.ts';

export type Vec4 = [number, number, number, number];

export interface RaidGateMark {
  x: number;
  y: number;
  z: number;
  yaw: number;
  width: number;
  height: number;
}

export interface RaidBridgeMark {
  hingeX: number;
  hingeY: number;
  hingeZ: number;
  yaw: number;
  length: number;
  width: number;
  /** The deck's outline when down ([x, z]). */
  walk: Vec2[];
}

export interface RaidMarkup {
  core: Vec3;
  coreRadius: number;
  gate: RaidGateMark;
  drawbridge: RaidBridgeMark;
  /** Cannon mounts [x, y, z, yaw] (1 to 4) and where a duck stands to man each [x, y, z]. */
  cannons: Vec4[];
  cannonUse: Vec3[];
  duckSpawns: Vec4[];
  /** Trench exits where hunters come out. */
  hunterSpawns: Vec4[];
  sniperPerches: Vec4[];
  raftLanes: { from: Vec2; to: Vec2 }[];
  trenches: Vec2[][];
  wallWalk: Vec2[][];
  lever: Vec3 | null;
  keep: Vec2[] | null;
  island: Vec2[] | null;
}

/** The cannon count the packed manning state holds (raid/man.ts). */
export const MAX_CANNONS = 4;

type Json = Record<string, unknown>;

const fail = (what: string, rule: string): never => {
  throw new Error(`map_v1: raid.${what} ${rule}`);
};

function num(v: unknown, what: string): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  return fail(what, 'must be a number');
}

function pos(v: unknown, what: string): number {
  const n = num(v, what);
  return n > 0 ? n : fail(what, 'must be above 0');
}

function list(v: unknown, what: string, optional = false): unknown[] {
  if (optional && (v === undefined || v === null)) return [];
  return Array.isArray(v) ? v : fail(what, 'must be an array');
}

function obj(v: unknown, what: string): Json {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Json) : fail(what, 'must be an object');
}

function vec(v: unknown, what: string, n: number): number[] {
  const a = list(v, what);
  if (a.length < n) fail(what, `needs ${n} numbers`);
  return a.slice(0, n).map((x, i) => num(x, `${what}[${i}]`));
}

const v2 = (v: unknown, what: string): Vec2 => vec(v, what, 2) as Vec2;
const v3 = (v: unknown, what: string): Vec3 => vec(v, what, 3) as Vec3;
const v4 = (v: unknown, what: string): Vec4 => vec(v, what, 4) as Vec4;

/** A point of a polyline: [x, z], or [x, y, z] (the height is dropped). */
function flat(v: unknown, what: string): Vec2 {
  const a = list(v, what);
  if (a.length >= 3) return [num(a[0], what), num(a[2], what)];
  return v2(a, what);
}

function points4(v: unknown, what: string, min: number): Vec4[] {
  const a = list(v, what, min === 0).map((p, i) => v4(p, `${what}[${i}]`));
  if (a.length < min) fail(what, `needs at least ${min} entries`);
  return a;
}

function polyline(v: unknown, what: string, min: number): Vec2[] {
  const a = list(v, what).map((p, i) => flat(p, `${what}[${i}]`));
  if (a.length < min) fail(what, `needs at least ${min} points`);
  return a;
}

/** Read and check the `raid` object of a map. Throws on anything unusable, like the rest of the loader. */
export function parseRaidMarkup(raw: unknown): RaidMarkup {
  const r = obj(raw, '(root)');
  const g = obj(r.gate, 'gate');
  const b = obj(r.drawbridge, 'drawbridge');
  const cannons = points4(r.cannons, 'cannons', 1);
  if (cannons.length > MAX_CANNONS) fail('cannons', `holds at most ${MAX_CANNONS}`);
  const cannonUse = list(r.cannonUse, 'cannonUse').map((p, i) => v3(p, `cannonUse[${i}]`));
  if (cannonUse.length !== cannons.length) fail('cannonUse', 'needs one entry per cannon');
  const lanes = list(r.raftLanes, 'raftLanes', true).map((l, i) => {
    const o = obj(l, `raftLanes[${i}]`);
    return { from: v2(o.from, `raftLanes[${i}].from`), to: v2(o.to, `raftLanes[${i}].to`) };
  });
  const optPoly = (v: unknown, what: string): Vec2[] | null => (v === undefined || v === null ? null : polyline(v, what, 3));
  return {
    core: v3(r.core, 'core'),
    coreRadius: pos(r.coreRadius, 'coreRadius'),
    gate: { x: num(g.x, 'gate.x'), y: num(g.y, 'gate.y'), z: num(g.z, 'gate.z'), yaw: num(g.yaw ?? 0, 'gate.yaw'), width: pos(g.width, 'gate.width'), height: pos(g.height, 'gate.height') },
    drawbridge: {
      hingeX: num(b.hingeX, 'drawbridge.hingeX'),
      hingeY: num(b.hingeY, 'drawbridge.hingeY'),
      hingeZ: num(b.hingeZ, 'drawbridge.hingeZ'),
      yaw: num(b.yaw ?? 0, 'drawbridge.yaw'),
      length: pos(b.length, 'drawbridge.length'),
      width: pos(b.width, 'drawbridge.width'),
      walk: polyline(b.walk, 'drawbridge.walk', 3),
    },
    cannons,
    cannonUse,
    duckSpawns: points4(r.duckSpawns, 'duckSpawns', 1),
    hunterSpawns: points4(r.hunterSpawns, 'hunterSpawns', 2),
    sniperPerches: points4(r.sniperPerches, 'sniperPerches', 0),
    raftLanes: lanes,
    trenches: list(r.trenches, 'trenches', true).map((t, i) => polyline(t, `trenches[${i}]`, 2)),
    wallWalk: list(r.wallWalk, 'wallWalk', true).map((t, i) => polyline(t, `wallWalk[${i}]`, 2)),
    lever: r.lever === undefined || r.lever === null ? null : v3(r.lever, 'lever'),
    keep: optPoly(r.keep, 'keep'),
    island: optPoly(r.island, 'island'),
  };
}
