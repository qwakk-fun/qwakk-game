"""How the wing-hands hold the weapons.

The right fist has a "grip frame": the point between the curled fingers and the palm, oriented like the
weapon (barrel -Y, up +Z in weapon space). `attach` is that frame in RightHand bone space; the engine puts
the weapon there. The left hand uses the mirrored frame to wrap the support point.
"""

import math

from mathutils import Matrix, Quaternion, Vector

import params as P
from posing import DEG

# Fist center relative to the wrist, in the rest T-pose (right hand points -X, palm down).
GRIP_FROM_WRIST = Vector((0.080, 0.0, -0.070))   # x is along the hand, mirrored per side
GRIP_RAKE_DEG = 10.0                              # tilt the weapon so its raked grip sits along the curled fingers

# Finger curls (degrees per joint) that wrap a grip of about 35 mm.
GRIP_CURL = {"index": -40.0, "middle": -44.0, "thumb": -22.0}
SUPPORT_CURL = {"index": -36.0, "middle": -40.0, "thumb": -18.0}


def _rest_grip_frame(side):
    """4x4 grip frame in armature space at the rest pose (weapon axes -> world)."""
    s = 1 if side == "Left" else -1
    wrist = Vector((P.WRIST_X * s, 0, P.SHOULDER_Z))
    pos = wrist + Vector((GRIP_FROM_WRIST.x * s, GRIP_FROM_WRIST.y, GRIP_FROM_WRIST.z))
    if side == "Right":
        # barrel (-Y_w) along the fingers (-X), weapon up (+Z_w) toward the thumb (-Y), weapon right (-X_w) up
        cols = (Vector((0, 0, -1)), Vector((1, 0, 0)), Vector((0, -1, 0)))
    else:
        cols = (Vector((0, 0, 1)), Vector((-1, 0, 0)), Vector((0, -1, 0)))
    rot = Matrix(cols).transposed()
    rot = rot @ Matrix.Rotation(-GRIP_RAKE_DEG * DEG, 3, "X")   # undo the raked grip angle
    m = rot.to_4x4()
    m.translation = pos
    return m


def attach(sk, side="Right"):
    """Weapon frame in the hand bone's local space (Blender axes)."""
    return sk.rest[side + "Hand"].inverted() @ _rest_grip_frame(side)


def hand_target(sk, side, grip_world):
    """Hand bone world matrix that puts this hand's grip frame at `grip_world`."""
    return grip_world @ attach(sk, side).inverted()


def frame(pos, rx=0.0, ry=0.0, rz=0.0):
    """World 4x4 for a weapon at `pos`, rotated in degrees (pitch about X, roll about Y, yaw about Z)."""
    q = Quaternion((0, 0, 1), rz * DEG) @ Quaternion((1, 0, 0), rx * DEG) @ Quaternion((0, 1, 0), ry * DEG)
    m = q.to_matrix().to_4x4()
    m.translation = Vector(pos)
    return m


def support_frame(gun_world, kind):
    """Where the left grip frame goes: the left fist wraps the magwell (rifle) or the right fist (pistol)
    from the gun's left side, curl axis along the gun's down, knuckles toward the gun's front right."""
    local = Matrix.Translation(SUPPORT_POINT[kind]) @ Matrix.Rotation(SUPPORT_YAW_DEG[kind] * DEG, 4, "Z")
    return gun_world @ local


SUPPORT_YAW_DEG = {"rifle": -70.0, "pistol": -75.0}
SUPPORT_POINT = {}   # filled from weapons.py by the build (keeps one source of truth)
