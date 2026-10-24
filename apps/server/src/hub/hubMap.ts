/**
 * The hub map on the server: Duck Plaza's map_v1 (colliders, terrain, the
 * hash the client checks) plus its `hub` section (portals, spawns, exits),
 * read from the same shipped files as every map (maps.ts).
 */
import { readFileSync } from 'node:fs';
import { parseHubMap, type HubMapData } from '@qwakk/shared/hub';
import { loadMapV1, type ServerMap } from '../maps.ts';

export interface ServerHubMap extends ServerMap {
  hub: HubMapData;
}

const cache = new Map<string, ServerHubMap>();

export function loadHubMap(id: string): ServerHubMap {
  const hit = cache.get(id);
  if (hit) return hit;
  const map = loadMapV1(id);
  const raw = readFileSync(new URL(`../../../../packages/shared/src/maps/${id}/map_v1.json`, import.meta.url), 'utf8');
  const out: ServerHubMap = { ...map, hub: parseHubMap(JSON.parse(raw)) };
  cache.set(id, out);
  return out;
}
