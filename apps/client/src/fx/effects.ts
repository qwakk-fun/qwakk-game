/**
 * Combat effects: muzzle flashes, tracers, impact puffs, duck feather bursts
 * and a toony red splat on kills (cartoon, not gore). All pooled.
 */
import * as THREE from 'three/webgpu';
import { BRAND } from '../render/palette.ts';
import { ParticleSystem } from './particles.ts';

interface Tracer {
  mesh: THREE.Mesh;
  age: number;
  life: number;
  width: number;
}

interface Flash {
  mesh: THREE.Group;
  age: number;
}

interface Decal {
  mesh: THREE.Mesh;
  material: THREE.MeshBasicNodeMaterial;
  age: number;
}

const TRACER_LIFE = 0.09;
const FLASH_LIFE = 0.05;
const DECAL_LIFE = 12;

function splatTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d') as CanvasRenderingContext2D;
  const blob = (x: number, y: number, r: number, color: string) => {
    g.fillStyle = color;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  };
  // Dark rim first, then the bright splat: a toon outline like the ducks.
  const drops: [number, number, number][] = [[64, 64, 34]];
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2 + Math.random() * 0.4;
    const d = 30 + Math.random() * 22;
    drops.push([64 + Math.cos(a) * d, 64 + Math.sin(a) * d, 6 + Math.random() * 9]);
  }
  for (const [x, y, r] of drops) blob(x, y, r + 3, '#151619');
  for (const [x, y, r] of drops) blob(x, y, r, '#e5383b');
  for (const [x, y, r] of drops.slice(0, 3)) blob(x - r * 0.3, y - r * 0.3, r * 0.35, '#ff8f8f');
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class Effects {
  private readonly scene: THREE.Scene;
  private readonly feathers: ParticleSystem;
  private readonly blobs: ParticleSystem;
  private readonly tracers: Tracer[] = [];
  private readonly flashes: Flash[] = [];
  private readonly decals: Decal[] = [];
  /** Keep current combat effects out of the recorded death replay. */
  hideForReplay(): () => void {
    const objects = [this.feathers.mesh, this.blobs.mesh, ...this.tracers.map((t) => t.mesh), ...this.flashes.map((f) => f.mesh), ...this.decals.map((d) => d.mesh)];
    const visible = objects.map((o) => o.visible);
    objects.forEach((o) => { o.visible = false; });
    return () => objects.forEach((o, i) => { o.visible = visible[i]!; });
  }

  private nextTracer = 0;
  private nextFlash = 0;
  private nextDecal = 0;
  private readonly yellow = new THREE.Color(BRAND.yellow);
  private readonly white = new THREE.Color(0xfff8e1);
  private readonly orange = new THREE.Color(BRAND.beak);
  private readonly red = new THREE.Color(0xe5383b);
  private readonly dust = new THREE.Color(0xc9c2ae);
  private readonly tmpA = new THREE.Vector3();
  private readonly tmpB = new THREE.Vector3();
  private readonly groundAt: (x: number, y: number, z: number) => number;

  constructor(scene: THREE.Scene, groundAt: (x: number, y: number, z: number) => number) {
    this.scene = scene;
    this.groundAt = groundAt;
    // Feather: a slim leaf shape.
    const feather = new THREE.PlaneGeometry(0.055, 0.14);
    const featherMat = new THREE.MeshBasicNodeMaterial({ color: 0xffffff, side: THREE.DoubleSide });
    this.feathers = new ParticleSystem(feather, featherMat, 900, false);
    scene.add(this.feathers.mesh);
    const blobMat = new THREE.MeshBasicNodeMaterial({ color: 0xffffff });
    this.blobs = new ParticleSystem(new THREE.CircleGeometry(0.5, 10), blobMat, 500, true);
    scene.add(this.blobs.mesh);

    const tracerGeo = new THREE.BoxGeometry(1, 1, 1);
    tracerGeo.translate(0, 0, -0.5); // grows from the muzzle along -z
    const tracerMat = new THREE.MeshBasicNodeMaterial({ color: 0xfff3b0 });
    for (let i = 0; i < 48; i++) {
      const mesh = new THREE.Mesh(tracerGeo, tracerMat);
      mesh.visible = false;
      mesh.frustumCulled = false;
      scene.add(mesh);
      this.tracers.push({ mesh, age: 1, life: TRACER_LIFE, width: 0.03 });
    }

    const flashMat = new THREE.MeshBasicNodeMaterial({ color: 0xfff0a0, side: THREE.DoubleSide });
    const flashCore = new THREE.MeshBasicNodeMaterial({ color: 0xffffff, side: THREE.DoubleSide });
    const petal = new THREE.PlaneGeometry(0.16, 0.42);
    petal.translate(0, 0, 0);
    for (let i = 0; i < 12; i++) {
      const g = new THREE.Group();
      for (let k = 0; k < 3; k++) {
        const m = new THREE.Mesh(petal, flashMat);
        m.rotation.set(Math.PI / 2, (k * Math.PI) / 3, 0);
        m.position.z = -0.12;
        g.add(m);
      }
      const core = new THREE.Mesh(new THREE.CircleGeometry(0.09, 8), flashCore);
      g.add(core);
      g.visible = false;
      scene.add(g);
      this.flashes.push({ mesh: g, age: 1 });
    }

    const splatGeo = new THREE.PlaneGeometry(1, 1);
    splatGeo.rotateX(-Math.PI / 2);
    const tex = splatTexture();
    for (let i = 0; i < 14; i++) {
      const material = new THREE.MeshBasicNodeMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
      const mesh = new THREE.Mesh(splatGeo, material);
      mesh.visible = false;
      mesh.renderOrder = 1;
      scene.add(mesh);
      this.decals.push({ mesh, material, age: DECAL_LIFE });
    }
  }

  /** Muzzle flash at `from`, pointing along `dir`. */
  muzzleFlash(from: THREE.Vector3, dir: THREE.Vector3, scale = 1): void {
    const f = this.flashes[this.nextFlash] as Flash;
    this.nextFlash = (this.nextFlash + 1) % this.flashes.length;
    f.age = 0;
    f.mesh.visible = true;
    f.mesh.position.copy(from);
    this.tmpA.copy(from).add(dir);
    f.mesh.lookAt(this.tmpA);
    f.mesh.rotateZ(Math.random() * Math.PI);
    f.mesh.scale.setScalar(scale * (0.8 + Math.random() * 0.4));
  }

  tracer(from: THREE.Vector3, to: THREE.Vector3, width = 0.03): void {
    const len = from.distanceTo(to);
    if (len < 0.3) return;
    const t = this.tracers[this.nextTracer] as Tracer;
    this.nextTracer = (this.nextTracer + 1) % this.tracers.length;
    t.age = 0;
    t.width = width;
    t.mesh.visible = true;
    t.mesh.position.copy(from);
    t.mesh.lookAt(to);
    // lookAt points +z at the target for non-cameras; our geometry grows along -z, so flip.
    t.mesh.rotateY(Math.PI);
    t.mesh.scale.set(width, width, len);
  }

  /** Dust and chips where a bullet hits the world. */
  impact(at: THREE.Vector3, normalish: THREE.Vector3): void {
    for (let i = 0; i < 6; i++) {
      this.blobs.spawn({
        x: at.x,
        y: at.y,
        z: at.z,
        vx: normalish.x * 1.5 + (Math.random() - 0.5) * 1.6,
        vy: normalish.y * 1.5 + Math.random() * 1.4,
        vz: normalish.z * 1.5 + (Math.random() - 0.5) * 1.6,
        life: 0.35 + Math.random() * 0.25,
        size: 0.08 + Math.random() * 0.08,
        grow: 2.4,
        gravity: 1.5,
        drag: 5,
        color: this.dust,
        spin: 0,
      });
    }
  }

  /** Yellow feathers flying off a duck that was hit. */
  feathersBurst(at: THREE.Vector3, dir: THREE.Vector3, count: number, power = 1): void {
    for (let i = 0; i < count; i++) {
      const c = Math.random() < 0.25 ? this.white : Math.random() < 0.08 ? this.orange : this.yellow;
      this.feathers.spawn({
        x: at.x + (Math.random() - 0.5) * 0.2,
        y: at.y + (Math.random() - 0.5) * 0.2,
        z: at.z + (Math.random() - 0.5) * 0.2,
        vx: (dir.x * 2 + (Math.random() - 0.5) * 4) * power,
        vy: (1.2 + Math.random() * 2.6) * power,
        vz: (dir.z * 2 + (Math.random() - 0.5) * 4) * power,
        life: 1.2 + Math.random() * 1.2,
        size: 0.8 + Math.random() * 0.6,
        grow: 1,
        gravity: 2.2,
        drag: 2.6,
        color: c,
        spin: (Math.random() - 0.5) * 14,
      });
    }
  }

  /** A kill: a big feather explosion, red cartoon drops and a splat on the ground. */
  killBurst(at: THREE.Vector3): void {
    this.tmpB.set(0, 1, 0);
    this.feathersBurst(this.tmpA.copy(at).setY(at.y + 1.0), this.tmpB, 46, 1.5);
    for (let i = 0; i < 16; i++) {
      this.blobs.spawn({
        x: at.x,
        y: at.y + 1.0,
        z: at.z,
        vx: (Math.random() - 0.5) * 5,
        vy: 1.5 + Math.random() * 3,
        vz: (Math.random() - 0.5) * 5,
        life: 0.6 + Math.random() * 0.4,
        size: 0.09 + Math.random() * 0.09,
        grow: 0.6,
        gravity: 12,
        drag: 0.5,
        color: this.red,
        spin: 0,
      });
    }
    const d = this.decals[this.nextDecal] as Decal;
    this.nextDecal = (this.nextDecal + 1) % this.decals.length;
    d.age = 0;
    d.mesh.visible = true;
    d.material.opacity = 1;
    d.mesh.position.set(at.x, this.groundAt(at.x, at.y + 1, at.z) + 0.03, at.z);
    d.mesh.rotation.y = Math.random() * Math.PI * 2;
    d.mesh.scale.setScalar(1.4 + Math.random() * 0.6);
  }

  update(dt: number, camera: THREE.Camera): void {
    this.feathers.update(dt, camera);
    this.blobs.update(dt, camera);
    for (const t of this.tracers) {
      if (!t.mesh.visible) continue;
      t.age += dt;
      if (t.age >= t.life) {
        t.mesh.visible = false;
        continue;
      }
      const w = t.width * (1 - t.age / t.life);
      t.mesh.scale.x = w;
      t.mesh.scale.y = w;
    }
    for (const f of this.flashes) {
      if (!f.mesh.visible) continue;
      f.age += dt;
      if (f.age >= FLASH_LIFE) f.mesh.visible = false;
    }
    for (const d of this.decals) {
      if (!d.mesh.visible) continue;
      d.age += dt;
      if (d.age >= DECAL_LIFE) d.mesh.visible = false;
      else if (d.age > DECAL_LIFE - 2) d.material.opacity = (DECAL_LIFE - d.age) / 2;
    }
  }
}
