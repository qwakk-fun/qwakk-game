/**
 * Small CPU particle system on one InstancedMesh: feathers, dust puffs and
 * cartoon blood drops. A fixed pool, no allocation per particle.
 */
import * as THREE from 'three/webgpu';

export interface ParticleSpec {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  size: number;
  /** Size at end of life, as a factor of `size`. */
  grow: number;
  gravity: number;
  /** Velocity damping per second (feathers flutter, puffs stop fast). */
  drag: number;
  color: THREE.Color;
  /** Spin speed (rad/s); billboards ignore it. */
  spin: number;
}

interface Particle extends ParticleSpec {
  age: number;
  rx: number;
  ry: number;
  rz: number;
  alive: boolean;
}

export class ParticleSystem {
  readonly mesh: THREE.InstancedMesh;
  private readonly parts: Particle[] = [];
  private next = 0;
  private readonly billboard: boolean;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler();
  private readonly p = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private readonly hidden = new THREE.Matrix4().makeScale(0, 0, 0);

  constructor(geometry: THREE.BufferGeometry, material: THREE.Material, capacity: number, billboard: boolean) {
    this.mesh = new THREE.InstancedMesh(geometry, material, capacity);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.billboard = billboard;
    for (let i = 0; i < capacity; i++) {
      this.mesh.setMatrixAt(i, this.hidden);
      this.mesh.setColorAt(i, new THREE.Color(1, 1, 1));
      this.parts.push({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 1, size: 1, grow: 1, gravity: 0, drag: 0, color: new THREE.Color(), spin: 0, age: 0, rx: 0, ry: 0, rz: 0, alive: false });
    }
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  }

  spawn(spec: ParticleSpec): void {
    const idx = this.next;
    const p = this.parts[idx] as Particle;
    this.next = (this.next + 1) % this.parts.length;
    Object.assign(p, spec);
    p.color = p.color.clone();
    p.age = 0;
    p.rx = Math.random() * 6.28;
    p.ry = Math.random() * 6.28;
    p.rz = Math.random() * 6.28;
    p.alive = true;
    this.mesh.setColorAt(idx, p.color);
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  update(dt: number, camera: THREE.Camera): void {
    let any = false;
    for (let i = 0; i < this.parts.length; i++) {
      const p = this.parts[i] as Particle;
      if (!p.alive) continue;
      any = true;
      p.age += dt;
      if (p.age >= p.life) {
        p.alive = false;
        this.mesh.setMatrixAt(i, this.hidden);
        continue;
      }
      const damp = Math.exp(-p.drag * dt);
      p.vx *= damp;
      p.vy = p.vy * damp - p.gravity * dt;
      p.vz *= damp;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      p.rx += p.spin * dt;
      p.rz += p.spin * 0.7 * dt;
      const t = p.age / p.life;
      const size = p.size * (1 + (p.grow - 1) * t) * (t > 0.8 ? (1 - t) / 0.2 : 1);
      this.p.set(p.x, p.y, p.z);
      this.s.setScalar(size);
      if (this.billboard) this.q.copy(camera.quaternion);
      else this.q.setFromEuler(this.e.set(p.rx, p.ry, p.rz));
      this.mesh.setMatrixAt(i, this.m.compose(this.p, this.q, this.s));
    }
    if (any) this.mesh.instanceMatrix.needsUpdate = true;
  }
}
