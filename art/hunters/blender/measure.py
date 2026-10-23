"""Measure the posed models (hitboxes, heights) and write the asset manifest hunters.json.

All numbers in the manifest are in glTF axes and meters: Y up, the character faces +Z, the feet at y = 0.
Hitboxes follow the duck's hitbox.ts style: a head sphere plus a vertical body capsule per pose.
"""

import bpy
from mathutils import Vector

import hclips
import hp
import hpose

HEAD_PARTS = {"head", "ears", "nose", "eyes", "pupils", "shine", "brows", "mouth", "mustache", "beard", "hair", "glasses"}
BODY_PARTS = {"torso", "vest", "waders", "pelvis", "coat_skirt", "collar"}
LEG_PARTS = {"legs", "boots"}
HAT_PARTS = {"hat"}


def apply(rig, sk, pose):
    M, _ = hpose.solve(sk, pose)
    basis = hpose.to_basis(sk, M)
    for name in sk.order:
        pb = rig.pose.bones[name]
        pb.rotation_mode = "QUATERNION"
        pb.matrix_basis = basis[name]
        s = pose.scale.get(name)
        if s is not None:
            pb.scale = (max(s, 1e-4),) * 3
    bpy.context.view_layer.update()


def reset(rig):
    for pb in rig.pose.bones:
        pb.matrix_basis.identity()
        pb.rotation_quaternion = (1, 0, 0, 0)
        pb.location = (0, 0, 0)
        pb.scale = (1, 1, 1)
    bpy.context.view_layer.update()


def positions(obj):
    dg = bpy.context.evaluated_depsgraph_get()
    ev = obj.evaluated_get(dg)
    m = ev.to_mesh()
    out = [obj.matrix_world @ v.co for v in m.vertices]
    ev.to_mesh_clear()
    return out


def pick(pts, spans, names):
    return [pts[i] for part, a, b in spans if part.name in names for i in range(a, b)]


def pct(values, q):
    v = sorted(values)
    return v[min(len(v) - 1, int(q * (len(v) - 1) + 0.5))]


def hitbox(pts, spans, scale):
    skull = pick(pts, spans, {"head"})
    c = sum(skull, Vector()) / len(skull)
    head_r = sum((p - c).length for p in skull) / len(skull)
    body = pick(pts, spans, BODY_PARTS)
    axis = sum((Vector((p.x, p.y, 0)) for p in body), Vector()) / len(body)
    r = pct([(Vector((p.x, p.y, 0)) - axis).length for p in body], 0.9)
    top = max(p.z for p in body)
    s = scale
    return {
        "headY": round(c.z * s, 3), "headR": round(head_r * s, 3),
        "headX": round(c.x * s, 3), "headZ": round(-c.y * s, 3),
        "bodyLo": round(r * s, 3), "bodyHi": round((top - r * 0.6) * s, 3), "bodyR": round(r * s, 3),
        "bodyX": round(axis.x * s, 3), "bodyZ": round(-axis.y * s, 3),
    }


def hunter(c, sk, ctx, reg, scale):
    obj = c.lods[0]
    poses = {
        "stand": reg["Idle"][0](ctx, 0.0),
        "aim": reg["Aim"][0](ctx, 0.0),
        "run": reg["Run"][0](ctx, 0.15),
    }
    out = {"hitbox": {}}
    for name, pose in poses.items():
        apply(c.rig, sk, pose)
        pts = positions(obj)
        out["hitbox"][name] = hitbox(pts, c.spans, scale)
        if name == "stand":
            out["height_m"] = round(max(p.z for p in pts) * scale, 3)
            skull = pick(pts, c.spans, {"head"})
            out["skull_top_m"] = round(max(p.z for p in skull) * scale, 3)
            hat = pick(pts, c.spans, HAT_PARTS)
            out["hat_top_m"] = round(max(p.z for p in hat) * scale, 3) if hat else None
            ht = c.rig.matrix_world @ c.rig.pose.bones["HeadTop"].head
            out["head_top_node_m"] = round(ht.z * scale, 3)
            xs = [p.x for p in pts]
            ys = [p.y for p in pts]
            out["stand_bounds_m"] = {"width": round((max(xs) - min(xs)) * scale, 3),
                                     "depth": round((max(ys) - min(ys)) * scale, 3)}
        if name == "aim":
            mz = c.rig.matrix_world @ c.rig.pose.bones["Muzzle"].head
            out["muzzle_aim_m"] = [round(mz.x * scale, 3), round(mz.z * scale, 3), round(-mz.y * scale, 3)]
    reset(c.rig)
    return out


def manifest(stats, files):
    """The asset contract as data (see art/hunters/README.md)."""
    reg = hclips.registry()
    clips = {}
    for name, (_fn, frames, loop, layer, extra) in reg.items():
        clips[name] = {"seconds": round(frames / hclips.FPS, 3), "loop": loop, "layer": layer}
        if name in hclips.AUTHORED_SPEED:
            clips[name]["authoredSpeed"] = hclips.AUTHORED_SPEED[name]
        if name in hclips.EVENTS:
            clips[name]["events"] = hclips.EVENTS[name]
        if extra:
            clips[name]["animates"] = list(extra)
    hunters = {}
    for lid, st in stats["hunters"].items():
        hunters[lid] = {
            "file": files[lid], "scale": st["scale"], "triangles": st["triangles"], "glbBytes": st["glb_bytes"],
            "height": st["height_m"], "skullTop": st["skull_top_m"], "hatTop": st["hat_top_m"],
            "headTopNode": st["head_top_node_m"], "hitbox": st["hitbox"], "muzzleAim": st["muzzle_aim_m"],
        }
    return {
        "version": 1,
        "axes": "glTF: Y up, characters face +Z, meters, feet at y = 0 (turn the model to face the sim's -Z like the ducks)",
        "material": "Hunter (one material, 256 px palette texture with nearest filtering; apply the duck toon recipe)",
        "lods": {"nodes": ["LOD0", "LOD1", "LOD2"], "until": list(hp.LOD_DISTANCES),
                 "note": "skinned meshes on one skeleton: show exactly one by camera distance (about 0.6x on phones)"},
        "anims": "hunter_anims.glb",
        "hunters": hunters,
        "clips": clips,
        "dog": stats["dog"]["manifest"],
        "props": {k: v["manifest"] for k, v in stats["props"].items()},
        "attach": stats.get("attach", {}),
        "hiddenNodes": ["FxStars", "FxPoof", "LeftHandProp"],
    }
