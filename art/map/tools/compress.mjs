// Compress the prop GLBs for the client and verify them with three's own MeshoptDecoder.
//
// Usage: node art/map/tools/compress.mjs <srcDir> <outDir> <manifest.json>
//
// Per file: reorder for meshopt, quantize (positions 14 bit over one shared volume per file, normals 10 bit,
// palette UVs 12 bit, which keeps the 16 px cell centers exact), then EXT_meshopt_compression.
// Quantization puts one scale + translation on every mesh node (KHR_mesh_quantization), so engines must use
// the node matrices (three's GLTFLoader does). Pivot empties (PropLeft, PropRight) keep their transforms.
//
// Verification: every compressed buffer view is decoded with three/examples/jsm/libs/meshopt_decoder.module.js
// (the decoder the client ships), positions are dequantized through the node hierarchy, and the resulting
// bounds must match the uncompressed source within 1 cm.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { reorder, quantize } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';

const here = path.dirname(fileURLToPath(import.meta.url));
const threeDecoderPath = path.resolve(here, '../../../node_modules/three/examples/jsm/libs/meshopt_decoder.module.js');
const { MeshoptDecoder: ThreeDecoder } = await import(threeDecoderPath);

const [srcDir, outDir, manifestPath] = process.argv.slice(2);
if (!srcDir || !outDir) {
  console.error('usage: node compress.mjs <srcDir> <outDir> [manifest.json]');
  process.exit(2);
}
await MeshoptEncoder.ready;
await MeshoptDecoder.ready;
await ThreeDecoder.ready;

const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });

// ---------------------------------------------------------------- GLB reading for verification
function readGlb(buf) {
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));
  const binStart = 20 + jsonLen;
  const bin = binStart < buf.length ? buf.subarray(binStart + 8, binStart + 8 + buf.readUInt32LE(binStart)) : null;
  return { json, bin };
}

function nodeMatrix(n) {
  if (n.matrix) return n.matrix;
  const [tx, ty, tz] = n.translation ?? [0, 0, 0];
  const [x, y, z, w] = n.rotation ?? [0, 0, 0, 1];
  const [sx, sy, sz] = n.scale ?? [1, 1, 1];
  const x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2, yy = y * y2, yz = y * z2, zz = z * z2;
  const wx = w * x2, wy = w * y2, wz = w * z2;
  return [
    (1 - (yy + zz)) * sx, (xy + wz) * sx, (xz - wy) * sx, 0,
    (xy - wz) * sy, (1 - (xx + zz)) * sy, (yz + wx) * sy, 0,
    (xz + wy) * sz, (yz - wx) * sz, (1 - (xx + yy)) * sz, 0,
    tx, ty, tz, 1,
  ];
}

function mul(a, b) {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
}

const COMPONENT = { 5120: [Int8Array, 127], 5121: [Uint8Array, 255], 5122: [Int16Array, 32767], 5123: [Uint16Array, 65535], 5126: [Float32Array, 1] };

/** Decode (if needed) and return world-space position bounds of every mesh in the file. */
function positionBounds(buf, decodeMeshopt) {
  const { json, bin } = readGlb(buf);
  const views = (json.bufferViews ?? []).map((bv) => {
    const ext = bv.extensions?.EXT_meshopt_compression;
    if (ext) {
      if (!decodeMeshopt) throw new Error('compressed view without decoder');
      const src = new Uint8Array(bin.buffer, bin.byteOffset + (ext.byteOffset ?? 0), ext.byteLength);
      const out = new Uint8Array(ext.count * ext.byteStride);
      ThreeDecoder.decodeGltfBuffer(out, ext.count, ext.byteStride, src, ext.mode, ext.filter ?? 'NONE');
      return { data: out, stride: bv.byteStride ?? ext.byteStride };
    }
    return { data: new Uint8Array(bin.buffer, bin.byteOffset + (bv.byteOffset ?? 0), bv.byteLength), stride: bv.byteStride };
  });
  const mn = [Infinity, Infinity, Infinity];
  const mx = [-Infinity, -Infinity, -Infinity];
  const names = [];
  const visit = (idx, parent) => {
    const n = json.nodes[idx];
    names.push(n.name ?? '');
    const m = mul(parent, nodeMatrix(n));
    if (n.mesh !== undefined) {
      for (const prim of json.meshes[n.mesh].primitives) {
        const acc = json.accessors[prim.attributes.POSITION];
        const view = views[acc.bufferView];
        const [Arr, maxv] = COMPONENT[acc.componentType];
        const size = Arr.BYTES_PER_ELEMENT;
        const stride = view.stride ?? size * 3;
        const dv = new DataView(view.data.buffer, view.data.byteOffset, view.data.byteLength);
        for (let i = 0; i < acc.count; i++) {
          const base = (acc.byteOffset ?? 0) + i * stride;
          const v = [0, 1, 2].map((k) => {
            const off = base + k * size;
            let x;
            switch (acc.componentType) {
              case 5120: x = dv.getInt8(off); break;
              case 5121: x = dv.getUint8(off); break;
              case 5122: x = dv.getInt16(off, true); break;
              case 5123: x = dv.getUint16(off, true); break;
              default: x = dv.getFloat32(off, true);
            }
            return acc.normalized ? Math.max(x / maxv, -1) : x;
          });
          for (let k = 0; k < 3; k++) {
            const w = m[k] * v[0] + m[4 + k] * v[1] + m[8 + k] * v[2] + m[12 + k];
            if (w < mn[k]) mn[k] = w;
            if (w > mx[k]) mx[k] = w;
          }
        }
      }
    }
    for (const c of n.children ?? []) visit(c, m);
  };
  const ident = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  for (const r of json.scenes[json.scene ?? 0].nodes) visit(r, ident);
  return { mn, mx, names, extensions: json.extensionsUsed ?? [] };
}

// ---------------------------------------------------------------- main
fs.mkdirSync(outDir, { recursive: true });
const files = fs.readdirSync(srcDir).filter((f) => f.endsWith('.glb')).sort();
let before = 0;
let after = 0;
let failures = 0;
const sizes = {};
for (const f of files) {
  const src = path.join(srcDir, f);
  const out = path.join(outDir, f);
  const doc = await io.read(src);
  await doc.transform(
    reorder({ encoder: MeshoptEncoder, target: 'size' }),
    quantize({ quantizationVolume: 'scene', quantizePosition: 14, quantizeNormal: 10, quantizeTexcoord: 12 }),
  );
  doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
  await io.write(out, doc);

  const a = fs.statSync(src).size;
  const b = fs.statSync(out).size;
  before += a;
  after += b;
  sizes[f.replace('.glb', '')] = { src: a, out: b };

  const ref = positionBounds(fs.readFileSync(src), false);
  const got = positionBounds(fs.readFileSync(out), true);
  const err = Math.max(...[0, 1, 2].flatMap((k) => [Math.abs(ref.mn[k] - got.mn[k]), Math.abs(ref.mx[k] - got.mx[k])]));
  const lodNames = ref.names.filter((n) => /^LOD\d$/.test(n));
  const lost = lodNames.filter((n) => !got.names.includes(n));
  const ok = err < 0.01 && lost.length === 0 && got.extensions.includes('EXT_meshopt_compression');
  if (!ok) failures++;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${f.padEnd(24)} ${(a / 1024).toFixed(1).padStart(7)} KB -> ${(b / 1024).toFixed(1).padStart(6)} KB  bounds err ${(err * 1000).toFixed(2)} mm  nodes ${lodNames.join(',')}`);
}
console.log(`TOTAL ${(before / 1024).toFixed(0)} KB -> ${(after / 1024).toFixed(0)} KB (${files.length} files)`);
if (manifestPath && fs.existsSync(manifestPath)) {
  const man = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  for (const [name, s] of Object.entries(sizes)) if (man.props[name]) man.props[name].glbBytes = s.out;
  man.compression = 'EXT_meshopt_compression (QUANTIZE) + KHR_mesh_quantization, one quantization volume per file; use MeshoptDecoder from three/examples/jsm/libs/meshopt_decoder.module.js';
  fs.writeFileSync(manifestPath, JSON.stringify(man, null, 1));
}
if (failures) {
  console.error(`COMPRESS_FAIL ${failures} file(s)`);
  process.exit(1);
}
console.log('COMPRESS_OK decoded with three MeshoptDecoder, bounds match the sources');
