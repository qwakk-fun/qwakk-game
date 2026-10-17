/**
 * Worker thread that builds a map_v1 map's navmesh (about a minute of WASM
 * work for Yelova) off the main thread, so the server keeps ticking
 * rooms while it runs. Gets the map id as workerData, posts the exported
 * navmesh bytes back.
 */
import { parentPort, workerData } from 'node:worker_threads';
import { exportNavMesh } from 'recast-navigation';
import { loadMapV1 } from '../maps.ts';
import { buildNavMesh, initNav } from './navmesh.ts';

await initNav();
const bytes = exportNavMesh(buildNavMesh(loadMapV1(String(workerData)).def));
parentPort?.postMessage(bytes);
