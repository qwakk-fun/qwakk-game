/**
 * Toony explosion effects for the deathmatch explosives: a two-tone fireball
 * that pops and fades, a flat shockwave ring on the ground, dark debris
 * chunks, a puff of smoke, a few loose feathers (it is a duck pond), a scorch
 * mark that fades out, and the rocket's smoke trail. Cartoon, never gore.
 * Everything is pooled; nothing is allocated per blast after the first frame.
 */
import * as THREE from 'three/webgpu';
import { BRAND } from '../render/palette.ts';
import { ParticleSystem } from './particles.ts';

interface Blast {
  group: THREE.Group;
  core: THREE.Mesh;
  shell: THREE.Mesh;
  ring: THREE.Mesh;
  coreMat: THREE.MeshBasicNodeMaterial;
  shellMat: THREE.MeshBasicNodeMaterial;
  ringMat: THREE.MeshBasicNodeMaterial;
  age: number;
  size: number;
}

interface Scorch {
  mesh: THREE.Mesh;
  material: THREE.MeshBasicNodeMaterial;
  age: number;
}

const BLAST_LIFE = 0.55;
const SCORCH_LIFE = 14;
const SCORCH_FADE = 4;

function scorchTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d') as CanvasRenderingContext2D;
  const grad = g.createRadialGradient(64, 64, 6, 64, 64, 62);
  grad.addColorStop(0, 'rgba(21,22,25,0.95)');
  grad.addColorStop(0.55, 'rgba(40,34,28,0.75)');
  grad.addColorStop(1, 'rgba(40,34,28,0)');
  g.fillStyle = grad;
  g.beginPath();
  // A ragged blotch: a star of soft lobes.
  for (let i = 0; i <= 14; i++) {
    const a = (i / 14) * Math.PI * 2;
    const r = 46 + (i % 2 === 0 ? 14 : 0) + Math.random() * 6;
    const x = 64 + Math.cos(a) * r;
    const y = 64 + Math.sin(a) * r;
    if (i === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
  g.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class ExplosionFx {
  private readonly blasts: Blast[] = [];
  private readonly scorches: Scorch[] = [];
  private readonly debris: ParticleSystem;
  private readonly smoke: ParticleSystem;
  private nextBlast = 0;
  private nextScorch = 0;
  private readonly groundAt: (x: number, y: number, z: number) => number;
  private readonly dark = new THREE.Color(0x3a332c);
  private readonly char = new THREE.Color(BRAND.dark);
  private readonly grey = new THREE.Color(0x8d8a84);
  private readonly light = new THREE.Color(0xc9c4ba);
  private readonly hot = new THREE.Color(BRAND.beak);

  constructor(scene: THREE.Scene, groundAt: (x: number, y: number, z: number) => number) {
    this.groundAt = groundAt;
    const sphere = new THREE.IcosahedronGeometry(1, 1);
    const ringGeo = new THREE.RingGeometry(0.82, 1, 40);
    ringGeo.rotateX(-Math.PI / 2);
    for (let i = 0; i < 8; i++) {
      const coreMat = new THREE.MeshBasicNodeMaterial({ color: 0xfff6c8, transparent: true, depthWrite: false });
      const shellMat = new THREE.MeshBasicNodeMaterial({ color: BRAND.beak, transparent: true, depthWrite: false });
      const ringMat = new THREE.MeshBasicNodeMaterial({ color: 0xfff1c2, transparent: true, depthWrite: false, side: THREE.DoubleSide });
      const core = new THREE.Mesh(sphere, coreMat);
      const shell = new THREE.Mesh(sphere, shellMat);
      const ring = new THREE.Mesh(ringGeo, ringMat);
      core.renderOrder = 3;
      shell.renderOrder = 2;
      ring.renderOrder = 2;
      const group = new THREE.Group();
      group.add(shell, core);
      group.visible = false;
      ring.visible = false;
      scene.add(group, ring);
      this.blasts.push({ group, core, shell, ring, coreMat, shellMat, ringMat, age: BLAST_LIFE, size: 1 });
    }
    const tex = scorchTexture();
    const plane = new THREE.PlaneGeometry(1, 1);
    plane.rotateX(-Math.PI / 2);
    for (let i = 0; i < 10; i++) {
      const material = new THREE.MeshBasicNodeMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3 });
      const mesh = new THREE.Mesh(plane, material);
      mesh.visible = false;
      mesh.renderOrder = 1;
      scene.add(mesh);
      this.scorches.push({ mesh, material, age: SCORCH_LIFE });
    }
    this.debris = new ParticleSystem(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicNodeMaterial({ color: 0xffffff }), 260, false);
    scene.add(this.debris.mesh);
    this.smoke = new ParticleSystem(new THREE.CircleGeometry(0.5, 12), new THREE.MeshBasicNodeMaterial({ color: 0xffffff }), 700, true);
    scene.add(this.smoke.mesh);
  }

  /** A blast at `at`: grenade (size 1) or rocket (a little smaller). A ring and a scorch mark when it is near the ground. */
  explode(at: THREE.Vector3, rocket: boolean): void {
    const size = rocket ? 0.85 : 1;
    const b = this.blasts[this.nextBlast] as Blast;
    this.nextBlast = (this.nextBlast + 1) % this.blasts.length;
    b.age = 0;
    b.size = size;
    b.group.visible = true;
    b.group.position.copy(at);
    b.group.rotation.set(Math.random() * 6, Math.random() * 6, 0);
    const ground = this.groundAt(at.x, at.y + 0.5, at.z);
    const nearGround = at.y - ground < 2.5;
    b.ring.visible = nearGround;
    b.ring.position.set(at.x, ground + 0.06, at.z);
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * Math.PI * 2;
      const up = 3 + Math.random() * 6;
      const out = 3 + Math.random() * 6;
      this.debris.spawn({
        x: at.x, y: at.y + 0.1, z: at.z,
        vx: Math.cos(a) * out, vy: up, vz: Math.sin(a) * out,
        life: 0.7 + Math.random() * 0.6,
        size: 0.05 + Math.random() * 0.09,
        grow: 0.8,
        gravity: 16,
        drag: 0.6,
        color: Math.random() < 0.5 ? this.dark : this.char,
        spin: (Math.random() - 0.5) * 18,
      });
    }
    for (let i = 0; i < 14; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * 1.2 * size;
      this.smoke.spawn({
        x: at.x + Math.cos(a) * r, y: at.y + 0.3 + Math.random() * 0.8, z: at.z + Math.sin(a) * r,
        vx: Math.cos(a) * 1.2, vy: 0.8 + Math.random() * 1.2, vz: Math.sin(a) * 1.2,
        life: 1.2 + Math.random() * 1.0,
        size: (0.9 + Math.random() * 0.8) * size,
        grow: 2.6,
        gravity: -0.4,
        drag: 1.5,
        color: i < 4 ? this.hot : Math.random() < 0.5 ? this.grey : this.light,
        spin: 0,
      });
    }
    if (nearGround) {
      const s = this.scorches[this.nextScorch] as Scorch;
      this.nextScorch = (this.nextScorch + 1) % this.scorches.length;
      s.age = 0;
      s.mesh.visible = true;
      s.material.opacity = 1;
      s.mesh.position.set(at.x, ground + 0.035, at.z);
      s.mesh.rotation.y = Math.random() * Math.PI * 2;
      s.mesh.scale.setScalar((rocket ? 2.4 : 3.0) * (0.9 + Math.random() * 0.2));
    }
  }

  /** One puff of rocket exhaust smoke at `at` (call along the path every few centimeters of flight). */
  trail(at: THREE.Vector3, hot = false): void {
    this.smoke.spawn({
      x: at.x + (Math.random() - 0.5) * 0.06, y: at.y + (Math.random() - 0.5) * 0.06, z: at.z + (Math.random() - 0.5) * 0.06,
      vx: (Math.random() - 0.5) * 0.3, vy: 0.25 + Math.random() * 0.3, vz: (Math.random() - 0.5) * 0.3,
      life: hot ? 0.18 : 0.7 + Math.random() * 0.5,
      size: hot ? 0.22 : 0.16 + Math.random() * 0.1,
      grow: hot ? 0.4 : 3.2,
      gravity: -0.2,
      drag: 2,
      color: hot ? this.hot : Math.random() < 0.6 ? this.light : this.grey,
      spin: 0,
    });
  }

  /** Keep the explosion effects out of the recorded death replay (like Effects.hideForReplay). */
  hideForReplay(): () => void {
    const objects: THREE.Object3D[] = [this.debris.mesh, this.smoke.mesh, ...this.blasts.flatMap((b) => [b.group, b.ring])];
    const visible = objects.map((o) => o.visible);
    for (const o of objects) o.visible = false;
    return () => objects.forEach((o, i) => { o.visible = visible[i]!; });
  }

  update(dt: number, camera: THREE.Camera): void {
    this.debris.update(dt, camera);
    this.smoke.update(dt, camera);
    for (const b of this.blasts) {
      if (!b.group.visible) continue;
      b.age += dt;
      const t = b.age / BLAST_LIFE;
      if (t >= 1) {
        b.group.visible = false;
        b.ring.visible = false;
        continue;
      }
      // Pop fast, then hang and fade: an ease-out on the size, a late fade.
      const pop = 1 - (1 - Math.min(1, t * 2.2)) ** 3;
      const r = b.size * (0.6 + 2.6 * pop);
      b.shell.scale.setScalar(r);
      b.core.scale.setScalar(r * (0.75 - 0.35 * t));
      b.shellMat.opacity = t < 0.45 ? 0.95 : 0.95 * (1 - (t - 0.45) / 0.55);
      b.coreMat.opacity = Math.max(0, 1 - t * 1.6);
      if (b.ring.visible) {
        const rr = b.size * (0.6 + 6 * Math.min(1, t * 1.4));
        b.ring.scale.setScalar(rr);
        b.ringMat.opacity = Math.max(0, 0.85 * (1 - t));
      }
    }
    for (const s of this.scorches) {
      if (!s.mesh.visible) continue;
      s.age += dt;
      if (s.age >= SCORCH_LIFE) s.mesh.visible = false;
      else if (s.age > SCORCH_LIFE - SCORCH_FADE) s.material.opacity = (SCORCH_LIFE - s.age) / SCORCH_FADE;
    }
  }
}
