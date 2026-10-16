"""Review renders for weapons, holds and animation clips (contact strips and MP4/GIF previews).

Locomotion previews scroll a checker floor at the clip's authored speed: if a planted foot slides
against the checker, the gait does not match the engine speed.
"""

import math
import os
import shutil
import subprocess

import bpy
from mathutils import Matrix, Vector

import bake
import clips
import geo
import holds
import posing
import reloads
import render
import weapons

STRIP_FRAMES = 8


def ffmpeg(*args):
    if not shutil.which("ffmpeg"):
        print("ffmpeg not found, skipping", args[-1])
        return
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", *args], check=False)


class Stage:
    def __init__(self, rig_obj, sk, ctx, guns, duck_obj):
        self.rig, self.sk, self.ctx, self.guns, self.duck = rig_obj, sk, ctx, guns, duck_obj
        self.reg = clips.registry()
        self.floor = self._floor()
        self.floor.hide_render = True
        ng = bpy.data.node_groups.get("InvertedHull")
        self.gun_hulls = {}
        self.mags = {}
        self.mag_state = None
        for kind, (gun, nodes) in guns.items():
            gun.data.materials[0] = duck_obj.data.materials[0]   # the toon material set up by shots()
            hull = render.add_outline(gun, None, ng)
            hull.parent = None
            hull.hide_render = True
            self.gun_hulls[kind] = hull
            mag = weapons.mag_of(nodes)
            mag.data.materials[0] = duck_obj.data.materials[0]
            mag_hull = render.add_outline(mag, None, ng)
            mag_hull.parent = None
            mag_hull.hide_render = True
            self.mags[kind] = (mag, mag_hull)

    def _floor(self):
        bpy.ops.mesh.primitive_plane_add(size=40, location=(0, 0, -0.001))
        floor = bpy.context.active_object
        floor.name = "PreviewFloor"
        mat = bpy.data.materials.new("Checker")
        mat.use_nodes = True
        nt = mat.node_tree
        nt.nodes.clear()
        out = nt.nodes.new("ShaderNodeOutputMaterial")
        coord = nt.nodes.new("ShaderNodeTexCoord")
        checker = nt.nodes.new("ShaderNodeTexChecker")
        checker.inputs["Scale"].default_value = 80.0      # 0.25 m squares on the 40 m plane (UV space)
        checker.inputs["Color1"].default_value = (*geo.hex_to_linear("#22252d"), 1)
        checker.inputs["Color2"].default_value = (*geo.hex_to_linear("#2c303a"), 1)
        nt.links.new(coord.outputs["UV"], checker.inputs["Vector"])
        emit = nt.nodes.new("ShaderNodeEmission")
        nt.links.new(checker.outputs["Color"], emit.inputs["Color"])
        geom = nt.nodes.new("ShaderNodeNewGeometry")
        length = nt.nodes.new("ShaderNodeVectorMath")
        length.operation = "LENGTH"
        nt.links.new(geom.outputs["Position"], length.inputs[0])
        fade = nt.nodes.new("ShaderNodeMapRange")
        fade.inputs["From Min"].default_value = 0.8
        fade.inputs["From Max"].default_value = 1.6
        fade.inputs["To Min"].default_value = 1.0
        fade.inputs["To Max"].default_value = 0.0
        nt.links.new(length.outputs["Value"], fade.inputs["Value"])
        transp = nt.nodes.new("ShaderNodeBsdfTransparent")
        mix = nt.nodes.new("ShaderNodeMixShader")
        nt.links.new(fade.outputs["Result"], mix.inputs["Fac"])
        nt.links.new(transp.outputs[0], mix.inputs[1])
        nt.links.new(emit.outputs[0], mix.inputs[2])
        nt.links.new(mix.outputs[0], out.inputs["Surface"])
        mat.surface_render_method = "BLENDED"
        floor.data.materials.append(mat)
        return floor

    # ---- posing
    def basis_at(self, name, t):
        fn, frames, loop, layer = self.reg[name]
        pose = fn(self.ctx, t)
        self.mag_state = getattr(pose, "mag", None)
        M, _ = posing.solve(self.sk, pose)
        return posing.to_basis(self.sk, M), layer

    def show(self, basis, weapon=None):
        bake.apply_basis(self.rig, self.sk, basis)
        bpy.context.view_layer.update()
        for kind, (gun, _e) in self.guns.items():
            on = kind == weapon
            gun.hide_render = self.gun_hulls[kind].hide_render = not on
            mag, mag_hull = self.mags[kind]
            state = self.mag_state or "gun"
            mag.hide_render = mag_hull.hide_render = not on or state == "none"
            if on:
                hand = self.rig.matrix_world @ self.rig.pose.bones["RightHand"].matrix
                gun.matrix_world = hand @ holds.attach(self.sk, "Right")
                self.gun_hulls[kind].matrix_world = gun.matrix_world
                if state == "hand":
                    left = self.rig.matrix_world @ self.rig.pose.bones["LeftHand"].matrix
                    world = left @ holds.mag_in_hand(self.sk, kind)
                else:
                    world = gun.matrix_world @ weapons.mag_local(kind)
                bpy.context.view_layer.update()
                mag.matrix_world = world
                mag_hull.matrix_world = world
        self.mag_state = None
        bpy.context.view_layer.update()

    def layered(self, lower, upper, t_lower, t_upper):
        """Engine-style layering: the upper clip's local rotations replace everything from Spine up."""
        b_low, _ = self.basis_at(lower, t_lower)
        b_up, _ = self.basis_at(upper, t_upper)
        for name in self.sk.subtree("Spine"):
            b_low[name] = b_up[name]
        return b_low

    def turn(self, deg):
        self.rig.rotation_euler = (0, 0, math.radians(deg))
        bpy.context.view_layer.update()

    def scroll_floor(self, name, t):
        """Move the checker so the ground passes under the duck at the clip's authored speed."""
        kind, d = gait_of(name)
        if kind is None:
            self.floor.hide_render = True
            return
        self.floor.hide_render = False
        g = clips.GAITS[kind]
        travel = clips.DIRS[d]
        world_dir = self.rig.matrix_world.to_3x3() @ travel
        shift = -world_dir * g["speed"] * t
        self.floor.location = Vector((shift.x, shift.y, -0.001))


def gait_of(name):
    table = {"Walk": "walk", "Run": "run", "Sprint": "sprint", "Crouch_Walk": "crouch"}
    for prefix, kind in table.items():
        if name == prefix or name.startswith(prefix + "_"):
            if name == "Sprint":
                return kind, "F"
            if name == "Crouch_Walk":
                return kind, "F"
            return kind, name.split("_")[-1]
    return None, None


def weapon_of(name):
    if name.startswith("Rifle") or name == "Equip":
        return "rifle"
    if name.startswith("Pistol"):
        return "pistol"
    return None


def camera_for(name):
    if name.startswith("Death"):
        return dict(yaw=-90, target=(0, 0.1, 0.55), height=2.3)
    if gait_of(name)[0]:
        strafe = name.endswith("_L") or name.endswith("_R")
        return dict(yaw=-18 if strafe else -62, target=(0, 0, 0.82), height=2.0)
    if weapon_of(name):
        return dict(yaw=-38, target=(0, -0.1, 0.95), height=1.6)
    return dict(yaw=-35, target=(0, 0, 0.86), height=2.0)


def run(wanted, quick, renders, rig_obj, sk, ctx, guns, duck_obj):
    stage = Stage(rig_obj, sk, ctx, guns, duck_obj)
    scene = bpy.context.scene
    if wanted("weapon"):
        weapon_shots(stage, renders)
    if wanted("hold"):
        hold_shots(stage, renders)
    if wanted("tps"):
        tps_strips(stage, renders)
    names = [n for n in stage.reg if wanted("anim:" + n)]   # --only anim, or --only anim:Run_F
    if names:
        anim_dir = os.path.join(renders, "anim")
        os.makedirs(anim_dir, exist_ok=True)
        scene.render.resolution_x = scene.render.resolution_y = 384
        scene.eevee.taa_render_samples = 8 if quick else 16
        for name in names:
            strip(stage, name, anim_dir)
        if not quick:
            videos(stage, anim_dir, names)
        scene.render.resolution_x = scene.render.resolution_y = 1024
    stage.turn(0)


def strip(stage, name, anim_dir):
    fn, frames, loop, layer = stage.reg[name]
    cam_cfg = camera_for(name)
    stage.turn(cam_cfg["yaw"])
    cam = render.frame_camera("cam_strip", cam_cfg["target"], cam_cfg["height"], pitch_deg=8)
    tmp = os.path.join(anim_dir, "_tmp")
    os.makedirs(tmp, exist_ok=True)
    files = []
    count = STRIP_FRAMES
    for i in range(count):
        f = round(i * frames / (count if loop else count - 1))
        t = f / clips.FPS
        basis, _ = stage.basis_at(name, t)
        stage.show(basis, weapon_of(name))
        stage.scroll_floor(name, t)
        path = os.path.join(tmp, f"{name}_{i}.png")
        render.render(cam, path)
        files.append(path)
    ffmpeg(*sum([["-i", p] for p in files], []), "-filter_complex", f"hstack=inputs={count}",
           os.path.join(anim_dir, f"strip_{name}.png"))
    for p in files:
        os.remove(p)
    stage.floor.hide_render = True


def videos(stage, anim_dir, names):
    """MP4 and GIF previews of the key clips. Short cycles repeat so they read as motion."""
    jobs = [
        ("Run_F", None, 6), ("Sprint", None, 6), ("Idle", None, 1), ("Death_A", None, 1),
        ("Rifle_Aim", "Run_F", 6), ("Walk_L", None, 6), ("Crouch_Walk", None, 4), ("Rifle_Reload", None, 1),
        ("Quack", None, 2),
    ]
    tmp = os.path.join(anim_dir, "_frames")
    for name, under, repeats in jobs:
        if name not in names:
            continue
        shutil.rmtree(tmp, ignore_errors=True)
        os.makedirs(tmp)
        fn, frames, loop, layer = stage.reg[name]
        lower = under or name
        _, lframes, _, _ = stage.reg[lower]
        total = frames * repeats if loop else frames + 20
        if under:
            total = lframes * 10   # about 3.7 s of the lower clip
        cam_cfg = camera_for(lower if under else name)
        if under:
            cam_cfg = dict(yaw=-50, target=(0, -0.05, 0.85), height=2.0)
        stage.turn(cam_cfg["yaw"])
        cam = render.frame_camera("cam_vid", cam_cfg["target"], cam_cfg["height"], pitch_deg=8)
        for f in range(total):
            t = f / clips.FPS
            tu = (f % frames) / clips.FPS if loop else min(f, frames) / clips.FPS
            if under:
                basis = stage.layered(lower, name, (f % lframes) / clips.FPS, tu)
                stage.show(basis, weapon_of(name))
                stage.scroll_floor(lower, t)
            else:
                basis, _ = stage.basis_at(name, tu)
                stage.show(basis, weapon_of(name))
                stage.scroll_floor(name, t)
            render.render(cam, os.path.join(tmp, f"{f:04d}.png"))
        label = name + ("_over_" + under if under else "")
        ffmpeg("-framerate", str(clips.FPS), "-i", os.path.join(tmp, "%04d.png"), "-c:v", "libx264", "-pix_fmt", "yuv420p",
               "-crf", "20", os.path.join(anim_dir, label + ".mp4"))
        ffmpeg("-framerate", str(clips.FPS), "-i", os.path.join(tmp, "%04d.png"), "-vf",
               "fps=30,scale=320:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=64[p];[b][p]paletteuse",
               "-loop", "0", os.path.join(anim_dir, label + ".gif"))
    shutil.rmtree(tmp, ignore_errors=True)
    shutil.rmtree(os.path.join(anim_dir, "_tmp"), ignore_errors=True)
    stage.floor.hide_render = True


def weapon_shots(stage, renders):
    """Each weapon alone, side and 3/4, at 1024 px."""
    for kind, (gun, empties) in stage.guns.items():
        gun.hide_render = stage.gun_hulls[kind].hide_render = False
        stage.rig.hide_render = True
        stage.duck.hide_render = True
        for o in bpy.data.objects:
            if o.name.startswith("QwakkDuck_Outline") or o.name == "GroundGlow":
                o.hide_render = True
        size = 0.85 if kind == "rifle" else 0.32
        for view, yaw, pitch in (("side", 90, 4), ("three_quarter", 140, 18)):
            gun.matrix_world = Matrix.Translation((0, 0, 1.0))
            stage.gun_hulls[kind].matrix_world = gun.matrix_world
            bpy.context.view_layer.update()
            center = Vector((0, -0.14 if kind == "rifle" else -0.05, 1.03))
            cam = render.frame_camera("cam_w", center, size, yaw_deg=yaw, pitch_deg=pitch, lens=70)
            render.render(cam, os.path.join(renders, f"weapon_{kind}_{view}.png"))
        gun.hide_render = stage.gun_hulls[kind].hide_render = True
    stage.duck.hide_render = False
    for o in bpy.data.objects:
        if o.name.startswith("QwakkDuck_Outline") or o.name == "GroundGlow":
            o.hide_render = False


def hold_shots(stage, renders):
    """The duck holding each weapon in its aim pose, plus a close-up of the grip."""
    for kind, clip in (("rifle", "Rifle_Aim"), ("pistol", "Pistol_Aim")):
        basis, _ = stage.basis_at(clip, 0.0)
        for view, yaw, target, height in (("three_quarter", -38, (0, -0.1, 0.92), 1.9), ("side", -90, (0, -0.15, 0.92), 1.9),
                                          ("front", 0, (0, 0, 0.92), 1.9), ("grip", -60, None, 0.55),
                                          ("tps", 0, (-0.12, -0.25, 1.0), 1.5)):
            stage.turn(yaw)
            stage.show(basis, kind)
            if target is None:
                gun = stage.guns[kind][0]
                target = gun.matrix_world.to_translation() + Vector((0, 0, 0.03))
            if view == "tps":   # behind the right shoulder, like the game camera
                cam = render.frame_camera("cam_h", target, height, yaw_deg=200, pitch_deg=14, lens=50)
            else:
                cam = render.frame_camera("cam_h", target, height, pitch_deg=8, lens=80)
            render.render(cam, os.path.join(renders, f"hold_{kind}_{view}.png"))
        stage.show(posing.to_basis(stage.sk, posing.solve(stage.sk, posing.Pose())[0]), None)


def game_camera(name, arm, zoom=1.0, pitch=-0.10):
    """The game's over-the-shoulder camera (tpsCamera.ts): pivot at eye height, shoulder 0.75 m right
    and 0.32 m up, arm straight back along the view; 75 degree vertical field of view divided by `zoom`."""
    shoulder = Vector((-0.75, 0.0, 1.55 + 0.32))          # duck's right is -X, forward is -Y
    fwd = Vector((0.0, -math.cos(pitch), math.sin(pitch)))
    loc = shoulder - fwd * arm
    # Blender fits the 36 mm sensor to the wider side: 16:9 frames, so scale the vertical view by 16/9.
    lens = 18.0 / (math.tan(math.radians(37.5)) / zoom * 16 / 9)
    return render.camera(name, loc, loc + fwd * 10, lens)


def tps_strips(stage, renders):
    """Review strips in renders/tps: hip vs aim down sights from the game camera, and each reload at
    its magazine events from the game camera, from the same eye point with a narrow lens on the hands
    (`tpszoom`), and from the duck's front right (`right`, how other players see it)."""
    out = os.path.join(renders, "tps")
    os.makedirs(out, exist_ok=True)
    scene = bpy.context.scene
    scene.render.resolution_x, scene.render.resolution_y = 768, 432
    stage.turn(0)
    for kind, aim, ads in (("rifle", "Rifle_Aim", "Rifle_ADS"), ("pistol", "Pistol_Aim", "Pistol_ADS")):
        for label, clip, arm, zoom in (("hip", aim, 3.1, 1.0), ("ads", ads, 1.8, 1.5 if kind == "rifle" else 1.25)):
            basis, _ = stage.basis_at(clip, 0.0)
            stage.show(basis, kind)
            render.render(game_camera("cam_tps", arm, zoom), os.path.join(out, f"{kind}_{label}.png"))
    for kind, clip in (("rifle", "Rifle_Reload"), ("pistol", "Pistol_Reload")):
        e = reloads.MAG_EVENTS[kind]
        times = [0.0, e["out"] + 0.02, (e["out"] + e["drop"]) / 2 if e["drop"] > e["out"] else e["out"] + 0.12,
                 e["fresh"] + 0.02, (e["fresh"] + e["in"]) / 2, e["in"] + 0.02, reloads.RELOAD_SECONDS[kind] - 0.25]
        for view in ("tps", "tpszoom", "right"):
            files = []
            for i, t in enumerate(times):
                basis, _ = stage.basis_at(clip, t)
                stage.show(basis, kind)
                if view == "tps":
                    scene.render.resolution_x, scene.render.resolution_y = 768, 432
                    cam = game_camera("cam_tps", 3.1)
                elif view == "tpszoom":
                    # Same eye point as the game camera, narrow lens on the hands (review only).
                    scene.render.resolution_x = scene.render.resolution_y = 432
                    eye = game_camera("cam_tps", 3.1).location.copy()
                    cam = render.camera("cam_z", eye, Vector((-0.2, -0.3, 0.95)), 75)
                else:
                    scene.render.resolution_x = scene.render.resolution_y = 432
                    cam = render.frame_camera("cam_f", (-0.30, -0.30, 0.80), 0.75, yaw_deg=-75, pitch_deg=15, lens=60)
                path = os.path.join(out, f"_{kind}_{view}_{i}.png")
                render.render(cam, path)
                files.append(path)
                stage.turn(0)
            ffmpeg(*sum([["-i", p] for p in files], []), "-filter_complex", f"hstack=inputs={len(files)}",
                   os.path.join(out, f"reload_{kind}_{view}.png"))
            for p in files:
                os.remove(p)
    scene.render.resolution_x = scene.render.resolution_y = 1024
