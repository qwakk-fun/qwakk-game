/**
 * Loader for the map_v1 format (art/map, see docs/map-design.md section 6):
 * `map_v1.json`, `map_v1_heights.bin` (int16 centimeters) and the prop kit's
 * `colliders.json`. Pure: the caller reads the files (fs on the server, fetch
 * on the client) and passes the parsed JSON and the raw height bytes, so the
 * client and the server build bit-identical colliders.
 *
 * Kept tolerant on purpose: unknown top-level fields are ignored, optional
 * ones get defaults, so a small format tweak from the map workstream is a
 * small change here (all field reads are in this file).
 */
import type { BrMapData, CircleCandidate, CirclePhase, FlightPath, LootPoint, MapZone, RiverPoint, Vec2, WaterDef } from './brMapData.ts';
import { Container } from './brMapData.ts';
import { CG, kindBits, SOLID_BITS, type KindFlags } from './collision.ts';
import type { BoxDef, MapDef, Quat, ShapeDef, TerrainDef, Vec3 } from './map.ts';
import { terrainHeightAt } from './map.ts';
import { dcos, dsin } from './math.ts';

type Json = Record<string, unknown>;

function obj(v: unknown, what: string): Json {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new Error(`map_v1: ${what} must be an object`);
  return v as Json;
}

function arr(v: unknown, what: string): unknown[] {
  if (!Array.isArray(v)) throw new Error(`map_v1: ${what} must be an array`);
  return v;
}

function num(v: unknown, what: string, fallback?: number): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (fallback !== undefined && (v === undefined || v === null)) return fallback;
  throw new Error(`map_v1: ${what} must be a number`);
}

function vec3(v: unknown, what: string): Vec3 {
  const a = arr(v, what);
  return [num(a[0], what), num(a[1], what), num(a[2], what)];
}

function vec2(v: unknown, what: string): Vec2 {
  const a = arr(v, what);
  return [num(a[0], what), num(a[1], what)];
}

/** Multiply quaternions a * b, (x, y, z, w). */
function qmul(a: Quat, b: Quat): Quat {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [aw * bx + ax * bw + ay * bz - az * by, aw * by - ax * bz + ay * bw + az * bx, aw * bz + ax * by - ay * bx + az * bw, aw * bw - ax * bx - ay * by - az * bz];
}

/** Collider records per prop, already validated. */
interface PropShape {
  type: ShapeDef['type'];
  kind: string;
  c: Vec3;
  q: Quat;
  h?: Vec3;
  r?: number;
  hh?: number;
  pts?: Vec3[];
}

export interface PropInstance {
  prop: string;
  x: number;
  y: number;
  z: number;
  rotY: number;
  scale: number;
}

/** What a loaded map adds for the client renderer (the sim ignores it). */
export interface MapV1Extras {
  name: string;
  props: PropInstance[];
  groundLegend: string[];
  roads: { id: string; width: number; pts: Vec2[] }[];
  /** Kinds in colliders.json the loader did not know (treated as solid). */
  unknownKinds: string[];
}

export interface LoadedMap {
  def: MapDef;
  extras: MapV1Extras;
}

/**
 * Read map_v1_heights.bin: a 16-byte header (`QWHF`, version, samples per
 * side, origin x and z, cell size cm, units per meter), then int16 little
 * endian samples. Files without the magic are read as bare int16 centimeters.
 */
export function decodeHeights(bytes: Uint8Array, samples: number): Float32Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 0;
  let unitsPerMeter = 100;
  if (bytes.byteLength >= 16 && String.fromCharCode(bytes[0] ?? 0, bytes[1] ?? 0, bytes[2] ?? 0, bytes[3] ?? 0) === 'QWHF') {
    const side = view.getUint16(6, true);
    if (side * side !== samples) throw new Error(`map_v1: heights header says ${side} samples per side, the JSON says ${Math.sqrt(samples)}`);
    unitsPerMeter = view.getUint16(14, true) || 100;
    offset = 16;
  }
  if (bytes.byteLength - offset < samples * 2) throw new Error(`map_v1: heights hold ${(bytes.byteLength - offset) / 2} samples, expected ${samples}`);
  const out = new Float32Array(samples);
  for (let i = 0; i < samples; i++) out[i] = view.getInt16(offset + i * 2, true) / unitsPerMeter;
  return out;
}

/** Ground paint ids from map_v1_ground.bin (16-byte `QWGP` header, then one uint8 per sample). */
export function decodeGround(bytes: Uint8Array, samples: number): Uint8Array {
  const offset = bytes.byteLength >= 16 && String.fromCharCode(bytes[0] ?? 0, bytes[1] ?? 0, bytes[2] ?? 0, bytes[3] ?? 0) === 'QWGP' ? 16 : 0;
  return bytes.subarray(offset, offset + samples);
}

function parseKinds(colliders: Json, unknown: Set<string>): (kind: string) => number {
  const table = new Map<string, number>();
  const kinds = colliders.kinds;
  if (kinds && typeof kinds === 'object') {
    for (const [name, raw] of Object.entries(kinds as Json)) {
      const k = obj(raw, `kinds.${name}`);
      const flags: KindFlags = { move: k.move !== false, bullets: k.bullets !== false, sight: k.sight !== false };
      table.set(name, kindBits(flags));
    }
  }
  return (kind) => {
    const bits = table.get(kind);
    if (bits !== undefined) return bits;
    unknown.add(kind);
    return SOLID_BITS;
  };
}

function parsePropShapes(colliders: Json): Map<string, PropShape[]> {
  const out = new Map<string, PropShape[]>();
  const props = obj(colliders.props, 'colliders.props');
  for (const [name, list] of Object.entries(props)) {
    const shapes: PropShape[] = [];
    arr(list, `colliders.props.${name}`).forEach((raw, i) => {
      const s = obj(raw, `${name}[${i}]`);
      const type = s.type;
      const kind = typeof s.kind === 'string' ? s.kind : 'block';
      const q: Quat = s.q === undefined ? [0, 0, 0, 1] : (() => {
        const a = arr(s.q, `${name}[${i}].q`);
        return [num(a[0], 'q'), num(a[1], 'q'), num(a[2], 'q'), num(a[3], 'q')] as Quat;
      })();
      if (type === 'box') shapes.push({ type, kind, c: vec3(s.c, 'c'), q, h: vec3(s.h, 'h') });
      else if (type === 'capsule' || type === 'cylinder') shapes.push({ type, kind, c: vec3(s.c, 'c'), q, r: num(s.r, 'r'), hh: num(s.halfHeight, 'halfHeight') });
      else if (type === 'hull') shapes.push({ type, kind, c: [0, 0, 0], q, pts: arr(s.points, 'points').map((p) => vec3(p, 'point')) });
      else throw new Error(`map_v1: unknown collider type ${String(type)} in ${name}`);
    });
    out.set(name, shapes);
  }
  return out;
}

/** One prop instance's colliders in world space (the transform rule from the map design doc). */
function placeShapes(inst: PropInstance, shapes: readonly PropShape[], bitsOf: (kind: string) => number, out: ShapeDef[]): void {
  const half = inst.rotY * 0.5;
  const qy: Quat = [0, dsin(half), 0, dcos(half)];
  const c = dcos(inst.rotY);
  const s = dsin(inst.rotY);
  const k = inst.scale;
  const toWorld = (p: Vec3): Vec3 => {
    const lx = p[0] * k;
    const ly = p[1] * k;
    const lz = p[2] * k;
    return [inst.x + c * lx + s * lz, inst.y + ly, inst.z - s * lx + c * lz];
  };
  for (const sh of shapes) {
    const bits = bitsOf(sh.kind);
    if (bits === 0) continue;
    if (sh.type === 'hull') {
      const pts: number[] = [];
      for (const p of sh.pts ?? []) pts.push(...toWorld(p));
      out.push({ type: 'hull', bits, kind: sh.kind, c: [0, 0, 0], q: [0, 0, 0, 1], pts });
      continue;
    }
    const def: ShapeDef = { type: sh.type, bits, kind: sh.kind, c: toWorld(sh.c), q: qmul(qy, sh.q) };
    if (sh.h) def.h = [sh.h[0] * k, sh.h[1] * k, sh.h[2] * k];
    if (sh.r !== undefined) def.r = sh.r * k;
    if (sh.hh !== undefined) def.hh = sh.hh * k;
    out.push(def);
  }
}

function parseBr(json: Json, zoneIndex: Map<string, number>, zones: MapZone[]): BrMapData {
  // Format v2 keeps the plane under drop.plane; v1 had a top-level flight.
  const drop = json.drop && typeof json.drop === 'object' ? (json.drop as Json) : {};
  const flight = obj(drop.plane ?? json.flight ?? {}, 'drop.plane');
  const paths: FlightPath[] = arr(flight.paths ?? [], 'flight.paths').map((p, i) => {
    const o = obj(p, `flight.paths[${i}]`);
    return { from: vec2(o.from, 'from'), to: vec2(o.to, 'to') };
  });
  const circle = obj(json.circle ?? {}, 'circle');
  const finalCandidates: CircleCandidate[] = arr(circle.finalCandidates ?? [], 'circle.finalCandidates').map((c, i) => {
    const o = obj(c, `finalCandidates[${i}]`);
    return { name: typeof o.name === 'string' ? o.name : `circle ${i}`, x: num(o.x, 'x'), z: num(o.z, 'z'), r: num(o.r, 'r', 50), weight: num(o.weight, 'weight', 1) };
  });
  const containers: Record<string, number> = { small: Container.Small, large: Container.Large, ammo: Container.Ammo };
  const loot: LootPoint[] = arr(json.loot ?? [], 'loot').map((l, i) => {
    const o = obj(l, `loot[${i}]`);
    const zone = typeof o.zone === 'string' ? (zoneIndex.get(o.zone) ?? -1) : -1;
    return {
      id: Math.round(num(o.id, 'loot.id', i)),
      kind: typeof o.kind === 'string' ? o.kind : 'ground',
      x: num(o.x, 'loot.x'),
      y: num(o.y, 'loot.y'),
      z: num(o.z, 'loot.z'),
      tier: Math.max(1, Math.min(4, Math.round(num(o.tier, 'loot.tier', 1)))),
      zone,
      container: typeof o.container === 'string' ? (containers[o.container] ?? Container.None) : Container.None,
    };
  });
  const phases: CirclePhase[] = arr(circle.phases ?? [], 'circle.phases').map((p, i) => {
    const o = obj(p, `circle.phases[${i}]`);
    return { waitS: num(o.waitS, 'waitS', 60), shrinkS: num(o.shrinkS, 'shrinkS', 0), radius: num(o.radius, 'radius', 0), dps: num(o.dps, 'dps', 0) };
  });
  const groundSpawns: Vec3[] = Array.isArray(json.groundSpawns) ? json.groundSpawns.map((p) => vec3(p, 'groundSpawns')) : [];
  return {
    name: typeof json.name === 'string' ? json.name : 'Map',
    phases,
    groundSpawns,
    flight: { altitude: num(flight.altitude, 'flight.altitude', 180), speed: num(flight.speed, 'flight.speed', 55), paths },
    finalCandidates,
    zones,
    loot,
  };
}

/** Spawn points on a grid inside a rectangle (warm-up and deathmatch on loaded maps). */
function gridSpawns(t: TerrainDef, x0: number, z0: number, x1: number, z1: number, count: number): Vec3[] {
  const out: Vec3[] = [];
  const cols = Math.max(1, Math.ceil(Math.sqrt(count)));
  const rows = Math.max(1, Math.ceil(count / cols));
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols && out.length < count; c++) {
      const x = x0 + ((c + 0.5) / cols) * (x1 - x0);
      const z = z0 + ((r + 0.5) / rows) * (z1 - z0);
      out.push([x, terrainHeightAt(t, x, z) + 0.5, z]);
    }
  }
  return out;
}

/**
 * Build a MapDef from map_v1 data. `heightBytes` is map_v1_heights.bin as is.
 * No randomness: two calls with the same input give identical output.
 */
export function buildMapDef(id: string, rawJson: unknown, heightBytes: Uint8Array, rawColliders: unknown): LoadedMap {
  const json = obj(rawJson, 'map');
  const colliders = obj(rawColliders, 'colliders');
  const terrainJ = obj(json.terrain, 'terrain');
  const cells = Math.round(num(terrainJ.cells, 'terrain.cells'));
  const cellSize = num(terrainJ.cellSize, 'terrain.cellSize');
  const size = num(json.size, 'size', cells * cellSize);
  const heights = decodeHeights(heightBytes, (cells + 1) * (cells + 1));
  const terrain: TerrainDef = { cells, cellSize, heights };

  const unknown = new Set<string>();
  const bitsOf = parseKinds(colliders, unknown);
  const propShapes = parsePropShapes(colliders);

  const props: PropInstance[] = arr(json.props ?? [], 'props').map((p, i) => {
    const o = obj(p, `props[${i}]`);
    return {
      prop: String(o.prop),
      x: num(o.x, 'prop.x'),
      y: num(o.y, 'prop.y'),
      z: num(o.z, 'prop.z'),
      rotY: num(o.rotY, 'prop.rotY', 0),
      scale: num(o.scale, 'prop.scale', 1),
    };
  });
  const shapes: ShapeDef[] = [];
  for (const inst of props) {
    const list = propShapes.get(inst.prop);
    if (list) placeShapes(inst, list, bitsOf, shapes);
  }

  // Map bounds: invisible walls 6 m inside the edge, tall enough for the drop plane altitude.
  const boxes: BoxDef[] = [];
  const edge = size / 2 - 6;
  const wallH = 170;
  const wallY = wallH - 20;
  boxes.push({ kind: 'boundary', c: [edge + 1, wallY, 0], h: [1, wallH, size / 2], q: [0, 0, 0, 1] });
  boxes.push({ kind: 'boundary', c: [-edge - 1, wallY, 0], h: [1, wallH, size / 2], q: [0, 0, 0, 1] });
  boxes.push({ kind: 'boundary', c: [0, wallY, edge + 1], h: [size / 2, wallH, 1], q: [0, 0, 0, 1] });
  boxes.push({ kind: 'boundary', c: [0, wallY, -edge - 1], h: [size / 2, wallH, 1], q: [0, 0, 0, 1] });

  const zones: MapZone[] = arr(json.zones ?? [], 'zones').map((z, i) => {
    const o = obj(z, `zones[${i}]`);
    const drop = o.drop === 'hot' || o.drop === 'medium' ? o.drop : 'quiet';
    return {
      id: String(o.id),
      name: typeof o.name === 'string' ? o.name : String(o.id),
      tier: Math.round(num(o.tier, 'zone.tier', 1)),
      drop,
      poly: Array.isArray(o.poly) ? o.poly.map((p) => vec2(p, 'zone.poly')) : [],
    };
  });
  const zoneIndex = new Map(zones.map((z, i) => [z.id, i]));
  const br = parseBr(json, zoneIndex, zones);

  const waterJ = json.water && typeof json.water === 'object' ? (json.water as Json) : {};
  const river: RiverPoint[] = Array.isArray(waterJ.river)
    ? waterJ.river.map((r, i) => {
        const o = obj(r, `water.river[${i}]`);
        return { x: num(o.x, 'river.x'), z: num(o.z, 'river.z'), bed: num(o.bed, 'river.bed', 0), water: num(o.water, 'river.water', 0) };
      })
    : [];
  const water: WaterDef = { sea: num(waterJ.sea, 'water.sea', num(json.seaLevel, 'seaLevel', 0)), river, riverHalfWidth: num(waterJ.riverHalfWidth, 'water.riverHalfWidth', 6) };

  // Warm-up and deathmatch spawns: the village square when the map has one, else the center.
  const plaza = Array.isArray(json.plaza) && json.plaza.length === 4 ? (json.plaza as unknown[]).map((v) => num(v, 'plaza')) : [-15, -15, 15, 15];
  const [px0, pz0, px1, pz1] = plaza as [number, number, number, number];
  const spawns = gridSpawns(terrain, px0, pz0, px1, pz1, 24);
  const arena = { x: (px0 + px1) / 2, z: (pz0 + pz1) / 2, radius: Math.max(px1 - px0, pz1 - pz0) };

  const terrainExtra = terrainJ.groundLegend;
  const roads = Array.isArray(json.roads)
    ? json.roads.map((r, i) => {
        const o = obj(r, `roads[${i}]`);
        return { id: String(o.id ?? i), width: num(o.width, 'road.width', 5), pts: arr(o.pts ?? [], 'road.pts').map((p) => vec2(p, 'road.pt')) };
      })
    : [];

  const def: MapDef = {
    id,
    seed: Math.round(num(json.seed, 'seed', 0)),
    size,
    seaLevel: water.sea,
    terrain,
    boxes,
    rocks: [],
    spawns,
    arena,
    arenaSpawns: spawns,
    shapes,
    water,
    br,
  };
  return {
    def,
    extras: {
      name: br.name,
      props,
      groundLegend: Array.isArray(terrainExtra) ? terrainExtra.map(String) : [],
      roads,
      unknownKinds: [...unknown].sort(),
    },
  };
}

/** Membership bits of the greybox's boxes (boundaries block movement and the camera only). */
export function greyboxBits(kind: string): number {
  return kind === 'boundary' ? CG.Move | CG.Opaque : SOLID_BITS;
}

/** FNV-1a over several byte arrays: the map hash the client checks against the server's. */
export function hashBytes(parts: readonly Uint8Array[]): string {
  let h = 0x811c9dc5;
  for (const p of parts) for (let i = 0; i < p.length; i++) h = Math.imul(h ^ (p[i] as number), 0x01000193);
  return (h >>> 0).toString(16).padStart(8, '0');
}
