/**
 * Textured toon ground for the map_v1 terrain (TSL, so it runs on WebGPU and
 * the WebGL2 fallback alike).
 *
 * The map paints one ground type per 4 m height sample. A small float texture
 * holds, per sample, the texture layer and the tint that turns that layer
 * into the paint's toon color. Each pixel reads its four surrounding samples
 * (with the grid warped by noise so edges do not follow the 4 m grid), samples
 * their layers in world-space UVs, and blends them by bilinear weight pushed by
 * each layer's height map: grass blades and pebbles poke over their
 * neighbors, so edges are crisp and organic instead of a 4 m smear. Every
 * layer is sampled twice (a second, rotated or shifted UV) and the two are
 * mixed by a large-scale noise, so the 4 m tile does not repeat visibly. Far
 * away the texture fades into the flat vertex colors (no shimmer, and the
 * same average color).
 *
 * High: 4 paint reads, 8 layer samples, 2 noise samples per pixel.
 * Low (phones): the nearest sample's layer and tint only (1 paint read,
 * 1 layer sample, 1 noise sample for the edge warp), no anti-tiling, a
 * shorter fade and lower anisotropic filtering (`groundTextures.ts`).
 * The GPU runs every sample even where the fade is complete (sampling
 * inside a per-pixel branch is not allowed in uniform control flow).
 */
import * as THREE from 'three/webgpu';
import { attribute, cameraPosition, clamp, distance, dot, float, floor, fwidth, int, ivec2, log2, max, mix, positionWorld, smoothstep, texture, textureLoad, uniformArray, vec2, vec4 } from 'three/tsl';
import type { TerrainDef } from '@qwakk/shared';
import { envGradientMap } from './gltf.ts';
import { gridNormals, groundPaintData } from './groundPaint.ts';
import { setGroundQuality, type GroundTextures } from './groundTextures.ts';

/** Look numbers of the textured ground. */
export const GROUND_LOOK = {
  /** Blend edges wander up to this many 4 m cells off the grid. */
  warpCells: 0.6,
  /** How far a layer's height map pushes its edge over a neighbor (bilinear weight units). */
  heightBlend: 0.55,
  /** Soft width of a blend edge (bilinear weight units). */
  band: 0.12,
  /** Noise scales in 1 / meters: macro tone and anti-tiling selector, edge warp. */
  macroScale: 1 / 41,
  warpScale: 1 / 9.7,
  /** Brightness swing of the macro tone, +- this. */
  macroTone: 0.07,
  /** Second UV of the non-row layers: rotation (radians), scale and offset (tiles). */
  rotate: 0.62,
  scale: 0.79,
  offset: [0.37, 0.71] as const,
  /** Distance fade into the vertex colors (meters), per quality. */
  fade: { high: [70, 170], low: [45, 120] } as const,
  /**
   * Footprint fade: texels per pixel as a mip level (log2). Rows and stones turn
   * to moire once a few texels fall in one pixel (far, or grazing), so the
   * detail fades into the flat colors between these levels.
   */
  footprint: [3.6, 5.4] as const,
} as const;

export interface GroundMaterial {
  material: THREE.MeshToonNodeMaterial;
  dispose(): void;
}

function paintTexture(t: TerrainDef, ground: Uint8Array, legend: readonly string[], tex: GroundTextures): THREE.DataTexture {
  const w = t.cells + 1;
  const data = groundPaintData(t, ground, legend, tex.info, gridNormals(t));
  const paint = new THREE.DataTexture(data, w, w, THREE.RGBAFormat, THREE.FloatType);
  paint.magFilter = THREE.NearestFilter;
  paint.minFilter = THREE.NearestFilter;
  paint.generateMipmaps = false;
  paint.wrapS = THREE.ClampToEdgeWrapping;
  paint.wrapT = THREE.ClampToEdgeWrapping;
  paint.needsUpdate = true;
  return paint;
}

type Vec2Node = THREE.Node<'vec2'>;

/**
 * High: the four surrounding samples, each layer sampled twice (anti-tiling),
 * blended by bilinear weight plus height, times a macro tone.
 */
function blendHigh(paint: THREE.DataTexture, tex: GroundTextures, uv: Vec2Node, wp: Vec2Node, grid: Vec2Node) {
  const L = GROUND_LOOK;
  const c = Math.cos(L.rotate) * L.scale;
  const sn = Math.sin(L.rotate) * L.scale;
  // Second UV per layer: rows and cobbles shift half a tile across the rows; the rest rotate and scale.
  const xf = uniformArray<'vec4'>(
    tex.info.map((l) => (l.shift ? new THREE.Vector4(1, 0, 0, 1) : new THREE.Vector4(c, -sn, sn, c))),
    'vec4',
  );
  const off = uniformArray<'vec2'>(
    tex.info.map((l) => (l.shift ? new THREE.Vector2(0.5, 0.5) : new THREE.Vector2(L.offset[0], L.offset[1]))),
    'vec2',
  );
  const macro = texture(tex.noise, wp.mul(L.macroScale));
  const i0 = ivec2(floor(grid));
  const f = grid.sub(floor(grid));
  const corner = (dx: number, dz: number) => {
    const p = textureLoad(paint, i0.add(ivec2(dx, dz)));
    const layer = int(p.w.add(0.5));
    const m = xf.element(layer);
    const a = texture(tex.layers, uv).depth(layer);
    const b = texture(tex.layers, vec2(dot(uv, m.xy), dot(uv, m.zw)).add(off.element(layer))).depth(layer);
    const s = mix(a, b, smoothstep(float(-0.12), float(0.12), macro.g.sub(0.5).add(b.a.sub(a.a).mul(0.45))));
    const wx = dx === 0 ? float(1).sub(f.x) : f.x;
    const wz = dz === 0 ? float(1).sub(f.y) : f.y;
    return { rgb: s.rgb.mul(p.rgb), score: wx.mul(wz).add(s.a.mul(L.heightBlend)) };
  };
  const k = [corner(0, 0), corner(1, 0), corner(0, 1), corner(1, 1)] as const;
  const top = max(max(k[0].score, k[1].score), max(k[2].score, k[3].score));
  const e = k.map((q) => max(q.score.sub(top).add(L.band), float(0)));
  const sum = e.reduce((a, b) => a.add(b));
  const color = k.map((q, i) => q.rgb.mul(e[i] as ReturnType<typeof float>)).reduce((a, b) => a.add(b)).div(sum);
  return color.mul(macro.r.sub(0.5).mul(2 * L.macroTone).add(1));
}

/** Low: the nearest sample's layer and tint only (the warped grid keeps its edges organic). */
function nearestLow(paint: THREE.DataTexture, tex: GroundTextures, uv: Vec2Node, grid: Vec2Node) {
  const p = textureLoad(paint, ivec2(floor(grid.add(0.5))));
  const layer = int(p.w.add(0.5));
  return texture(tex.layers, uv).depth(layer).rgb.mul(p.rgb);
}

/** The textured ground for one map. The texture array is shared; the paint table and the material are this map's. */
export function createGroundMaterial(t: TerrainDef, ground: Uint8Array, legend: readonly string[], tex: GroundTextures, quality: 'high' | 'low'): GroundMaterial {
  const L = GROUND_LOOK;
  setGroundQuality(tex, quality);
  const paint = paintTexture(t, ground, legend, tex);
  const half = (t.cells * t.cellSize) / 2;
  const wp = positionWorld.xz;
  const uv = wp.div(tex.tileMeters);
  const warpN = texture(tex.noise, wp.mul(L.warpScale));
  const grid = clamp(wp.add(half).div(t.cellSize).add(warpN.gb.sub(0.5).mul(2 * L.warpCells)), float(0), float(t.cells - 0.001));
  const flat = attribute('color', 'vec3');
  const [fadeNear, fadeFar] = L.fade[quality];
  const texels = fwidth(uv).mul(tex.size);
  const footprint = smoothstep(float(L.footprint[0]), float(L.footprint[1]), log2(max(max(texels.x, texels.y), float(1e-4))));
  const fade = max(smoothstep(float(fadeNear), float(fadeFar), distance(positionWorld, cameraPosition)), footprint);
  const color = quality === 'high' ? blendHigh(paint, tex, uv, wp, grid) : nearestLow(paint, tex, uv, grid);
  const material = new THREE.MeshToonNodeMaterial({ gradientMap: envGradientMap() });
  material.colorNode = vec4(mix(color, flat, fade), 1);
  material.name = `ground-${quality}`;
  return {
    material,
    dispose() {
      material.dispose();
      paint.dispose();
    },
  };
}
