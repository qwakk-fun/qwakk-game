"""Bake code-authored clips into Blender actions, export GLBs, and post-process them (track pruning,
hidden effect nodes at scale 0, the boss Root scale)."""

import json
import struct

import bpy
from mathutils import Matrix, Quaternion, Vector

import hpose

FPS = 30
SCALE_BONES = ("FxStars", "FxPoof", "LeftHandProp")     # hidden (node scale 0) until a clip scales them up


def bake_all(rig_obj, sk, ctx, registry, special, static, upper_root="Spine", layer_upper="upper", root_child="Hips"):
    """registry: name -> (fn, frames, loop, layer, special bones animated). Returns per-clip info."""
    scene = bpy.context.scene
    scene.render.fps = FPS
    rig_obj.animation_data_create()
    ad = rig_obj.animation_data
    upper = set(sk.subtree(upper_root))
    info = {}
    for name, (fn, frames, loop, layer, extra) in registry.items():
        action = bpy.data.actions.new(name)
        action.use_fake_user = True
        ad.action = action
        body = [b for b in sk.order if b not in special and b not in static and (layer != layer_upper or b in upper)]
        moving = list(extra)
        prev = {}
        worst = 0.0
        for f in range(frames + 1):
            pose = fn(ctx, f / FPS)
            M, errors = hpose.solve(sk, pose)
            worst = max([worst] + [abs(e) for e in errors.values()])
            basis = hpose.to_basis(sk, M)
            for b in body + moving:
                pb = rig_obj.pose.bones[b]
                pb.rotation_mode = "QUATERNION"
                q = basis[b].to_quaternion()
                if b in prev:
                    q.make_compatible(prev[b])
                prev[b] = q
                pb.rotation_quaternion = q
                pb.keyframe_insert("rotation_quaternion", frame=f, group=b)
                if b == root_child or b in moving:      # the Hips (moved by every full-body clip) and the special bones
                    pb.location = basis[b].to_translation()
                    pb.keyframe_insert("location", frame=f, group=b)
                if b in moving and b in SCALE_BONES:
                    s = pose.scale.get(b, 0.0)
                    pb.scale = (s, s, s)
                    pb.keyframe_insert("scale", frame=f, group=b)
        action.use_frame_range = True
        action.frame_start, action.frame_end = 0, frames
        track = ad.nla_tracks.new()
        track.name = name
        track.strips.new(name, 0, action)
        track.mute = True
        ad.action = None
        info[name] = {"seconds": round(frames / FPS, 3), "frames": frames, "loop": loop, "layer": layer,
                      "animates": sorted(set(extra)), "ik_reach_error_m": round(worst, 4)}
    for pb in rig_obj.pose.bones:
        pb.rotation_quaternion = Quaternion()
        pb.location = Vector()
        pb.scale = (1, 1, 1)
    return info


def track_rules(sk, registry, special, static, upper_root="Spine", root_child="Hips", layer_upper="upper"):
    """Which (node, path) channels each clip keeps."""
    upper = set(sk.subtree(upper_root))
    rules = {}
    for name, (_fn, _frames, _loop, layer, extra) in registry.items():
        keep = set()
        for b in sk.order:
            if b in static or (b in special and b not in extra):
                continue
            if layer == layer_upper and b not in upper and b not in extra:
                continue
            keep.add((b, "rotation"))
            if b == root_child and layer != layer_upper:
                keep.add((b, "translation"))
            if b in extra:
                keep.add((b, "translation"))
                if b in SCALE_BONES:
                    keep.add((b, "scale"))
        rules[name] = keep
    return rules


# ----------------------------------------------------------------- export


def select_only(objs):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]


def export_model(path, objs, animations=False):
    select_only(objs)
    bpy.ops.export_scene.gltf(
        filepath=path, export_format="GLB", use_selection=True, export_skins=True, export_def_bones=True,
        export_animations=animations, export_animation_mode="ACTIONS", export_force_sampling=True,
        export_frame_step=1, export_anim_slide_to_zero=True, export_optimize_animation_size=False,
        export_reset_pose_bones=True, export_apply=False, export_yup=True, export_extras=False, export_morph=False,
    )


def export_static(path, objs):
    select_only(objs)
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True, export_apply=True,
                              export_yup=True, export_extras=False, export_animations=False)


# ----------------------------------------------------------------- GLB post-processing


def read_glb(path):
    with open(path, "rb") as f:
        data = f.read()
    jlen = struct.unpack("<I", data[12:16])[0]
    gltf = json.loads(data[20:20 + jlen])
    off = 20 + jlen
    blen = struct.unpack("<I", data[off:off + 4])[0] if off < len(data) else 0
    return gltf, data[off + 8:off + 8 + blen]


def write_glb(path, gltf, binary):
    js = json.dumps(gltf, separators=(",", ":")).encode()
    js += b" " * (-len(js) % 4)
    binary += b"\0" * (-len(binary) % 4)
    total = 12 + 8 + len(js) + 8 + len(binary)
    with open(path, "wb") as f:
        f.write(struct.pack("<III", 0x46546C67, 2, total))
        f.write(struct.pack("<II", len(js), 0x4E4F534A) + js)
        f.write(struct.pack("<II", len(binary), 0x004E4942) + binary)


def compact(gltf, binary):
    """Drop unreferenced accessors and buffer views, repack the binary chunk."""
    used = set()
    for mesh in gltf.get("meshes", []):
        for prim in mesh["primitives"]:
            used.update(prim["attributes"].values())
            if "indices" in prim:
                used.add(prim["indices"])
    for skin in gltf.get("skins", []):
        if "inverseBindMatrices" in skin:
            used.add(skin["inverseBindMatrices"])
    for anim in gltf.get("animations", []):
        for s in anim["samplers"]:
            used.update((s["input"], s["output"]))
    acc_map = {old: new for new, old in enumerate(sorted(used))}
    accessors = [gltf["accessors"][old] for old in sorted(used)]
    views_used = sorted({a["bufferView"] for a in accessors if "bufferView" in a}
                        | {img["bufferView"] for img in gltf.get("images", []) if "bufferView" in img})
    view_map, views, out = {}, [], bytearray()
    for old in views_used:
        v = dict(gltf["bufferViews"][old])
        start = v.get("byteOffset", 0)
        chunk = binary[start:start + v["byteLength"]]
        out += b"\0" * (-len(out) % 4)
        v["byteOffset"] = len(out)
        out += chunk
        view_map[old] = len(views)
        views.append(v)
    for a in accessors:
        if "bufferView" in a:
            a["bufferView"] = view_map[a["bufferView"]]
    for img in gltf.get("images", []):
        if "bufferView" in img:
            img["bufferView"] = view_map[img["bufferView"]]
    for mesh in gltf.get("meshes", []):
        for prim in mesh["primitives"]:
            prim["attributes"] = {k: acc_map[v] for k, v in prim["attributes"].items()}
            if "indices" in prim:
                prim["indices"] = acc_map[prim["indices"]]
    for skin in gltf.get("skins", []):
        if "inverseBindMatrices" in skin:
            skin["inverseBindMatrices"] = acc_map[skin["inverseBindMatrices"]]
    for anim in gltf.get("animations", []):
        for s in anim["samplers"]:
            s["input"], s["output"] = acc_map[s["input"]], acc_map[s["output"]]
    gltf["accessors"], gltf["bufferViews"] = accessors, views
    gltf["buffers"] = [{"byteLength": len(out)}]
    return gltf, bytes(out)


def postprocess(path, hidden=(), root_scale=None, rules=None, rename=None):
    """Hidden nodes get scale 0, the Root node an optional uniform scale, animation channels are pruned by
    `rules` (clip -> {(node, path)}), nodes renamed by `rename` (old -> new)."""
    gltf, binary = read_glb(path)
    nodes = gltf["nodes"]
    for n in nodes:
        if rename and n.get("name") in rename:
            n["name"] = rename[n["name"]]
    for n in nodes:
        if n.get("name") in hidden:
            n["scale"] = [0.0, 0.0, 0.0]
        if root_scale and n.get("name") == "Root":
            n["scale"] = [root_scale] * 3
    if rules is not None:
        names = [n.get("name") for n in nodes]
        for anim in gltf.get("animations", []):
            keep = rules[anim["name"]]
            chans = [c for c in anim["channels"] if (names[c["target"]["node"]], c["target"]["path"]) in keep]
            samplers, remap = [], {}
            for c in chans:
                s = c["sampler"]
                if s not in remap:
                    remap[s] = len(samplers)
                    samplers.append(anim["samplers"][s])
                c["sampler"] = remap[s]
            anim["channels"], anim["samplers"] = chans, samplers
    gltf.pop("extras", None)
    gltf, binary = compact(gltf, binary)
    write_glb(path, gltf, binary)
    return gltf


# ----------------------------------------------------------------- attach poses for props riding on joints

TO_GLTF = Matrix(((1, 0, 0, 0), (0, 0, 1, 0), (0, -1, 0, 0), (0, 0, 0, 1)))


def node_globals(gltf, unit_scale=()):
    """Global 4x4 (glTF space) of every node by name; nodes in `unit_scale` count as unscaled."""
    nodes = gltf["nodes"]
    parent = {}
    for i, n in enumerate(nodes):
        for c in n.get("children", []):
            parent[c] = i

    def local(n):
        t = Vector(n.get("translation", (0, 0, 0)))
        x, y, z, w = n.get("rotation", (0, 0, 0, 1))
        s = (1, 1, 1) if n.get("name") in unit_scale else n.get("scale", (1, 1, 1))
        m = Quaternion((w, x, y, z)).to_matrix().to_4x4()
        for k in range(3):
            m.col[k] *= s[k]
        m.translation = t
        return m

    out = {}
    for i, n in enumerate(nodes):
        m = local(n)
        j = i
        while j in parent:
            j = parent[j]
            m = local(nodes[j]) @ m
        out[n.get("name", str(i))] = m
    return out


def attach_pose(glb_path, node, world_blender, unit_scale=()):
    """Where a prop goes in a joint's local space: {position, quaternion [x, y, z, w]} (glTF axes).
    `world_blender` is the prop's world matrix in Blender space at the rest pose."""
    gltf, _ = read_glb(glb_path)
    g = node_globals(gltf, unit_scale)[node]
    want = TO_GLTF @ world_blender @ TO_GLTF.inverted()
    local = g.inverted() @ want
    q = local.to_quaternion()
    t = local.to_translation()
    return {"node": node, "position": [round(v, 5) for v in t],
            "quaternion": [round(v, 6) for v in (q.x, q.y, q.z, q.w)]}


def export_renamed(path, renames, static=False, animations=False):
    """Export objects under temporary contract names: renames = [(object, name)]."""
    saved = [(o, o.name) for o, _ in renames]
    for o, n in renames:
        o.name = n
        if o.name != n:
            raise RuntimeError(f"name {n} is taken")
    try:
        objs = [o for o, _ in renames]
        if static:
            export_static(path, objs)
        else:
            export_model(path, objs, animations=animations)
    finally:
        for o, n in saved:
            o.name = n


def drop_actions(rig):
    """Remove a rig's baked actions once exported (renders pose the rig from code)."""
    ad = rig.animation_data
    for tr in list(ad.nla_tracks):
        act = tr.strips[0].action if tr.strips else None
        ad.nla_tracks.remove(tr)
        if act:
            bpy.data.actions.remove(act)
