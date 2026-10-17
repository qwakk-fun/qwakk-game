/**
 * The menu's hero duck as a real 3D model: the picked character's model
 * (duck.glb, or duck_<key>.glb for the other ducks) with the rifle from
 * weapons/rifle.glb, posed with Rifle_Aim (upper body) over Idle (legs) at
 * their first frame, and framed and shaded like the static menu image
 * (`public/ui/duck-rifle.webp`, the art's `hold_rifle_three_quarter` render):
 * the art's 80 mm camera, the duck turned 38 degrees, the review renders'
 * fixed-light two-band toon with the shadow tint, a 7.5 mm outline hull and
 * the soft ground disc.
 *
 * `pose()` aims the duck: the base pose is restored first every call and the
 * offsets are applied on top (the avatar.ts rule), so nothing stacks from
 * frame to frame.
 */
import * as THREE from 'three/webgpu';
import { dot, float, length, normalLocal, normalWorld, positionLocal, select, smoothstep, texture, uv, vec3, vertexColor } from 'three/tsl';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { characterIdOf, characterKey } from '@qwakk/shared/characters';
import { rotateBoneWorld } from '../player/ik.ts';
import { BRAND } from '../render/palette.ts';
import { AIM, aimFromScreen } from './aim.ts';

const MODELS = `${import.meta.env.BASE_URL}models/`;

/** The art's hold render (art/blender/previews.py hold_shots, three_quarter), in glTF axes. */
const FRAME = {
  /** stage.turn(-38): the duck faces 38 degrees to the viewer's left. */
  turn: (-38 * Math.PI) / 180,
  /** frame_camera(target, height 1.9, pitch 8, lens 80) on a 36 mm square sensor. */
  target: new THREE.Vector3(0, 0.92, 0.1),
  height: 1.9,
  pitch: (8 * Math.PI) / 180,
  lens: 80,
} as const;

/** The review renders' toon recipe (art/blender/render.py, params.py). */
const LOOK = {
  /** Light direction (Blender LIGHT_DIR, converted to glTF axes), fixed in the world. */
  light: new THREE.Vector3(-0.55, 0.85, 0.75).normalize(),
  threshold: 0.08,
  shadowTint: 0xd9a6a0,
  outline: 0.0075,
  /**
   * Palette cells drawn without an outline (art/blender duck.py and characters.py:
   * the belly and breast patches, shine, mouth and blush parts have outline weight 0),
   * in the order of params.py PALETTE: belly, shine, mouth, blush, then the
   * mallard's m_chest, m_belly and m_blush. Cell i sits in column i % 16 and
   * row floor(i / 16) of the 256 px palette (glTF v grows downward, row 0 on top).
   */
  noOutlineCells: [2, 6, 7, 8, 18, 20, 29],
  paletteCells: 16,
  ground: 0x1f2128,
} as const;

interface AttachJson {
  rifle?: { position?: number[]; quaternion?: number[] };
}

async function loadAttach(): Promise<{ position: THREE.Vector3; quaternion: THREE.Quaternion }> {
  const r = await fetch(`${MODELS}weapons/attach.json`);
  if (!r.ok) throw new Error(`attach.json ${r.status}`);
  const j = (await r.json()) as AttachJson;
  const p = j.rifle?.position;
  const q = j.rifle?.quaternion;
  if (p?.length !== 3 || q?.length !== 4) throw new Error('attach.json has no rifle pose');
  return { position: new THREE.Vector3().fromArray(p), quaternion: new THREE.Quaternion().fromArray(q) };
}

/** Flat two-band toon from a fixed world light, like the menu image (unlit: no scene lights needed). */
function toonLook(src: THREE.Material): THREE.MeshBasicNodeMaterial {
  const s = src as THREE.MeshStandardMaterial;
  const m = new THREE.MeshBasicNodeMaterial();
  const rgb = (c: THREE.Color) => vec3(c.r, c.g, c.b); // working (linear) space
  let base = s.map ? texture(s.map).rgb : rgb(s.color ?? new THREE.Color(0xffffff));
  if (s.vertexColors) base = base.mul(vertexColor().rgb);
  const lit = dot(normalWorld, vec3(LOOK.light.x, LOOK.light.y, LOOK.light.z)).greaterThan(LOOK.threshold);
  m.colorNode = select(lit, base, base.mul(rgb(new THREE.Color(LOOK.shadowTint))));
  m.side = s.side;
  return m;
}

/**
 * Inverted hull: back faces pushed out along the (skinned) normal, in the brand
 * dark. The art's no-outline parts (belly, blush, shine, mouth) are pulled a
 * little inward instead, so their hull hides under the surface.
 */
function outlineLook(): THREE.MeshBasicNodeMaterial {
  const m = new THREE.MeshBasicNodeMaterial({ color: BRAND.dark, side: THREE.BackSide });
  const cell = uv().x.mul(LOOK.paletteCells).floor().add(uv().y.mul(LOOK.paletteCells).floor().mul(LOOK.paletteCells));
  const bare = LOOK.noOutlineCells.map((c) => cell.equal(c)).reduce((a, b) => a.or(b));
  const weight = select(bare, float(-0.3), float(1));
  m.positionNode = positionLocal.add(normalLocal.mul(weight.mul(LOOK.outline)));
  return m;
}

/** The soft ground disc under the feet (radius 1 m, fading out from 0.35 m). */
function groundDisc(): THREE.Mesh {
  const m = new THREE.MeshBasicNodeMaterial({ color: LOOK.ground, transparent: true, depthWrite: false });
  m.opacityNode = smoothstep(0.35, 1, length(positionLocal.xy)).oneMinus();
  const disc = new THREE.Mesh(new THREE.CircleGeometry(1, 64), m);
  disc.rotation.x = -Math.PI / 2;
  disc.position.y = -0.002;
  disc.renderOrder = -1;
  return disc;
}

/** KeyframeTrack.createInterpolant exists at runtime (set by setInterpolation) but is missing from the typings. */
function interpolant(track: THREE.KeyframeTrack): THREE.Interpolant {
  return (track as THREE.KeyframeTrack & { createInterpolant(): THREE.Interpolant }).createInterpolant();
}

/** Set bones from a clip's pose at time t. */
function samplePose(clip: THREE.AnimationClip, t: number, bones: Map<string, THREE.Bone>): void {
  for (const track of clip.tracks) {
    const dot = track.name.lastIndexOf('.');
    const bone = bones.get(track.name.slice(0, dot));
    const prop = track.name.slice(dot + 1);
    if (!bone) continue;
    const v = interpolant(track).evaluate(t) as unknown as number[];
    if (prop === 'quaternion') bone.quaternion.fromArray(v).normalize();
    else if (prop === 'position') bone.position.fromArray(v);
    else if (prop === 'scale') bone.scale.fromArray(v);
  }
}

const UP = new THREE.Vector3(0, 1, 0);
const _q = new THREE.Quaternion();
const _qy = new THREE.Quaternion();
const _qp = new THREE.Quaternion();
const _axis = new THREE.Vector3();
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _ndc = new THREE.Vector2();
const _ray = new THREE.Raycaster();

export class HeroDuck {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  /** The duck's turn on its feet (the frame's 38 degrees plus the root share of the aim). */
  private readonly turn = new THREE.Group();
  private readonly all: THREE.Bone[];
  private readonly base: THREE.Quaternion[];
  private readonly spine: THREE.Bone[];
  private readonly neck: THREE.Bone;
  private readonly head: THREE.Bone;
  private readonly jaw: THREE.Bone | null;
  private readonly quackJaw: THREE.Interpolant | null;
  readonly quackSeconds: number;
  /** Where the rifle's grip is on the canvas (0 to 1 from the top left), the reference for aiming. */
  private readonly grip = new THREE.Vector2();
  /** Horizontal axis across the authored aim (a positive turn lifts the muzzle). */
  private readonly pitchAxis = new THREE.Vector3();
  private readonly hitTargets: THREE.Object3D[] = [];
  /** The glTF textures the toon materials sample (not material properties, so tracked here). */
  private readonly textures = new Set<THREE.Texture>();

  /** `character`: the menu catalog id (`classic`, `mallard`); an unknown one shows the classic duck. */
  static async load(character = 'classic'): Promise<HeroDuck> {
    const loader = new GLTFLoader();
    const key = characterKey(characterIdOf(character));
    const [duck, anims, rifle, attach] = await Promise.all([
      loader.loadAsync(`${MODELS}${key === 'classic' ? 'duck.glb' : `duck_${key}.glb`}`),
      loader.loadAsync(`${MODELS}duck_anims.glb`),
      loader.loadAsync(`${MODELS}weapons/rifle.glb`),
      loadAttach(),
    ]);
    return new HeroDuck(duck, anims, rifle, attach);
  }

  /** Built from loaded files (load() fetches them; tests pass their own). */
  constructor(duck: Pick<GLTF, 'scene'>, anims: Pick<GLTF, 'animations'>, rifle: Pick<GLTF, 'scene'>, attach: { position: THREE.Vector3; quaternion: THREE.Quaternion }) {
    // No background: the canvas is transparent and the menu's stage (glow, rings) shows through.
    this.scene.background = null;
    const fov = 2 * Math.atan(18 / FRAME.lens);
    this.camera = new THREE.PerspectiveCamera((fov * 180) / Math.PI, 1, 0.05, 30);
    const dist = FRAME.height / 2 / Math.tan(fov / 2);
    this.camera.position.set(0, Math.sin(FRAME.pitch) * dist, Math.cos(FRAME.pitch) * dist).add(FRAME.target);
    this.camera.lookAt(FRAME.target);
    this.camera.updateMatrixWorld(); // not in the scene: project() and the hit ray need its matrices now

    const made = new Map<THREE.Material, THREE.MeshBasicNodeMaterial>();
    const look = (src: THREE.Material): THREE.MeshBasicNodeMaterial => {
      const known = made.get(src);
      if (known) return known;
      const map = (src as THREE.MeshStandardMaterial).map;
      if (map) {
        // Palette texture: nearest sampling, like the art's renders (Closest).
        map.magFilter = map.minFilter = THREE.NearestFilter;
        map.generateMipmaps = false;
        this.textures.add(map);
      }
      const m = toonLook(src);
      made.set(src, m);
      src.dispose();
      return m;
    };
    const model = duck.scene;
    const bones = new Map<string, THREE.Bone>();
    const skinned: THREE.SkinnedMesh[] = [];
    model.traverse((o) => {
      if ((o as THREE.Bone).isBone) bones.set(o.name, o as THREE.Bone);
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(look) : look(mesh.material);
      if ((o as THREE.SkinnedMesh).isSkinnedMesh) skinned.push(o as THREE.SkinnedMesh);
      this.hitTargets.push(mesh);
    });
    const outline = outlineLook();
    for (const mesh of skinned) {
      const hull = new THREE.SkinnedMesh(mesh.geometry, outline);
      hull.bind(mesh.skeleton, mesh.bindMatrix);
      mesh.parent?.add(hull);
    }
    const need = (name: string): THREE.Bone => {
      const b = bones.get(name);
      if (!b) throw new Error(`duck.glb has no ${name} bone`);
      return b;
    };
    this.spine = [need('Spine'), need('Spine1'), need('Spine2')];
    this.neck = need('Neck');
    this.head = need('Head');
    this.jaw = bones.get('Jaw') ?? null;
    const hand = need('RightHand');

    // The gun rides the right hand at the art's attach pose, with its own outline hull.
    const gun = rifle.scene;
    const gunMeshes: THREE.Mesh[] = [];
    gun.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) gunMeshes.push(o as THREE.Mesh);
    });
    for (const mesh of gunMeshes) {
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(look) : look(mesh.material);
      mesh.add(new THREE.Mesh(mesh.geometry, outline));
      this.hitTargets.push(mesh);
    }
    hand.add(gun);
    gun.position.copy(attach.position);
    gun.quaternion.copy(attach.quaternion);

    // Base pose: the legs from Idle, the upper body from Rifle_Aim, both at their first frame.
    const clip = (name: string): THREE.AnimationClip => {
      const c = anims.animations.find((a) => a.name === name);
      if (!c) throw new Error(`duck_anims.glb has no ${name}`);
      return c;
    };
    samplePose(clip('Idle'), 0, bones);
    samplePose(clip('Rifle_Aim'), 0, bones);
    this.all = [...bones.values()];
    this.base = this.all.map((b) => b.quaternion.clone());
    const quack = anims.animations.find((a) => a.name === 'Quack');
    const jawTrack = quack?.tracks.find((t) => t.name === 'Jaw.quaternion');
    this.quackJaw = this.jaw && jawTrack ? interpolant(jawTrack) : null;
    this.quackSeconds = this.quackJaw && quack ? quack.duration : 0;

    this.turn.rotation.y = FRAME.turn;
    this.turn.add(model);
    this.scene.add(this.turn, groundDisc());
    this.scene.updateMatrixWorld(true);

    const muzzle = gun.getObjectByName('Muzzle');
    const grip = gun.getObjectByName('Grip');
    if (!muzzle || !grip) throw new Error('rifle.glb has no Muzzle or Grip');
    grip.getWorldPosition(_w);
    const dir = muzzle.getWorldPosition(_v).sub(_w);
    this.pitchAxis.set(dir.x, 0, dir.z).normalize().cross(UP).normalize();
    _w.project(this.camera);
    this.grip.set((_w.x + 1) / 2, (1 - _w.y) / 2);
  }

  /**
   * Pose the duck: aim offsets (radians, relative to the authored pose), a
   * recoil kick (0 to 1) and the bill (seconds into the Quack clip, or < 0).
   */
  pose(yaw: number, pitch: number, recoil: number, quackT: number): void {
    this.all.forEach((b, i) => b.quaternion.copy(this.base[i] as THREE.Quaternion));
    if (this.jaw && this.quackJaw && quackT >= 0) this.jaw.quaternion.fromArray(this.quackJaw.evaluate(Math.min(quackT, this.quackSeconds)) as unknown as number[]).normalize();
    const rootYaw = yaw * AIM.rootYaw;
    this.turn.rotation.y = FRAME.turn + rootYaw;
    this.turn.updateMatrixWorld(true);
    // The rest of the yaw and the pitch, shared over the spine (then a little
    // more for the neck and head). Each bone lifts around the axis across its
    // current aim, so the shares add up exactly: the rifle turns by the full aim.
    const yawRest = yaw - rootYaw;
    let turned = rootYaw;
    const share = (bone: THREE.Bone, s: { yaw: number; pitch: number }): void => {
      _axis.copy(this.pitchAxis).applyAxisAngle(UP, turned);
      _qp.setFromAxisAngle(_axis, pitch * s.pitch);
      _qy.setFromAxisAngle(UP, yawRest * s.yaw);
      rotateBoneWorld(bone, _q.multiplyQuaternions(_qy, _qp));
      turned += yawRest * s.yaw;
    };
    this.spine.forEach((bone, i) => share(bone, AIM.spine[i] ?? { yaw: 0, pitch: 0 }));
    if (recoil > 0) {
      _axis.copy(this.pitchAxis).applyAxisAngle(UP, turned);
      rotateBoneWorld(this.spine[2] as THREE.Bone, _q.setFromAxisAngle(_axis, recoil * recoil * AIM.recoilKick));
    }
    share(this.neck, AIM.neck);
    share(this.head, AIM.head);
  }

  /** The aim offsets toward a point on the page (client pixels), given the canvas box. */
  aimAt(x: number, y: number, rect: DOMRect): { yaw: number; pitch: number } {
    const size = rect.height;
    if (size <= 0) return { yaw: 0, pitch: 0 };
    return aimFromScreen((x - rect.left - this.grip.x * rect.width) / size, -(y - rect.top - this.grip.y * rect.height) / size);
  }

  /** True when a point on the page (client pixels) is on the duck or its rifle. */
  hit(x: number, y: number, rect: DOMRect): boolean {
    if (!this.ray(x, y, rect)) return false;
    return _ray.intersectObjects(this.hitTargets, false).length > 0;
  }

  private ray(x: number, y: number, rect: DOMRect): boolean {
    if (rect.width <= 0 || rect.height <= 0) return false;
    _ndc.set(((x - rect.left) / rect.width) * 2 - 1, -(((y - rect.top) / rect.height) * 2 - 1));
    _ray.setFromCamera(_ndc, this.camera);
    return true;
  }

  /** Free every geometry, material and texture this duck owns. */
  dispose(): void {
    const materials = new Set<THREE.Material>();
    const textures = new Set<THREE.Texture>();
    this.scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.geometry.dispose();
      for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) materials.add(m);
    });
    for (const m of materials) {
      for (const v of Object.values(m)) if ((v as THREE.Texture | null)?.isTexture) textures.add(v as THREE.Texture);
      m.dispose();
    }
    for (const t of textures) t.dispose();
    for (const t of this.textures) t.dispose();
    this.textures.clear();
    this.scene.clear();
  }
}
