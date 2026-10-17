import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import { createSimWorld, initPhysics, type MapDef, type SimWorld } from '@qwakk/shared';
import { NameTags, type TagDuck } from '../src/game/nameTags.ts';

// Only the DOM sink is replaced. Visibility uses real camera projection and Rapier rays.
class Node {
  className = '';
  hidden = false;
  textContent = '';
  clientWidth = 1280;
  clientHeight = 720;
  style = { transform: '', opacity: '' };
  children: Node[] = [];
  parent: Node | null = null;
  append(...nodes: Node[]): void { for (const node of nodes) this.appendChild(node); }
  appendChild(node: Node): void { node.parent = this; this.children.push(node); }
  remove(): void { if (this.parent) this.parent.children = this.parent.children.filter((n) => n !== this); }
}

let sim: SimWorld;
let tags: NameTags;
let root: Node;
let camera: THREE.PerspectiveCamera;
const duck = (id: string, x: number, z: number, extra: Partial<TagDuck> = {}): TagDuck =>
  ({ id, name: id, ally: false, alive: true, down: false, x, y: 0, z, crouch: 0, ...extra });
const names = (): string[] => root.children[0]!.children.filter((n) => !n.hidden).map((n) => n.children[1]!.textContent);

beforeAll(initPhysics);
beforeEach(() => {
  vi.stubGlobal('document', { createElement: () => new Node() });
  const map: MapDef = {
    id: 'greybox', seed: 1, size: 400, seaLevel: -1,
    terrain: { cells: 1, cellSize: 400, heights: new Float32Array(4) },
    boxes: [], rocks: [], spawns: [], arena: { x: 0, z: 0, radius: 200 }, arenaSpawns: [], shapes: [], water: null, br: null,
  };
  sim = createSimWorld(map);
  root = new Node();
  tags = new NameTags(root as unknown as HTMLElement, sim);
  camera = new THREE.PerspectiveCamera(60, 1280 / 720, 0.1, 300);
  camera.position.set(0, 2, 0);
  camera.lookAt(0, 2, -10);
  camera.updateMatrixWorld(true);
});
afterEach(() => { tags.dispose(); sim.dispose(); vi.unstubAllGlobals(); });

function wall(height: number, thickness = 0.2): void {
  sim.world.createCollider(sim.rapier.ColliderDesc.cuboid(2, height / 2, thickness).setTranslation(0, height / 2, -5));
  sim.world.step();
}

function update(ducks: TagDuck[], viewer = new THREE.Vector3()): void { tags.update(camera, ducks, viewer); }

describe('nearby player names', () => {
  it('fades from 6 to 12 m, then hides the name immediately at the distance boundary', () => {
    update([duck('Enemy', 0, -6)]);
    const node = root.children[0]!.children[0]!;
    expect(Number(node.style.opacity)).toBeCloseTo(0.65);
    update([duck('Enemy', 0, -9)]);
    expect(Number(node.style.opacity)).toBeCloseTo(0.325);
    update([duck('Enemy', 0, -12)]);
    expect(names()).toEqual([]);
    update([duck('Enemy', 0, -3)]);
    expect(names()).toEqual(['Enemy']);
    expect(Number(node.style.opacity)).toBeCloseTo(0.65);
  });

  it('measures range from the player, independently of the camera boom', () => {
    camera.position.set(0, 2, 10);
    camera.lookAt(0, 2, -10);
    camera.updateMatrixWorld(true);
    update([duck('CloseToPlayer', 0, -10)], new THREE.Vector3(0, 0, -6));
    expect(names()).toEqual(['CloseToPlayer']);
  });

  it('shows nearby off-crosshair enemies together, but hides distant names', () => {
    update([duck('Left', -4, -10), duck('Right', 4, -10), duck('Far', 30, -100)]);
    expect(names()).toEqual(['Left', 'Right']);
    expect(tags.stats.enemyTags).toBe(2);
  });

  it('hides an occluded enemy immediately and removes its label when its pose disappears', () => {
    update([duck('Enemy', 6, -10)]);
    expect(names()).toEqual(['Enemy']);
    wall(5);
    update([duck('Enemy', 0, -10)]);
    expect(names()).toEqual([]);
    update([duck('Enemy', 6, -10)]);
    expect(names()).toEqual(['Enemy']);
    update([]);
    expect(root.children[0]!.children).toHaveLength(0);
    expect(tags.stats.enemyTags).toBe(0);
  });

  it('shows a visible head over cover when the chest is hidden', () => {
    wall(1.7);
    update([duck('Peeking', 0, -10)]);
    expect(names()).toEqual(['Peeking']);
  });

  it('does not reveal a duck when only its floating label clears the wall', () => {
    wall(1.85);
    update([duck('Hidden', 0, -10)]);
    expect(names()).toEqual([]);
  });

  it('hides a duck pressed against the far side of a thin wall', () => {
    wall(5, 0.01);
    update([duck('Hidden', 0, -5.1)]);
    expect(names()).toEqual([]);
  });

  it('keeps nearby allied wall markers, but hides distant allies', () => {
    wall(5);
    update([duck('Ally', 0, -10, { ally: true }), duck('FarAlly', 0, -30, { ally: true }), duck('Enemy', 0, -10)]);
    expect(names()).toEqual(['Ally']);
    expect(tags.stats).toEqual({ allyTags: 1, enemyTags: 0 });
    expect(root.children[0]!.children.map((n) => n.className)).toEqual(['nt ally']);
  });

  it('does not show dead, behind-camera or offscreen ducks', () => {
    update([duck('Dead', 0, -10, { alive: false }), duck('Behind', 0, 10), duck('Offscreen', 100, -10)]);
    expect(names()).toEqual([]);
  });
});
