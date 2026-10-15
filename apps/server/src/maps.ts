/**
 * Map loading on the server: the greybox comes from its seed, Sainte-Canard
 * from the map files shipped in the shared package (read once per process).
 * The hash covers the same bytes the client fetches, so a client with other
 * files refuses to play instead of desyncing.
 */
import { readFileSync } from 'node:fs';
import { buildMapDef, generateMap, hashBytes, type LoadedMap, type MapDef } from '@qwakk/shared';

export const SAINTE_CANARD = 'sainte-canard';

export interface ServerMap {
  def: MapDef;
  hash: string;
  loaded: LoadedMap | null;
}

let sainte: ServerMap | null = null;

/** Sainte-Canard map files (map_v1.json, heights, colliders), parsed once. */
export function loadSainteCanard(): ServerMap {
  if (sainte) return sainte;
  const dir = new URL('../../../packages/shared/src/maps/sainte-canard/', import.meta.url);
  const json = new Uint8Array(readFileSync(new URL('map_v1.json', dir)));
  const heights = new Uint8Array(readFileSync(new URL('map_v1_heights.bin', dir)));
  const colliders = new Uint8Array(readFileSync(new URL('colliders.json', dir)));
  const text = new TextDecoder();
  const loaded = buildMapDef(SAINTE_CANARD, JSON.parse(text.decode(json)), heights, JSON.parse(text.decode(colliders)));
  if (loaded.extras.unknownKinds.length > 0) console.warn(`[map] unknown collider kinds (treated as solid): ${loaded.extras.unknownKinds.join(', ')}`);
  sainte = { def: loaded.def, hash: hashBytes([json, heights, colliders]), loaded };
  return sainte;
}

export function greybox(seed: number): ServerMap {
  return { def: generateMap(seed), hash: '', loaded: null };
}
