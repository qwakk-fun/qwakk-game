/**
 * The caped hero's cape (deathmatch): a procedural cloth strip, beak orange
 * outside, brand yellow lining, a dark hem, rebuilt on the CPU every frame
 * (11 x 7 vertices, so it is cheap). It hangs from the duck's upper spine:
 * every frame it follows the Spine2 bone's position (crouch, bob), but keeps
 * the duck's facing instead of the bone's turn (the rifle stance twists the
 * chest sideways, which would swing the cape off to one side). It streams back
 * with speed, almost flat while flying, and flutters.
 *
 * A mode effect, not part of a character model: it is added to the skeleton
 * only while the duck wears the cape, never changes the hitboxes and is not
 * checked by the character silhouette rules.
 */
import * as THREE from 'three/webgpu';
import { BRAND } from '../render/palette.ts';
import { toonMaterial } from '../render/materials.ts';

const COLS = 6;
const ROWS = 10;
/** Shoulder width, hem width and length (m). */
const TOP_W = 0.5;
const HEM_W = 0.78;
const LENGTH = 0.86;
/** From the Spine2 bone to the anchor below the neck, just behind the back, in the avatar's space (the duck faces -z, its back is +z). */
const ANCHOR = new THREE.Vector3(0, 0.1, 0.38);
/** The placeholder duck (no skeleton): shoulders at about 1.1 m. */
const PLACEHOLDER_ANCHOR = new THREE.Vector3(0, 1.12, 0.3);
const _v = new THREE.Vector3();

let hemMaterial: THREE.MeshToonNodeMaterial | null = null;

export class HeroCape {
  readonly object = new THREE.Group();
  private readonly geometry = new THREE.BufferGeometry();
  private readonly pos: Float32Array;
  private time = Math.random() * 10;
  /** Smoothed backward swing (rad) and flutter strength. */
  private swing = 0.42;
  private flutter = 0.2;

  constructor() {
    const verts = (COLS + 1) * (ROWS + 1);
    this.pos = new Float32Array(verts * 3);
    const uv = new Float32Array(verts * 2);
    const color = new Float32Array(verts * 3);
    const outer = new THREE.Color(BRAND.beak);
    const hem = new THREE.Color(BRAND.dark);
    const index: number[] = [];
    for (let r = 0; r <= ROWS; r++) {
      for (let c = 0; c <= COLS; c++) {
        const i = r * (COLS + 1) + c;
        uv[i * 2] = c / COLS;
        uv[i * 2 + 1] = 1 - r / ROWS;
        const k = r >= ROWS - 1 ? hem : outer;
        color.set([k.r, k.g, k.b], i * 3);
        if (r < ROWS && c < COLS) {
          const a = i, b = i + 1, d = i + COLS + 1, e = d + 1;
          // Front faces point away from the duck (the cape streams toward -z in its own space).
          index.push(a, b, d, b, e, d);
        }
      }
    }
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    this.geometry.setAttribute('color', new THREE.BufferAttribute(color, 3));
    this.geometry.setIndex(index);
    hemMaterial ??= toonMaterial(0xffffff, { vertexColors: true });
    // Outside: orange with the dark hem (front faces, seen from behind the duck); inside: the yellow lining.
    const front = new THREE.Mesh(this.geometry, hemMaterial);
    const lining = toonMaterial(BRAND.yellow).clone();
    lining.side = THREE.BackSide;
    const back = new THREE.Mesh(this.geometry, lining);
    for (const m of [front, back]) {
      m.castShadow = true;
      m.frustumCulled = false;
      this.object.add(m);
    }
    this.object.name = 'hero-cape';
    this.build(0, 0);
  }

  /** Hang it on a duck (a child of the avatar, facing its back). */
  attach(avatarRoot: THREE.Object3D): void {
    avatarRoot.add(this.object);
    this.object.position.copy(PLACEHOLDER_ANCHOR);
    this.object.rotation.set(0, Math.PI, 0);
  }

  /** Follow the upper spine bone's position (null: the placeholder duck's fixed shoulders). */
  follow(spine2: THREE.Object3D | null, avatarRoot: THREE.Object3D): void {
    if (!spine2) {
      this.object.position.copy(PLACEHOLDER_ANCHOR);
      return;
    }
    spine2.getWorldPosition(_v);
    avatarRoot.worldToLocal(_v);
    this.object.position.copy(_v).add(ANCHOR);
  }

  /**
   * One frame: `speed` is the duck's horizontal speed (m/s), `flying` while
   * in the air with the cape on, `rise` its vertical speed (m/s).
   */
  update(dt: number, speed: number, flying: boolean, rise: number): void {
    this.time += dt;
    // Rising lifts the cape a little less (the air pushes it down), gliding down lifts it more.
    const lift = Math.max(-0.25, Math.min(0.25, rise * 0.05));
    const swingTarget = flying ? 1.2 + Math.min(0.25, speed * 0.04) - lift : Math.min(0.9, 0.42 + speed * 0.07);
    const k = 1 - Math.exp(-dt * 5);
    this.swing = Math.max(0.05, Math.min(1.45, this.swing + (swingTarget - this.swing) * k));
    const flutterTarget = flying ? 1 : Math.min(0.8, 0.15 + speed * 0.1);
    this.flutter += (flutterTarget - this.flutter) * k;
    this.build(this.swing, this.flutter);
  }

  private build(swing: number, flutter: number): void {
    const p = this.pos;
    const seg = LENGTH / ROWS;
    const t = this.time;
    for (let c = 0; c <= COLS; c++) {
      const u = c / COLS - 0.5;
      let y = 0;
      let z = 0;
      for (let r = 0; r <= ROWS; r++) {
        const v = r / ROWS;
        if (r > 0) {
          // The swing bends in along the length: the top hugs the back, the hem streams.
          const a = swing * (0.35 + 0.65 * v) + flutter * 0.12 * v * Math.sin(t * 9 - v * 5 + u * 3);
          y -= Math.cos(a) * seg;
          z -= Math.sin(a) * seg;
        }
        const w = TOP_W + (HEM_W - TOP_W) * v;
        // Sideways ripple and a slight wrap around the back near the shoulders.
        const ripple = flutter * 0.05 * v * Math.sin(t * 7.3 + u * 5 + v * 3);
        const wrap = (1 - v) * 0.09 * u * u * 4;
        const i = (r * (COLS + 1) + c) * 3;
        p[i] = u * w;
        p[i + 1] = y;
        p[i + 2] = z + ripple + wrap;
      }
    }
    const attr = this.geometry.getAttribute('position') as THREE.BufferAttribute;
    attr.needsUpdate = true;
    this.geometry.computeVertexNormals();
    this.geometry.computeBoundingSphere();
  }

  dispose(): void {
    this.object.removeFromParent();
    this.geometry.dispose();
    for (const m of this.object.children) {
      const mat = (m as THREE.Mesh).material as THREE.Material;
      if (mat !== hemMaterial) mat.dispose();
    }
  }
}
