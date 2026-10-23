import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { HeroCape } from '../src/fx/heroCape.ts';

/** The hem's middle vertex in the avatar's space (the duck faces -z, its back is +z). */
function hem(cape: HeroCape): THREE.Vector3 {
  const mesh = cape.object.children[0] as THREE.Mesh;
  const pos = mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
  const v = new THREE.Vector3().fromBufferAttribute(pos, pos.count - 4);
  cape.object.updateMatrix();
  return v.applyMatrix4(cape.object.matrix);
}

describe('hero cape', () => {
  it('hangs down the back at rest and streams back, nearly flat, while flying', () => {
    const root = new THREE.Group();
    const cape = new HeroCape();
    cape.attach(root);
    for (let i = 0; i < 120; i++) cape.update(1 / 60, 0, false, 0);
    const rest = hem(cape);
    expect(rest.y).toBeLessThan(0.4);
    expect(rest.z).toBeGreaterThan(0.25);
    for (let i = 0; i < 120; i++) cape.update(1 / 60, 6, true, 0);
    const fly = hem(cape);
    expect(fly.z - rest.z).toBeGreaterThan(0.35);
    expect(fly.y - rest.y).toBeGreaterThan(0.3);
    cape.dispose();
  });

  it('shows its orange outside to someone behind the duck', () => {
    const cape = new HeroCape();
    cape.attach(new THREE.Group());
    const mesh = cape.object.children[0] as THREE.Mesh;
    const n = mesh.geometry.getAttribute('normal') as THREE.BufferAttribute;
    const normal = new THREE.Vector3().fromBufferAttribute(n, 3).applyQuaternion(cape.object.quaternion);
    // Outside faces point backward (+z in the avatar), toward a camera behind the duck.
    expect(normal.z).toBeGreaterThan(0.5);
    cape.dispose();
  });
});
