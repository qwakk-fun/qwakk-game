/**
 * Dev-only map viewer (dev server and test builds only, see vite.config.ts):
 * loads Sainte-Canard without a game server and flies a fixed camera path for
 * frame time, draw call and triangle measurements (e2e/map-perf.ts).
 *
 * URL: /game/mapview.html?quality=low&shadows=0&ducks=0&segment=street&hold=1 (or &cam=x,y,z&look=x,y,z&segment=view)
 */
import * as THREE from 'three/webgpu';
import { Item } from '@qwakk/shared';
import { config } from '../config.ts';
import { createRenderer } from '../render/renderer.ts';
import { Avatar } from '../player/avatar.ts';
import { loadDuckGlb } from '../player/duckModel.ts';
import { loadClips } from '../player/animations.ts';
import { createGlider, createSainteWorld, ItemsView, loadSainteCanard, PlaneView, ZoneWall } from '../world/sainte/index.ts';

const params = new URLSearchParams(location.search);
const info = document.getElementById('info') as HTMLElement;

interface Segment {
  name: string;
  seconds: number;
  /** Camera position and look target at u in [0, 1]. */
  at(u: number, pos: THREE.Vector3, look: THREE.Vector3, ground: (x: number, z: number) => number): void;
}

const lerp = (a: number, b: number, u: number) => a + (b - a) * u;

/** Plane path 0 from map_v1 (the viewer has no server to pick one). */
const PLANE_FROM = new THREE.Vector2(-263, -399.8);
const PLANE_TO = new THREE.Vector2(96.7, 468.7);

const SEGMENTS: Segment[] = [
  {
    name: 'plane',
    seconds: 7,
    at(u, pos, look) {
      const t = 0.15 + u * 0.35;
      const x = lerp(PLANE_FROM.x, PLANE_TO.x, t);
      const z = lerp(PLANE_FROM.y, PLANE_TO.y, t);
      const dir = new THREE.Vector2(PLANE_TO.x - PLANE_FROM.x, PLANE_TO.y - PLANE_FROM.y).normalize();
      pos.set(x - dir.x * 26 + 8, 188, z - dir.y * 26);
      look.set(x + dir.x * 60, 140, z + dir.y * 60);
    },
  },
  {
    name: 'glide',
    seconds: 7,
    at(u, pos, look, ground) {
      const x = lerp(-60, 30, u);
      const z = lerp(-360, -205, u);
      pos.set(x, lerp(150, ground(x, z) + 30, u), z);
      look.set(45, 8, -195);
    },
  },
  {
    name: 'street',
    seconds: 8,
    at(u, pos, look, ground) {
      const x = lerp(-50, 130, u);
      const z = lerp(-188, -182, u);
      pos.set(x, ground(x, z) + 2.6, z);
      look.set(x + 20, ground(x + 20, z) + 2, z + 1);
    },
  },
  {
    name: 'turn',
    seconds: 6,
    at(u, pos, look, ground) {
      const cx = 40;
      const cz = -192;
      pos.set(cx, ground(cx, cz) + 2.6, cz);
      const a = u * Math.PI * 2;
      look.set(cx + Math.sin(a) * 20, pos.y - 0.5, cz - Math.cos(a) * 20);
    },
  },
];

/** `?cam=x,y,z&look=x,y,z` adds a fixed 'view' segment (house interiors, review shots). */
const camParam = params.get('cam')?.split(',').map(Number);
const lookParam = params.get('look')?.split(',').map(Number);
if (camParam?.length === 3 && lookParam?.length === 3 && [...camParam, ...lookParam].every(Number.isFinite)) {
  const [cx, cy, cz] = camParam as [number, number, number];
  const [lx, ly, lz] = lookParam as [number, number, number];
  SEGMENTS.push({
    name: 'view',
    seconds: 3,
    at(_u, pos, look) {
      pos.set(cx, cy, cz);
      look.set(lx, ly, lz);
    },
  });
}

interface SegStats {
  name: string;
  frames: number;
  frameMsAvg: number;
  frameMsP95: number;
  cpuMsAvg: number;
  cpuMsP95: number;
  drawCallsAvg: number;
  drawCallsMax: number;
  trianglesAvg: number;
  trianglesMax: number;
}

function summarize(name: string, frames: number[], cpu: number[], calls: number[], tris: number[]): SegStats {
  const avg = (a: number[]) => a.reduce((s, v) => s + v, 0) / Math.max(1, a.length);
  const p95 = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length * 0.95)] ?? 0;
  const r = (v: number, d = 2) => Math.round(v * 10 ** d) / 10 ** d;
  return {
    name,
    frames: frames.length,
    frameMsAvg: r(avg(frames)),
    frameMsP95: r(p95(frames)),
    cpuMsAvg: r(avg(cpu)),
    cpuMsP95: r(p95(cpu)),
    drawCallsAvg: Math.round(avg(calls)),
    drawCallsMax: Math.max(0, ...calls),
    trianglesAvg: Math.round(avg(tris)),
    trianglesMax: Math.max(0, ...tris),
  };
}

async function main(): Promise<void> {
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const shadows = params.get('shadows') !== '0';
  const [ctx, assets] = await Promise.all([createRenderer(canvas, { forceWebGL: config.forceWebGL, pixelRatio: config.pixelRatio, shadows }), loadSainteCanard()]);
  const { scene, camera, renderer } = ctx;
  camera.far = 1400;
  camera.updateProjectionMatrix();
  const quality = params.get('quality') === 'low' ? 'low' : 'high';
  const world = await createSainteWorld(scene, assets, { quality, shadows });
  const ground = (x: number, z: number) => world.groundAt(x, z);

  const plane = new PlaneView(scene);
  plane.visible = true;
  const zone = new ZoneWall(scene, ground);
  zone.set(60, -40, 260);
  zone.setNext(40, -120, 170);
  const items = new ItemsView(scene);
  const loot = assets.def.br?.loot ?? [];
  const kinds = [Item.Rifle, Item.Pistol, Item.RifleAmmo, Item.PistolAmmo, Item.Vest1, Item.Vest2, Item.Helmet1, Item.Helmet2, Item.Bandage, Item.Medkit, Item.Backpack1, Item.Backpack2, Item.Backpack3];
  loot.forEach((p, i) => {
    if (i % 10 < 7) items.upsert(`i${i}`, kinds[i % kinds.length] as number, p.x, p.y, p.z);
  });

  // 16 ducks in and around the village square, walking small circles; one gliding above.
  const ducks: Avatar[] = [];
  const duckCount = params.get('ducks') === '0' ? 0 : 16;
  const [glb] = await Promise.all([config.placeholderDuck ? Promise.resolve(null) : loadDuckGlb(), loadClips()]);
  for (let i = 0; i < duckCount; i++) {
    const a = new Avatar();
    if (glb) a.setModel(glb);
    scene.add(a.object);
    ducks.push(a);
  }
  const glider = createGlider();
  if (ducks[0]) ducks[0].object.add(glider);

  camera.position.set(0, 120, 300);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  await world.warmup(renderer, camera);

  const segName = params.get('segment');
  const hold = params.get('hold') === '1';
  const segs = segName ? SEGMENTS.filter((s) => s.name === segName) : SEGMENTS;
  const results: SegStats[] = [];
  const state = { ready: false, done: false, segment: '', results };
  (window as unknown as { __mapview: unknown }).__mapview = {
    get ready() {
      return state.ready;
    },
    get done() {
      return state.done;
    },
    get segment() {
      return state.segment;
    },
    results,
    /** Live numbers for the current frame window. */
    stats: () => live,
  };
  let live = { fps: 0, frameMsAvg: 0, frameMsP95: 0, drawCalls: 0, triangles: 0 };

  const pos = new THREE.Vector3();
  const look = new THREE.Vector3();
  let segIndex = 0;
  let segStart = -1;
  let last = 0;
  let warm = 40; // frames to settle shader compiles before measuring
  let frames: number[] = [];
  let cpu: number[] = [];
  let calls: number[] = [];
  let tris: number[] = [];
  const window60: number[] = [];
  state.ready = true;

  renderer.setAnimationLoop((now: number) => {
    const dt = last ? Math.min(0.1, (now - last) / 1000) : 1 / 60;
    const frameMs = last ? now - last : 16.7;
    last = now;
    const seg = segs[segIndex];
    if (!seg) return;
    if (segStart < 0) segStart = now;
    const u = hold ? 0.5 : Math.min(1, (now - segStart) / 1000 / seg.seconds);
    seg.at(u, pos, look, ground);
    camera.position.copy(pos);
    camera.lookAt(look);
    camera.updateMatrixWorld();

    const t0 = performance.now();
    const time = now / 1000;
    // Plane flies along path 0 ahead of the camera.
    const pt = 0.2 + ((time * 0.02) % 0.6);
    const dir = new THREE.Vector2(PLANE_TO.x - PLANE_FROM.x, PLANE_TO.y - PLANE_FROM.y).normalize();
    plane.update(lerp(PLANE_FROM.x, PLANE_TO.x, pt), 180, lerp(PLANE_FROM.y, PLANE_TO.y, pt), Math.atan2(dir.x, dir.y), dt);
    ducks.forEach((d, i) => {
      const a = time * 0.6 + (i / ducks.length) * Math.PI * 2;
      const r = 6 + (i % 4) * 3;
      const x = 40 + Math.cos(a) * r;
      const z = -192 + Math.sin(a) * r;
      const air = i === 0;
      d.update({ x, y: air ? ground(x, z) + 25 : ground(x, z), z, yaw: -a, pitch: 0, crouch: 0, grounded: !air, alive: true, weapon: i % 2, act: 0 }, dt);
    });
    items.update(dt, camera);
    zone.update(dt);
    world.update(camera, dt);
    world.env.follow(pos);
    renderer.render(scene, camera);
    const cpuMs = performance.now() - t0;
    const r = renderer.info.render;

    window60.push(frameMs);
    if (window60.length > 60) window60.shift();
    const sorted = [...window60].sort((a, b) => a - b);
    const avg = window60.reduce((s, v) => s + v, 0) / window60.length;
    live = { fps: 1000 / avg, frameMsAvg: avg, frameMsP95: sorted[Math.floor(sorted.length * 0.95)] ?? 0, drawCalls: r.drawCalls, triangles: r.triangles };
    info.textContent = `${seg.name}  ${live.fps.toFixed(0)} fps  ${avg.toFixed(1)} ms  cpu ${cpuMs.toFixed(2)} ms\ncalls ${r.drawCalls}  tris ${r.triangles}  props ${world.info().propInstances}`;

    if (warm > 0) {
      warm--;
      segStart = now;
      return;
    }
    frames.push(frameMs);
    cpu.push(cpuMs);
    calls.push(r.drawCalls);
    tris.push(r.triangles);
    if (!hold && u >= 1) {
      results.push(summarize(seg.name, frames, cpu, calls, tris));
      frames = [];
      cpu = [];
      calls = [];
      tris = [];
      segIndex++;
      segStart = -1;
      warm = 10;
      state.segment = segs[segIndex]?.name ?? '';
      if (segIndex >= segs.length) state.done = true;
    }
  });
  state.segment = segs[0]?.name ?? '';
}

main().catch((e: unknown) => {
  console.error(e);
  info.textContent = `Map viewer failed: ${e instanceof Error ? e.message : String(e)}`;
});
