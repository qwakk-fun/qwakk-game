"""Review renders for every character other than the classic duck (renders/<id>/), and its menu portrait.

  turnaround_*.png, turnaround_sheet.png   relaxed pose, front, 3/4, side, back (same cameras as the classic)
  face_closeup.png
  hold_*.png                                the weapon holds (previews.hold_shots)
  lineup_*.png                              next to the classic duck: front, 3/4, back, rifle up
  distance_*.png                            both ducks from the game's camera at 10 m and 25 m (75 degree FOV, 16:9)
  apps/client/public/ui/duck-<id>-rifle.webp  the menu card and stage image (800 px, from hold_rifle_three_quarter)
"""

import math
import os
import shutil
import subprocess

import bpy
from mathutils import Vector

import clips
import posing
import render
import rig

VIEWS = [("front", 0), ("three_quarter", -38), ("side", -90), ("back", 180)]


def ffmpeg(*args):
    if not shutil.which("ffmpeg"):
        print("ffmpeg not found, skipping", args[-1])
        return
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", *args], check=False)


def turn(obj, deg):
    obj.rotation_euler = (0, 0, math.radians(deg))
    bpy.context.view_layer.update()


def resolution(x, y):
    scene = bpy.context.scene
    scene.render.resolution_x, scene.render.resolution_y = x, y


def portrait(src_png, dst_webp, width=800, quality=86):
    """Scale the hold render to 800 px and save it as WebP with Blender's own image writer."""
    img = bpy.data.images.load(src_png)
    img.scale(width, max(1, round(img.size[1] * width / img.size[0])))
    scene = bpy.context.scene
    settings = scene.render.image_settings
    old = (settings.file_format, settings.quality, settings.color_mode)
    settings.file_format = "WEBP"
    settings.color_mode = "RGB"
    settings.quality = quality
    os.makedirs(os.path.dirname(dst_webp), exist_ok=True)
    img.save_render(dst_webp, scene=scene)
    settings.file_format, settings.quality, settings.color_mode = old
    bpy.data.images.remove(img)


def run(renders, client_ui, duck_obj, rig_obj, extras, guns, previews):
    ng = bpy.data.node_groups["InvertedHull"]
    toon = duck_obj.data.materials[0]          # the toon material shots() put on the classic duck
    classic = [duck_obj] + [o for o in bpy.data.objects if o.name.startswith("QwakkDuck_Outline")]
    relaxed = rig.RELAXED + rig.fingers("Left", -12, -8) + rig.fingers("Right", -12, -8)
    target = (0, 0, 0.86)

    for cid, (look, obj, c_rig, _deform, _stats) in extras.items():
        out = os.path.join(renders, cid)
        os.makedirs(out, exist_ok=True)
        for slot in range(len(obj.data.materials)):
            obj.data.materials[slot] = toon
        hull = render.add_outline(obj, c_rig, ng)
        mine = [obj, hull]
        for o in classic:
            o.hide_render = True
        for o in mine:
            o.hide_render = False
        resolution(1024, 1024)
        sk = posing.Skeleton(c_rig)
        stage = previews.Stage(c_rig, sk, clips.Ctx(sk), guns, obj)
        stage.show(posing.to_basis(sk, posing.solve(sk, posing.Pose())[0]), None)   # every gun and magazine hidden

        rig.apply_pose(c_rig, relaxed)
        for name, deg in VIEWS:
            turn(c_rig, deg)
            cam = render.frame_camera("cam_c_" + name, target, 2.0, pitch_deg=7)
            render.render(cam, os.path.join(out, f"turnaround_{name}.png"))
        files = [os.path.join(out, f"turnaround_{n}.png") for n, _ in VIEWS]
        ffmpeg(*sum([["-i", f] for f in files], []), "-filter_complex", "hstack=inputs=4", os.path.join(out, "turnaround_sheet.png"))

        turn(c_rig, -28)
        cam = render.frame_camera("cam_c_face", (0, -0.06, 1.38), 1.15, yaw_deg=0, pitch_deg=5, lens=90)
        render.render(cam, os.path.join(out, "face_closeup.png"))

        previews.hold_shots(stage, out)
        turn(c_rig, 0)
        portrait(os.path.join(out, "hold_rifle_three_quarter.png"), os.path.join(client_ui, f"duck-{cid}-rifle.webp"))

        # Next to the classic duck: classic on the viewer's left, this one on the right.
        for o in classic:
            o.hide_render = False
        rig_obj.location = (-0.55, 0, 0)
        c_rig.location = (0.55, 0, 0)
        rig.apply_pose(rig_obj, relaxed)
        rig.apply_pose(c_rig, relaxed)
        resolution(1600, 1024)
        for name, deg in (("front", 0), ("three_quarter", -30), ("back", 180)):
            turn(rig_obj, deg)
            turn(c_rig, deg)
            if name == "back":   # keep the classic on the viewer's left from behind too
                rig_obj.location, c_rig.location = (0.55, 0, 0), (-0.55, 0, 0)
            cam = render.frame_camera("cam_l_" + name, (0, 0, 0.9), 3.3, pitch_deg=6, lens=60)
            render.render(cam, os.path.join(out, f"lineup_{name}.png"))
            rig_obj.location, c_rig.location = (-0.55, 0, 0), (0.55, 0, 0)

        # Both from the game's over-the-shoulder field of view at play distances (16:9, 75 degrees).
        resolution(1280, 720)
        lens = 18.0 / (math.tan(math.radians(37.5)) * 16 / 9)
        turn(rig_obj, 20)
        turn(c_rig, -20)
        for dist in (10, 25):
            cam = render.camera(f"cam_d_{dist}", (0.0, -dist, 1.9), (0.0, 0.0, 1.0), lens=lens)
            render.render(cam, os.path.join(out, f"distance_{dist}m.png"))

        # Rifle up side by side: the same aim pose on both skeletons (only this duck carries the gun).
        resolution(1600, 1024)
        basis, _ = stage.basis_at("Rifle_Aim", 0.0)
        turn(rig_obj, -38)
        turn(c_rig, -38)
        import bake  # noqa: E402
        bake.apply_basis(rig_obj, sk, basis)
        stage.show(basis, "rifle")
        cam = render.frame_camera("cam_l_rifle", (0, -0.1, 0.92), 3.3, pitch_deg=8, lens=60)
        render.render(cam, os.path.join(out, "lineup_rifle.png"))
        stage.show(posing.to_basis(sk, posing.solve(sk, posing.Pose())[0]), None)

        # Keep only these compact review sheets in Git; full PNGs regenerate locally.
        for name in ("lineup_three_quarter", "turnaround_sheet"):
            portrait(os.path.join(out, name + ".png"), os.path.join(out, name + ".webp"), width=1200, quality=82)

        rig.reset_pose(rig_obj)
        rig_obj.location = (0, 0, 0)
        c_rig.location = (0, 0, 0)
        turn(rig_obj, 0)
        turn(c_rig, 0)
        for o in mine:
            o.hide_render = True
        resolution(1024, 1024)
