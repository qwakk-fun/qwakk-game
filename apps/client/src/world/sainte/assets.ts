/**
 * Loads a map_v1 map's files (bundled from packages/shared/src/maps/<id>/,
 * hashed by Vite) and builds the same MapDef the server builds. Every map
 * folder there is picked up by the glob below, so a newly synced map needs
 * no client change; only the files of the map in play are fetched. The hash
 * covers the three files the colliders come from; the client refuses to play
 * when it differs from the server's.
 */
import { buildMapDef, decodeGround, hashBytes, type MapDef, type MapV1Extras } from '@qwakk/shared';

/**
 * Asset URLs of every shipped map file, keyed './<id>/<file>'. Keys are
 * relative to the maps folder (`base`), so the public bundle does not spell
 * out the repo layout.
 */
const FILES = import.meta.glob('./*/*.{json,bin}', { base: '../../../../../packages/shared/src/maps/', query: '?url', import: 'default', eager: true }) as Record<string, string>;

export interface MapAssets {
  def: MapDef;
  extras: MapV1Extras;
  /** Ground paint id per height sample (same layout as the heights). */
  ground: Uint8Array;
  /** Hash of map_v1.json, the heights and colliders.json (in that order). */
  hash: string;
}

/** The asset URL of one map file, or null when the map does not ship it. */
function fileUrl(id: string, name: string): string | null {
  return FILES[`./${id}/${name}`] ?? null;
}

/** Map ids the client can load (folders with a map_v1.json). */
export function shippedMapIds(): string[] {
  const ids = new Set<string>();
  for (const path of Object.keys(FILES)) {
    const m = /^\.\/([^/]+)\/map_v1\.json$/.exec(path);
    if (m?.[1]) ids.add(m[1]);
  }
  return [...ids].sort();
}

async function bytes(url: string): Promise<Uint8Array> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`could not load ${url} (${r.status})`);
  return new Uint8Array(await r.arrayBuffer());
}

export class UnknownMapError extends Error {}

export async function loadMapAssets(id: string, onProgress?: (done: number, total: number) => void): Promise<MapAssets> {
  const urls = ['map_v1.json', 'map_v1_heights.bin', 'map_v1_ground.bin', 'colliders.json'].map((name) => fileUrl(id, name));
  const [jsonUrl, heightsUrl, groundUrl, collidersUrl] = urls;
  if (!jsonUrl || !heightsUrl || !collidersUrl) throw new UnknownMapError(`map "${id}" is not in this build`);
  let done = 0;
  const step = <T>(p: Promise<T>): Promise<T> =>
    p.then((v) => {
      onProgress?.(++done, 4);
      return v;
    });
  const [jsonBytes, heightBytes, groundBytes, colliderBytes] = await Promise.all([
    step(bytes(jsonUrl)),
    step(bytes(heightsUrl)),
    // Ground paint is optional (plain grass without it).
    step(groundUrl ? bytes(groundUrl) : Promise.resolve(new Uint8Array(0))),
    step(bytes(collidersUrl)),
  ]);
  const text = new TextDecoder();
  const json: unknown = JSON.parse(text.decode(jsonBytes));
  const colliders: unknown = JSON.parse(text.decode(colliderBytes));
  const { def, extras } = buildMapDef(id, json, heightBytes, colliders);
  const samples = (def.terrain.cells + 1) * (def.terrain.cells + 1);
  const ground = groundBytes.byteLength > 0 ? decodeGround(groundBytes, samples) : new Uint8Array(samples);
  return { def, extras, ground, hash: hashBytes([jsonBytes, heightBytes, colliderBytes]) };
}

/** Yelova (the battle royale map; the dev map viewer). */
export function loadSainteCanard(onProgress?: (done: number, total: number) => void): Promise<MapAssets> {
  return loadMapAssets('sainte-canard', onProgress);
}
