"""One-shot build of the Hunt Season melee art: the duck katana and scabbard, the duck's katana clips,
the swing effects, the contract data (melee.json) and the review renders.

Run through the wrapper:  sh qwakk-game/art/melee/build.sh [--no-render] [--quick] [--only NAME]
It rebuilds the classic duck and its rig in memory from art/blender/ (nothing in art/export/ or the
duck's published files is written), so the clips fit duck.glb exactly.
"""

import json
import os
import shutil
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
MELEE = os.path.dirname(HERE)
ART = os.path.dirname(MELEE)
sys.path.insert(0, HERE)
sys.path.insert(1, os.path.join(ART, "blender"))

import bpy  # noqa: E402

import bake  # noqa: E402  (art/blender)
import duck  # noqa: E402
import geo  # noqa: E402
import katana  # noqa: E402
import mclips  # noqa: E402
import mfx  # noqa: E402
import mmeasure  # noqa: E402
import mp  # noqa: E402
import params as P  # noqa: E402
import posing  # noqa: E402
import rig  # noqa: E402

EXPORT = os.path.join(MELEE, "export")
RENDERS = os.path.join(MELEE, "renders")
REPO = os.path.dirname(ART)
MODELS = os.path.join(REPO, "apps", "client", "public", "models")
OUT = os.path.join(MODELS, "melee")
DUCK_GLB = os.path.join(MODELS, "duck.glb")

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
NO_RENDER = "--no-render" in argv
QUICK = "--quick" in argv
ONLY = [argv[i + 1] for i, a in enumerate(argv) if a == "--only" and i + 1 < len(argv)]


def export_material(palette, name):
    mat = bpy.data.materials.new(name)
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


def export_static(path, objs, colors=False):
    select_only(objs)
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True, export_yup=True,
                              export_extras=False, export_animations=False, export_apply=False,
                              export_vertex_color="ACTIVE" if colors else "MATERIAL")


def publish(src, name):
    os.makedirs(OUT, exist_ok=True)
    shutil.copyfile(src, os.path.join(OUT, name))


def build_duck():
    """The classic duck and its rig, exactly as art/blender/build_all.py builds them."""
    duck_obj, ranges, parts = duck.build_duck()
    finger_parts = {p.name: p.finger for p in parts if hasattr(p, "finger")}
    rig_obj, deform = rig.build_armature(finger_parts)
    rig.skin(duck_obj, rig_obj, ranges, finger_parts, deform, body_mode=P.BODY_WEIGHTS)
    return duck_obj, rig_obj


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.preferences.filepaths.save_version = 0
    os.makedirs(EXPORT, exist_ok=True)
    duck_obj, rig_obj = build_duck()
    sk = posing.Skeleton(rig_obj)
    ctx = mclips.MCtx(sk)

    palette = katana.build_palette(os.path.join(EXPORT, "melee_palette.png"))
    material = export_material(palette, "QwakkMelee")
    stats = {}

    # ---- katana and scabbard
    kit = katana.build(material)
    k_objs = [kit["katana"], kit["blade"]] + [kit["empties"][n] for n in ("Grip", "TrailStart", "TrailEnd", "Tip")]
    s_objs = [kit["scabbard"], kit["empties"]["KatanaSeat"]]
    kpath = os.path.join(EXPORT, "katana.glb")
    export_static(kpath, k_objs + s_objs)
    publish(kpath, "katana.glb")
    stats["katana"] = {
        "triangles": {"Katana": geo.triangle_count(kit["katana"]), "Blade": geo.triangle_count(kit["blade"]),
                      "Scabbard": geo.triangle_count(kit["scabbard"])},
        "glb_bytes": os.path.getsize(kpath),
        "length_m": round(mp.BLADE_Z[1] - mp.POMMEL_Z, 3),
    }

    # ---- clips: baked on the classic rig, exported as an armature-only GLB (same bones as duck.glb)
    reg = mclips.registry()
    anim_info = bake.bake_all(rig_obj, sk, ctx, reg)
    apath = os.path.join(EXPORT, "duck_melee_anims.glb")
    bake.export_anims(apath, rig_obj)
    upper = {n for n, v in anim_info.items() if v["layer"] == mclips.UPPER}
    bake.prune_anims(apath, upper, set(sk.subtree("Spine")))
    publish(apath, "duck_melee_anims.glb")
    stats["anims_glb_bytes"] = os.path.getsize(apath)
    stats["clips"] = anim_info

    # ---- effects
    fx, _fx_mat = mfx.build(material)
    fpath = os.path.join(EXPORT, "melee_fx.glb")
    export_static(fpath, list(fx.values()), colors=True)
    publish(fpath, "melee_fx.glb")
    stats["fx"] = {n: geo.triangle_count(o) for n, o in fx.items()}
    stats["fx_glb_bytes"] = os.path.getsize(fpath)

    # ---- contract data
    arcs = mmeasure.arcs(ctx)
    manifest = build_manifest(sk, ctx, anim_info, arcs, stats)
    stats["arcs"] = arcs
    with open(os.path.join(EXPORT, "stats.json"), "w") as f:
        json.dump(stats, f, indent=1, sort_keys=True)
    mpath = os.path.join(EXPORT, "melee.json")
    with open(mpath, "w") as f:
        json.dump(manifest, f, indent=1, sort_keys=True)
    publish(mpath, "melee.json")
    print("STATS", json.dumps({"katana": stats["katana"], "fx": stats["fx"],
                               "ik": {n: v["ik_reach_error_m"] for n, v in anim_info.items()}}))
    print("ARCS", json.dumps({n: a.get("measured") for n, a in arcs.items()}))
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(EXPORT, "melee.blend"))

    if NO_RENDER:
        return
    import mrender  # noqa: E402  (render-only module)
    mrender.run(duck_obj, rig_obj, sk, ctx, kit, fx, palette, RENDERS, QUICK, ONLY, ART)


def build_manifest(sk, ctx, anim_info, arcs, stats):
    attach_k = bake.joint_pose(DUCK_GLB, sk, "RightHand", ctx.attach)
    attach_s = bake.joint_pose(DUCK_GLB, sk, ctx.saya_bone, ctx.saya_local)
    seat = katana.seat_matrix()
    q = seat.to_quaternion()
    # the seat in glTF axes (the exporter maps Blender (x, y, z) to (x, z, -y) on both sides)
    to_g = bake.TO_GLTF
    sg = to_g @ seat @ to_g.inverted()
    qg = sg.to_quaternion()
    spots = katana.spots()
    upper = [b for b in sk.subtree("Spine") if sk.parent.get(b) is not None and b in set(sk.order)]
    clips = {}
    for name, (_fn, frames, loop, layer) in mclips.registry().items():
        c = {"seconds": round(frames / mclips.FPS, 3), "frames": frames, "loop": loop, "layer": layer,
             "flow": mclips.FLOW[name]}
        if name in mclips.EVENTS:
            c["events"] = mclips.EVENTS[name]
        clips[name] = c
    clips["Katana_Run"]["syncWith"] = {"Run_F": 0.367, "note": "same length as Run_F: set its time to the run's normalized time x 0.367"}
    dash = {"distance": mclips.DASH_DISTANCE, "moveStart": mclips.DASH_MOVE[0], "moveEnd": mclips.DASH_MOVE[1],
            "progress": [round(mclips.dash_progress(f / mclips.FPS), 4) for f in range(0, 9)],
            "note": "fraction of the distance covered at each 30 fps frame of Dash (frame 0 to 8); no root motion in the clip"}
    checkpoints = []
    reg = mclips.registry()
    for name, at in (("Katana_Idle", 0.0), ("Slash_1", "impact"), ("Slash_2", "impact"), ("Slash_3", "impact"),
                     ("Heavy_Release", "impact"), ("Ultimate", "flash"), ("Draw", "ready")):
        t = mclips.EVENTS[name][at] if isinstance(at, str) else at
        frame = round(t * mclips.FPS)
        tip, _base, _end = mmeasure.blade_points(ctx, reg[name][0], frame / mclips.FPS,
                                                 upper=reg[name][3] == mclips.UPPER)
        checkpoints.append({"clip": name, "frame": frame, "time": round(frame / mclips.FPS, 4),
                            "tip": mmeasure.to_gltf(tip)})
    return {
        "version": 1,
        "checkpoints": {"note": "the Tip empty's position in the duck's model space at these exact frames, the clip played alone (for tests)",
                        "points": checkpoints},
        "axes": "glTF: Y up, the duck faces +Z, meters, feet at y = 0; angles are degrees from forward, positive to the duck's right",
        "files": {"katana": "katana.glb", "anims": "duck_melee_anims.glb", "fx": "melee_fx.glb"},
        "katana": {
            "nodes": {"Katana": "mesh, origin at the grip (the right fist's center)", "Blade": "mesh, child of Katana",
                      "Grip": "empty at the origin", "TrailStart": "empty on the edge near the guard",
                      "TrailEnd": "empty on the edge near the tip", "Tip": "empty at the point"},
            "points": {k: [round(v.x, 4), round(v.z, 4), round(-v.y, 4)] for k, v in spots.items()},
            "axes": "katana space: blade along +Y, cutting edge toward -Z, flats along X",
            "length": stats["katana"]["length_m"],
            "triangles": stats["katana"]["triangles"],
        },
        "attach": {
            "katana": dict(attach_k, node="RightHand", note="Katana root in the RightHand joint (like weapons/attach.json)"),
            "scabbard": dict(attach_s, node=ctx.saya_bone, note="Scabbard root in this joint; diagonally across the back"),
            "seat": {"node": "KatanaSeat", "position": [round(v, 5) for v in sg.to_translation()],
                     "quaternion": [round(v, 6) for v in (qg.x, qg.y, qg.z, qg.w)],
                     "note": "sheathed: make Katana a child of the KatanaSeat empty with an identity transform (this is the seat's own pose inside Scabbard, for reference)"},
        },
        "clips": clips,
        "upperBones": upper,
        "dash": dash,
        "arcs": arcs,
        "fx": {
            "SlashArc": {"radius": mp.ARC_RADIUS, "degrees": mp.ARC_DEGREES,
                         "note": "flat crescent on the XZ plane centered on +Z; u=0 at the duck's right end, u=1 the bright leading left end; scale by the swing reach, mirror x for left-to-right, tilt for diagonals"},
            "Shockwave": {"radius": mp.SHOCK_RADIUS, "note": "ground ring with a short wall; scale up from the impact, fade by time"},
            "EliteRing": {"radius": mp.ELITE_RADIUS, "note": "ground ring under an elite enemy; spin slowly"},
            "Feather": {"height": 0.30, "note": "XP pickup, toon material, origin at its middle; bob and spin it"},
            "material": "MeleeFx: vertex colors (COLOR_0) hold the glow ramp; draw additive, depthWrite off, double sided",
            "triangles": stats["fx"],
        },
    }


main()
