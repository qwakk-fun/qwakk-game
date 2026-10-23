"""One-shot build of the duck hunters (raid enemies): meshes, rig, clips, the dog, the props, GLB exports,
the asset manifest and the review renders.

Run through the wrapper:  sh qwakk-game/art/hunters/build.sh [--no-render] [--quick] [--only NAME]
"""

import json
import os
import shutil
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import bpy  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

import assemble  # noqa: E402
import dog  # noqa: E402
import hbake  # noqa: E402
import hclips  # noqa: E402
import hp  # noqa: E402
import hpose  # noqa: E402
import looks  # noqa: E402
import measure  # noqa: E402
import mesh  # noqa: E402
import props  # noqa: E402

ART = os.path.dirname(HERE)
EXPORT = os.path.join(ART, "export")
RENDERS = os.path.join(ART, "renders")
REPO = os.path.dirname(os.path.dirname(ART))
MODELS = os.path.join(REPO, "apps", "client", "public", "models")
OUT = os.path.join(MODELS, "hunters")

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
NO_RENDER = "--no-render" in argv
QUICK = "--quick" in argv
ONLY = [argv[i + 1] for i, a in enumerate(argv) if a == "--only" and i + 1 < len(argv)]

HIDDEN = ("FxStars", "FxPoof", "LeftHandProp")
DECOY_IN_HAND = (0.0, 0.0, -0.055)    # the decoy's middle under the left fist (rest pose, palm down)
FILES = {lid: f"hunter_{lid}.glb" for lid in looks.LOOKS}


def publish(src, name):
    os.makedirs(OUT, exist_ok=True)
    shutil.copyfile(src, os.path.join(OUT, name))


def export_hunter(c, path, root_scale=None):
    """hunter_<id>.glb: armature `HunterRig` with the skinned meshes LOD0, LOD1, LOD2."""
    saved = (c.rig.name, [o.name for o in c.lods], [o.data.name for o in c.lods])
    c.rig.name = "HunterRig"
    for k, o in enumerate(c.lods):
        o.name = f"LOD{k}"
        o.data.name = f"Hunter_LOD{k}"
    try:
        hbake.export_model(path, [c.rig] + c.lods)
    finally:
        c.rig.name = saved[0]
        for o, n, dn in zip(c.lods, saved[1], saved[2]):
            o.name, o.data.name = n, dn
    hbake.postprocess(path, hidden=HIDDEN, root_scale=root_scale)


def attach_poses(base, the_dog):
    """Where hunter_fx.glb's Stars and Poof and decoy.glb go in the joints that carry them."""
    def at(rig, bone, offset=(0, 0, 0)):
        return Matrix.Translation(rig.matrix_world @ rig.data.bones[bone].head_local + Vector(offset))

    hglb = os.path.join(EXPORT, FILES[base.id])
    dglb = os.path.join(EXPORT, "dog.glb")
    hidden = HIDDEN
    return {
        "hunter": {
            "Stars": hbake.attach_pose(hglb, "FxStars", at(base.rig, "FxStars"), hidden),
            "Poof": hbake.attach_pose(hglb, "FxPoof", at(base.rig, "FxPoof"), hidden),
            "Decoy": hbake.attach_pose(hglb, "LeftHandProp", at(base.rig, "LeftHandProp", DECOY_IN_HAND), hidden),
        },
        "dog": {
            "Stars": hbake.attach_pose(dglb, "FxStars", at(the_dog.rig, "FxStars"), hidden),
            "Poof": hbake.attach_pose(dglb, "FxPoof", at(the_dog.rig, "FxPoof"), hidden),
        },
    }


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.preferences.filepaths.save_version = 0
    os.makedirs(EXPORT, exist_ok=True)
    palette = mesh.build_palette(os.path.join(EXPORT, "hunter_palette.png"))
    material = assemble.export_material(palette, "Hunter")
    chars = assemble.build_all_hunters(material)
    stats = {"hunters": {}, "clips": {}}

    # ---- clips, baked on the rifleman's rig (every look has the same bones and bind pose; only Muzzle differs)
    base = chars["rifleman"]
    sk = hpose.Skeleton(base.rig, hclips.CHAINS)
    ctx = hclips.Ctx(sk)
    reg = hclips.registry()
    stats["clips"] = hbake.bake_all(base.rig, sk, ctx, reg, hclips.SPECIAL, hclips.STATIC)
    anims = os.path.join(EXPORT, "hunter_anims.glb")
    name = base.rig.name
    base.rig.name = "HunterRig"
    hbake.export_model(anims, [base.rig], animations=True)
    base.rig.name = name
    hbake.postprocess(anims, hidden=HIDDEN, rules=hbake.track_rules(sk, reg, hclips.SPECIAL, hclips.STATIC))
    hbake.drop_actions(base.rig)
    publish(anims, "hunter_anims.glb")
    stats["anims_glb_bytes"] = os.path.getsize(anims)

    # ---- hunter models
    for lid, c in chars.items():
        path = os.path.join(EXPORT, FILES[lid])
        boss = looks.LOOKS[lid].get("boss")
        export_hunter(c, path, root_scale=hp.BOSS_SCALE if boss else None)
        publish(path, FILES[lid])
        c.info["scale"] = hp.BOSS_SCALE if boss else 1.0
        st = dict(c.info)
        st["glb_bytes"] = os.path.getsize(path)
        st["scale"] = round(hp.BOSS_SCALE, 6) if boss else 1.0
        st.update(measure.hunter(c, sk, ctx, reg, st["scale"]))
        stats["hunters"][lid] = st

    # ---- the dog and the props
    dog_info = dog.build_and_export(material, os.path.join(EXPORT, "dog.glb"))
    the_dog = dog_info.pop("obj")
    stats["dog"] = dog_info
    publish(os.path.join(EXPORT, "dog.glb"), "dog.glb")
    kit = props.Props(material)
    stats["props"] = kit.export(EXPORT)
    for pinfo in stats["props"].values():
        publish(os.path.join(EXPORT, pinfo["file"]), pinfo["file"])
    stats["attach"] = attach_poses(base, the_dog)

    manifest = measure.manifest(stats, FILES)
    with open(os.path.join(EXPORT, "stats.json"), "w") as f:
        json.dump(stats, f, indent=1, sort_keys=True)
    with open(os.path.join(EXPORT, "hunters.json"), "w") as f:
        json.dump(manifest, f, indent=1, sort_keys=True)
    publish(os.path.join(EXPORT, "hunters.json"), "hunters.json")
    print("STATS", json.dumps({k: v.get("triangles") for k, v in stats["hunters"].items()}))
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(EXPORT, "hunters.blend"))

    if NO_RENDER:
        return
    import hrender  # noqa: E402  (render-only module)
    hrender.run(chars, sk, ctx, reg, palette, the_dog, kit, stats["attach"], RENDERS, QUICK, ONLY, MODELS)


main()
