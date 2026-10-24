"""Review renders for the melee art: the katana close-up, the katana in the duck's hand, a contact sheet of
every clip from behind (the game camera side) and from the side, the effects. Toon look from
art/blender/render.py. Images end up as WebP in art/melee/renders/."""

import math
import os
import shutil
import subprocess

import bpy
from mathutils import Matrix, Vector

import bake
import geo
import clips as dclips
import mclips
import posing
import render

STRIP = 8
LOWER = {n: v[0] for n, v in dclips.registry().items() if n in ("Run_F", "Idle")}


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


def size(w, h):
    s = bpy.context.scene.render
    s.resolution_x, s.resolution_y = w, h


class Stage:
    def __init__(self, duck_obj, rig_obj, sk, ctx, kit, fx, palette, art, quick):
        self.duck, self.rig, self.sk, self.ctx, self.kit, self.fx = duck_obj, rig_obj, sk, ctx, kit, fx
        render.setup_scene(samples=8 if quick else 24, size=600)
        duck_pal = bpy.data.images.load(os.path.join(art, "export", "palette.png"))
        self.duck_toon = render.toon_material(duck_pal, "DuckToon")
        self.melee_toon = render.toon_material(palette, "MeleeToon")
        self.ng = render.outline_node_group(render.outline_material())
        duck_obj.data.materials.clear()
        duck_obj.data.materials.append(self.duck_toon)
        self.hulls = {"duck": render.add_outline(duck_obj, rig_obj, self.ng)}
        for key in ("katana", "blade", "scabbard"):
            o = kit[key]
            o.data.materials[0] = self.melee_toon
            h = render.add_outline(o, None, self.ng)
            h.parent = None
            self.hulls[key] = h
        fx["Feather"].data.materials[0] = self.melee_toon
        self.hulls["feather"] = render.add_outline(fx["Feather"], None, self.ng)
        for o in fx.values():
            o.hide_render = True
        self.hulls["feather"].hide_render = True
        self.labels = []

    # ---- posing
    def pose(self, pose):
        M, _ = posing.solve(self.sk, pose)
        basis = posing.to_basis(self.sk, M)
        bake.apply_basis(self.rig, self.sk, basis)
        bpy.context.view_layer.update()
        return M

    def pose_layered(self, lower, upper):
        """Engine-style layering: the upper pose's local rotations replace everything from Spine up."""
        Ml, _ = posing.solve(self.sk, lower)
        Mu, _ = posing.solve(self.sk, upper)
        bl, bu = posing.to_basis(self.sk, Ml), posing.to_basis(self.sk, Mu)
        for name in self.sk.subtree("Spine"):
            bl[name] = bu[name]
        bake.apply_basis(self.rig, self.sk, bl)
        bpy.context.view_layer.update()

    def place_katana(self, sheathed=False, show_saya=True):
        W = self.rig.matrix_world
        spine = W @ self.rig.pose.bones[self.ctx.saya_bone].matrix
        saya = spine @ self.ctx.saya_local
        if sheathed:
            K = saya @ (self.ctx.saya_rest.inverted() @ self.ctx.seat_rest)
        else:
            K = W @ self.rig.pose.bones["RightHand"].matrix @ self.ctx.attach
        self.set_world("katana", K)
        self.set_world("scabbard", saya, show_saya)
        bpy.context.view_layer.update()

    def set_world(self, key, m, visible=True):
        o = self.kit[key]
        o.matrix_world = m
        bpy.context.view_layer.update()
        if key == "katana":
            self.hulls["blade"].matrix_world = self.kit["blade"].matrix_world
        self.hulls[key].matrix_world = m
        o.hide_render = not visible
        self.hulls[key].hide_render = not visible
        if key == "katana":
            self.kit["blade"].hide_render = self.hulls["blade"].hide_render = not visible

    def show_duck(self, on):
        self.duck.hide_render = self.hulls["duck"].hide_render = not on

    def turn(self, deg):
        self.rig.rotation_euler = (0, 0, math.radians(deg))
        bpy.context.view_layer.update()

    def label(self, text, loc, cam, size=0.08, color="#e8e8ea"):
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


def run(duck_obj, rig_obj, sk, ctx, kit, fx, palette, renders, quick, only, art):
    os.makedirs(renders, exist_ok=True)
    st = Stage(duck_obj, rig_obj, sk, ctx, kit, fx, palette, art, quick)
    render.ground_disc(radius=1.6)

    def wanted(name):
        return not only or any(o.split(":")[0] in name for o in only)

    if wanted("katana"):
        katana_closeup(st, renders)
    if wanted("hold"):
        hold_shots(st, renders)
    if wanted("keys"):
        key_poses(st, renders)
    if wanted("anim"):
        contact_sheet(st, renders, only)
    if wanted("fx"):
        fx_sheet(st, renders)
    to_webp(renders)


def to_webp(renders):
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


def katana_closeup(st, renders):
    """The katana and the scabbard alone: side, three-quarter and edge-on."""
    st.show_duck(False)
    size(700, 700)
    files = []
    for i, (yaw, pitch) in enumerate(((-90, 8), (-35, 18), (0, 10))):
        st.set_world("katana", Matrix.Translation((0.0, 0.0, 0.25)) @ Matrix.Rotation(math.radians(-8), 4, "Y"))
        st.set_world("scabbard", Matrix.Translation((0.24, 0.10, 1.03)) @ Matrix.Rotation(math.radians(6), 4, "Y"))
        cam = render.frame_camera("cam_k", (0.1, 0.0, 0.62), 1.25, yaw_deg=yaw, pitch_deg=pitch, lens=85)
        path = os.path.join(renders, f"_katana_{i}.png")
        render.render(cam, path)
        files.append(path)
    hstack(files, os.path.join(renders, "katana_closeup.png"))
    for f in files:
        os.remove(f)
    st.show_duck(True)


def hold_shots(st, renders):
    """The katana in the duck's hand (Katana_Idle) and sheathed on the back, from the front three-quarter,
    the side and the over-the-shoulder game camera."""
    size(600, 700)
    files = []
    fn = mclips.registry()["Katana_Idle"][0]
    shots = [("front34", -32, 7, False), ("side", -90, 6, False), ("tps", 168, 14, False), ("sheathed_back", 160, 10, True)]
    for name, yaw, pitch, sheathed in shots:
        if sheathed:
            st.pose(mclips.relaxed_upper(st.ctx))
        else:
            st.pose(fn(st.ctx, 0.0))
        st.place_katana(sheathed=sheathed)
        cam = render.frame_camera("cam_h", (0, 0, 0.95), 2.3, yaw_deg=yaw, pitch_deg=pitch, lens=70)
        path = os.path.join(renders, f"_hold_{name}.png")
        render.render(cam, path)
        files.append(path)
    hstack(files, os.path.join(renders, "katana_hold.png"))
    for f in files:
        os.remove(f)
    # the grip close-up: the fist around the handle
    size(600, 600)
    st.pose(fn(st.ctx, 0.0))
    st.place_katana()
    hand = (st.rig.matrix_world @ st.rig.pose.bones["RightHand"].matrix).to_translation()
    cam = render.frame_camera("cam_g", hand + Vector((0, -0.05, -0.02)), 0.75, yaw_deg=-110, pitch_deg=-5, lens=85)
    render.render(cam, os.path.join(renders, "katana_grip.png"))


def contact_sheet(st, renders, only):
    """Every clip, eight frames from behind (the game camera side) and eight from the side."""
    size(300, 340)
    anim_dir = os.path.join(renders, "anim")
    os.makedirs(anim_dir, exist_ok=True)
    rows = []
    reg = mclips.registry()
    for name, (fn, frames, loop, layer) in reg.items():
        if only and not any(o in ("anim", "anim:" + name) for o in only):
            continue
        strips = []
        for view, yaw, pitch in (("behind", 172, 12), ("side", -90, 6)):
            files = []
            T = frames / mclips.FPS
            for i in range(STRIP):
                t = T * i / (STRIP if loop else STRIP - 1)
                pose = fn(st.ctx, t)
                if layer == mclips.UPPER:
                    lower_name = "Run_F" if name == "Katana_Run" else "Idle"
                    lfn = LOWER[lower_name]
                    st.pose_layered(lfn(st.ctx.base, t), pose)
                else:
                    st.pose(pose)
                sheathed = name in ("Draw", "Sheathe") and ((name == "Draw" and t < mclips.DRAW_EVENTS["grab"]) or
                                                             (name == "Sheathe" and t >= mclips.SHEATHE_EVENTS["release"]))
                st.place_katana(sheathed=sheathed)
                cam = render.frame_camera("cam_a", (0, 0, 0.9), 2.6, yaw_deg=yaw, pitch_deg=pitch, lens=50)
                if i == 0:
                    st.label(f"{name} ({view})", _corner(cam, 0.95, 1.25), cam, size=0.11)
                st.label(f"{t:.2f}s", _corner(cam, 0.95, -1.15), cam, size=0.09, color="#9aa0aa")
                path = os.path.join(anim_dir, f"_{name}_{view}_{i}.png")
                render.render(cam, path)
                st.clear_labels()
                files.append(path)
            out = os.path.join(anim_dir, f"_{name}_{view}.png")
            hstack(files, out)
            for f in files:
                os.remove(f)
            strips.append(out)
        out = os.path.join(anim_dir, f"{name}.png")
        vstack(strips, out)
        for f in strips:
            os.remove(f)
        rows.append(out)
    st.turn(0)
    if rows and not only:
        full = os.path.join(renders, "_contact_full.png")
        vstack(rows, full)
        ffmpeg("-i", full, "-vf", "scale=iw*0.6:-1", os.path.join(renders, "anim_contact_sheet.png"))
        if os.path.exists(full):
            os.remove(full)


KEYS = [("Katana_Idle", 0.0), ("Slash_1", "impact"), ("Slash_2", "impact"), ("Slash_3", "impact"),
        ("Heavy_Charge", 0.0), ("Heavy_Release", "impact"), ("Dash", 0.12), ("Quack_Shockwave", "impact"),
        ("Ultimate", "flash"), ("Ultimate_Spin", 0.1)]


def key_poses(st, renders):
    """The key moment of every move, bigger: one sheet from the game camera side (behind, over the right
    shoulder, about where the 3.1 m spring arm sits) and one from the front three-quarter."""
    size(420, 470)
    reg = mclips.registry()
    for view, yaw, pitch in (("tps", 166, 16), ("front", -30, 8)):
        rows = []
        for half in (KEYS[:5], KEYS[5:]):
            files = []
            for i, (name, at) in enumerate(half):
                t = mclips.EVENTS[name][at] if isinstance(at, str) else at
                st.pose(reg[name][0](st.ctx, t))
                st.place_katana()
                cam = render.frame_camera("cam_key", (0, 0, 0.85), 2.9, yaw_deg=yaw, pitch_deg=pitch, lens=50)
                st.label(f"{name} {t:.2f}s", _corner(cam, 1.25, 1.30), cam, size=0.12)
                path = os.path.join(renders, f"_key_{view}_{len(rows)}_{i}.png")
                render.render(cam, path)
                st.clear_labels()
                files.append(path)
            row = os.path.join(renders, f"_key_{view}_{len(rows)}.png")
            hstack(files, row)
            rows.append(row)
            for f in files:
                os.remove(f)
        vstack(rows, os.path.join(renders, f"key_poses_{view}.png"))
        for f in rows:
            os.remove(f)


def _corner(cam, right, up):
    """A point in front of the camera, offset in its image plane (meters at the target distance)."""
    m = cam.matrix_world
    fwd = -(m.to_3x3() @ Vector((0, 0, 1)))
    r = m.to_3x3() @ Vector((1, 0, 0))
    u = m.to_3x3() @ Vector((0, 1, 0))
    target = cam.location + fwd * (cam.location - Vector((0, 0, 0.9))).length
    return target - r * right + u * up - fwd * 0.5


def fx_sheet(st, renders):
    """The effects: the slash crescent around a mid-swing duck, the shockwave ring, the elite ring, the feather."""
    size(700, 600)
    files = []
    fx = st.fx
    for o in fx.values():
        o.hide_render = True
    # slash arc around Slash_1's impact frame
    fn = mclips.registry()["Slash_1"][0]
    st.pose(fn(st.ctx, mclips.SLASH_EVENTS["Slash_1"]["impact"]))
    st.place_katana()
    arc = fx["SlashArc"]
    arc.hide_render = False
    arc.matrix_world = Matrix.Translation((0, 0, 0.9)) @ Matrix.Scale(1.3, 4)
    em = _emissive_preview(arc)
    cam = render.frame_camera("cam_fx", (0, -0.3, 0.8), 2.8, yaw_deg=150, pitch_deg=28, lens=50)
    path = os.path.join(renders, "_fx_0.png")
    render.render(cam, path)
    files.append(path)
    arc.hide_render = True
    # shockwave at the quack's impact
    fn = mclips.registry()["Quack_Shockwave"][0]
    st.pose(fn(st.ctx, mclips.QUACK_EVENTS["impact"]))
    st.place_katana()
    sw = fx["Shockwave"]
    sw.hide_render = False
    sw.matrix_world = Matrix.Scale(1.4, 4)
    _emissive_preview(sw)
    cam = render.frame_camera("cam_fx", (0, 0, 0.6), 3.4, yaw_deg=160, pitch_deg=30, lens=50)
    path = os.path.join(renders, "_fx_1.png")
    render.render(cam, path)
    files.append(path)
    sw.hide_render = True
    # elite ring and the feather, no duck
    st.show_duck(False)
    st.set_world("katana", Matrix.Translation((0, 0, -5)), False)
    st.set_world("scabbard", Matrix.Translation((0, 0, -5)), False)
    er = fx["EliteRing"]
    er.hide_render = False
    er.matrix_world = Matrix.Translation((-0.35, 0.2, 0.01))
    _emissive_preview(er)
    fe = fx["Feather"]
    fe.hide_render = st.hulls["feather"].hide_render = False
    fe.matrix_world = Matrix.Translation((0.55, -0.1, 0.35)) @ Matrix.Rotation(math.radians(25), 4, "Z") @ Matrix.Scale(1.6, 4)
    st.hulls["feather"].matrix_world = fe.matrix_world
    cam = render.frame_camera("cam_fx", (0.05, 0, 0.2), 2.1, yaw_deg=-20, pitch_deg=38, lens=60)
    path = os.path.join(renders, "_fx_2.png")
    render.render(cam, path)
    files.append(path)
    er.hide_render = fe.hide_render = st.hulls["feather"].hide_render = True
    st.show_duck(True)
    hstack(files, os.path.join(renders, "fx_sheet.png"))
    for f in files:
        os.remove(f)


def _emissive_preview(obj):
    """Render the vertex-color glow as an additive-looking emission (black is see-through)."""
    name = "FxPreview"
    mat = bpy.data.materials.get(name)
    if mat is None:
        mat = bpy.data.materials.new(name)
        mat.use_nodes = True
        nt = mat.node_tree
        nt.nodes.clear()
        out = nt.nodes.new("ShaderNodeOutputMaterial")
        col = nt.nodes.new("ShaderNodeVertexColor")
        col.layer_name = "Col"
        emit = nt.nodes.new("ShaderNodeEmission")
        emit.inputs["Strength"].default_value = 1.6
        nt.links.new(col.outputs["Color"], emit.inputs["Color"])
        add = nt.nodes.new("ShaderNodeAddShader")
        transp = nt.nodes.new("ShaderNodeBsdfTransparent")
        nt.links.new(emit.outputs[0], add.inputs[0])
        nt.links.new(transp.outputs[0], add.inputs[1])
        nt.links.new(add.outputs[0], out.inputs["Surface"])
        mat.surface_render_method = "BLENDED"
        mat.use_backface_culling = False
    obj.data.materials[0] = mat
    return mat
