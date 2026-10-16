"""One-shot build of the Qwakk duck: mesh, palette, rig, skin, GLB exports and review renders.

Run from anywhere:
  /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P qwakk-game/art/blender/build_all.py
Options after `--`:
  --no-render     build and export only
  --quick         fewer render samples, for fast iteration
  --only NAME     render only shots whose name contains NAME (repeatable):
                  turnaround, face, size, pose, beanie, weapon, hold, tps, anim
  --no-anim       skip baking and exporting the animation clips (faster mesh iteration)
"""

import json
import math
import os
import shutil
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import bpy  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

import bake  # noqa: E402
import clips  # noqa: E402
import duck  # noqa: E402
import geo  # noqa: E402
import holds  # noqa: E402
import params as P  # noqa: E402
import posing  # noqa: E402
import reloads  # noqa: E402
import render  # noqa: E402
import rig  # noqa: E402
import weapons  # noqa: E402

ART = os.path.dirname(HERE)
EXPORT = os.path.join(ART, "export")
RENDERS = os.path.join(ART, "renders")
CLIENT_MODELS = os.path.join(os.path.dirname(ART), "apps", "client", "public", "models")
CLIENT_MODEL = os.path.join(CLIENT_MODELS, "duck.glb")

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
NO_RENDER = "--no-render" in argv
QUICK = "--quick" in argv
NO_ANIM = "--no-anim" in argv
ONLY = [argv[i + 1] for i, a in enumerate(argv) if a == "--only" and i + 1 < len(argv)]
if "--only" in argv and not ONLY:
    sys.exit("usage: --only NAME")


def export_material(palette):
    """The material that ships in the GLB: palette texture, matte. The game swaps in its toon shader."""
    mat = bpy.data.materials.new("QwakkDuck")
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes.get("Principled BSDF")
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = palette
    tex.interpolation = "Closest"
    nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 1.0
    bsdf.inputs["Metallic"].default_value = 0.0
    return mat


def select_only(objs):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]


def export_glb(path, objs):
    select_only(objs)
    bpy.ops.export_scene.gltf(
        filepath=path, export_format="GLB", use_selection=True, export_skins=True,
        export_def_bones=True, export_animations=False, export_apply=False, export_yup=True,
        export_extras=False, export_morph=False,
    )


def build():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    os.makedirs(EXPORT, exist_ok=True)
    os.makedirs(RENDERS, exist_ok=True)
    palette = duck.build_palette(os.path.join(EXPORT, "palette.png"))

    duck_obj, ranges, parts = duck.build_duck()
    finger_parts = {p.name: p.finger for p in parts if hasattr(p, "finger")}
    rig_obj, deform = rig.build_armature(finger_parts)
    stats = rig.skin(duck_obj, rig_obj, ranges, finger_parts, deform, body_mode=P.BODY_WEIGHTS)
    duck_obj.data.materials.append(export_material(palette))

    beanie = duck.build_beanie()
    beanie.data.materials.append(duck_obj.data.materials[0])
    return palette, duck_obj, rig_obj, beanie, deform, stats


def report(duck_obj, rig_obj, beanie, deform, stats):
    info = {
        "duck_triangles": geo.triangle_count(duck_obj),
        "duck_vertices": len(duck_obj.data.vertices),
        "beanie_triangles": geo.triangle_count(beanie),
        "bones_total": len(rig_obj.data.bones),
        "bones_deform": len(deform),
        "weights": stats,
    }
    outline_idx = duck_obj.vertex_groups["outline"].index
    max_influences = max(len([g for g in v.groups if g.weight > 0 and g.group != outline_idx]) for v in duck_obj.data.vertices)
    info["max_influences"] = max_influences
    zs = [(duck_obj.matrix_world @ v.co).z for v in duck_obj.data.vertices]
    info["height_m"] = round(max(zs) - min(zs), 3)
    return info


def publish(src, *rel):
    """Copy an export into apps/client/public/models (only the files the asset contract names)."""
    dst = os.path.join(CLIENT_MODELS, *rel)
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    shutil.copyfile(src, dst)


def main():
    palette, duck_obj, rig_obj, beanie, deform, stats = build()

    # ---- exports (rest pose)
    duck_glb = os.path.join(EXPORT, "duck.glb")
    export_glb(duck_glb, [rig_obj, duck_obj])
    beanie_glb = os.path.join(EXPORT, "acc_beanie.glb")
    export_glb(beanie_glb, [beanie])
    publish(duck_glb, "duck.glb")
    info = report(duck_obj, rig_obj, beanie, deform, stats)
    info["duck_glb_bytes"] = os.path.getsize(duck_glb)
    info["beanie_glb_bytes"] = os.path.getsize(beanie_glb)

    # ---- weapons: GLBs with Muzzle/Grip/Support/Eject empties, plus the RightHand attach offsets
    os.makedirs(os.path.join(EXPORT, "weapons"), exist_ok=True)
    guns = weapons.build_all(duck_obj.data.materials[0])
    sk = posing.Skeleton(rig_obj)
    attach = bake.attach_json(duck_glb, sk, holds)
    attach_doc = {"space": "RightHand joint local space of duck.glb (glTF axes, meters)", "rifle": attach, "pistol": attach}
    for kind, (gun, empties) in guns.items():
        path = os.path.join(EXPORT, "weapons", kind + ".glb")
        weapons.contract_names(guns, kind)
        select_only([gun] + empties)
        bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True, export_extras=False)
        publish(path, "weapons", kind + ".glb")
        info[kind + "_triangles"] = geo.triangle_count(gun) + geo.triangle_count(weapons.mag_of(empties))
        info[kind + "_glb_bytes"] = os.path.getsize(path)
        holds.SUPPORT_POINT[kind] = next(e.location.copy() for e in empties if e["contract_name"] == "Support")
        gun.hide_render = True
    # Reload timeline and the magazine's pose in the left fist (LeftHand joint space), for the engine.
    attach_doc["reload"] = {
        kind: {"seconds": reloads.RELOAD_SECONDS[kind], **reloads.MAG_EVENTS[kind],
               "magInHand": bake.joint_pose(duck_glb, sk, "LeftHand", holds.mag_in_hand(sk, kind))}
        for kind in reloads.RELOAD_SECONDS
    }
    attach_path = os.path.join(EXPORT, "weapons", "attach.json")
    with open(attach_path, "w") as f:
        json.dump(attach_doc, f, indent=2)
    publish(attach_path, "weapons", "attach.json")

    # ---- animation clips baked from code, exported as an armature-only GLB
    ctx = clips.Ctx(sk)
    if not NO_ANIM:
        anim_info = bake.bake_all(rig_obj, sk, ctx, clips.registry())
        anims_glb = os.path.join(EXPORT, "duck_anims.glb")
        bake.export_anims(anims_glb, rig_obj)
        upper_clips = {n for n, v in anim_info.items() if v["layer"] == clips.UPPER}
        bake.prune_anims(anims_glb, upper_clips, set(sk.subtree("Spine")))
        publish(anims_glb, "duck_anims.glb")
        info["anims_glb_bytes"] = os.path.getsize(anims_glb)
        info["clips"] = anim_info
    with open(os.path.join(EXPORT, "stats.json"), "w") as f:
        json.dump(info, f, indent=2)
    print("STATS", json.dumps({k: v for k, v in info.items() if k != "clips"}))

    # ---- beanie rides on the Head bone (cosmetic head slot)
    world = beanie.matrix_world.copy()
    beanie.parent = rig_obj
    beanie.parent_type = "BONE"
    beanie.parent_bone = "Head"
    bpy.context.view_layer.update()
    beanie.matrix_world = world
    bpy.context.view_layer.update()
    bpy.context.preferences.filepaths.save_version = 0   # no duck.blend1 backups
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(EXPORT, "duck.blend"))

    if NO_RENDER:
        return
    shots(palette, duck_obj, rig_obj, beanie)
    import previews  # noqa: E402  (render-only module)
    previews.run(wanted, QUICK, RENDERS, rig_obj, sk, ctx, guns, duck_obj)


def wanted(name):
    return not ONLY or any(o in name for o in ONLY)


def shots(palette, duck_obj, rig_obj, beanie):
    render.setup_scene(samples=16 if QUICK else 48)
    toon = render.toon_material(palette)
    duck_obj.data.materials[0] = toon
    beanie.data.materials[0] = toon
    outline_mat = render.outline_material()
    ng = render.outline_node_group(outline_mat)
    render.add_outline(duck_obj, rig_obj, ng)
    beanie_hull = render.add_outline(beanie, None, ng)
    render.ground_disc(radius=1.05)
    beanie.hide_render = beanie_hull.hide_render = True

    target = (0, 0, 0.86)
    relaxed = rig.RELAXED + rig.fingers("Left", -12, -8) + rig.fingers("Right", -12, -8)

    def turn(deg):
        rig_obj.rotation_euler = (0, 0, math.radians(deg))
        bpy.context.view_layer.update()

    out = []
    views = [("front", 0), ("three_quarter", -38), ("side", -90), ("back", 180)]
    rig.apply_pose(rig_obj, relaxed)
    for name, deg in views:
        if not wanted("turnaround"):
            break
        turn(deg)
        cam = render.frame_camera("cam_" + name, target, 2.0, pitch_deg=7)
        path = os.path.join(RENDERS, f"turnaround_{name}.png")
        render.render(cam, path)
        out.append(path)
    if wanted("turnaround"):
        sheet = os.path.join(RENDERS, "turnaround_sheet.png")
        files = [os.path.join(RENDERS, f"turnaround_{n}.png") for n, _ in views]
        cmd = ["ffmpeg", "-y", "-loglevel", "error"] + sum([["-i", f] for f in files], []) + [
            "-filter_complex", "hstack=inputs=4", sheet]
        if shutil.which("ffmpeg"):
            subprocess.run(cmd, check=False)
        else:
            print("ffmpeg not found, skipping turnaround_sheet.png")

    if wanted("face"):
        turn(-28)
        cam = render.frame_camera("cam_face", (0, -0.06, 1.34), 1.05, yaw_deg=0, pitch_deg=5, lens=90)
        render.render(cam, os.path.join(RENDERS, "face_closeup.png"))
        rig.apply_pose(rig_obj, relaxed + [("Jaw", (1, 0, 0), 30)])
        turn(-28)
        render.render(cam, os.path.join(RENDERS, "face_quack.png"))
        rig.apply_pose(rig_obj, relaxed)

    if wanted("size"):
        size_check(rig_obj, target)

    if wanted("pose"):
        turn(-30)
        rig.apply_pose(rig_obj, rig.ARMS_UP + rig.fingers("Left", -20, -10) + rig.fingers("Right", -20, -10))
        cam = render.frame_camera("cam_pose", (0, 0, 1.0), 2.4, pitch_deg=7)
        render.render(cam, os.path.join(RENDERS, "pose_arms_up.png"))
        turn(-60)
        rig.apply_pose(rig_obj, rig.RUN + rig.fingers("Left", -35, -20) + rig.fingers("Right", -35, -20))
        rig_obj.location = (0, 0, 0.06)
        cam = render.frame_camera("cam_run", (0, 0, 0.9), 2.1, pitch_deg=7)
        render.render(cam, os.path.join(RENDERS, "pose_run.png"))
        rig_obj.location = (0, 0, 0)
        rig.apply_pose(rig_obj, relaxed)

    if wanted("beanie"):
        beanie.hide_render = beanie_hull.hide_render = False
        turn(-32)
        cam = render.frame_camera("cam_beanie", (0, 0, 0.9), 2.0, pitch_deg=7)
        render.render(cam, os.path.join(RENDERS, "accessory_beanie.png"))
        beanie.hide_render = beanie_hull.hide_render = True
    turn(0)


def size_check(rig_obj, target):
    """The duck next to a 1.8 m reference box, side by side, with labels."""
    box_mat = render.flat_material("RefBox", "#3a3e4a")
    bpy.ops.mesh.primitive_cube_add(size=1, location=(0.95, 0, 0.9))
    box = bpy.context.active_object
    box.scale = (0.45, 0.28, 1.8)
    box.data.materials.append(box_mat)
    bpy.ops.object.transform_apply(scale=True)
    label_mat = render.flat_material("Label", "#e8e8ea")
    yellow = render.flat_material("LabelYellow", P.PALETTE["yellow"])

    def label(text, loc, mat, size=0.085):
        curve = bpy.data.curves.new("txt_" + text, "FONT")
        curve.body = text
        curve.size = size
        curve.align_x = "CENTER"
        t = bpy.data.objects.new("txt_" + text, curve)
        bpy.context.scene.collection.objects.link(t)
        t.location = loc
        t.rotation_euler = (math.radians(90), 0, 0)
        t.data.materials.append(mat)
        return t

    label("1.8 m", (0.95, -0.2, 1.86), label_mat)
    # measure the duck in the current pose
    duck = bpy.data.objects["QwakkDuck"]
    dg = bpy.context.evaluated_depsgraph_get()
    ev = duck.evaluated_get(dg)
    zs = [(ev.matrix_world @ v.co).z for v in ev.to_mesh().vertices]
    ev.to_mesh_clear()
    h = max(zs) - min(min(zs), 0.0)
    label(f"duck {h:.2f} m", (0.0, -0.45, max(zs) + 0.06), yellow)
    rig_obj.rotation_euler = (0, 0, math.radians(-20))
    bpy.context.view_layer.update()
    cam = render.frame_camera("cam_size", (0.45, 0, 0.98), 2.35, pitch_deg=4, lens=70)
    render.render(cam, os.path.join(RENDERS, "size_check.png"))
    for o in [box] + [o for o in bpy.data.objects if o.name.startswith("txt_")]:
        bpy.data.objects.remove(o)


main()
