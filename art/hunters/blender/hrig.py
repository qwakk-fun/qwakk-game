"""The shared hunter skeleton (one for every look, the boss included) and its skin-weight rules.

Bone names follow the duck's Mixamo-style names where they exist (Hips, Spine, Spine1, Spine2, Neck, Head,
Left/Right Shoulder, Arm, ForeArm, Hand, UpLeg, Leg, Foot, ToeBase), plus the hunter's own points:
Root, HeadTop, Hat, FxStars, FxPoof, Whistle, Left/RightHandFingers, LeftHandProp, WeaponSocket, Muzzle.
"""

import bpy
from mathutils import Vector

import hp
from mesh import geo

Z = (0, 0, 1)
FWD = (0, -1, 0)
SOCKET_B = Vector((-1, 0, 0))      # right fist: barrel along the arm in the T-pose
SOCKET_U = Vector((0, -1, 0))      # gun top toward the thumb (forward in the T-pose)


def fist(side):
    return Vector((hp.FIST_X * side, 0.0, hp.SHOULDER_Z - hp.FIST_DROP))


def muzzle_world(muzzle_local):
    """Socket-local (right, forward, up) offset to the rest-pose world position."""
    x, y, z = muzzle_local
    r = SOCKET_B.cross(SOCKET_U)
    return fist(-1) + r * x + SOCKET_B * y + SOCKET_U * z


def bone_specs(muzzle_local):
    """(name, head, tail, parent, roll axis) for every bone; every bone is exported as a glTF joint."""
    sz = hp.SHOULDER_Z
    specs = [
        ("Root", (0, 0, 0), (0, 0, 0.15), None, FWD),
        ("Hips", (0, 0, hp.HIPS_Z), (0, 0, hp.SPINE_Z[0]), "Root", FWD),
        ("Spine", (0, 0, hp.SPINE_Z[0]), (0, 0, hp.SPINE_Z[1]), "Hips", FWD),
        ("Spine1", (0, 0, hp.SPINE_Z[1]), (0, 0, hp.SPINE_Z[2]), "Spine", FWD),
        ("Spine2", (0, 0, hp.SPINE_Z[2]), (0, 0, hp.NECK_Z), "Spine1", FWD),
        ("Neck", (0, 0, hp.NECK_Z), (0, 0, hp.HEAD_BONE_Z), "Spine2", FWD),
        ("Head", (0, 0, hp.HEAD_BONE_Z), (0, 0, hp.HEAD_TOP_Z), "Neck", FWD),
        ("HeadTop", (0, 0, hp.HEADTOP_Z), (0, 0, hp.HEADTOP_Z + 0.08), "Head", FWD),
        ("Hat", hp.HAT_PIVOT, tuple(Vector(hp.HAT_PIVOT) + Vector((0, 0, 0.1))), "Head", FWD),
        ("FxStars", (0, -0.01, hp.HEAD_TOP_Z + hp.STARS_Z), (0, -0.01, hp.HEAD_TOP_Z + hp.STARS_Z + 0.1), "Root", FWD),
        ("FxPoof", (0, 0, 0.0), (0, 0, 0.1), "Root", FWD),
        ("Whistle", hp.WHISTLE_REST, tuple(Vector(hp.WHISTLE_REST) + Vector((0, 0, 0.06))), "Spine2", FWD),
    ]
    for side, pre in ((1, "Left"), (-1, "Right")):
        specs += [
            (pre + "Shoulder", (hp.SHOULDER_ROOT_X * side, 0, sz), (hp.ARM_JOINT_X * side, 0, sz), "Spine2", Z),
            (pre + "Arm", (hp.ARM_JOINT_X * side, 0, sz), (hp.ELBOW_X * side, 0, sz), pre + "Shoulder", Z),
            (pre + "ForeArm", (hp.ELBOW_X * side, 0, sz), (hp.WRIST_X * side, 0, sz), pre + "Arm", Z),
            (pre + "Hand", (hp.WRIST_X * side, 0, sz), (hp.HAND_END_X * side, 0, sz), pre + "ForeArm", Z),
            (pre + "HandFingers", (hp.HAND_END_X * side, 0, sz), (hp.FINGERS_END_X * side, 0, sz), pre + "Hand", Z),
        ]
    specs += [
        ("LeftHandProp", tuple(fist(1)), tuple(fist(1) + Vector((0.08, 0, 0))), "LeftHand", Z),
        ("WeaponSocket", tuple(fist(-1)), tuple(fist(-1) + SOCKET_B * 0.1), "RightHand", tuple(SOCKET_U)),
        ("Muzzle", tuple(muzzle_world(muzzle_local)), tuple(muzzle_world(muzzle_local) + SOCKET_B * 0.05), "WeaponSocket",
         tuple(SOCKET_U)),
    ]
    for side, pre in ((1, "Left"), (-1, "Right")):
        x = hp.HIP_X * side
        specs += [
            (pre + "UpLeg", (x, 0, hp.HIP_JOINT_Z), (x, 0, hp.KNEE_Z), "Hips", FWD),
            (pre + "Leg", (x, 0, hp.KNEE_Z), (x, 0, hp.ANKLE_Z), pre + "UpLeg", FWD),
            (pre + "Foot", (x, 0, hp.ANKLE_Z), (x, hp.TOE_BASE_Y, 0.035), pre + "Leg", Z),
            (pre + "ToeBase", (x, hp.TOE_BASE_Y, 0.035), (x, hp.TOE_END_Y, 0.035), pre + "Foot", Z),
        ]
    return specs


def build_armature(name, specs, collection=None):
    data = bpy.data.armatures.new(name)
    obj = bpy.data.objects.new(name, data)
    (collection or bpy.context.scene.collection).objects.link(obj)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.mode_set(mode="EDIT")
    for bname, head, tail, parent, roll in specs:
        eb = data.edit_bones.new(bname)
        eb.head, eb.tail = Vector(head), Vector(tail)
        eb.align_roll(Vector(roll))
        eb.use_deform = True
        if parent:
            eb.parent = data.edit_bones[parent]
            eb.use_connect = (Vector(head) - data.edit_bones[parent].tail).length < 1e-6
    bpy.ops.object.mode_set(mode="OBJECT")
    data.display_type = "STICK"
    return obj, [s[0] for s in specs]


# ------------------------------------------------------------------ weight rules (rest-pose coordinates)
ss = geo.smoothstep


def side_of(co):
    return "Left" if co.x >= 0 else "Right"


def torso(co):
    """Soft spine falloff by height, shoulder influence at the top corners."""
    keys = [("Hips", 0.97), ("Spine", 1.09), ("Spine1", 1.21), ("Spine2", 1.31), ("Neck", 1.43)]
    z = co.z
    w = {}
    if z <= keys[0][1]:
        w["Hips"] = 1.0
    elif z >= keys[-1][1]:
        w["Neck"] = 1.0
    else:
        for (a, za), (b, zb) in zip(keys, keys[1:]):
            if za <= z <= zb:
                t = ss(za, zb, z)
                w[a], w[b] = 1 - t, t
                break
    sh = ss(0.12, 0.22, abs(co.x)) * ss(1.20, 1.32, z) * 0.5
    if sh > 0:
        w = {k: v * (1 - sh) for k, v in w.items()}
        w[side_of(co) + "Shoulder"] = sh
    return w


def pelvis(co):
    """Pants top and coat skirts: the hips, with the thighs taking over below the crotch."""
    k = ss(0.90, 0.55, co.z) * 0.8
    if k <= 0:
        return torso(co)
    s = max(-1.0, min(1.0, co.x / 0.12))
    w = {"Hips": 1 - k, "LeftUpLeg": k * (0.5 + 0.5 * s), "RightUpLeg": k * (0.5 - 0.5 * s)}
    return w


def skirt(co):
    """Long coats: hips at the waist, sharing with the thighs further down (less than the pants)."""
    k = ss(0.92, 0.40, co.z) * 0.55
    s = max(-1.0, min(1.0, co.x / 0.14))
    return {"Hips": 1 - k, "LeftUpLeg": k * (0.5 + 0.5 * s), "RightUpLeg": k * (0.5 - 0.5 * s)}


def arm(co):
    pre = side_of(co)
    x = abs(co.x)
    e = ss(hp.ELBOW_X - 0.045, hp.ELBOW_X + 0.045, x)
    h = ss(hp.WRIST_X - 0.03, hp.WRIST_X + 0.02, x)
    return {pre + "Arm": 1 - e, pre + "ForeArm": e * (1 - h), pre + "Hand": h}


def leg(co):
    pre = side_of(co)
    k = ss(hp.KNEE_Z - 0.04, hp.KNEE_Z + 0.04, co.z)
    a = ss(hp.ANKLE_Z + 0.03, hp.ANKLE_Z - 0.01, co.z)
    w = {pre + "UpLeg": k, pre + "Leg": (1 - k) * (1 - a), pre + "Foot": a * (1 - k)}
    hip = ss(hp.HIP_JOINT_Z - 0.02, hp.HIP_JOINT_Z + 0.08, co.z)
    if hip > 0:
        w = {b: v * (1 - hip) for b, v in w.items()}
        w["Hips"] = hip
    return w


def foot(co):
    pre = side_of(co)
    t = ss(hp.TOE_BASE_Y + 0.03, hp.TOE_BASE_Y - 0.03, co.y)
    up = ss(hp.ANKLE_Z + 0.06, hp.ANKLE_Z + 0.14, co.z)     # boot shaft above the ankle rides the shin
    w = {pre + "Foot": (1 - t) * (1 - up), pre + "ToeBase": t * (1 - up)}
    if up > 0:
        w[pre + "Leg"] = up
    return w


def neck(co):
    t = ss(hp.NECK_Z + 0.02, hp.HEAD_BONE_Z + 0.04, co.z)
    return {"Spine2": (1 - t) * 0.5, "Neck": (1 - t) * 0.5 + t * 0.3, "Head": t * 0.7}


def lanyard(co):
    """A cord from the neck down to the whistle: the lower end follows the Whistle bone."""
    t = ss(hp.WHISTLE_REST[2] + 0.17, hp.WHISTLE_REST[2] + 0.02, co.z)
    return {"Spine2": 1 - t, "Whistle": t}


def side_bone(base):
    """Rigid on Left<base> or Right<base> by the vertex's side."""
    return lambda co: {side_of(co) + base: 1.0}
