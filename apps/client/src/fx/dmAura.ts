/**
 * Deathmatch aura around a duck (a child of its avatar, so it shows only on
 * ducks this client receives): a soft glow on the ground and a column of
 * light that fades upward, additive, growing with the kill stacks (beak
 * orange, hotter at five), or gold for the caped hero.
 */
import * as THREE from 'three/webgpu';
import { BRAND } from '../render/palette.ts';

let ringTex: THREE.CanvasTexture | null = null;
let shellTex: THREE.CanvasTexture | null = null;
let dotTex: THREE.CanvasTexture | null = null;

function canvasTexture(w: number, h: number, paint: (g: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  paint(c.getContext('2d') as CanvasRenderingContext2D);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Soft round glow (ground ring and sparkle particles). Shared, never disposed. */
export function glowDotTexture(): THREE.CanvasTexture {
  dotTex ??= canvasTexture(64, 64, (g) => {
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.35, 'rgba(255,255,255,0.55)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
  });
  return dotTex;
}

function ringTexture(): THREE.CanvasTexture {
  ringTex ??= canvasTexture(128, 128, (g) => {
    const grad = g.createRadialGradient(64, 64, 8, 64, 64, 64);
    grad.addColorStop(0, 'rgba(255,255,255,0.15)');
    grad.addColorStop(0.62, 'rgba(255,255,255,0.75)');
    grad.addColorStop(0.75, 'rgba(255,255,255,0.9)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
  });
  return ringTex;
}

function shellTexture(): THREE.CanvasTexture {
  shellTex ??= canvasTexture(4, 64, (g) => {
    const grad = g.createLinearGradient(0, 64, 0, 0);
    grad.addColorStop(0, 'rgba(255,255,255,0.85)');
    grad.addColorStop(0.45, 'rgba(255,255,255,0.3)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 4, 64);
  });
  return shellTex;
}

const STACK_COLORS = [BRAND.yellow, BRAND.yellow, 0xffb43b, BRAND.beak, BRAND.beak, 0xff6a2b];
const HERO_GOLD = 0xffd43b;

function glowMaterial(map: THREE.Texture): THREE.MeshBasicNodeMaterial {
  return new THREE.MeshBasicNodeMaterial({ map, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
}

export class DuckAura {
  readonly object = new THREE.Group();
  private readonly ring: THREE.Mesh;
  private readonly shell: THREE.Mesh;
  private readonly ringMat: THREE.MeshBasicNodeMaterial;
  private readonly shellMat: THREE.MeshBasicNodeMaterial;
  private strength = 0;
  private target = 0;
  private time = Math.random() * 10;

  constructor() {
    const ringGeo = new THREE.PlaneGeometry(1, 1);
    ringGeo.rotateX(-Math.PI / 2);
    this.ringMat = glowMaterial(ringTexture());
    this.ring = new THREE.Mesh(ringGeo, this.ringMat);
    this.ring.position.y = 0.04;
    const shellGeo = new THREE.CylinderGeometry(0.46, 0.38, 1.9, 20, 1, true);
    shellGeo.translate(0, 0.95, 0);
    this.shellMat = glowMaterial(shellTexture());
    this.shell = new THREE.Mesh(shellGeo, this.shellMat);
    for (const m of [this.ring, this.shell]) {
      m.renderOrder = 2;
      m.frustumCulled = false;
      m.castShadow = false;
      this.object.add(m);
    }
    this.object.name = 'dm-aura';
    this.object.visible = false;
  }

  /** Kill stacks (0..5) and the hero flag: the look it eases toward. */
  set(stacks: number, hero: boolean): void {
    this.target = hero ? Math.max(3.5, stacks + 1) : stacks;
    const color = hero ? HERO_GOLD : (STACK_COLORS[Math.min(stacks, STACK_COLORS.length - 1)] ?? BRAND.beak);
    this.ringMat.color.setHex(color);
    this.shellMat.color.setHex(color);
  }

  update(dt: number): void {
    this.time += dt;
    this.strength += (this.target - this.strength) * (1 - Math.exp(-dt * 6));
    const s = this.strength;
    this.object.visible = s > 0.05;
    if (!this.object.visible) return;
    const pulse = 1 + 0.08 * Math.sin(this.time * 4.2);
    const size = (0.9 + 0.22 * s) * pulse;
    this.ring.scale.set(size * 1.4, 1, size * 1.4);
    this.ring.rotation.y = this.time * 0.6;
    this.ringMat.opacity = Math.min(0.9, 0.18 + 0.12 * s);
    this.shell.scale.set(0.8 + 0.06 * s, 0.5 + 0.09 * s * pulse, 0.8 + 0.06 * s);
    this.shellMat.opacity = Math.min(0.3, 0.04 + 0.045 * s);
  }

  dispose(): void {
    this.object.removeFromParent();
    this.ring.geometry.dispose();
    this.shell.geometry.dispose();
    this.ringMat.dispose();
    this.shellMat.dispose();
  }
}
