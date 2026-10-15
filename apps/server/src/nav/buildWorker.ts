/**
 * Worker thread that builds the Sainte-Canard navmesh (about a minute of
 * WASM work) off the main thread, so the server keeps ticking rooms while it
 * runs. Posts the exported navmesh bytes back.
 */
import { parentPort } from 'node:worker_threads';
import { exportNavMesh } from 'recast-navigation';
import { loadSainteCanard } from '../maps.ts';
import { buildNavMesh, initNav } from './navmesh.ts';

await initNav();
const bytes = exportNavMesh(buildNavMesh(loadSainteCanard().def));
parentPort?.postMessage(bytes);
