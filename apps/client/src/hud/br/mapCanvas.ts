/**
 * The map picture behind the minimap and the full-screen map (M): drawn once
 * from the ground paint and the heights (sea below 0, a light relief shade),
 * with buildings as dark blocks. Then each frame: the zone, the next circle,
 * the plane path and the duck on top.
 */
import type { MapDef, MapV1Extras } from '@qwakk/shared';
import { GROUND_COLORS } from '../../world/sainte/terrain.ts';

const SEA = [47, 167, 201];
const BUILDINGS = new Set(['farmhouse', 'townhouse', 'house_ruined', 'church', 'barn', 'lighthouse', 'bunker_pillbox', 'bridge_stone']);

export interface MapOverlay {
  /** Duck position and heading (yaw, three.js convention). */
  me: { x: number; z: number; yaw: number } | null;
  /** Current circle and the announced next one. */
  zone: { x: number; z: number; r: number } | null;
  next: { x: number; z: number; r: number } | null;
  /** Plane path while it matters (from, to) and the plane position. */
  plane: { fx: number; fz: number; tx: number; tz: number; px: number; pz: number } | null;
  /** Teammates: green dots (orange when knocked, grey when out), named on the big map. */
  allies?: { x: number; z: number; down: boolean; out: boolean; name: string }[];
}

/** Render the base map picture (size x size pixels, north up). */
export function renderMapImage(def: MapDef, ground: Uint8Array, extras: MapV1Extras, size = 512): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const g = c.getContext('2d') as CanvasRenderingContext2D;
  const img = g.createImageData(size, size);
  const t = def.terrain;
  const n = t.cells + 1;
  const half = (t.cells * t.cellSize) / 2;
  const colors = extras.groundLegend.map((name) => GROUND_COLORS[name] ?? 0x8cc152);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const col = Math.min(n - 1, Math.floor((px / size) * n));
      const row = Math.min(n - 1, Math.floor((py / size) * n));
      const i = row * n + col;
      const h = t.heights[i] ?? 0;
      let r: number;
      let gg: number;
      let b: number;
      if (h < 0.05) {
        const deep = Math.min(1, -h / 6);
        r = SEA[0]! * (1 - deep * 0.3);
        gg = SEA[1]! * (1 - deep * 0.25);
        b = SEA[2]! * (1 - deep * 0.15);
      } else {
        const c0 = colors[ground[i] ?? 0] ?? 0x8cc152;
        // Relief: lighter on slopes facing north-west.
        const hx = (t.heights[i + 1] ?? h) - h;
        const hz = (t.heights[i + n] ?? h) - h;
        const shade = 1 + Math.max(-0.18, Math.min(0.18, (-hx - hz) * 0.06));
        r = ((c0 >> 16) & 255) * shade;
        gg = ((c0 >> 8) & 255) * shade;
        b = (c0 & 255) * shade;
      }
      const o = (py * size + px) * 4;
      img.data[o] = r;
      img.data[o + 1] = gg;
      img.data[o + 2] = b;
      img.data[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  // River ribbon.
  const w = def.water;
  const k = size / (half * 2);
  const toPx = (x: number) => (x + half) * k;
  if (w && w.river.length > 1) {
    g.strokeStyle = `rgb(${SEA.join(',')})`;
    g.lineWidth = Math.max(2, w.riverHalfWidth * 2 * k);
    g.lineCap = 'round';
    g.beginPath();
    w.river.forEach((p, i) => (i === 0 ? g.moveTo(toPx(p.x), toPx(p.z)) : g.lineTo(toPx(p.x), toPx(p.z))));
    g.stroke();
  }
  // Buildings.
  g.fillStyle = 'rgba(70, 62, 55, 0.85)';
  for (const p of extras.props) {
    if (!BUILDINGS.has(p.prop)) continue;
    const s = (p.prop === 'church' ? 11 : 8) * k;
    g.save();
    g.translate(toPx(p.x), toPx(p.z));
    g.rotate(-p.rotY);
    g.fillRect(-s / 2, -s / 2, s, s);
    g.restore();
  }
  return c;
}

/** Draws the base picture plus the live overlay into a canvas. */
export class MapPainter {
  private readonly base: HTMLCanvasElement;
  private readonly half: number;

  constructor(base: HTMLCanvasElement, mapHalf: number) {
    this.base = base;
    this.half = mapHalf;
  }

  /**
   * Draw a window of `span` meters centered on (cx, cz) into `out` (span =
   * whole map for the full-screen map). `labels` adds zone names.
   */
  draw(out: HTMLCanvasElement, cx: number, cz: number, span: number, o: MapOverlay, labels: { name: string; x: number; z: number }[] | null): void {
    const g = out.getContext('2d') as CanvasRenderingContext2D;
    const W = out.width;
    const H = out.height;
    const scale = W / span;
    const toX = (x: number) => (x - cx) * scale + W / 2;
    const toY = (z: number) => (z - cz) * scale + H / 2;
    g.fillStyle = 'rgb(47,167,201)';
    g.fillRect(0, 0, W, H);
    const bs = this.base.width / (this.half * 2);
    // Source rect of the base picture for this window.
    g.imageSmoothingEnabled = true;
    g.drawImage(this.base, (cx - span / 2 + this.half) * bs, (cz - span / 2 + this.half) * bs, span * bs, span * bs, 0, 0, W, H);

    if (labels) {
      g.font = `600 ${Math.round(W / 46)}px ui-sans-serif, system-ui, sans-serif`;
      g.textAlign = 'center';
      for (const l of labels) {
        g.fillStyle = 'rgba(21,22,25,0.7)';
        g.fillText(l.name, toX(l.x) + 1, toY(l.z) + 1);
        g.fillStyle = '#f4f1e8';
        g.fillText(l.name, toX(l.x), toY(l.z));
      }
    }
    if (o.plane) {
      g.strokeStyle = 'rgba(255,255,255,0.55)';
      g.setLineDash([6, 6]);
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(toX(o.plane.fx), toY(o.plane.fz));
      g.lineTo(toX(o.plane.tx), toY(o.plane.tz));
      g.stroke();
      g.setLineDash([]);
      g.fillStyle = '#ffd43b';
      g.beginPath();
      g.arc(toX(o.plane.px), toY(o.plane.pz), Math.max(3, W / 90), 0, Math.PI * 2);
      g.fill();
    }
    if (o.zone && o.zone.r < 1000) {
      // Outside the circle: a soft orange wash.
      g.save();
      g.beginPath();
      g.rect(0, 0, W, H);
      g.arc(toX(o.zone.x), toY(o.zone.z), o.zone.r * scale, 0, Math.PI * 2, true);
      g.fillStyle = 'rgba(255,138,61,0.28)';
      g.fill('evenodd');
      g.restore();
      g.strokeStyle = '#ff8a3d';
      g.lineWidth = 2.5;
      g.beginPath();
      g.arc(toX(o.zone.x), toY(o.zone.z), o.zone.r * scale, 0, Math.PI * 2);
      g.stroke();
    }
    if (o.next) {
      g.strokeStyle = '#ffffff';
      g.lineWidth = 2;
      g.beginPath();
      g.arc(toX(o.next.x), toY(o.next.z), Math.max(1.5, o.next.r * scale), 0, Math.PI * 2);
      g.stroke();
      // A line from the duck to the next circle when outside it.
      if (o.me && Math.hypot(o.me.x - o.next.x, o.me.z - o.next.z) > o.next.r) {
        g.strokeStyle = 'rgba(255,255,255,0.6)';
        g.setLineDash([4, 5]);
        g.beginPath();
        g.moveTo(toX(o.me.x), toY(o.me.z));
        g.lineTo(toX(o.next.x), toY(o.next.z));
        g.stroke();
        g.setLineDash([]);
      }
    }
    for (const a of o.allies ?? []) {
      const r = Math.max(4, W / 70);
      g.fillStyle = a.out ? '#8a8f98' : a.down ? '#ff8a3d' : '#3ddc84';
      g.strokeStyle = '#151619';
      g.lineWidth = 2;
      g.beginPath();
      g.arc(toX(a.x), toY(a.z), r, 0, Math.PI * 2);
      g.fill();
      g.stroke();
      if (labels && a.name) {
        g.font = `600 ${Math.round(W / 60)}px ui-sans-serif, system-ui, sans-serif`;
        g.textAlign = 'center';
        g.fillStyle = 'rgba(21,22,25,0.75)';
        g.fillText(a.name, toX(a.x) + 1, toY(a.z) - r - 3);
        g.fillStyle = '#3ddc84';
        g.fillText(a.name, toX(a.x), toY(a.z) - r - 4);
      }
    }
    if (o.me) {
      const x = toX(o.me.x);
      const y = toY(o.me.z);
      const s = Math.max(6, W / 34);
      g.save();
      g.translate(x, y);
      // Yaw 0 faces -z, which is up on the map.
      g.rotate(-o.me.yaw);
      g.beginPath();
      g.moveTo(0, -s);
      g.lineTo(s * 0.62, s * 0.7);
      g.lineTo(0, s * 0.35);
      g.lineTo(-s * 0.62, s * 0.7);
      g.closePath();
      g.fillStyle = '#ffd43b';
      g.strokeStyle = '#151619';
      g.lineWidth = 2;
      g.fill();
      g.stroke();
      g.restore();
    }
  }
}
