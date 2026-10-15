"""Humanoid skeleton with Mixamo bone names (plus a Jaw), skin weights and posing helpers."""

import math

import bpy
from mathutils import Matrix, Vector

import geo
import params as P

FINGER_SPLITS = (0.0, 0.40, 0.72, 1.0)   # where each finger bone starts/ends along the finger


def finger_point(root, d, length, s):
    return root + d * (length * s) + Vector((0, 0, -0.018)) * s * s


def toe_point(side, y, z):
    """A point along the left/right foot, including the foot turn-out."""
    turn = Matrix.Rotation(math.radians(-P.FOOT_TURN_OUT_DEG * side), 3, "Z")
    ankle = Vector((P.HIP_X * side, 0, 0))
    return ankle + turn @ Vector((0, y, 0)) + Vector((0, 0, z))


def bone_specs(finger_parts):
    """(name, head, tail, parent, roll_axis, deform) for every bone."""
    z = Vector((0, 0, 1))
    fwd = Vector((0, -1, 0))
    specs = [
        ("Hips", (0, 0, P.HIPS_Z), (0, 0, P.SPINE_Z[0]), None, fwd, True),
        ("Spine", (0, 0, P.SPINE_Z[0]), (0, 0, P.SPINE_Z[1]), "Hips", fwd, True),
        ("Spine1", (0, 0, P.SPINE_Z[1]), (0, 0, P.SPINE_Z[2]), "Spine", fwd, True),
        ("Spine2", (0, 0, P.SPINE_Z[2]), (0, 0, P.NECK_Z), "Spine1", fwd, True),
        ("Neck", (0, 0, P.NECK_Z), (0, 0, P.HEAD_BONE_Z), "Spine2", fwd, True),
        ("Head", (0, 0, P.HEAD_BONE_Z), (0, 0, P.HEAD_TOP_Z), "Neck", fwd, True),
        ("HeadTop_End", (0, 0, P.HEAD_TOP_Z), (0, 0, P.HEAD_TOP_Z + 0.1), "Head", fwd, False),
        ("Jaw", P.JAW_PIVOT, tuple(Vector(P.JAW_PIVOT) + Vector((0, -P.JAW_LENGTH, 0))), "Head", z, True),
        # extra (not Mixamo): tail wiggle
        ("Tail", P.TAIL_ROOT, tuple(Vector(P.TAIL_ROOT) + Vector((0, 0.17, 0.12))), "Hips", z, True),
    ]
    for side, pre in ((1, "Left"), (-1, "Right")):
        sz = P.SHOULDER_Z
        specs += [
            (pre + "Shoulder", (P.SHOULDER_ROOT_X * side, 0, sz), (P.ARM_JOINT_X * side, 0, sz), "Spine2", z, True),
            (pre + "Arm", (P.ARM_JOINT_X * side, 0, sz), (P.ELBOW_X * side, 0, sz), pre + "Shoulder", z, True),
            (pre + "ForeArm", (P.ELBOW_X * side, 0, sz), (P.WRIST_X * side, 0, sz), pre + "Arm", z, True),
            (pre + "Hand", (P.WRIST_X * side, 0, sz), (P.HAND_END_X * side, 0, sz), pre + "ForeArm", z, True),
        ]
        suffix = "" if side == 1 else "_R"
        for fname, _off, _dir, _len, _w, _t in P.FINGERS:
            name, root, d, length = finger_parts["finger_" + fname + suffix]
            parent = pre + "Hand"
            for k in range(3):
                bname = f"{pre}Hand{fname}{k + 1}"
                h = finger_point(root, d, length, FINGER_SPLITS[k])
                t = finger_point(root, d, length, FINGER_SPLITS[k + 1])
                specs.append((bname, tuple(h), tuple(t), parent, z, True))
                parent = bname
        specs += [
            (pre + "UpLeg", (P.HIP_X * side, 0, 0.63), (P.HIP_X * side, 0, P.KNEE_Z), "Hips", fwd, True),
            (pre + "Leg", (P.HIP_X * side, 0, P.KNEE_Z), (P.HIP_X * side, 0, P.ANKLE_Z), pre + "UpLeg", fwd, True),
            (pre + "Foot", (P.HIP_X * side, 0, P.ANKLE_Z), tuple(toe_point(side, P.TOE_BASE_Y, 0.03)), pre + "Leg", z, True),
            (pre + "ToeBase", tuple(toe_point(side, P.TOE_BASE_Y, 0.03)), tuple(toe_point(side, P.TOE_END_Y, 0.03)), pre + "Foot", z, True),
        ]
    return specs


def build_armature(finger_parts, collection=None):
    data = bpy.data.armatures.new("QwakkRig")
    obj = bpy.data.objects.new("QwakkRig", data)
    (collection or bpy.context.scene.collection).objects.link(obj)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.mode_set(mode="EDIT")
    specs = bone_specs(finger_parts)
    for name, head, tail, parent, roll_axis, deform in specs:
        eb = data.edit_bones.new(name)
        eb.head, eb.tail = Vector(head), Vector(tail)
        eb.align_roll(roll_axis)
        eb.use_deform = deform
        if parent:
            eb.parent = data.edit_bones[parent]
            eb.use_connect = (Vector(head) - data.edit_bones[parent].tail).length < 1e-5 and name not in ("Jaw",)
    bpy.ops.object.mode_set(mode="OBJECT")
    data.display_type = "STICK"
    return obj, [s[0] for s in specs if s[5]]


# ------------------------------------------------------------------ weights
def body_weights(v):
    """Soft spine falloff by height, with a little shoulder influence at the top corners."""
    z = v.z
    keys = [("Hips", 0.68), ("Spine", 0.80), ("Spine1", 0.90), ("Spine2", 1.00), ("Neck", 1.12)]
    w = {}
    if z <= keys[0][1]:
        w["Hips"] = 1.0
    elif z >= keys[-1][1]:
        w["Neck"] = 1.0
    else:
        for (a, za), (b, zb) in zip(keys, keys[1:]):
            if za <= z <= zb:
                t = geo.smoothstep(za, zb, z)
                w[a], w[b] = 1 - t, t
    sh = geo.smoothstep(0.10, 0.20, abs(v.x)) * geo.smoothstep(0.90, 1.02, z) * 0.45
    if sh > 0:
        w = {k: val * (1 - sh) for k, val in w.items()}
        w[("Left" if v.x > 0 else "Right") + "Shoulder"] = sh
    return w


def arm_weights(v, pre):
    x = abs(v.x)
    w = {}
    e = geo.smoothstep(P.ELBOW_X - 0.045, P.ELBOW_X + 0.045, x)
    h = geo.smoothstep(P.WRIST_X - 0.035, P.WRIST_X + 0.025, x)
    w[pre + "Arm"] = 1 - e
    w[pre + "ForeArm"] = e * (1 - h)
    w[pre + "Hand"] = h
    return w


def finger_weights(v, pre, fname, info):
    _, root, d, length = info
    s = (v - root).dot(d) / length
    bones = [pre + "Hand"] + [f"{pre}Hand{fname}{k}" for k in (1, 2, 3)]
    # blend windows (center, half width) between Hand->1, 1->2 and 2->3; they never overlap
    t = [geo.smoothstep(c - hw, c + hw, s) for c, hw in ((0.06, 0.09), (FINGER_SPLITS[1], 0.07), (FINGER_SPLITS[2], 0.07))]
    weights = [1 - t[0], t[0] - t[1], t[1] - t[2], t[2]]
    return {b: w for b, w in zip(bones, weights) if w > 1e-4}


def leg_weights(v, pre):
    k = geo.smoothstep(P.KNEE_Z - 0.035, P.KNEE_Z + 0.03, v.z)
    return {pre + "UpLeg": k, pre + "Leg": 1 - k}


def foot_weights(v, pre, side):
    turn = Matrix.Rotation(math.radians(P.FOOT_TURN_OUT_DEG * side), 3, "Z")
    local = turn @ (v - Vector((P.HIP_X * side, 0, 0)))
    t = geo.smoothstep(P.TOE_BASE_Y + 0.035, P.TOE_BASE_Y - 0.035, local.y)
    return {pre + "Foot": 1 - t, pre + "ToeBase": t}


TORSO_BONES = ("Hips", "Spine", "Spine1", "Spine2", "Neck", "LeftShoulder", "RightShoulder")


def torso_bone_heat(mesh_obj, rig_obj, ranges):
    """Blender automatic weights (bone heat) on the torso alone, against the torso bones only.
    Running it on the whole joined mesh fails, because the separate limb and head shells hide
    the bones from most torso vertices. Returns {vertex index: {bone: weight}}."""
    keep = sorted(i for name in ("body", "belly") for v0, v1 in ranges.get(name, []) for i in range(v0, v1))
    keep_set = set(keep)
    src = mesh_obj.data
    remap = {old: new for new, old in enumerate(keep)}
    faces = [[remap[v] for v in p.vertices] for p in src.polygons if all(v in keep_set for v in p.vertices)]
    tmp_mesh = bpy.data.meshes.new("torso_tmp")
    tmp_mesh.from_pydata([tuple(src.vertices[i].co) for i in keep], [], faces)
    tmp = bpy.data.objects.new("torso_tmp", tmp_mesh)
    bpy.context.scene.collection.objects.link(tmp)
    saved = {b.name: b.use_deform for b in rig_obj.data.bones}
    for b in rig_obj.data.bones:
        b.use_deform = b.name in TORSO_BONES
    result = {}
    bpy.ops.object.select_all(action="DESELECT")
    tmp.select_set(True)
    rig_obj.select_set(True)
    bpy.context.view_layer.objects.active = rig_obj
    try:
        bpy.ops.object.parent_set(type="ARMATURE_AUTO")
        names = {g.index: g.name for g in tmp.vertex_groups}
        for v in tmp_mesh.vertices:
            w = {names[g.group]: g.weight for g in v.groups if g.weight > 0.01}
            if w:
                result[keep[v.index]] = w
    except RuntimeError as exc:
        print("bone heat failed:", exc)
    for b in rig_obj.data.bones:
        b.use_deform = saved[b.name]
    bpy.data.objects.remove(tmp)
    bpy.data.meshes.remove(tmp_mesh)
    return result


def skin(mesh_obj, rig_obj, ranges, finger_parts, deform_bones, body_mode="auto"):
    """Bind with automatic weights, then replace the weights of every part with known-good procedural
    weights. The body keeps the automatic result when body_mode is 'auto' and bone heat succeeded."""
    for g in list(mesh_obj.vertex_groups):
        if g.name != "outline":
            mesh_obj.vertex_groups.remove(g)
    mesh_obj.parent = rig_obj
    mod = mesh_obj.modifiers.new("Armature", "ARMATURE")
    mod.object = rig_obj

    auto = torso_bone_heat(mesh_obj, rig_obj, ranges) if body_mode == "auto" else {}

    groups = {b: (mesh_obj.vertex_groups.get(b) or mesh_obj.vertex_groups.new(name=b)) for b in deform_bones}
    verts = mesh_obj.data.vertices
    stats = {"auto_body_kept": 0, "auto_body_empty": 0}

    def assign(i, weights):
        for g in groups.values():
            g.remove([i])
        total = sum(weights.values())
        for b, w in sorted(weights.items(), key=lambda kv: -kv[1])[:4]:
            groups[b].add([i], w / total, "REPLACE")

    for name, spans in ranges.items():
        base = name[:-2] if name.endswith("_R") else name
        side = -1 if name.endswith("_R") else 1
        pre = "Left" if side == 1 else "Right"
        for v0, v1 in spans:
            for i in range(v0, v1):
                co = verts[i].co
                if base == "mouth":   # lower half rides the jaw, so the dark mouth stretches open
                    t = geo.smoothstep(P.JAW_PIVOT[2] - 0.012, P.JAW_PIVOT[2] + 0.004, co.z)
                    w = {"Head": t, "Jaw": 1 - t} if 0 < t < 1 else ({"Head": 1.0} if t >= 1 else {"Jaw": 1.0})
                elif base in ("head", "eye", "shine", "blush", "bill", "tuft"):
                    w = {"Head": 1.0}
                elif base == "jaw":
                    w = {"Jaw": 1.0}
                elif base == "tail":
                    w = {"Tail": 1.0}
                elif base in ("body", "belly"):
                    w = auto.get(i)
                    if w:
                        stats["auto_body_kept"] += 1
                    else:
                        stats["auto_body_empty"] += 1
                        w = body_weights(co)
                elif base in ("arm", "wingfeather"):
                    w = arm_weights(co, pre)
                elif base.startswith("finger_"):
                    fname = base[len("finger_"):]
                    w = finger_weights(co, pre, fname, finger_parts[name])
                elif base == "leg":
                    w = leg_weights(co, pre)
                elif base == "foot":
                    w = foot_weights(co, pre, side)
                else:
                    raise ValueError("no weights for part " + name)
                assign(i, w)
    return stats


# ------------------------------------------------------------------ posing
def reset_pose(rig_obj):
    for pb in rig_obj.pose.bones:
        pb.matrix_basis = Matrix.Identity(4)
    bpy.context.view_layer.update()


def rotate(rig_obj, bone, axis, degrees):
    """Rotate a pose bone around a world-space axis through its head (armature at identity)."""
    pb = rig_obj.pose.bones[bone]
    head = pb.matrix.to_translation()
    if axis is None:   # the bone's own X axis
        axis = pb.matrix.to_3x3() @ Vector((1, 0, 0))
    rot = Matrix.Rotation(math.radians(degrees), 4, Vector(axis))
    pb.matrix = Matrix.Translation(head) @ rot @ Matrix.Translation(-head) @ pb.matrix
    bpy.context.view_layer.update()


def apply_pose(rig_obj, moves):
    """moves: list of (bone, axis, degrees), applied in order (parents first)."""
    reset_pose(rig_obj)
    for bone, axis, deg in moves:
        rotate(rig_obj, bone, axis, deg)


def fingers(pre, degrees, thumb_degrees=None):
    """Curl moves around each finger bone's own X axis (negative curls toward the palm)."""
    moves = []
    for fname in ("Index", "Middle"):
        for k in (1, 2, 3):
            moves.append((f"{pre}Hand{fname}{k}", None, degrees))
    if thumb_degrees is not None:
        for k in (1, 2, 3):
            moves.append((f"{pre}HandThumb{k}", None, thumb_degrees))
    return moves


RELAXED = [
    ("LeftArm", (0, 1, 0), 62), ("RightArm", (0, 1, 0), -62),
    ("LeftArm", (1, 0, 0), -10), ("RightArm", (1, 0, 0), -10),
    ("LeftForeArm", (0, 0, 1), 18), ("RightForeArm", (0, 0, 1), -18),
    ("LeftHand", (1, 0, 0), 0), ("RightHand", (1, 0, 0), 0),
]

ARMS_UP = [
    ("LeftArm", (0, 1, 0), -62), ("RightArm", (0, 1, 0), 62),
    ("LeftForeArm", (0, 1, 0), -25), ("RightForeArm", (0, 1, 0), 25),
    ("Jaw", (1, 0, 0), 22),
]

RUN = [
    ("Hips", (0, 0, 1), 8),
    ("Spine", (1, 0, 0), -8), ("Spine1", (0, 0, 1), -10),
    ("LeftUpLeg", (1, 0, 0), -58), ("LeftLeg", (1, 0, 0), 75), ("LeftFoot", (1, 0, 0), -12),
    ("RightUpLeg", (1, 0, 0), 32), ("RightLeg", (1, 0, 0), 48), ("RightFoot", (1, 0, 0), 22),
    ("LeftArm", (0, 1, 0), 70), ("LeftArm", (1, 0, 0), 38), ("LeftForeArm", (0, 0, 1), -20),
    ("RightArm", (0, 1, 0), -70), ("RightArm", (1, 0, 0), -45), ("RightForeArm", (0, 0, 1), 55),
    ("Jaw", (1, 0, 0), 10),
]
