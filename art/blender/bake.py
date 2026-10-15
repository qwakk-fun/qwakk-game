"""Bake the code-authored clips into Blender actions and export the animation GLB."""

import json
import struct

import bpy
from mathutils import Matrix, Quaternion, Vector

import clips
import posing

# Blender (Z up, -Y forward) to glTF (Y up, +Z forward)
TO_GLTF = Matrix(((1, 0, 0, 0), (0, 0, 1, 0), (0, -1, 0, 0), (0, 0, 0, 1)))


def apply_basis(rig_obj, sk, basis, bones=None):
    for name in bones or sk.order:
        pb = rig_obj.pose.bones[name]
        pb.rotation_mode = "QUATERNION"
        pb.rotation_quaternion = basis[name].to_quaternion()
        pb.location = basis[name].to_translation() if name == "Hips" else Vector()


def bake_all(rig_obj, sk, ctx, registry):
    scene = bpy.context.scene
    scene.render.fps = clips.FPS
    rig_obj.animation_data_create()
    ad = rig_obj.animation_data
    upper = set(sk.subtree("Spine"))
    deform = [n for n in sk.order if rig_obj.data.bones[n].use_deform]
    info = {}
    for name, (fn, frames, loop, layer) in registry.items():
        action = bpy.data.actions.new(name)
        action.use_fake_user = True
        ad.action = action
        bones = [b for b in deform if layer == clips.FULL or b in upper]
        prev = {}
        worst = 0.0
        for f in range(frames + 1):
            pose = fn(ctx, f / clips.FPS)
            M, errors = posing.solve(sk, pose)
            worst = max([worst] + [abs(e) for e in errors.values()])
            basis = posing.to_basis(sk, M)
            for b in bones:
                pb = rig_obj.pose.bones[b]
                pb.rotation_mode = "QUATERNION"
                q = basis[b].to_quaternion()
                if b in prev:
                    q.make_compatible(prev[b])
                prev[b] = q
                pb.rotation_quaternion = q
                pb.keyframe_insert("rotation_quaternion", frame=f, group=b)
                if b == "Hips":
                    pb.location = basis[b].to_translation()
                    pb.keyframe_insert("location", frame=f, group=b)
        action.use_frame_range = True
        action.frame_start, action.frame_end = 0, frames
        action["qwakk_loop"] = loop
        track = ad.nla_tracks.new()
        track.name = name
        track.strips.new(name, 0, action)
        track.mute = True
        ad.action = None
        info[name] = {"seconds": round(frames / clips.FPS, 3), "frames": frames, "loop": loop, "layer": layer,
                      "ik_reach_error_m": round(worst, 4)}
    for pb in rig_obj.pose.bones:
        pb.rotation_quaternion = Quaternion()
        pb.location = Vector()
    return info


def export_anims(path, rig_obj):
    bpy.ops.object.select_all(action="DESELECT")
    rig_obj.select_set(True)
    bpy.context.view_layer.objects.active = rig_obj
    bpy.ops.export_scene.gltf(
        filepath=path, export_format="GLB", use_selection=True, export_def_bones=True,
        export_animations=True, export_animation_mode="ACTIONS", export_force_sampling=True,
        export_frame_step=1, export_anim_slide_to_zero=True, export_optimize_animation_size=False,
        export_reset_pose_bones=True, export_skins=True, export_extras=False,
    )


# ----------------------------------------------------------------- reading GLBs back


def read_glb(path):
    with open(path, "rb") as f:
        data = f.read()
    length = struct.unpack("<I", data[12:16])[0]
    return json.loads(data[20:20 + length])


def node_globals(gltf):
    """Global 4x4 (glTF space) of every node in the default scene, by node name."""
    nodes = gltf["nodes"]
    parent = {}
    for i, n in enumerate(nodes):
        for c in n.get("children", []):
            parent[c] = i

    def local(n):
        if "matrix" in n:
            m = n["matrix"]
            return Matrix([m[0:4], m[4:8], m[8:12], m[12:16]]).transposed()
        t = Vector(n.get("translation", (0, 0, 0)))
        x, y, z, w = n.get("rotation", (0, 0, 0, 1))
        s = n.get("scale", (1, 1, 1))
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


def attach_json(duck_glb, sk, holds):
    """Weapon pose in RightHand joint space, computed from the exported joint transforms."""
    g = node_globals(read_glb(duck_glb))
    hand = g["RightHand"]
    rest_grip = sk.rest["RightHand"] @ holds.attach(sk, "Right")
    want = TO_GLTF @ rest_grip @ TO_GLTF.inverted()
    local = hand.inverted() @ want
    q = local.to_quaternion()
    t = local.to_translation()
    return {"position": [round(v, 5) for v in t], "quaternion": [round(v, 6) for v in (q.x, q.y, q.z, q.w)]}


def write_glb(path, gltf, binary):
    js = json.dumps(gltf, separators=(",", ":")).encode()
    js += b" " * (-len(js) % 4)
    binary += b"\0" * (-len(binary) % 4)
    total = 12 + 8 + len(js) + 8 + len(binary)
    with open(path, "wb") as f:
        f.write(struct.pack("<III", 0x46546C67, 2, total))
        f.write(struct.pack("<II", len(js), 0x4E4F534A) + js)
        f.write(struct.pack("<II", len(binary), 0x004E4942) + binary)


def prune_anims(path, upper_clips, upper_bones):
    """Keep only authored tracks: rotations (plus the Hips translation in full-body clips), and in
    upper-body clips only the bones from Spine up. Then drop unused data so the file shrinks."""
    with open(path, "rb") as f:
        data = f.read()
    jlen = struct.unpack("<I", data[12:16])[0]
    gltf = json.loads(data[20:20 + jlen])
    bin_start = 20 + jlen + 8
    binary = data[bin_start:]
    names = [n.get("name") for n in gltf["nodes"]]
    for anim in gltf.get("animations", []):
        upper = anim["name"] in upper_clips
        keep = []
        for ch in anim["channels"]:
            node, prop = names[ch["target"]["node"]], ch["target"]["path"]
            if prop == "scale":
                continue
            if prop == "translation" and (node != "Hips" or upper):
                continue
            if upper and node not in upper_bones:
                continue
            keep.append(ch)
        samplers = []
        remap = {}
        for ch in keep:
            s = ch["sampler"]
            if s not in remap:
                remap[s] = len(samplers)
                samplers.append(anim["samplers"][s])
            ch["sampler"] = remap[s]
        anim["channels"], anim["samplers"] = keep, samplers
    # accessors still in use
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
    write_glb(path, gltf, bytes(out))
