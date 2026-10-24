/**
 * The plaza fountain's synthesized water (hub/fountainSound.ts): heard only
 * near the fountain (a smooth fade to silence), the stream buffer loops
 * without a click and is not a flat noise, a droplet rings out and fades.
 */
import { describe, expect, it } from 'vitest';
import { FOUNTAIN, fountainFade, renderDrop, renderStream } from '../src/hub/fountainSound.ts';

function rand(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rms = (a: Float32Array, from = 0, to = a.length): number => {
  let s = 0;
  for (let i = from; i < to; i++) s += a[i]! * a[i]!;
  return Math.sqrt(s / Math.max(1, to - from));
};

describe('fountain sound', () => {
  it('fades smoothly from full near the fountain to silence at FOUNTAIN.far', () => {
    expect(fountainFade(0)).toBe(1);
    expect(fountainFade(FOUNTAIN.near)).toBe(1);
    expect(fountainFade(FOUNTAIN.far)).toBe(0);
    expect(fountainFade(80)).toBe(0);
    let last = 1;
    for (let d = FOUNTAIN.near; d <= FOUNTAIN.far; d += 0.25) {
      const v = fountainFade(d);
      expect(v).toBeLessThanOrEqual(last);
      expect(last - v).toBeLessThan(0.05);
      last = v;
    }
  });

  it('the stream loops seamlessly and swells and dips (bubbles, not a flat hiss)', () => {
    const rate = 24000;
    const s = renderStream(rate, rand(3), 3, FOUNTAIN.streamDensity);
    expect(s.every(Number.isFinite)).toBe(true);
    const level = rms(s);
    expect(level).toBeGreaterThan(0.1);
    expect(level).toBeLessThan(0.5);
    // The seam: the step from the last sample to the first is like any other step.
    let step = 0;
    for (let i = 1; i < s.length; i++) step += Math.abs(s[i]! - s[i - 1]!);
    expect(Math.abs(s[0]! - s[s.length - 1]!)).toBeLessThan((step / (s.length - 1)) * 8);
    // 20 ms windows differ clearly in level.
    const w = rate / 50;
    const levels: number[] = [];
    for (let i = 0; i + w <= s.length; i += w) levels.push(20 * Math.log10(rms(s, i, i + w)));
    const mean = levels.reduce((a, b) => a + b, 0) / levels.length;
    const sd = Math.sqrt(levels.reduce((a, b) => a + (b - mean) ** 2, 0) / levels.length);
    expect(sd).toBeGreaterThan(1);
  });

  it('a droplet rings and dies away', () => {
    const d = renderDrop(24000, rand(5));
    const q = Math.floor(d.length / 4);
    expect(rms(d, 0, q)).toBeGreaterThan(rms(d, 3 * q) * 10);
    expect(Math.max(...d.map(Math.abs))).toBeLessThan(1);
  });
});
