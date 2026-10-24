/**
 * The katana's trail: a ribbon between the blade's TrailStart and TrailEnd
 * points over the last frames of a cut, bright at the blade and fading
 * behind it (additive: the fade to black is the fade out). It carries the
 * read of a swing even when the blade itself hides behind the duck for a
 * frame (art/melee README). One small mesh per duck, rewritten every frame.
 */
import * as THREE from 'three/webgpu';

const SAMPLES = 14;
/** How long a sample stays (s). */
const LIFE = 0.16;

export class KatanaTrail {
  private readonly mesh: THREE.Mesh;
  private readonly pos: Float32Array;
  private readonly col: Float32Array;
  private readonly pts: { a: THREE.Vector3; b: THREE.Vector3; age: number }[] = [];
  private readonly geo: THREE.BufferGeometry;
  private readonly tmpA = new THREE.Vector3();
  private readonly tmpB = new THREE.Vector3();

  constructor(scene: THREE.Object3D) {
    this.geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(SAMPLES * 2 * 3);
    this.col = new Float32Array(SAMPLES * 2 * 3);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    const idx: number[] = [];
    for (let i = 0; i < SAMPLES - 1; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    this.geo.setIndex(idx);
    const mat = new THREE.MeshBasicNodeMaterial({ vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    this.mesh = new THREE.Mesh(this.geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.mesh.renderOrder = 20;
    scene.add(this.mesh);
  }

  /** One frame: add the blade's edge now (while cutting), age the rest, rebuild the ribbon. */
  sample(start: THREE.Object3D, end: THREE.Object3D, cutting: boolean, dt: number): void {
    for (const p of this.pts) p.age += dt;
    while (this.pts.length > 0 && this.pts[0]!.age > LIFE) this.pts.shift();
    if (cutting) {
      start.getWorldPosition(this.tmpA);
      end.getWorldPosition(this.tmpB);
      // A little longer than the blade: the swoosh reads past the tip.
      this.tmpB.sub(this.tmpA).multiplyScalar(1.15).add(this.tmpA);
      this.pts.push({ a: this.tmpA.clone(), b: this.tmpB.clone(), age: 0 });
      if (this.pts.length > SAMPLES) this.pts.shift();
    }
    const n = this.pts.length;
    this.mesh.visible = n >= 2;
    if (n < 2) return;
    for (let i = 0; i < SAMPLES; i++) {
      const p = this.pts[Math.min(n - 1, i)]!;
      const k = Math.max(0, 1 - p.age / LIFE) * (i / Math.max(1, n - 1));
      const o = i * 6;
      this.pos[o] = p.a.x;
      this.pos[o + 1] = p.a.y;
      this.pos[o + 2] = p.a.z;
      this.pos[o + 3] = p.b.x;
      this.pos[o + 4] = p.b.y;
      this.pos[o + 5] = p.b.z;
      // Warm white at the edge, brand yellow toward the base, all fading with age.
      this.col[o] = 1.0 * k * 0.6;
      this.col[o + 1] = 0.83 * k * 0.6;
      this.col[o + 2] = 0.24 * k * 0.6;
      this.col[o + 3] = 1.0 * k;
      this.col[o + 4] = 0.97 * k;
      this.col[o + 5] = 0.85 * k;
    }
    (this.geo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.geo.dispose();
  }
}
