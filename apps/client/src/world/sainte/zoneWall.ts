/**
 * The safe zone: a tall translucent wall on the current circle (beak orange
 * with soft diagonal stripes, readable from far away and from inside), and a
 * thin white line on the ground for the next circle.
 */
import * as THREE from 'three/webgpu';
import { float, mix, smoothstep, uv } from 'three/tsl';

const HEIGHT = 140;
const BASE_Y = -20;
const STRIPE_M = 14;
const RING_SEGMENTS = 256;

function stripeTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d') as CanvasRenderingContext2D;
  g.fillStyle = 'rgba(255,138,61,0.3)';
  g.fillRect(0, 0, 64, 64);
  g.strokeStyle = 'rgba(255,212,59,0.38)';
  g.lineWidth = 6;
  for (let i = -64; i < 128; i += 32) {
    g.beginPath();
    g.moveTo(i, 64);
    g.lineTo(i + 64, 0);
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

export class ZoneWall {
  readonly wall: THREE.Mesh;
  private readonly tex: THREE.CanvasTexture;
  private readonly next: THREE.Mesh;
  private readonly groundAt: (x: number, z: number) => number;
  private nextKey = '';
  private t = 0;

  constructor(scene: THREE.Scene, groundAt: (x: number, z: number) => number) {
    this.groundAt = groundAt;
    this.tex = stripeTexture();
    const mat = new THREE.MeshBasicNodeMaterial({ map: this.tex, transparent: true, side: THREE.DoubleSide, depthWrite: false });
    // Strong near the ground where it matters, fading out toward the top so it never walls off the sky.
    mat.opacityNode = mix(float(1), float(0.12), smoothstep(float(0.04), float(0.45), uv().y));
    const geo = new THREE.CylinderGeometry(1, 1, HEIGHT, 160, 1, true);
    geo.translate(0, HEIGHT / 2 + BASE_Y, 0);
    this.wall = new THREE.Mesh(geo, mat);
    this.wall.name = 'zone-wall';
    this.wall.frustumCulled = false;
    this.wall.renderOrder = 2;
    this.wall.visible = false;
    scene.add(this.wall);

    const ringGeo = new THREE.BufferGeometry();
    ringGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array((RING_SEGMENTS + 1) * 2 * 3), 3));
    const idx: number[] = [];
    for (let i = 0; i < RING_SEGMENTS; i++) {
      const k = i * 2;
      idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
    }
    ringGeo.setIndex(idx);
    this.next = new THREE.Mesh(ringGeo, new THREE.MeshBasicNodeMaterial({ color: 0xffffff, transparent: true, opacity: 0.75, side: THREE.DoubleSide, depthWrite: false }));
    this.next.name = 'zone-next';
    this.next.frustumCulled = false;
    this.next.visible = false;
    this.next.renderOrder = 2;
    scene.add(this.next);
  }

  /** Current safe circle. Hidden when it covers the whole map. */
  set(cx: number, cz: number, r: number): void {
    const show = r > 0.5 && r < 600;
    this.wall.visible = show;
    if (!show) return;
    this.wall.position.set(cx, 0, cz);
    this.wall.scale.set(r, 1, r);
    this.tex.repeat.set(Math.max(1, Math.round((2 * Math.PI * r) / STRIPE_M)), HEIGHT / STRIPE_M);
  }

  /** Next circle as a thin line that hugs the ground; r <= 0 or >= 600 hides it. */
  setNext(cx: number, cz: number, r: number): void {
    const show = r > 0.5 && r < 600;
    this.next.visible = show;
    if (!show) return;
    const key = `${cx.toFixed(1)}|${cz.toFixed(1)}|${r.toFixed(1)}`;
    if (key === this.nextKey) return;
    this.nextKey = key;
    const pos = this.next.geometry.getAttribute('position') as THREE.BufferAttribute;
    const w = Math.max(0.35, r * 0.004);
    for (let i = 0; i <= RING_SEGMENTS; i++) {
      const a = (i / RING_SEGMENTS) * Math.PI * 2;
      const x = cx + Math.cos(a) * r;
      const z = cz + Math.sin(a) * r;
      const y = Math.max(0.05, this.groundAt(x, z)) + 0.25;
      pos.setXYZ(i * 2, x, y, z);
      pos.setXYZ(i * 2 + 1, x, y + w * 3, z);
    }
    pos.needsUpdate = true;
  }

  /** Animate the stripes. */
  update(dt: number): void {
    this.t += dt;
    this.tex.offset.set(this.t * 0.05, this.t * 0.12);
  }

  dispose(): void {
    this.wall.removeFromParent();
    this.next.removeFromParent();
    this.wall.geometry.dispose();
    this.next.geometry.dispose();
    this.tex.dispose();
  }
}
