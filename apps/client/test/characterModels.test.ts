/**
 * Every character's model shares the classic duck's skeleton exactly (joint
 * names, order and bind pose), so duck_anims.glb and the weapon attach pose fit
 * it, and the server hitboxes (one table for all ducks, matched to the classic
 * art) fit it too: its body stays inside the classic duck's box, and nothing
 * reaches higher than the classic's tuft. Reads the published GLBs.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CHARACTERS, HITBOX } from '@qwakk/shared';

interface Glb {
  doc: {
    nodes: { name?: string }[];
    skins: { joints: number[]; inverseBindMatrices: number }[];
    meshes: { primitives: { attributes: { POSITION: number }; indices: number; material?: number }[] }[];
    materials: { name?: string }[];
    accessors: { bufferView: number; byteOffset?: number; count: number; type: string; min?: number[]; max?: number[] }[];
    bufferViews: { byteOffset?: number }[];
  };
  bin: Buffer;
}

function readGlb(file: string): Glb {
  const data = readFileSync(new URL(`../public/models/${file}`, import.meta.url));
  const jsonLen = data.readUInt32LE(12);
  const doc = JSON.parse(data.subarray(20, 20 + jsonLen).toString('utf8')) as Glb['doc'];
  const off = 20 + jsonLen;
  const binLen = data.readUInt32LE(off);
  return { doc, bin: data.subarray(off + 8, off + 8 + binLen) };
}

function skeleton(file: string) {
  const { doc, bin } = readGlb(file);
  const skin = doc.skins[0]!;
  const names = skin.joints.map((i) => doc.nodes[i]!.name);
  const a = doc.accessors[skin.inverseBindMatrices]!;
  const start = (doc.bufferViews[a.bufferView]!.byteOffset ?? 0) + (a.byteOffset ?? 0);
  const ibm = Array.from({ length: a.count * 16 }, (_, i) => bin.readFloatLE(start + i * 4));
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (const m of doc.meshes) {
    for (const p of m.primitives) {
      const pos = doc.accessors[p.attributes.POSITION]!;
      for (let k = 0; k < 3; k++) {
        lo[k] = Math.min(lo[k]!, pos.min![k]!);
        hi[k] = Math.max(hi[k]!, pos.max![k]!);
      }
    }
  }
  return { names, ibm, lo, hi };
}

const others = CHARACTERS.filter((c) => c.key !== 'classic');

describe('character models', () => {
  const classic = skeleton('duck.glb');

  it.each(CHARACTERS.map((c) => [c.key]))('%s meets the 6k to 10k triangle budget', (key) => {
    const { doc } = readGlb(key === 'classic' ? 'duck.glb' : `duck_${key}.glb`);
    const triangles = doc.meshes.flatMap((m) => m.primitives).reduce((n, p) => n + doc.accessors[p.indices]!.count / 3, 0);
    expect(triangles).toBeGreaterThanOrEqual(6000);
    expect(triangles).toBeLessThanOrEqual(10000);
  });

  it('exports the cap separately so a helmet can hide it without hiding the duck', () => {
    const { doc } = readGlb('duck_mallard.glb');
    const cap = doc.materials.findIndex((m) => m.name === 'QwakkHeadwear');
    expect(cap).toBeGreaterThanOrEqual(0);
    const primitives = doc.meshes.flatMap((m) => m.primitives);
    expect(primitives.some((p) => p.material === cap)).toBe(true);
    expect(primitives.some((p) => p.material !== cap)).toBe(true);
  });

  it.each(others.map((c) => [c.key]))('%s shares the classic skeleton and bind pose', (key) => {
    const m = skeleton(`duck_${key}.glb`);
    expect(m.names).toEqual(classic.names);
    expect(m.ibm.length).toBe(classic.ibm.length);
    for (let i = 0; i < m.ibm.length; i++) expect(Math.abs(m.ibm[i]! - classic.ibm[i]!)).toBeLessThan(1e-5);
  });

  it.each(others.map((c) => [c.key]))('%s stays inside the classic silhouette the hitboxes are matched to', (key) => {
    const m = skeleton(`duck_${key}.glb`);
    // glTF axes, y up. Sideways and front-back: at most 3 cm past the classic duck.
    for (const k of [0, 2]) {
      expect(m.lo[k]!).toBeGreaterThanOrEqual(classic.lo[k]! - 0.03);
      expect(m.hi[k]!).toBeLessThanOrEqual(classic.hi[k]! + 0.03);
    }
    // Feet on the same ground, nothing above the classic tuft tip, and the head
    // top (where the hitbox ends) is covered the same way: the duck reaches it.
    expect(m.lo[1]!).toBeCloseTo(classic.lo[1]!, 3);
    expect(m.hi[1]!).toBeLessThanOrEqual(classic.hi[1]! + 1e-3);
    expect(m.hi[1]!).toBeGreaterThanOrEqual(HITBOX.stand.headY + HITBOX.stand.headR);
  });
});
