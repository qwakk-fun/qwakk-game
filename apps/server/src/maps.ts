/**
 * Map loading on the server: the greybox comes from its seed, map_v1 maps
 * (Yelova, the deathmatch map) from the map files shipped in the
 * shared package under `maps/<id>/` (read once per process and id). The hash
 * covers the same bytes the client fetches, so a client with other files
 * refuses to play instead of desyncing.
 */
import { readFileSync } from 'node:fs';
import { buildMapDef, generateMap, hashBytes, MATCH, ROOM, type LoadedMap, type MapDef } from '@qwakk/shared';

export const SAINTE_CANARD = 'sainte-canard';
export const GREYBOX = 'greybox';

export interface ServerMap {
  def: MapDef;
  hash: string;
  loaded: LoadedMap | null;
}

const cache = new Map<string, ServerMap>();

/** Map ids are folder names: lowercase letters, digits and dashes only. */
export function validMapId(id: string): boolean {
  return /^[a-z0-9][a-z0-9-]{0,63}$/.test(id);
}

/** A map_v1 map's files (map_v1.json, heights, colliders), parsed once. */
export function loadMapV1(id: string): ServerMap {
  const hit = cache.get(id);
  if (hit) return hit;
  if (!validMapId(id) || id === GREYBOX) throw new Error(`invalid map id "${id}"`);
  const dir = new URL(`../../../packages/shared/src/maps/${id}/`, import.meta.url);
  const json = new Uint8Array(readFileSync(new URL('map_v1.json', dir)));
  const heights = new Uint8Array(readFileSync(new URL('map_v1_heights.bin', dir)));
  const colliders = new Uint8Array(readFileSync(new URL('colliders.json', dir)));
  const text = new TextDecoder();
  const loaded = buildMapDef(id, JSON.parse(text.decode(json)), heights, JSON.parse(text.decode(colliders)));
  if (loaded.extras.unknownKinds.length > 0) console.warn(`[map] ${id}: unknown collider kinds (treated as solid): ${loaded.extras.unknownKinds.join(', ')}`);
  const map: ServerMap = { def: loaded.def, hash: hashBytes([json, heights, colliders]), loaded };
  cache.set(id, map);
  return map;
}

/** Yelova (the battle royale map). */
export function loadSainteCanard(): ServerMap {
  return loadMapV1(SAINTE_CANARD);
}

export function greybox(seed: number): ServerMap {
  return { def: generateMap(seed), hash: '', loaded: null };
}

/** The deathmatch map id: QWAKK_DM_MAP when set (tests, a quick switch), else MATCH.mapId. */
export function dmMapId(): string {
  return process.env.QWAKK_DM_MAP || MATCH.mapId;
}

/** Any map by id: the greybox from its seed, or a map_v1 map. */
export function loadMap(id: string, seed: number = ROOM.defaultSeed): ServerMap {
  return id === GREYBOX ? greybox(seed >>> 0) : loadMapV1(id);
}
