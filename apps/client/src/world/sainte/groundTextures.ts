/**
 * The stylized ground textures baked by the art workstream
 * (`art/ground/build.sh` writes public/textures/ground/): one texture array
 * with a layer per ground type (albedo in RGB, height in A for the blend) and
 * a small tiling noise. Loaded once per page and shared by every game; never
 * disposed.
 */
import * as THREE from 'three/webgpu';

export const GROUND_BASE = `${import.meta.env.BASE_URL}textures/ground/`;

export interface GroundLayerInfo {
  name: string;
  /** Mean linear albedo of the layer: the game re-tints each layer to its paint color. */
  mean: [number, number, number];
  /** Anti-tiling by a half-tile shift only (rows and cobbles); otherwise rotate and scale. */
  shift: boolean;
}

export interface GroundTextures {
  /** RGB albedo (sRGB) and A height, one layer per ground type, mipmapped. */
  layers: THREE.DataArrayTexture;
  /** Tiling noise (linear): R macro tone, G and B blend warp and anti-tiling selector. */
  noise: THREE.DataTexture;
  info: GroundLayerInfo[];
  tileMeters: number;
  /** Pixels per tile side. */
  size: number;
}

interface GroundJson {
  version: number;
  tileMeters: number;
  size: number;
  albedo: string;
  height: string;
  noise: string;
  layers: GroundLayerInfo[];
}

async function pixels(url: string): Promise<{ data: Uint8ClampedArray; width: number; height: number }> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`could not load ${url} (${r.status})`);
  // No color conversion: the bytes are the authored values.
  const bmp = await createImageBitmap(await r.blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  try {
    const { width, height } = bmp;
    const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(width, height) : Object.assign(document.createElement('canvas'), { width, height });
    const ctx = canvas.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
    if (!ctx) throw new Error('no 2d canvas to decode the ground textures');
    ctx.drawImage(bmp, 0, 0);
    return { data: ctx.getImageData(0, 0, width, height).data, width, height };
  } finally {
    bmp.close();
  }
}

function isInfo(v: unknown): v is GroundJson {
  const j = v as GroundJson;
  return !!j && j.version === 1 && Number.isFinite(j.tileMeters) && Number.isInteger(j.size) && Array.isArray(j.layers) && j.layers.length > 0;
}

async function load(): Promise<GroundTextures> {
  const r = await fetch(`${GROUND_BASE}ground.json`);
  if (!r.ok) throw new Error(`could not load ground.json (${r.status})`);
  const json: unknown = await r.json();
  if (!isInfo(json)) throw new Error('ground.json: unexpected format');
  const [albedo, height, noise] = await Promise.all([pixels(GROUND_BASE + json.albedo), pixels(GROUND_BASE + json.height), pixels(GROUND_BASE + json.noise)]);
  const size = json.size;
  const count = json.layers.length;
  if (albedo.width !== size || albedo.height !== size * count || height.width !== size || height.height !== size * count) {
    throw new Error('ground textures: atlas size does not match ground.json');
  }
  // The atlas stacks the layers top to bottom, which is already the array texture's memory layout.
  const data = new Uint8Array(albedo.data.length);
  data.set(albedo.data);
  for (let i = 3; i < data.length; i += 4) data[i] = height.data[i - 3] ?? 0;
  const layers = new THREE.DataArrayTexture(data, size, size, count);
  layers.format = THREE.RGBAFormat;
  layers.type = THREE.UnsignedByteType;
  layers.colorSpace = THREE.SRGBColorSpace;
  layers.wrapS = THREE.RepeatWrapping;
  layers.wrapT = THREE.RepeatWrapping;
  layers.magFilter = THREE.LinearFilter;
  layers.minFilter = THREE.LinearMipmapLinearFilter;
  layers.generateMipmaps = true;
  layers.anisotropy = GROUND_ANISOTROPY.high;
  layers.needsUpdate = true;

  const noiseTex = new THREE.DataTexture(new Uint8Array(noise.data), noise.width, noise.height, THREE.RGBAFormat);
  noiseTex.wrapS = THREE.RepeatWrapping;
  noiseTex.wrapT = THREE.RepeatWrapping;
  noiseTex.magFilter = THREE.LinearFilter;
  noiseTex.minFilter = THREE.LinearMipmapLinearFilter;
  noiseTex.generateMipmaps = true;
  noiseTex.needsUpdate = true;
  return { layers, noise: noiseTex, info: json.layers, tileMeters: json.tileMeters, size };
}

/** Anisotropic filtering per preset: phones pay for every extra tap. */
export const GROUND_ANISOTROPY = { high: 8, low: 2 } as const;

/**
 * Sets the shared texture array's filtering for the preset of the game being
 * built. A change re-uploads the array, which only happens when the preset
 * changed since the last game (never mid-match).
 */
export function setGroundQuality(tex: GroundTextures, quality: 'high' | 'low'): void {
  const a = GROUND_ANISOTROPY[quality];
  if (tex.layers.anisotropy === a) return;
  tex.layers.anisotropy = a;
  tex.layers.needsUpdate = true;
}

/** How long a game waits for the ground textures before it starts with the flat colors. */
export const GROUND_LOAD_TIMEOUT_MS = 8000;

let cached: Promise<GroundTextures> | null = null;

/** Loads once per page. A failed load is not cached, so the next game tries again. */
export function loadGroundTextures(): Promise<GroundTextures> {
  if (!cached) {
    cached = load();
    cached.catch(() => {
      cached = null;
    });
  }
  return cached;
}
