/**
 * The hub part of Duck Plaza's map_v1.json (`hub`): where the portals stand,
 * where ducks appear (fresh, and back from each mode), the leaderboard board
 * and the pond. Written by art/map/layout/gen_plaza.py; pure data, read the
 * same way by the server (portal triggers, spawns) and the client (portal
 * swirls and signs, the board).
 */
import { dcos, dsin } from '../math.ts';
import { isPortalId, PORTAL_TRIGGER, PORTALS, type PortalId } from './constants.ts';

/** A prop-like placement: position and three.js yaw (rotY 0: the prop front, +Z, faces +z). */
export interface HubPlace {
  x: number;
  y: number;
  z: number;
  rotY: number;
}

export interface HubPortal extends HubPlace {
  id: PortalId;
}

/** [x, y, z, yaw] with the player yaw (0 looks north, -z). */
export type HubSpawn = [number, number, number, number];

export interface HubMapData {
  portals: HubPortal[];
  /** Where a fresh duck appears. */
  spawns: HubSpawn[];
  /** Back from a mode: in front of that mode's portal, looking away from it. */
  exits: Record<PortalId, HubSpawn[]>;
  /** The in-world leaderboard billboard (plaza_board), if the map has one. */
  board: HubPlace | null;
}

type Json = Record<string, unknown>;

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function place(v: unknown): HubPlace | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Json;
  if (!isNum(o.x) || !isNum(o.y) || !isNum(o.z)) return null;
  return { x: o.x, y: o.y, z: o.z, rotY: isNum(o.rotY) ? o.rotY : 0 };
}

function spawn(v: unknown): HubSpawn | null {
  if (!Array.isArray(v) || v.length < 4 || !v.slice(0, 4).every(isNum)) return null;
  return [v[0], v[1], v[2], v[3]] as HubSpawn;
}

function spawns(v: unknown): HubSpawn[] {
  return Array.isArray(v) ? v.map(spawn).filter((s): s is HubSpawn => s !== null) : [];
}

/** Read the `hub` section of a parsed map_v1.json. Throws when it has no portals or spawns. */
export function parseHubMap(rawMapJson: unknown): HubMapData {
  const json = (rawMapJson && typeof rawMapJson === 'object' ? (rawMapJson as Json).hub : null) as Json | null;
  if (!json || typeof json !== 'object') throw new Error('map_v1: no hub section');
  const portals: HubPortal[] = [];
  for (const raw of Array.isArray(json.portals) ? json.portals : []) {
    const p = place(raw);
    const id = (raw as Json | null)?.id;
    if (p && isPortalId(id) && !portals.some((q) => q.id === id)) portals.push({ ...p, id });
  }
  // Wire order: the index of a portal on the wire is its index in PORTALS.
  portals.sort((a, b) => PORTALS.indexOf(a.id) - PORTALS.indexOf(b.id));
  const fresh = spawns(json.spawns);
  if (portals.length === 0 || fresh.length === 0) throw new Error('map_v1: the hub needs portals and spawns');
  const ex = (json.exits && typeof json.exits === 'object' ? json.exits : {}) as Json;
  const exits = Object.fromEntries(PORTALS.map((id) => [id, spawns(ex[id])])) as Record<PortalId, HubSpawn[]>;
  return { portals, spawns: fresh, exits, board: place(json.board) };
}

/** A point in a placement's own frame (the inverse of the map loader's prop transform). */
export function toLocal(p: HubPlace, x: number, z: number): { lx: number; lz: number } {
  const c = dcos(p.rotY);
  const s = dsin(p.rotY);
  const dx = x - p.x;
  const dz = z - p.z;
  return { lx: c * dx - s * dz, lz: s * dx + c * dz };
}

/** The portal whose walk-through opening holds these feet, or null. */
export function portalAt(portals: readonly HubPortal[], x: number, y: number, z: number): HubPortal | null {
  for (const p of portals) {
    if (y < p.y - PORTAL_TRIGGER.below || y > p.y + PORTAL_TRIGGER.above) continue;
    const { lx, lz } = toLocal(p, x, z);
    if (Math.abs(lx) <= PORTAL_TRIGGER.halfWidth && Math.abs(lz) <= PORTAL_TRIGGER.halfDepth) return p;
  }
  return null;
}
