/**
 * What Duck Plaza draws on top of its map: the glowing swirls in the three
 * portal arches and their signs (a locked portal is grey with "Sign in to
 * enter"), the leaderboard board's face (the season's top 10, from the
 * public leaderboard API), the pond surface and the rings under teammates
 * and the duck you point at, and the signs over the two market stalls that
 * sell Hunt Season gear (the Blacksmith and the Armorer). Cosmetic only: the
 * server decides portals and every purchase.
 */
import * as THREE from 'three/webgpu';
import { HUB_SHOPS, type HubMapData, type HubPlace, type PortalId, type ShopId } from '@qwakk/shared/hub';
import { COPY } from '../ui/menu/copy.ts';
import type { LeaderboardData } from '../ui/menu/api.ts';

/** Portal opening and plaque in the arch's own space (art/map/blender/props_plaza.py, glTF axes). */
const OPENING = { half: 2.05, straight: 3.4 };
const PLAQUE = { w: 3.2, h: 0.7, y: 6.05, z: 0.875 };
const BOARD = { w: 5.8, h: 3.1, y: 3.1, z: 0.145 };

const COLORS: Record<PortalId, [string, string, string]> = {
  dm: ['#ff8a3d', '#ffd43b', '#ff5a3d'],
  br: ['#ffd43b', '#7fe0ff', '#3da5ff'],
  raid: ['#7be08a', '#d6ff7a', '#2fb36a'],
};
const LOCKED: [string, string, string] = ['#9a9aa2', '#d8d8de', '#6b6b73'];
const FONT = '"Geist Variable", "Geist", ui-sans-serif, system-ui, sans-serif';

function place(o: THREE.Object3D, p: HubPlace): void {
  o.position.set(p.x, p.y, p.z);
  o.rotation.y = p.rotY;
}

/** The arch opening as a flat shape (straight sides, a half circle on top), UVs square in meters around its middle. */
function openingGeometry(): THREE.BufferGeometry {
  const { half: r, straight: s } = OPENING;
  const shape = new THREE.Shape();
  shape.moveTo(-r, 0.02);
  shape.lineTo(r, 0.02);
  shape.lineTo(r, s);
  shape.absarc(0, s, r, 0, Math.PI, false);
  shape.lineTo(-r, 0.02);
  const geo = new THREE.ShapeGeometry(shape, 24);
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const uv = geo.getAttribute('uv') as THREE.BufferAttribute;
  const size = s + r;
  for (let i = 0; i < pos.count; i++) uv.setXY(i, (pos.getX(i) + size / 2) / size, pos.getY(i) / size);
  return geo;
}

/** A swirl of the portal's colors with soft transparent edges (drawn once per color set). */
function swirlTexture(c: [string, string, string]): THREE.CanvasTexture {
  const n = 256;
  const cv = document.createElement('canvas');
  cv.width = cv.height = n;
  const g = cv.getContext('2d')!;
  const bg = g.createRadialGradient(n / 2, n / 2, 4, n / 2, n / 2, n / 2);
  bg.addColorStop(0, '#ffffff');
  bg.addColorStop(0.18, c[1]);
  bg.addColorStop(0.6, c[0]);
  bg.addColorStop(1, c[2]);
  g.fillStyle = bg;
  g.fillRect(0, 0, n, n);
  g.lineCap = 'round';
  for (let arm = 0; arm < 5; arm++) {
    g.beginPath();
    for (let t = 0; t < 1; t += 0.01) {
      const a = arm * ((Math.PI * 2) / 5) + t * Math.PI * 3.2;
      const rr = 6 + t * n * 0.62;
      const x = n / 2 + Math.cos(a) * rr;
      const y = n / 2 + Math.sin(a) * rr;
      if (t === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.strokeStyle = arm % 2 ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.28)';
    g.lineWidth = arm % 2 ? 9 : 16;
    g.stroke();
  }
  // Sparkles.
  for (let i = 0; i < 40; i++) {
    const a = (i * 2.399) % (Math.PI * 2);
    const rr = ((i * 37) % 100) / 100 * n * 0.45;
    g.fillStyle = 'rgba(255,255,255,0.8)';
    g.beginPath();
    g.arc(n / 2 + Math.cos(a) * rr, n / 2 + Math.sin(a) * rr, 1.5 + (i % 3), 0, Math.PI * 2);
    g.fill();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.center.set(0.5, 0.5);
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

function textCanvas(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  draw(cv.getContext('2d')!);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function fitText(g: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number, weight: number, size: number): void {
  let s = size;
  g.font = `${weight} ${s}px ${FONT}`;
  while (g.measureText(text).width > maxW && s > 10) {
    s -= 2;
    g.font = `${weight} ${s}px ${FONT}`;
  }
  g.fillText(text, x, y);
}

function signTexture(id: PortalId, locked: boolean): THREE.CanvasTexture {
  const P = COPY.hub.portals[id];
  return textCanvas(640, 140, (g) => {
    g.fillStyle = '#f4ecd6';
    g.fillRect(0, 0, 640, 140);
    g.fillStyle = locked ? '#8e8a7f' : COLORS[id][2];
    g.fillRect(0, 0, 640, 10);
    g.fillRect(0, 130, 640, 10);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = '#151619';
    fitText(g, P.name.toUpperCase(), 320, 52, 600, 850, 62);
    g.fillStyle = locked ? '#a5523c' : '#5a3f2d';
    fitText(g, locked ? COPY.hub.signIn : P.sub, 320, 104, 600, 700, 38);
  });
}

/** A stall's hanging sign: the shop's name over the counter (stall space: +Z is the counter side). */
const STALL_SIGN = { w: 1.9, h: 0.5, y: 1.92, z: 1.04 };

function stallTexture(id: ShopId): THREE.CanvasTexture {
  const D = COPY.duck.shop;
  return textCanvas(512, 136, (g) => {
    g.fillStyle = '#5a3f2d';
    g.fillRect(0, 0, 512, 136);
    g.fillStyle = '#f4ecd6';
    g.fillRect(8, 8, 496, 120);
    g.fillStyle = id === 'smith' ? '#ff8a3d' : '#ffd43b';
    g.fillRect(8, 8, 496, 10);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = '#151619';
    fitText(g, (id === 'smith' ? D.smith : D.armorer).toUpperCase(), 256, 62, 470, 850, 58);
    g.fillStyle = '#5a3f2d';
    fitText(g, COPY.duck.shop.signSub, 256, 108, 470, 700, 26);
  });
}

interface PortalView {
  id: PortalId;
  group: THREE.Group;
  swirl: THREE.Mesh;
  swirl2: THREE.Mesh;
  front: THREE.Mesh;
  back: THREE.Mesh;
  locked: boolean;
}

export class HubDecor {
  readonly group = new THREE.Group();
  private readonly portals: PortalView[] = [];
  private readonly openGeo = openingGeometry();
  private readonly board: THREE.Mesh | null = null;
  private boardTex: THREE.CanvasTexture | null = null;
  private readonly rings = new Map<string, THREE.Mesh>();
  private readonly ringGeo = new THREE.RingGeometry(0.62, 0.78, 40);
  private readonly mateMat = new THREE.MeshBasicNodeMaterial({ color: 0x3ddc84, transparent: true, opacity: 0.85, depthWrite: false });
  private readonly hotMat = new THREE.MeshBasicNodeMaterial({ color: 0xffd43b, transparent: true, opacity: 0.9, depthWrite: false });
  private t = 0;

  constructor(scene: THREE.Scene, hub: HubMapData, pond: { x: number; z: number; rx: number; rz: number; water: number } | null) {
    this.group.name = 'hub-decor';
    scene.add(this.group);
    for (const p of hub.portals) this.portals.push(this.portal(p.id, p));
    if (hub.board) {
      const mat = new THREE.MeshBasicNodeMaterial({ color: 0xffffff });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(BOARD.w, BOARD.h), mat);
      mesh.position.set(0, BOARD.y, BOARD.z);
      const holder = new THREE.Group();
      place(holder, hub.board);
      holder.add(mesh);
      this.group.add(holder);
      this.board = mesh;
      this.setBoard(null);
    }
    if (pond) this.pond(scene, pond);
    this.ringGeo.rotateX(-Math.PI / 2);
    this.stallSigns();
  }

  /** The Blacksmith's and the Armorer's signs, both sides, over their counters. */
  private stallSigns(): void {
    const geo = new THREE.PlaneGeometry(STALL_SIGN.w, STALL_SIGN.h);
    for (const s of HUB_SHOPS) {
      const holder = new THREE.Group();
      holder.position.set(s.x, s.y, s.z);
      holder.rotation.y = s.yaw;
      holder.name = `stall:${s.id}`;
      const tex = stallTexture(s.id);
      for (const back of [false, true]) {
        const m = new THREE.Mesh(geo, new THREE.MeshBasicNodeMaterial({ map: tex }));
        m.position.set(0, STALL_SIGN.y, back ? STALL_SIGN.z - 0.04 : STALL_SIGN.z);
        if (back) m.rotation.y = Math.PI;
        holder.add(m);
      }
      this.group.add(holder);
    }
  }

  private portal(id: PortalId, p: HubPlace): PortalView {
    const group = new THREE.Group();
    place(group, p);
    const mk = (opacity: number, z: number): THREE.Mesh => {
      const m = new THREE.MeshBasicNodeMaterial({ map: swirlTexture(COLORS[id]), transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false });
      const mesh = new THREE.Mesh(this.openGeo, m);
      mesh.position.z = z;
      mesh.renderOrder = 2;
      group.add(mesh);
      return mesh;
    };
    const swirl = mk(0.92, 0);
    const swirl2 = mk(0.45, 0.06);
    swirl2.scale.set(0.97, 0.97, 1);
    const signGeo = new THREE.PlaneGeometry(PLAQUE.w, PLAQUE.h);
    const sign = (back: boolean): THREE.Mesh => {
      const m = new THREE.Mesh(signGeo, new THREE.MeshBasicNodeMaterial({ map: signTexture(id, false) }));
      m.position.set(0, PLAQUE.y, back ? -PLAQUE.z : PLAQUE.z);
      if (back) m.rotation.y = Math.PI;
      group.add(m);
      return m;
    };
    const view: PortalView = { id, group, swirl, swirl2, front: sign(false), back: sign(true), locked: false };
    group.name = `portal:${id}`;
    this.group.add(group);
    return view;
  }

  /** Grey out the portals this duck may not take (a guest: Battle Royale and Hunt Season). */
  setLocked(locked: readonly PortalId[]): void {
    for (const v of this.portals) {
      const on = locked.includes(v.id);
      if (on === v.locked) continue;
      v.locked = on;
      for (const s of [v.swirl, v.swirl2]) {
        const m = s.material as THREE.MeshBasicNodeMaterial;
        m.map?.dispose();
        m.map = swirlTexture(on ? LOCKED : COLORS[v.id]);
        m.needsUpdate = true;
      }
      for (const s of [v.front, v.back]) {
        const m = s.material as THREE.MeshBasicNodeMaterial;
        m.map?.dispose();
        m.map = signTexture(v.id, on);
        m.needsUpdate = true;
      }
    }
  }

  /** Redraw the signs once the web font is in (the first draw may use the fallback font). */
  redrawSigns(): void {
    for (const v of this.portals) {
      for (const s of [v.front, v.back]) {
        const m = s.material as THREE.MeshBasicNodeMaterial;
        m.map?.dispose();
        m.map = signTexture(v.id, v.locked);
        m.needsUpdate = true;
      }
    }
  }

  /** The board's face: the season's top 10 (null: loading or unavailable). */
  setBoard(data: LeaderboardData | null, failed = false): void {
    if (!this.board) return;
    const B = COPY.hub.board;
    const tex = textCanvas(1024, 548, (g) => {
      g.fillStyle = '#151619';
      g.fillRect(0, 0, 1024, 548);
      g.fillStyle = '#ffd43b';
      g.textBaseline = 'middle';
      g.textAlign = 'left';
      fitText(g, B.title, 40, 52, 700, 800, 46);
      g.textAlign = 'right';
      g.fillStyle = 'rgba(244,241,232,0.6)';
      fitText(g, data?.season.name ?? '', 984, 52, 260, 600, 26);
      g.fillStyle = 'rgba(255,212,59,0.35)';
      g.fillRect(40, 88, 944, 3);
      const rows = data?.rows.slice(0, 10) ?? [];
      if (rows.length === 0) {
        g.textAlign = 'center';
        g.fillStyle = 'rgba(244,241,232,0.75)';
        fitText(g, failed ? B.offline : data ? B.empty : B.loading, 512, 300, 900, 600, 34);
        return;
      }
      rows.forEach((r, i) => {
        const y = 122 + i * 42;
        g.textAlign = 'left';
        g.fillStyle = i < 3 ? ['#ffd43b', '#e6e6ea', '#ff8a3d'][i]! : 'rgba(244,241,232,0.55)';
        fitText(g, String(r.rank), 44, y, 60, 800, 30);
        g.fillStyle = '#f4f1e8';
        fitText(g, r.name, 110, y, 560, 700, 30);
        const nameW = Math.min(560, g.measureText(r.name).width);
        g.fillStyle = 'rgba(244,241,232,0.45)';
        fitText(g, `#${r.tag}`, 118 + nameW, y, 120, 500, 24);
        g.textAlign = 'right';
        g.fillStyle = '#ffd43b';
        fitText(g, B.points(r.score), 984, y, 240, 800, 30);
      });
    });
    const m = this.board.material as THREE.MeshBasicNodeMaterial;
    this.boardTex?.dispose();
    this.boardTex = tex;
    m.map = tex;
    m.needsUpdate = true;
  }

  /** The Duck Pond: our own calm surface (the map's sea plane would reach past the hills), with lily pads. */
  private pond(scene: THREE.Scene, p: { x: number; z: number; rx: number; rz: number; water: number }): void {
    const sea = scene.getObjectByName('sea');
    if (sea) sea.visible = false;
    const geo = new THREE.CircleGeometry(1, 64);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshToonNodeMaterial({ color: 0x3fb3cf, transparent: true, opacity: 0.82 });
    mat.depthWrite = false;
    const water = new THREE.Mesh(geo, mat);
    water.scale.set(p.rx * 1.25, 1, p.rz * 1.25);
    water.position.set(p.x, p.water, p.z);
    water.renderOrder = 1;
    water.name = 'pond';
    this.group.add(water);
    const padMat = new THREE.MeshToonNodeMaterial({ color: 0x5f9a3e });
    const padGeo = new THREE.CircleGeometry(0.55, 14, 0.4, Math.PI * 2 - 0.5);
    padGeo.rotateX(-Math.PI / 2);
    const pads = new THREE.InstancedMesh(padGeo, padMat, 14);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    for (let i = 0; i < 14; i++) {
      const a = i * 2.4;
      const r = 0.45 + ((i * 37) % 50) / 100;
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), a * 1.7);
      s.setScalar(0.7 + ((i * 13) % 6) / 10);
      m.compose(new THREE.Vector3(p.x + Math.cos(a) * p.rx * r, p.water + 0.02, p.z + Math.sin(a) * p.rz * r), q, s);
      pads.setMatrixAt(i, m);
    }
    pads.name = 'lily-pads';
    this.group.add(pads);
  }

  /** Rings under ducks: teammates green, the pointed-at duck yellow. */
  setRings(list: readonly { id: string; x: number; y: number; z: number; kind: 'mate' | 'hot' }[]): void {
    const seen = new Set<string>();
    for (const r of list) {
      const key = `${r.kind}:${r.id}`;
      seen.add(key);
      let mesh = this.rings.get(key);
      if (!mesh) {
        mesh = new THREE.Mesh(this.ringGeo, r.kind === 'mate' ? this.mateMat : this.hotMat);
        mesh.renderOrder = 3;
        this.rings.set(key, mesh);
        this.group.add(mesh);
      }
      mesh.position.set(r.x, r.y + 0.05, r.z);
      const pulse = r.kind === 'hot' ? 1 + 0.06 * Math.sin(this.t * 6) : 1;
      mesh.scale.setScalar(pulse);
    }
    for (const [key, mesh] of this.rings) {
      if (seen.has(key)) continue;
      mesh.removeFromParent();
      this.rings.delete(key);
    }
  }

  update(dt: number): void {
    this.t += dt;
    for (const [i, v] of this.portals.entries()) {
      const speed = v.locked ? 0.25 : 0.9;
      const a = (v.swirl.material as THREE.MeshBasicNodeMaterial).map;
      const b = (v.swirl2.material as THREE.MeshBasicNodeMaterial).map;
      if (a) a.rotation = -this.t * speed - i;
      if (b) b.rotation = this.t * speed * 1.6 + i;
      const breathe = 1 + 0.015 * Math.sin(this.t * 2 + i);
      v.swirl.scale.set(breathe, breathe, 1);
    }
  }

  /** Where a portal stands (camera tricks, the warp effect). */
  portalPlace(id: PortalId): THREE.Vector3 | null {
    const v = this.portals.find((p) => p.id === id);
    return v ? v.group.position : null;
  }

  dispose(): void {
    this.group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) {
        (m as THREE.MeshBasicNodeMaterial).map?.dispose();
        m.dispose();
      }
    });
    this.openGeo.dispose();
    this.ringGeo.dispose();
    this.group.removeFromParent();
  }
}
