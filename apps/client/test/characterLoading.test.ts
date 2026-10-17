import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { loadDuckGlb } from '../src/player/duckModel.ts';
import { Avatar } from '../src/player/avatar.ts';

afterEach(() => vi.restoreAllMocks());
describe('character recovery and helmets', () => {
  it('retries a failed model request instead of caching the missing model', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('', { status: 404 })).mockResolvedValueOnce(new Response('', { status: 200, headers: { 'content-type': 'model/gltf-binary' } }));
    vi.spyOn(GLTFLoader.prototype, 'loadAsync').mockResolvedValue({ scene: new THREE.Group() } as never);
    expect(await loadDuckGlb(1)).toBeNull();
    expect(await loadDuckGlb(1)).not.toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(2);
    await loadDuckGlb(1);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('hides cap and outline for every helmet and restores them without overriding distance detail', () => {
    const source = new THREE.Group();
    for (const name of ['cap', 'cap-outline']) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
      mesh.name = name;
      mesh.userData.headwear = true;
      source.add(mesh);
    }
    const avatar = new Avatar();
    avatar.setModel(source);
    const pose = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, crouch: 0, grounded: true, alive: true, weapon: 2, act: 0 };
    const cap = avatar.object.getObjectByName('cap')!;
    const hull = avatar.object.getObjectByName('cap-outline')!;
    for (const helmet of [1, 2]) {
      avatar.update({ ...pose, helmet }, 1 / 60);
      expect(cap.visible).toBe(false);
      expect(hull.visible).toBe(false);
      avatar.setDetail(100);
      avatar.setDetail(0);
      expect(hull.visible).toBe(false);
    }
    avatar.update({ ...pose, helmet: 0 }, 1 / 60);
    expect(cap.visible).toBe(true);
    expect(hull.visible).toBe(true);
    avatar.setDetail(100);
    expect(cap.visible).toBe(true);
    expect(hull.visible).toBe(false);
    avatar.dispose();
  });
});
