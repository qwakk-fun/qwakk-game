/**
 * Loads the Sainte-Canard map files (bundled from packages/shared, hashed by
 * Vite) and builds the same MapDef the server builds. The hash covers the
 * three files the colliders come from; the client refuses to play when it
 * differs from the server's.
 */
import { buildMapDef, decodeGround, hashBytes, type MapDef, type MapV1Extras } from '@qwakk/shared';
import mapJsonUrl from '@qwakk/shared/maps/sainte-canard/map_v1.json?url';
import heightsUrl from '@qwakk/shared/maps/sainte-canard/map_v1_heights.bin?url';
import groundUrl from '@qwakk/shared/maps/sainte-canard/map_v1_ground.bin?url';
import collidersUrl from '@qwakk/shared/maps/sainte-canard/colliders.json?url';

export interface MapAssets {
  def: MapDef;
  extras: MapV1Extras;
  /** Ground paint id per height sample (same layout as the heights). */
  ground: Uint8Array;
  /** Hash of map_v1.json, the heights and colliders.json (in that order). */
  hash: string;
}

async function bytes(url: string): Promise<Uint8Array> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`could not load ${url} (${r.status})`);
  return new Uint8Array(await r.arrayBuffer());
}

export async function loadSainteCanard(onProgress?: (done: number, total: number) => void): Promise<MapAssets> {
  let done = 0;
  const step = <T>(p: Promise<T>): Promise<T> =>
    p.then((v) => {
      onProgress?.(++done, 4);
      return v;
    });
  const [jsonBytes, heightBytes, groundBytes, colliderBytes] = await Promise.all([
    step(bytes(mapJsonUrl)),
    step(bytes(heightsUrl)),
    step(bytes(groundUrl)),
    step(bytes(collidersUrl)),
  ]);
  const text = new TextDecoder();
  const json: unknown = JSON.parse(text.decode(jsonBytes));
  const colliders: unknown = JSON.parse(text.decode(colliderBytes));
  const { def, extras } = buildMapDef('sainte-canard', json, heightBytes, colliders);
  const samples = (def.terrain.cells + 1) * (def.terrain.cells + 1);
  return { def, extras, ground: decodeGround(groundBytes, samples), hash: hashBytes([jsonBytes, heightBytes, colliderBytes]) };
}
