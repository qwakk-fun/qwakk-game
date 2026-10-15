/**
 * WebGPU renderer with the automatic WebGL2 fallback from three/webgpu.
 */
import * as THREE from 'three/webgpu';
import { WORLD_COLORS } from './palette.ts';

export interface RenderContext {
  renderer: THREE.WebGPURenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  backend: 'WebGPU' | 'WebGL2';
}

/** A new empty scene with the default sky and fog (each game gets its own). */
export function freshScene(): THREE.Scene {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(WORLD_COLORS.sky);
  scene.fog = new THREE.Fog(WORLD_COLORS.fog, 120, 520);
  return scene;
}

export async function createRenderer(canvas: HTMLCanvasElement, opts: { forceWebGL: boolean; pixelRatio: number; shadows: boolean }): Promise<RenderContext> {
  const renderer = new THREE.WebGPURenderer({ canvas, antialias: true, forceWebGL: opts.forceWebGL, powerPreference: 'high-performance' });
  await renderer.init();
  renderer.setPixelRatio(opts.pixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.shadowMap.enabled = opts.shadows;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.NoToneMapping;

  const scene = freshScene();

  const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.08, 1400);

  const onResize = (): void => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight, false);
  };
  window.addEventListener('resize', onResize);

  const backendInfo = renderer.backend as unknown as { isWebGPUBackend?: boolean };
  return { renderer, scene, camera, backend: backendInfo.isWebGPUBackend ? 'WebGPU' : 'WebGL2' };
}
