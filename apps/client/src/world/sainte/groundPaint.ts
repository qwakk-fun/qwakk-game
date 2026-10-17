/**
 * Ground paint data for the terrain (pure, no three): the toon color per paint
 * name, the grid normals, the steep-face rule, and the per-sample table the
 * textured ground shader reads (which texture layer, and the tint that turns
 * that layer into the paint's color).
 */
import type { TerrainDef } from '@qwakk/shared';

/** Toon colors per ground paint name (legend in map_v1.json terrain.groundLegend). */
export const GROUND_COLORS: Record<string, number> = {
  grass: 0x8cc152,
  grass_dark: 0x6fa443,
  sand: 0xf1dfa6,
  rock: 0xa29d92,
  dirt_road: 0xcfa86e,
  cobble: 0xb9ae9c,
  wheat: 0xe9c75c,
  green_crop: 0xa3cf58,
  plowed: 0x9c744d,
  forest_floor: 0x5e8a3c,
  river_mud: 0x8d7c58,
  seabed: 0xdcc58e,
  orchard_grass: 0x9ccb5c,
};

/** Texture layer (art/ground/blender/layers.py) per paint; tints make the variants. */
export const PAINT_LAYER: Record<string, string> = {
  grass: 'grass',
  grass_dark: 'grass',
  orchard_grass: 'grass',
  forest_floor: 'forest',
  dirt_road: 'dirt',
  river_mud: 'dirt',
  sand: 'sand',
  seabed: 'sand',
  rock: 'rock',
  cobble: 'cobble',
  plowed: 'plowed',
  wheat: 'wheat',
  green_crop: 'crop',
};

/** Steep faces read as rock, whatever the paint says: this much of the rock color. */
export const STEEP_ROCK = 0.65;

export function isSteep(normalY: number, height: number): boolean {
  return normalY < 0.72 && height > 0.5;
}

export function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** 0xrrggbb (sRGB) to linear RGB, the space three works in. */
export function hexToLinear(hex: number): [number, number, number] {
  return [srgbToLinear(((hex >> 16) & 255) / 255), srgbToLinear(((hex >> 8) & 255) / 255), srgbToLinear((hex & 255) / 255)];
}

/** Smooth normals of the height grid (central differences), xyz per sample. */
export function gridNormals(t: TerrainDef): Float32Array {
  const n = t.cells;
  const w = n + 1;
  const h = (rr: number, cc: number) => t.heights[Math.min(n, Math.max(0, rr)) * w + Math.min(n, Math.max(0, cc))] ?? 0;
  const nrm = new Float32Array(w * w * 3);
  for (let r = 0; r < w; r++) {
    for (let c = 0; c < w; c++) {
      const nx = h(r, c - 1) - h(r, c + 1);
      const nz = h(r - 1, c) - h(r + 1, c);
      const ny = 2 * t.cellSize;
      const len = Math.hypot(nx, ny, nz);
      const i = (r * w + c) * 3;
      nrm[i] = nx / len;
      nrm[i + 1] = ny / len;
      nrm[i + 2] = nz / len;
    }
  }
  return nrm;
}

/**
 * Per height sample, RGBA floats: RGB = tint (the paint's linear color divided
 * by the layer's mean color, so the textured ground averages to the same color
 * as the flat one), A = texture layer index. Same row-major layout as the heights.
 */
export function groundPaintData(t: TerrainDef, ground: Uint8Array, legend: readonly string[], layers: readonly { name: string; mean: readonly number[] }[], normals: Float32Array): Float32Array {
  const w = t.cells + 1;
  const layerIndex = (paint: string): number => {
    const i = layers.findIndex((l) => l.name === (PAINT_LAYER[paint] ?? 'grass'));
    return i >= 0 ? i : 0;
  };
  const rockLayer = layerIndex('rock');
  const rock = hexToLinear(GROUND_COLORS.rock as number);
  const byPaint = legend.map((name) => ({ layer: layerIndex(name), color: hexToLinear(GROUND_COLORS[name] ?? (GROUND_COLORS.grass as number)) }));
  const fallback = byPaint[0] ?? { layer: layerIndex('grass'), color: hexToLinear(GROUND_COLORS.grass as number) };
  const out = new Float32Array(w * w * 4);
  for (let i = 0; i < w * w; i++) {
    const p = byPaint[ground[i] ?? 0] ?? fallback;
    let layer = p.layer;
    let [r, g, b] = p.color;
    if (isSteep(normals[i * 3 + 1] ?? 1, t.heights[i] ?? 0)) {
      layer = rockLayer;
      r += (rock[0] - r) * STEEP_ROCK;
      g += (rock[1] - g) * STEEP_ROCK;
      b += (rock[2] - b) * STEEP_ROCK;
    }
    const mean = layers[layer]?.mean ?? [1, 1, 1];
    out[i * 4] = r / Math.max(1e-4, mean[0] ?? 1);
    out[i * 4 + 1] = g / Math.max(1e-4, mean[1] ?? 1);
    out[i * 4 + 2] = b / Math.max(1e-4, mean[2] ?? 1);
    out[i * 4 + 3] = layer;
  }
  return out;
}
