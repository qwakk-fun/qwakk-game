"""Review renders for the hunters: turnarounds, the lineup next to the duck for scale, LOD sheets, the dog,
the props and an animation contact sheet per clip (toon look from art/blender/render.py)."""

import math
import os
import shutil
import subprocess

import bpy
from mathutils import Matrix, Vector

import dog as dogmod
import hclips
import measure
import render   # art/blender/render.py (toon material, inverted hull outline, cameras)

HIDDEN = ("FxStars", "FxPoof", "LeftHandProp")
STRIP = 8


def ffmpeg(*args):
    if not shutil.which("ffmpeg"):
        print("ffmpeg not found, skipping", args[-1])
        return
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", *args], check=False)


def hstack(files, out):
    if len(files) == 1:
        shutil.copyfile(files[0], out)
        return
    ffmpeg(*sum([["-i", f] for f in files], []), "-filter_complex", f"hstack=inputs={len(files)}", out)


def vstack(files, out):
    if len(files) == 1:
        shutil.copyfile(files[0], out)
        return
    ffmpeg(*sum([["-i", f] for f in files], []), "-filter_complex", f"vstack=inputs={len(files)}", out)


def size(px):
    bpy.context.scene.render.resolution_x = px[0]
    bpy.context.scene.render.resolution_y = px[1]


class Stage:
    def __init__(self, chars, sk, ctx, reg, palette, the_dog, kit, attach, models, quick):
        self.chars, self.sk, self.ctx, self.reg, self.dog, self.kit = chars, sk, ctx, reg, the_dog, kit
        render.setup_scene(samples=8 if quick else 24, size=800)
        self.toon = render.toon_material(palette, "HunterToon")
        self.ng = render.outline_node_group(render.outline_material())
        self.hulls = {}
        for c in chars.values():
            self._dress(c.lods, c.rig)
        self._dress(the_dog.lods, the_dog.rig)
        for o in kit.decoy + kit.trap + [kit.stars, kit.poof]:
            o.data.materials[0] = self.toon
            self.hulls[o.name] = render.add_outline(o, None, self.ng)
        # effects ride their joints like in the engine (attach poses from the manifest are identity offsets)
        self.fx = {}
        for c in list(chars.values()) + [the_dog]:
            items = [("FxStars", kit.stars, (0, 0, 0)), ("FxPoof", kit.poof, (0, 0, 0))]
            if c is not the_dog:
                items.append(("LeftHandProp", kit.decoy[0], (0, 0, -0.055)))
            for bone, src, off in items:
                o = self._ride(src, c.rig, bone, off)
                self.fx.setdefault(c.rig.name, []).append(o)
        for o in kit.decoy + kit.trap + [kit.stars, kit.poof]:
            self.show_obj(o, False)
        self.duck = self._import_duck(os.path.join(models, "duck.glb"))
        if "boss" in chars:     # the GLB carries this on its Root node; in Blender the rig object takes it
            s = chars["boss"].info.get("scale", 1.0)
            chars["boss"].rig.scale = (s, s, s)
        self.labels = []

    def _dress(self, lods, rig):
        for o in lods:
            o.data.materials[0] = self.toon
            self.hulls[o.name] = render.add_outline(o, rig, self.ng)

    def _ride(self, src, rig, bone, offset):
        o = bpy.data.objects.new(src.name + "_on_" + rig.name, src.data)
        bpy.context.scene.collection.objects.link(o)
        o.parent = rig
        o.parent_type = "BONE"
        o.parent_bone = bone
        bpy.context.view_layer.update()
        o.matrix_world = Matrix.Translation(rig.matrix_world @ rig.data.bones[bone].head_local + Vector(offset))
        hull = render.add_outline(o, None, self.ng)
        hull.parent, hull.parent_type, hull.parent_bone = rig, "BONE", bone
        bpy.context.view_layer.update()
        hull.matrix_world = o.matrix_world.copy()
        self.hulls[o.name] = hull
        return o

    def _import_duck(self, path):
        before = set(bpy.data.objects)
        bpy.ops.import_scene.gltf(filepath=path)
        new = [o for o in bpy.data.objects if o not in before]
        rig = next(o for o in new if o.type == "ARMATURE")
        meshes = [o for o in new if o.type == "MESH"]
        img = None
        for m in meshes:
            for slot in m.material_slots:
                for n in slot.material.node_tree.nodes:
                    if n.type == "TEX_IMAGE":
                        img = n.image
        toon = render.toon_material(img, "DuckToon")
        for m in meshes:
            if not m.data.materials:
                m.data.materials.append(toon)
            for k in range(len(m.data.materials)):
                m.data.materials[k] = toon
            self.hulls[m.name] = render.add_outline(m, rig, self.ng)
        # arms down from the T-pose, like the duck's relaxed renders
        bpy.context.view_layer.update()
        for bone, axis, deg in (("LeftArm", (0, 1, 0), 62), ("RightArm", (0, 1, 0), -62),
                                ("LeftForeArm", (0, 0, 1), 18), ("RightForeArm", (0, 0, 1), -18)):
            pb = rig.pose.bones[bone]
            head = (rig.matrix_world @ pb.matrix).to_translation()
            rot = Matrix.Rotation(math.radians(deg), 4, Vector(axis))
            w = Matrix.Translation(head) @ rot @ Matrix.Translation(-head) @ (rig.matrix_world @ pb.matrix)
            pb.matrix = rig.matrix_world.inverted() @ w
            bpy.context.view_layer.update()
        return {"rig": rig, "meshes": meshes}

    # ---- visibility
    def show_obj(self, o, on):
        o.hide_render = not on
        h = self.hulls.get(o.name)
        if h:
            h.hide_render = not on

    def show_char(self, c, on, lod=0):
        for k, o in enumerate(c.lods):
            self.show_obj(o, on and k == lod)
        for o in self.fx.get(c.rig.name, []):
            self.show_obj(o, on)

    def show_duck(self, on):
        for m in self.duck["meshes"]:
            self.show_obj(m, on)

    def solo(self, who=(), duck=False, lod=0):
        for c in list(self.chars.values()) + [self.dog]:
            self.show_char(c, c in who, lod)
        self.show_duck(duck)
        for o in self.kit.decoy + self.kit.trap:
            self.show_obj(o, False)

    # ---- posing
    def pose(self, c, pose, sk=None):
        sk = sk or self.sk
        for b in HIDDEN:
            if b in c.rig.pose.bones and b not in pose.scale:
                pose.scale[b] = 0.0
        measure.apply(c.rig, sk, pose)

    def place(self, c, x=0.0, y=0.0, yaw=0.0):
        c.rig.location = (x, y, 0)
        c.rig.rotation_euler = (0, 0, math.radians(yaw))
        bpy.context.view_layer.update()

    def label(self, text, loc, cam, size=0.09, color="#e8e8ea"):
        curve = bpy.data.curves.new("lbl", "FONT")
        curve.body = text
        curve.size = size
        t = bpy.data.objects.new("lbl", curve)
        bpy.context.scene.collection.objects.link(t)
        t.location = loc
        t.rotation_euler = cam.rotation_euler.copy()
        t.data.materials.append(render.flat_material("lbl_" + color, color))
        self.labels.append(t)
        return t

    def clear_labels(self):
        for t in self.labels:
            bpy.data.objects.remove(t)
        self.labels = []


def run(chars, sk, ctx, reg, palette, the_dog, kit, attach, renders, quick, only, models):
    os.makedirs(renders, exist_ok=True)
    st = Stage(chars, sk, ctx, reg, palette, the_dog, kit, attach, models, quick)
    render.ground_disc(radius=1.4)

    def wanted(name):
        return not only or any(o.split(":")[0] in name for o in only)

    idle = reg["Idle"][0]
    if wanted("turnaround"):
        turnarounds(st, renders, idle)
    if wanted("lineup"):
        lineup(st, renders, idle)
    if wanted("lod"):
        lod_sheet(st, renders, idle)
    if wanted("dog"):
        dog_sheet(st, renders)
    if wanted("props"):
        props_sheet(st, renders)
    if wanted("anim"):
        anim_sheets(st, renders, only)
    to_webp(renders)


def to_webp(renders):
    """Store the review images as WebP (a fraction of the PNG size, so they can live in Git)."""
    scene = bpy.context.scene
    settings = scene.render.image_settings
    settings.file_format = "WEBP"
    settings.quality = 88
    settings.color_mode = "RGB"
    for folder in (renders, os.path.join(renders, "anim")):
        if not os.path.isdir(folder):
            continue
        for name in sorted(os.listdir(folder)):
            if not name.endswith(".png"):
                continue
            src = os.path.join(folder, name)
            img = bpy.data.images.load(src)
            img.save_render(src[:-4] + ".webp", scene=scene)
            bpy.data.images.remove(img)
            os.remove(src)
    settings.file_format = "PNG"


def turnarounds(st, renders, idle):
    size((640, 800))
    views = [("front", 0), ("three_quarter", -38), ("side", -90), ("back", 180)]
    for cid, c in st.chars.items():
        st.solo([c])
        st.pose(c, idle(st.ctx, 0.4))
        h = 2.75 if cid == "boss" else 2.1
        files = []
        for name, deg in views:
            st.place(c, yaw=deg)
            cam = render.frame_camera("cam_t", (0, 0, h * 0.5), h * 1.12, pitch_deg=6, lens=85)
            path = os.path.join(renders, f"{cid}_{name}.png")
            render.render(cam, path)
            files.append(path)
        hstack(files, os.path.join(renders, f"{cid}_turnaround.png"))
        for f in files:
            os.remove(f)
        st.place(c)


def lineup(st, renders, idle):
    """Every hunter, the dog and the classic duck side by side (front three-quarter), with height labels."""
    size((1800, 760))
    order = ["rifleman", "trapper", "decoy", "boss"]
    xs = {"duck": -2.9, "rifleman": -1.75, "trapper": -0.65, "decoy": 0.45, "boss": 1.85}
    who = [st.chars[k] for k in order] + [st.dog]
    st.solo(who, duck=True)
    for k in order:
        c = st.chars[k]
        st.pose(c, idle(st.ctx, 0.4))
        st.place(c, xs[k], 0, -18)
    st.pose(st.dog, dogmod.idle(st.dog.ctx, 0.3), st.dog.sk)
    st.place(st.dog, 3.25, 0.1, -60)
    st.duck["rig"].location = (xs["duck"], 0, 0)
    st.duck["rig"].rotation_euler = (0, 0, math.radians(-18))
    bpy.context.view_layer.update()
    for disc in [o for o in bpy.data.objects if o.name.startswith("GroundGlow")]:
        disc.scale = (4.2, 1.2, 1)
    cam = render.frame_camera("cam_line", (0.2, 0, 1.25), 7.4, yaw_deg=0, pitch_deg=5, lens=60)
    tops = {k: max(p.z for p in measure.positions(st.chars[k].lods[0])) for k in order}
    tops["duck"] = max(max(p.z for p in measure.positions(m)) for m in st.duck["meshes"])
    names = {"decoy": "decoy thrower", "boss": "Big Hunter", "duck": "Qwakk duck"}
    for k, x in xs.items():
        st.label(f"{names.get(k, k)} {tops[k]:.2f} m", (x - 0.45, -0.6, 0.02), cam, size=0.085)
    st.label(f"dog {max(p.z for p in measure.positions(st.dog.lods[0])):.2f} m", (2.95, -0.6, 0.02), cam, size=0.085)
    render.render(cam, os.path.join(renders, "lineup_with_duck.png"))
    # elevated telephoto view, closer to the third-person game camera angle
    size((1600, 500))
    cam2 = render.frame_camera("cam_far", (0.2, 0, 1.0), 8.0, yaw_deg=12, pitch_deg=12, lens=200)
    st.clear_labels()
    render.render(cam2, os.path.join(renders, "lineup_elevated.png"))
    for disc in [o for o in bpy.data.objects if o.name.startswith("GroundGlow")]:
        disc.scale = (1, 1, 1)
    for c in who:
        st.place(c)
    st.duck["rig"].location = (0, 0, 0)


def lod_sheet(st, renders, idle):
    size((420, 560))
    rows = []
    for cid, c in st.chars.items():
        files = []
        st.pose(c, idle(st.ctx, 0.4))
        st.place(c, yaw=-35)
        h = 2.75 if cid == "boss" else 2.1
        for lod in range(3):
            st.solo([c], lod=lod)
            cam = render.frame_camera("cam_l", (0, 0, h * 0.5), h * 1.12, pitch_deg=6, lens=85)
            tri = sum(len(p.vertices) - 2 for p in c.lods[lod].data.polygons)
            st.label(f"LOD{lod} {tri} tris", (-0.5, -0.4, 0.02), cam, size=0.1)
            path = os.path.join(renders, f"_lod_{cid}_{lod}.png")
            render.render(cam, path)
            st.clear_labels()
            files.append(path)
        row = os.path.join(renders, f"_lod_{cid}.png")
        hstack(files, row)
        rows.append(row)
        for f in files:
            os.remove(f)
        st.place(c)
    hstack(rows, os.path.join(renders, "lod_sheet.png"))
    for f in rows:
        os.remove(f)


def dog_sheet(st, renders):
    size((640, 520))
    d = st.dog
    st.solo([d])
    st.pose(d, dogmod.idle(d.ctx, 0.3), d.sk)
    files = []
    for name, deg in (("side", -90), ("three_quarter", -40), ("front", 0), ("back", 180)):
        st.place(d, yaw=deg)
        cam = render.frame_camera("cam_d", (0, 0, 0.55), 1.75, pitch_deg=8, lens=85)
        path = os.path.join(renders, f"_dog_{name}.png")
        render.render(cam, path)
        files.append(path)
    hstack(files, os.path.join(renders, "dog_turnaround.png"))
    for f in files:
        os.remove(f)
    st.place(d)


def props_sheet(st, renders):
    size((600, 600))
    st.solo([])
    files = []
    k = st.kit
    shots = [([k.decoy[0]], (0, 0, 0.12), 0.0, 0.55, -35), ([k.decoy[1]], (0, 0, 0.12), 0.0, 0.55, -35),
             ([k.trap[0]], (0, 0, 0.3), 0, 2.0, -30), ([k.trap[1]], (0, 0, 1.05), 0, 2.6, -30),
             ([k.stars], (0, 0, 0.0), 0, 0.6, -20), ([k.poof], (0, 0, 0.1), 0, 1.3, -20)]
    k.decoy_root.location = (0, 0, 0.12)
    bpy.context.view_layer.update()
    for i, (objs, target, _y, h, yaw) in enumerate(shots):
        for o in objs:
            st.show_obj(o, True)
        cam = render.frame_camera("cam_p", target, h, yaw_deg=yaw, pitch_deg=20, lens=85)
        path = os.path.join(renders, f"_prop_{i}.png")
        render.render(cam, path)
        files.append(path)
        for o in objs:
            st.show_obj(o, False)
    hstack(files, os.path.join(renders, "props_sheet.png"))
    for f in files:
        os.remove(f)
    k.decoy_root.location = (0, 0, 0)


ANIM_CAST = {"Throw": "decoy", "Whistle": "boss", "Taunt": "boss"}


def anim_sheets(st, renders, only):
    """One 8-frame strip per clip (rifleman unless the clip belongs to another look), then all stacked."""
    size((300, 360))
    anim_dir = os.path.join(renders, "anim")
    os.makedirs(anim_dir, exist_ok=True)
    rows = []
    for name, (fn, frames, loop, layer, _extra) in st.reg.items():
        if only and not any(o in ("anim", "anim:" + name) for o in only):
            continue
        c = st.chars[ANIM_CAST.get(name, "rifleman")]
        rows.append(_strip(st, c, st.sk, st.ctx, name, fn, frames, loop, anim_dir, boss=c.id == "boss"))
    for name, (fn, frames, loop, layer, _extra) in dogmod.registry().items():
        if only and not any(o in ("anim", "anim:dog", "anim:dog_" + name) for o in only):
            continue
        rows.append(_strip(st, st.dog, st.dog.sk, st.dog.ctx, "dog_" + name, fn, frames, loop, anim_dir, dog=True))
    if rows and not only:
        full = os.path.join(renders, "_anim_contact_sheet_full.png")
        vstack(rows, full)
        ffmpeg("-i", full, "-vf", "scale=iw/2:-1", os.path.join(renders, "anim_contact_sheet.png"))
        if os.path.exists(full):
            os.remove(full)
    defeat_closeup(st, renders)


def _strip(st, c, sk, ctx, name, fn, frames, loop, anim_dir, boss=False, dog=False):
    st.solo([c])
    seconds = frames / hclips.FPS
    files = []
    yaw = -55 if not dog else -70
    if name.startswith("Defeat") or name.startswith("dog_Defeat"):
        yaw = -75
    st.place(c, yaw=yaw)
    h = (2.9 if boss else 2.35) if not dog else 1.9
    tz = h * 0.45 if not dog else 0.6
    if "Defeat" in name:
        h, tz = h * 1.15, (0.75 if not dog else 0.45)
    for i in range(STRIP):
        t = seconds * i / (STRIP if loop else STRIP - 1)
        st.pose(c, fn(ctx, t), sk)
        cam = render.frame_camera("cam_a", (0, 0.1 if not dog else 0, tz), h, pitch_deg=8, lens=70)
        if i == 0:
            st.label(name, (-0.38 * h, -0.6, tz + 0.40 * h), cam, size=0.055 * h)
        st.label(f"{t:.2f}s", (0.12 * h, -0.6, tz - 0.45 * h), cam, size=0.042 * h, color="#9aa0aa")
        path = os.path.join(anim_dir, f"_{name}_{i}.png")
        render.render(cam, path)
        st.clear_labels()
        files.append(path)
    out = os.path.join(anim_dir, f"{name}.png")
    hstack(files, out)
    for f in files:
        os.remove(f)
    st.place(c)
    return out


def defeat_closeup(st, renders):
    """Bigger frames of the hunter and boss defeats: the hat pop, the plank fall, the poof, the stars."""
    size((520, 420))
    rows = []
    for cid in ("rifleman", "boss"):
        c = st.chars[cid]
        st.solo([c])
        st.place(c, yaw=-70)
        files = []
        h = 2.3 if cid != "boss" else 3.0
        for i, t in enumerate((0.0, 0.25, 0.5, 0.66, 0.8, 1.1, 1.6, 2.0)):
            st.pose(c, st.reg["Defeat"][0](st.ctx, t))
            cam = render.frame_camera("cam_dc", (0, 0.15, h * 0.4), h * 1.25, yaw_deg=10, pitch_deg=14, lens=60)
            path = os.path.join(renders, f"_defeat_{cid}_{i}.png")
            render.render(cam, path)
            files.append(path)
        row = os.path.join(renders, f"_defeat_{cid}.png")
        hstack(files, row)
        rows.append(row)
        for f in files:
            os.remove(f)
        st.place(c)
    vstack(rows, os.path.join(renders, "defeat_frames.png"))
    for f in rows:
        os.remove(f)
