/**
 * The drop plane flyover: transport_plane.glb in the environment toon look,
 * with PropLeft and PropRight spinning around their local Z (the flight axis).
 * `yaw` is the three.js rotation.y that turns the GLB front (+Z) along the
 * flight direction: yaw = Math.atan2(dirX, dirZ).
 */
import * as THREE from 'three/webgpu';
import { envMaterial, loadPropGlb, paletteOf } from './gltf.ts';

export class PlaneView {
  readonly object = new THREE.Group();
  private props: THREE.Object3D[] = [];
  private spin = 0;

  constructor(scene: THREE.Scene) {
    this.object.name = 'drop-plane';
    this.object.visible = false;
    scene.add(this.object);
    void loadPropGlb('transport_plane').then((gltf) => {
      const model = gltf.scene.clone(true);
      const mat = envMaterial({ key: 'plane', map: paletteOf(gltf), side: THREE.DoubleSide });
      model.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.material = mat;
        mesh.castShadow = false;
        mesh.frustumCulled = false;
      });
      this.props = ['PropLeft', 'PropRight'].map((n) => model.getObjectByName(n)).filter((o): o is THREE.Object3D => !!o);
      this.object.add(model);
    });
  }

  get visible(): boolean {
    return this.object.visible;
  }

  set visible(v: boolean) {
    this.object.visible = v;
  }

  update(x: number, y: number, z: number, yaw: number, dt: number): void {
    this.object.position.set(x, y, z);
    this.object.rotation.set(0, yaw, 0);
    // A lazy bank wobble so the flyover does not look like a slide.
    this.object.rotation.z = Math.sin(performance.now() / 1700) * 0.035;
    this.spin += dt * 38;
    for (const [i, p] of this.props.entries()) p.rotation.z = i === 0 ? this.spin : -this.spin;
  }

  dispose(): void {
    this.object.removeFromParent();
  }
}
