/**
 * The Big Hunter's camp and the supply crates, dressed from the map's prop
 * kit (no new art): around the camp's marker a ring of hay bales, crates, an
 * ammo box, a fuel barrel, the signpost, two canvas tents and a campfire
 * (the tents and the fire are simple shapes), leaving the middle clear for
 * the fight. Decoration only, out at the edge, with no colliders: the
 * duck sim's colliders never change during a run (CLAUDE.md, the keep rule).
 */
import * as THREE from 'three/webgpu';
import { toonFrom, toonMaterial } from '../../render/materials.ts';
import { loadPropGlb } from '../../world/sainte/gltf.ts';

/** A prop from the kit, toon shaded, or null when it is not there. */
async function prop(name: string): Promise<THREE.Object3D | null> {
  try {
    const g = await loadPropGlb(name);
    const o = g.scene.clone(true);
    o.traverse((x) => {
      const m = x as THREE.Mesh;
      if (!m.isMesh) return;
      m.material = Array.isArray(m.material) ? m.material.map(toonFrom) : toonFrom(m.material);
      m.castShadow = true;
      m.receiveShadow = true;
    });
    // LOD files carry several copies: keep the first level only.
    const lods = o.children.filter((c) => /LOD[12]$/.test(c.name));
    for (const l of lods) l.removeFromParent();
    return o;
  } catch {
    return null;
  }
}

function tent(color: number): THREE.Object3D {
  const g = new THREE.Group();
  const shape = new THREE.Shape([new THREE.Vector2(-1.3, 0), new THREE.Vector2(1.3, 0), new THREE.Vector2(0, 1.7)]);
  const geo = new THREE.ExtrudeGeometry(shape, { depth: 2.6, bevelEnabled: false });
  geo.translate(0, 0, -1.3);
  const m = new THREE.Mesh(geo, toonMaterial(color));
  m.castShadow = true;
  const door = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 1.1), toonMaterial(0x151619));
  door.position.set(0, 0.55, 1.31);
  g.add(m, door);
  return g;
}

function campfire(): { obj: THREE.Object3D; flame: THREE.Mesh } {
  const g = new THREE.Group();
  const wood = toonMaterial(0x6b4a2b);
  for (let i = 0; i < 4; i++) {
    const log = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 1.0, 6), wood);
    log.rotation.set(Math.PI / 2 - 0.35, (i * Math.PI) / 2, 0);
    log.position.y = 0.18;
    g.add(log);
  }
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.1, 6, 12), toonMaterial(0x8d8a80));
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.05;
  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.32, 0.9, 7), new THREE.MeshBasicNodeMaterial({ color: 0xff8a3d, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
  flame.position.y = 0.55;
  g.add(ring, flame);
  return { obj: g, flame };
}

/** The camp's dressing around (x, y, z), facing `yaw` (toward the castle); returns its root. */
export function buildCamp(parent: THREE.Object3D, x: number, y: number, z: number, groundAt: (x: number, z: number) => number): { root: THREE.Object3D; frame(now: number): void } {
  const root = new THREE.Group();
  parent.add(root);
  const place = (o: THREE.Object3D, angle: number, r: number, turn = 0): void => {
    const px = x + Math.cos(angle) * r;
    const pz = z + Math.sin(angle) * r;
    o.position.set(px, groundAt(px, pz), pz);
    o.rotation.y = -angle + Math.PI / 2 + turn;
    root.add(o);
  };
  place(tent(0xff6a13), 0.6, 11.5);
  place(tent(0x5d6b3d), 1.5, 12.5, 0.4);
  const fire = campfire();
  place(fire.obj, 2.4, 9.5);
  const ring: [string, number, number][] = [['hay_bales', 3.2, 11], ['crate_large', 3.9, 10.5], ['ammo_box', 4.3, 10], ['fuel_barrel', 4.8, 10.8], ['signpost', 5.4, 9.5], ['hay_bales', -0.3, 11]];
  for (const [name, a, r] of ring) void prop(name).then((o) => o && place(o, a, r));
  // The hunters' flag: a blaze-orange banner on a pole, at the back of the camp.
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 4.2, 6), toonMaterial(0x6b4a2b));
  pole.position.y = 2.1;
  const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.9), new THREE.MeshToonNodeMaterial({ color: 0xff6a13, side: THREE.DoubleSide }));
  flag.position.set(0.72, 3.6, 0);
  const banner = new THREE.Group();
  banner.add(pole, flag);
  place(banner, 1.0, 8.5);
  return {
    root,
    frame(now: number) {
      fire.flame.scale.set(1 + Math.sin(now / 90) * 0.12, 1 + Math.sin(now / 70 + 1) * 0.2, 1 + Math.cos(now / 80) * 0.12);
      flag.rotation.y = Math.sin(now / 600) * 0.25;
    },
  };
}

/** A supply crate from the kit (the large crate) or null. */
export function supplyCrate(): Promise<THREE.Object3D | null> {
  return prop('crate_large');
}
