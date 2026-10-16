/**
 * Small toon meshes for world pickups, one merged vertex-colored geometry per
 * item kind (one material for all of them). Sizes in meters, resting on y = 0.
 */
import * as THREE from 'three/webgpu';
import { Item } from '@qwakk/shared';
import { BRAND } from '../../render/palette.ts';
import { mergeSimple } from './gltf.ts';

const OLIVE = 0x6b7a3a;
const SLATE = 0x4a5160;
const GUN = 0x3a3d44;
const WOOD = 0x9a6a3c;
const WHITE = 0xf6f1e4;
const TAN = 0xc8a46a;

function paint(g: THREE.BufferGeometry, color: number): THREE.BufferGeometry {
  const c = new THREE.Color(color);
  const n = g.getAttribute('position').count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = c.r;
    arr[i * 3 + 1] = c.g;
    arr[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}

function box(w: number, h: number, d: number, color: number, x: number, y: number, z: number): THREE.BufferGeometry {
  return paint(new THREE.BoxGeometry(w, h, d).translate(x, y, z), color);
}

function cyl(r: number, len: number, color: number, x: number, y: number, z: number, axis: 'x' | 'y' | 'z' = 'y', seg = 12): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(r, r, len, seg);
  if (axis === 'x') g.rotateZ(Math.PI / 2);
  if (axis === 'z') g.rotateX(Math.PI / 2);
  return paint(g.translate(x, y, z), color);
}

function dome(r: number, color: number, y: number): THREE.BufferGeometry {
  return paint(new THREE.SphereGeometry(r, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, y, 0), color);
}

function rifle(): THREE.BufferGeometry[] {
  return [
    box(0.62, 0.07, 0.06, GUN, 0.05, 0.06, 0),
    cyl(0.018, 0.36, GUN, 0.53, 0.07, 0, 'x', 8),
    box(0.24, 0.1, 0.055, WOOD, -0.36, 0.05, 0),
    box(0.07, 0.15, 0.05, GUN, 0.08, 0.0, 0),
    box(0.05, 0.035, 0.07, BRAND.yellow, -0.2, 0.06, 0),
  ];
}

function pistol(): THREE.BufferGeometry[] {
  return [box(0.24, 0.07, 0.045, GUN, 0.03, 0.06, 0), box(0.07, 0.12, 0.045, WOOD, -0.06, 0.0, 0), box(0.03, 0.025, 0.05, BRAND.yellow, 0.1, 0.1, 0)];
}

function ammo(big: boolean): THREE.BufferGeometry[] {
  const w = big ? 0.36 : 0.26;
  const color = big ? OLIVE : TAN;
  return [box(w, 0.2, 0.2, color, 0, 0.1, 0), box(w + 0.01, 0.05, 0.205, BRAND.yellow, 0, 0.15, 0), box(0.1, 0.03, 0.06, GUN, 0, 0.215, 0)];
}

function vest(level: number): THREE.BufferGeometry[] {
  const color = level === 2 ? SLATE : OLIVE;
  const parts = [box(0.5, 0.1, 0.42, color, 0, 0.05, 0), box(0.16, 0.06, 0.12, color, -0.14, 0.12, -0.18), box(0.16, 0.06, 0.12, color, 0.14, 0.12, -0.18)];
  if (level === 2) parts.push(box(0.51, 0.03, 0.08, BRAND.yellow, 0, 0.11, 0.05));
  return parts;
}

function helmet(level: number): THREE.BufferGeometry[] {
  const color = level === 2 ? SLATE : OLIVE;
  const parts = [dome(0.2, color, 0.02), cyl(0.215, 0.035, level === 2 ? BRAND.yellow : 0x4d5a28, 0, 0.035, 0, 'y', 16)];
  if (level === 2) parts.push(box(0.05, 0.05, 0.03, BRAND.yellow, 0, 0.21, 0.08));
  return parts;
}

function bandage(): THREE.BufferGeometry[] {
  return [cyl(0.075, 0.16, WHITE, 0, 0.075, 0, 'z', 12), cyl(0.077, 0.04, TAN, 0, 0.075, 0, 'z', 12)];
}

function medkit(): THREE.BufferGeometry[] {
  // Orange case with a white band: no red cross (a protected emblem).
  return [box(0.38, 0.18, 0.26, BRAND.beak, 0, 0.09, 0), box(0.39, 0.06, 0.265, WHITE, 0, 0.1, 0), box(0.12, 0.03, 0.05, GUN, 0, 0.195, 0)];
}

/** Backpack: a canvas bag with a flap, side pockets and straps; one yellow band per level. */
function backpack(level: number): THREE.BufferGeometry[] {
  const color = level === 3 ? SLATE : level === 2 ? OLIVE : TAN;
  const dark = level === 1 ? 0x9c7f4e : level === 2 ? 0x4d5a28 : 0x363c48;
  const parts = [
    box(0.34, 0.4, 0.18, color, 0, 0.2, 0),
    box(0.35, 0.13, 0.2, dark, 0, 0.36, 0.005),
    box(0.08, 0.18, 0.1, dark, -0.205, 0.14, 0),
    box(0.08, 0.18, 0.1, dark, 0.205, 0.14, 0),
    box(0.05, 0.36, 0.03, GUN, -0.09, 0.22, -0.1),
    box(0.05, 0.36, 0.03, GUN, 0.09, 0.22, -0.1),
  ];
  for (let i = 0; i < level; i++) parts.push(box(0.352, 0.025, 0.185, BRAND.yellow, 0, 0.08 + i * 0.05, 0));
  return parts;
}

/** Geometry per item kind (Crate is a fallback box: crates are drawn by crates.ts). */
export function itemGeometry(kind: number): THREE.BufferGeometry {
  let parts: THREE.BufferGeometry[];
  switch (kind) {
    case Item.Rifle: parts = rifle(); break;
    case Item.Pistol: parts = pistol(); break;
    case Item.RifleAmmo: parts = ammo(true); break;
    case Item.PistolAmmo: parts = ammo(false); break;
    case Item.Vest1: parts = vest(1); break;
    case Item.Vest2: parts = vest(2); break;
    case Item.Helmet1: parts = helmet(1); break;
    case Item.Helmet2: parts = helmet(2); break;
    case Item.Bandage: parts = bandage(); break;
    case Item.Medkit: parts = medkit(); break;
    case Item.Backpack1: parts = backpack(1); break;
    case Item.Backpack2: parts = backpack(2); break;
    case Item.Backpack3: parts = backpack(3); break;
    default: parts = [box(0.75, 0.7, 0.75, WOOD, 0, 0.35, 0), box(0.77, 0.12, 0.77, BRAND.yellow, 0, 0.45, 0)];
  }
  const g = mergeSimple(parts);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

/** Cosmetic helmet for a duck's Head bone: origin at the head center, meters (head radius about 0.26). */
export function createHelmetMesh(level: number): THREE.Mesh {
  const g = mergeSimple(helmet(level).map((p) => p.clone()));
  g.scale(1.38, 1.2, 1.38);
  g.translate(0, 0.1, 0);
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, new THREE.MeshToonNodeMaterial({ vertexColors: true }));
  m.name = `helmet-${level}`;
  m.castShadow = true;
  return m;
}

/** Cosmetic vest for a duck's Spine2 bone: a short open shell around the chest, origin at the chest center. */
export function createVestMesh(level: number): THREE.Mesh {
  const color = level === 2 ? SLATE : OLIVE;
  const shell = paint(new THREE.CylinderGeometry(0.36, 0.34, 0.36, 16, 1, true), color);
  const parts = [shell];
  if (level === 2) parts.push(paint(new THREE.CylinderGeometry(0.365, 0.365, 0.06, 16, 1, true), BRAND.yellow));
  const g = mergeSimple(parts);
  g.computeVertexNormals();
  const mat = new THREE.MeshToonNodeMaterial({ vertexColors: true, side: THREE.DoubleSide });
  const m = new THREE.Mesh(g, mat);
  m.name = `vest-${level}`;
  m.castShadow = true;
  return m;
}

/** Cosmetic backpack for a duck's Spine2 bone (bone space: +y up, the duck's back toward -z), by level. */
export function createBackpackMesh(level: number): THREE.Mesh {
  const g = mergeSimple(backpack(level).map((p) => p.clone()));
  // Straps toward the duck: the bag's front (-z in the item mesh) faces the back of the duck.
  g.rotateY(Math.PI);
  g.scale(1.1, 1.1, 1.1);
  g.translate(0, -0.2, -0.42);
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, new THREE.MeshToonNodeMaterial({ vertexColors: true }));
  m.name = `backpack-${level}`;
  m.castShadow = true;
  return m;
}
