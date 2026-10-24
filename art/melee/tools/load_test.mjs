// Headless three.js check of the published melee files (no browser, no dev server).
//
// Usage (from qwakk-game/): node art/melee/tools/load_test.mjs
//
// Loads duck.glb, melee/duck_melee_anims.glb, melee/katana.glb, melee/melee_fx.glb and melee/melee.json with
// three's GLTFLoader, plays every melee clip on the classic duck through an AnimationMixer and checks: every
// track binds, the skinned bounds stay finite, the katana attached with melee.json's pose puts its Tip where
// the art build measured it at the checkpoint frames, the Draw grab and the Sheathe release hand the katana
// over between the hand and the scabbard's KatanaSeat without a pop, and the effects carry their glow ramp.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const models = path.resolve(here, '../../../apps/client/public/models');
const melee = path.join(models, 'melee');

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
  const buf = fs.readFileSync(file);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  return new Promise((res, rej) => new GLTFLoader().parse(ab, '', res, rej));
}

const problems = [];
const report = {};
const manifest = JSON.parse(fs.readFileSync(path.join(melee, 'melee.json'), 'utf8'));
const duck = await load(path.join(models, 'duck.glb'));
const anims = await load(path.join(melee, 'duck_melee_anims.glb'));
const kit = await load(path.join(melee, 'katana.glb'));
const fx = await load(path.join(melee, 'melee_fx.glb'));
const clips = Object.fromEntries(anims.animations.map((c) => [c.name, c]));
report.clips = Object.fromEntries(anims.animations.map((c) => [c.name, +c.duration.toFixed(3)]));

const root = duck.scene;
const mixer = new THREE.AnimationMixer(root);
const hand = root.getObjectByName('RightHand');
const sayaNode = root.getObjectByName(manifest.attach.scabbard.node);
const katana = kit.scene.getObjectByName('Katana');
const scabbard = kit.scene.getObjectByName('Scabbard');
for (const [obj, pose, parent] of [[katana, manifest.attach.katana, hand], [scabbard, manifest.attach.scabbard, sayaNode]]) {
  parent.add(obj);
  obj.position.fromArray(pose.position);
  obj.quaternion.fromArray(pose.quaternion);
}
const seat = scabbard.getObjectByName('KatanaSeat');
const tip = katana.getObjectByName('Tip');

function at(action, t) {
  action.reset().play();
  action.time = t;
  mixer.update(0);
  root.updateMatrixWorld(true);
}

function skinnedBox() {
  const box = new THREE.Box3();
  root.traverse((o) => {
    if (o.isSkinnedMesh) {
      o.skeleton.update();
      o.computeBoundingBox();
      box.union(o.boundingBox.clone().applyMatrix4(o.matrixWorld));
    }
  });
  return box;
}

for (const [name, clip] of Object.entries(clips)) {
  const before = warnings.length;
  const action = mixer.clipAction(clip);
  action.setLoop(THREE.LoopOnce, 1);
  action.clampWhenFinished = true;
  for (const t of [0, clip.duration * 0.5, clip.duration]) {
    at(action, t);
    const box = skinnedBox();
    if (![box.min.x, box.min.y, box.max.y].every(Number.isFinite)) problems.push(`${name}: NaN bounds`);
  }
  const info = manifest.clips[name];
  if (!info) problems.push(`${name}: not in melee.json`);
  else if (Math.abs(info.seconds - clip.duration) > 0.02) problems.push(`${name}: ${clip.duration} s, melee.json says ${info.seconds}`);
  action.stop();
  mixer.update(0);
  if (warnings.length > before) problems.push(`${name}: ${warnings.slice(before).join(' | ')}`);
}

// the attach pose: the Tip lands where the art build measured it
report.checkpoints = [];
for (const cp of manifest.checkpoints.points) {
  const action = mixer.clipAction(clips[cp.clip]);
  at(action, cp.time);
  const p = tip.getWorldPosition(new THREE.Vector3());
  const d = p.distanceTo(new THREE.Vector3().fromArray(cp.tip));
  report.checkpoints.push({ clip: cp.clip, time: cp.time, tip: p.toArray().map((v) => +v.toFixed(3)), error: +d.toFixed(4) });
  if (d > 0.02) problems.push(`checkpoint ${cp.clip} @${cp.time}: Tip off by ${d.toFixed(3)} m`);
  action.stop();
}

// the hand-over: at Draw's grab and Sheathe's release the katana in the hand sits exactly in the seat
function handover(clipName, eventName) {
  const t = Math.round(manifest.clips[clipName].events[eventName] * 30) / 30;
  const action = mixer.clipAction(clips[clipName]);
  at(action, t);
  const inHand = katana.matrixWorld.clone();
  const inSeat = seat.matrixWorld.clone();
  const pa = new THREE.Vector3(), pb = new THREE.Vector3(), qa = new THREE.Quaternion(), qb = new THREE.Quaternion(), s = new THREE.Vector3();
  inHand.decompose(pa, qa, s);
  inSeat.decompose(pb, qb, s);
  const dist = pa.distanceTo(pb);
  const angle = 2 * Math.acos(Math.min(1, Math.abs(qa.dot(qb))));
  action.stop();
  report[`${clipName}.${eventName}`] = { distance: +dist.toFixed(4), degrees: +(angle * 180 / Math.PI).toFixed(2) };
  if (dist > 0.015 || angle > 0.05) problems.push(`${clipName} ${eventName}: hand and seat differ by ${dist.toFixed(3)} m, ${(angle * 180 / Math.PI).toFixed(1)} deg`);
}
handover('Draw', 'grab');
handover('Sheathe', 'release');

// effects: the glow ramp is in the vertex colors
report.fx = {};
for (const n of ['SlashArc', 'Shockwave', 'EliteRing', 'Feather']) {
  const o = fx.scene.getObjectByName(n);
  if (!o?.isMesh) { problems.push(`melee_fx.glb: ${n} missing`); continue; }
  report.fx[n] = o.geometry.index.count / 3;
  if (n !== 'Feather' && !o.geometry.attributes.color) problems.push(`melee_fx.glb: ${n} has no vertex colors`);
}

console.warn = warn;
console.log(JSON.stringify(report, null, 1));
for (const p of problems) console.log('PROBLEM:', p);
console.log('LOAD TEST', problems.length ? 'FAILED' : 'OK');
process.exit(problems.length ? 1 : 0);
