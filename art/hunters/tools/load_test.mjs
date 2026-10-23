// Headless three.js check of the published hunter GLBs (no browser, no dev server).
//
// Usage (from qwakk-game/): node art/hunters/tools/load_test.mjs
//
// Loads every hunter, the clips, the dog and the props with three's GLTFLoader, plays every clip on every
// hunter through an AnimationMixer and checks: all tracks bind (no missing nodes), no NaN in the skinned
// bounds, heights, the muzzle in front (+Z), the hat leaves the head and the stars show in Defeat, and the
// hidden effect joints fall back to scale 0 once the defeat stops.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.resolve(here, '../../../apps/client/public/models/hunters');

// Node has no image decoder: textures are not under test here, so hand the loader a 1 px stand-in.
THREE.ImageBitmapLoader.prototype.load = function (url, onLoad) {
  const img = { width: 1, height: 1, close() {} };
  setTimeout(() => onLoad(img), 0);
  return img;
};
globalThis.createImageBitmap ??= async () => ({ width: 1, height: 1, close() {} });
globalThis.self ??= globalThis;

const warnings = [];
const warn = console.warn;
console.warn = (...a) => { warnings.push(a.join(' ')); };

async function load(file) {
  const buf = fs.readFileSync(path.join(dir, file));
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  return new Promise((res, rej) => new GLTFLoader().parse(ab, '', res, rej));
}

const problems = [];

/** Pose one action at time t (restarts it, so a finished clamped action poses again). */
function at(mixer, action, t) {
  action.reset().play();
  action.time = t;
  mixer.update(0);
}
const report = {};
const anims = await load('hunter_anims.glb');
const clips = Object.fromEntries(anims.animations.map((c) => [c.name, c]));
report.clips = Object.fromEntries(anims.animations.map((c) => [c.name, +c.duration.toFixed(3)]));

function skinnedBox(root, lod = 'LOD0') {
  root.updateMatrixWorld(true);
  const box = new THREE.Box3();
  root.getObjectByName(lod).traverse((o) => {
    if (o.isSkinnedMesh) {
      o.skeleton.update();
      o.computeBoundingBox();
      box.union(o.boundingBox.clone().applyMatrix4(o.matrixWorld));
    }
  });
  return box;
}

function world(root, name) {
  root.updateMatrixWorld(true);
  return root.getObjectByName(name).getWorldPosition(new THREE.Vector3());
}

for (const id of ['rifleman', 'trapper', 'decoy', 'boss']) {
  const gltf = await load(`hunter_${id}.glb`);
  const root = gltf.scene;
  const info = {};
  const lods = ['LOD0', 'LOD1', 'LOD2'].map((n) => root.getObjectByName(n));
  if (lods.some((l) => !l)) problems.push(`${id}: missing LOD node`);
  let skinned = 0;
  root.traverse((o) => { if (o.isSkinnedMesh) skinned++; });
  info.skinnedMeshes = skinned;
  const mixer = new THREE.AnimationMixer(root);
  for (const [name, clip] of Object.entries(clips)) {
    const before = warnings.length;
    const action = mixer.clipAction(clip);
    action.setLoop(THREE.LoopOnce, 1);     // non-looping use: hold the last frame (Defeat, Hit, Fire, ...)
    action.clampWhenFinished = true;
    action.reset().play();
    for (const t of [0, clip.duration * 0.5, clip.duration]) {
      at(mixer, action, t);
      const box = skinnedBox(root);
      if (![box.min.x, box.min.y, box.max.y].every(Number.isFinite)) problems.push(`${id} ${name}: NaN bounds`);
    }
    if (name === 'Idle') {
      at(mixer, action, 0);
      const box = skinnedBox(root);
      info.height = +box.max.y.toFixed(3);
      info.feet = +box.min.y.toFixed(3);
      info.headTop = +world(root, 'HeadTop').y.toFixed(3);
    }
    if (name === 'Aim') {
      at(mixer, action, 0);
      const m = world(root, 'Muzzle');
      info.muzzleAim = [+m.x.toFixed(3), +m.y.toFixed(3), +m.z.toFixed(3)];
      if (m.z < 0.5) problems.push(`${id}: muzzle not in front (+Z) in Aim`);
      const up = mixer.clipAction(clips.Aim_Up);
      action.stop();
      at(mixer, up, 0);
      const mu = world(root, 'Muzzle');
      if (mu.y < m.y + 0.2) problems.push(`${id}: Aim_Up does not raise the muzzle`);
      up.stop();
      action.play();
    }
    if (name === 'Defeat') {
      at(mixer, action, 0);
      const hat0 = world(root, 'Hat');
      at(mixer, action, clip.duration);
      const hat1 = world(root, 'Hat');
      const head1 = world(root, 'Head');
      const stars = root.getObjectByName('FxStars').scale.x;
      info.defeatEnd = { hatOnGround: +hat1.y.toFixed(3), hatFromHead: +hat1.distanceTo(head1).toFixed(3), stars: +stars.toFixed(2) };
      if (hat1.y > 0.4 || hat1.distanceTo(head1) < 0.4) problems.push(`${id}: the hat does not pop off in Defeat`);
      if (stars < 0.9) problems.push(`${id}: stars not shown at the end of Defeat`);
      if (hat0.distanceTo(hat1) < 0.5) problems.push(`${id}: hat did not move`);
    }
    action.stop();
    mixer.update(0);
    if (warnings.length > before) problems.push(`${id} ${name}: ${warnings.slice(before).join(' | ')}`);
  }
  // after every clip stopped, the hidden joints are back at scale 0 and the hat is back on the head
  at(mixer, mixer.clipAction(clips.Idle), 0.5);
  root.updateMatrixWorld(true);
  for (const n of ['FxStars', 'FxPoof', 'LeftHandProp']) {
    if (root.getObjectByName(n).scale.x !== 0) problems.push(`${id}: ${n} not restored to scale 0 after Defeat`);
  }
  if (world(root, 'Hat').distanceTo(world(root, 'Head')) > 0.4 * (id === 'boss' ? 1.3 : 1)) {
    problems.push(`${id}: the hat is not back on the head after Defeat`);
  }
  // attach poses from hunters.json: at the bind pose, Stars, Poof and the held decoy sit upright, facing +Z
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'hunters.json'), 'utf8'));
  mixer.stopAllAction();   // stopped actions hand every joint back its bind transform
  mixer.uncacheRoot(root);
  for (const [prop, pose] of Object.entries(manifest.attach.hunter)) {
    const joint = root.getObjectByName(pose.node);
    const saved = joint.scale.clone();
    joint.scale.set(1, 1, 1);
    const probe = new THREE.Object3D();
    probe.position.fromArray(pose.position);
    probe.quaternion.fromArray(pose.quaternion);
    joint.add(probe);
    root.updateMatrixWorld(true);
    const q = probe.getWorldQuaternion(new THREE.Quaternion());
    const angle = 2 * Math.acos(Math.min(1, Math.abs(q.w)));
    if (angle > 0.01) problems.push(`${id}: attach ${prop} is not upright at the bind pose (${angle.toFixed(3)} rad)`);
    joint.remove(probe);
    joint.scale.copy(saved);
  }
  report[id] = info;
}

const dog = await load('dog.glb');
{
  const root = dog.scene;
  const mixer = new THREE.AnimationMixer(root);
  const info = { clips: dog.animations.map((c) => c.name) };
  for (const clip of dog.animations) {
    const before = warnings.length;
    const a = mixer.clipAction(clip);
    a.setLoop(THREE.LoopOnce, 1);
    a.clampWhenFinished = true;
    at(mixer, a, clip.duration);
    const box = skinnedBox(root);
    if (!Number.isFinite(box.max.y)) problems.push(`dog ${clip.name}: NaN bounds`);
    if (clip.name === 'Idle') info.height = +box.max.y.toFixed(3);
    if (clip.name === 'Defeat') info.defeatTop = +box.max.y.toFixed(3);
    a.stop();
    if (warnings.length > before) problems.push(`dog ${clip.name}: ${warnings.slice(before).join(' | ')}`);
  }
  report.dog = info;
}
for (const f of ['decoy.glb', 'trap.glb', 'hunter_fx.glb']) {
  const g = await load(f);
  const names = [];
  g.scene.traverse((o) => { if (o.isMesh) names.push(o.name); });
  report[f] = names;
}

console.warn = warn;
console.log(JSON.stringify(report, null, 1));
for (const p of problems) console.log('PROBLEM:', p);
console.log('LOAD TEST', problems.length ? 'FAILED' : 'OK');
process.exit(problems.length ? 1 : 0);
