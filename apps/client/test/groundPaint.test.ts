import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GROUND_COLORS, gridNormals, groundPaintData, hexToLinear, PAINT_LAYER, STEEP_ROCK } from '../src/world/sainte/groundPaint.ts';

const info = JSON.parse(readFileSync(new URL('../public/textures/ground/ground.json', import.meta.url), 'utf8')) as {
  tileMeters: number;
  size: number;
  layers: { name: string; mean: number[]; shift: boolean }[];
};
const legend = Object.keys(GROUND_COLORS);

function flatTerrain(cells: number, height = 2): { cells: number; cellSize: number; heights: Float32Array } {
  return { cells, cellSize: 4, heights: new Float32Array((cells + 1) * (cells + 1)).fill(height) };
}

describe('ground paint table for the textured terrain', () => {
  it('ground.json lists a texture layer for every paint', () => {
    const names = info.layers.map((l) => l.name);
    for (const paint of legend) expect(names).toContain(PAINT_LAYER[paint]);
    for (const l of info.layers) for (const m of l.mean) expect(m).toBeGreaterThan(0);
  });

  it('tint times the layer mean gives the paint color, so the far fade keeps the same color', () => {
    const t = flatTerrain(2);
    const ground = new Uint8Array(9).map((_, i) => i % legend.length);
    const data = groundPaintData(t, ground, legend, info.layers, gridNormals(t));
    for (let i = 0; i < 9; i++) {
      const paint = legend[i % legend.length] as string;
      const layer = data[i * 4 + 3] as number;
      expect(info.layers[layer]?.name).toBe(PAINT_LAYER[paint]);
      const want = hexToLinear(GROUND_COLORS[paint] as number);
      for (let k = 0; k < 3; k++) expect((data[i * 4 + k] as number) * (info.layers[layer]?.mean[k] as number)).toBeCloseTo(want[k] as number, 5);
    }
  });

  it('steep faces use the rock layer, tinted like the vertex colors', () => {
    const t = flatTerrain(2);
    // A 10 m step between columns makes the middle column steep.
    for (let r = 0; r < 3; r++) t.heights[r * 3 + 2] = 12;
    const ground = new Uint8Array(9).fill(legend.indexOf('grass'));
    const nrm = gridNormals(t);
    const data = groundPaintData(t, ground, legend, info.layers, nrm);
    const rock = info.layers.findIndex((l) => l.name === 'rock');
    const i = 4; // row 1, col 1
    expect(data[i * 4 + 3]).toBe(rock);
    const g = hexToLinear(GROUND_COLORS.grass as number);
    const rk = hexToLinear(GROUND_COLORS.rock as number);
    const want = g[0] + (rk[0] - g[0]) * STEEP_ROCK;
    expect((data[i * 4] as number) * (info.layers[rock]?.mean[0] as number)).toBeCloseTo(want, 5);
    // Flat corner keeps its grass layer.
    expect(info.layers[data[3] as number]?.name).toBe('grass');
  });
});
