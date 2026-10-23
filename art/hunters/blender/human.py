"""The base hunter body: head and face, torso, arms with mitten gloves, legs and boots.

Every builder takes the look (looks.py) and the LOD (0, 1, 2) and appends skinned Parts.
Vinyl-toy proportions: a big round head with a potato nose, chunky limbs that start with a ball on their
joint (so a bent limb never opens a gap), mitten hands and big boots.
"""

import math

from mathutils import Matrix, Vector

import hp
import hrig
from mesh import L, Part, box, ellipsoid_xyz, geo, tube

C = Vector(hp.HEAD_CENTER)


def add(parts, name, w, outline=1.0):
    p = Part(name, w)
    p.outline = outline
    parts.append(p)
    return p


def head_point(yaw_deg, pitch_deg, out=0.0):
    """Point and normal on the head ellipsoid (yaw 0 = the face, +yaw toward the character's left)."""
    yaw, pitch = math.radians(yaw_deg), math.radians(pitch_deg)
    d = Vector((math.sin(yaw) * math.cos(pitch), -math.cos(yaw) * math.cos(pitch), math.sin(pitch)))
    a, b, c = hp.HEAD_RADII
    t = 1.0 / math.sqrt((d.x / a) ** 2 + (d.y / b) ** 2 + (d.z / c) ** 2)
    p = d * t
    n = Vector((p.x / a ** 2, p.y / b ** 2, p.z / c ** 2)).normalized()
    return C + p + n * out, n


def on_face(part, yaw, pitch, radii, cell, segs, rings, out=0.0):
    p, n = head_point(yaw, pitch, out)
    geo.ellipsoid(part, p, radii, geo.frame_from_normal(n), segs, rings, cell)


def torus(part, center, major, minor, cell, n_major, n_minor, tilt_x=0.0, scale_y=1.0):
    """A ring around the vertical axis through `center` (tilted about X), seam at the back."""
    c = Vector(center)
    rot = Matrix.Rotation(math.radians(tilt_x), 3, "X")
    rings = []
    for i in range(n_major + 1):
        a = 2 * math.pi * i / n_major
        d = Vector((math.sin(a), -math.cos(a) * scale_y, 0.0))
        dn = Vector((math.sin(a), -math.cos(a), 0.0))
        ring = []
        for j in range(n_minor):
            b = 2 * math.pi * j / n_minor
            v = d * major + dn * (math.cos(b) * minor) + Vector((0, 0, math.sin(b) * minor))
            ring.append(c + rot @ v)
        rings.append(ring)
    part.ring_stack(rings, cell)


# ----------------------------------------------------------------- head


def build_head(parts, look, lod):
    skin, deep = look["skin"], look["skin"] + "_deep"
    head = add(parts, "head", "Head")
    ellipsoid_xyz(head, C, hp.HEAD_RADII, skin, L(lod, 16, 12, 10), L(lod, 10, 8, 6))
    ears = add(parts, "ears", "Head")
    for s in (1, -1):
        ellipsoid_xyz(ears, (0.178 * s, 0.0, 1.565), (0.03, 0.045, 0.056), deep, L(lod, 6, 6, 4), L(lod, 4, 4, 3))
    if look.get("hair"):
        hair = add(parts, "hair", "Head")
        ellipsoid_xyz(hair, (0.0, 0.035, 1.605), (0.19, 0.165, 0.175), look["hair"], L(lod, *look.get("hair_segs", (12, 10, 8))),
                      L(lod, 7, 6, 4))
    nose = add(parts, "nose", "Head")
    p, _ = head_point(0, -9, 0.022)
    big = look.get("nose_scale", 1.0)
    ellipsoid_xyz(nose, p, (0.052 * big, 0.048 * big, 0.046 * big), look.get("nose", deep), L(lod, 8, 6, 5), L(lod, 6, 4, 3))
    eyes(parts, look, lod)
    brows(parts, look, lod)
    if lod <= 1 and not look.get("beard"):
        mouth = add(parts, "mouth", "Head", outline=0.0)
        pts = [head_point(15 * k / 2, -24 + 4 * (k / 2) ** 2, 0.004)[0] for k in (-2, -1, 0, 1, 2)]
        tube(mouth, pts, 0.010, 4, "mouth", caps=True, cap_rings=1, samples=L(lod, 5, 4))


def eyes(parts, look, lod):
    whites = add(parts, "eyes", "Head")
    pupils = add(parts, "pupils", "Head")
    look_in = look.get("look_in", 3.0)
    for s in (1, -1):
        on_face(whites, 21 * s, 4, (0.044, 0.022, 0.054), "eye_white", L(lod, 8, 8, 6), L(lod, 4, 4, 3), out=-0.008)
        on_face(pupils, (21 - look_in) * s, 2, (0.024, 0.012, 0.03), "pupil", L(lod, 6, 6, 5), L(lod, 4, 3, 3), out=0.006)
    if lod == 0:
        shine = add(parts, "shine", "Head", outline=0.0)
        for s in (1, -1):
            on_face(shine, (21 - look_in + 2.5) * s, 6.5, (0.007, 0.004, 0.008), "shine", 5, 3, out=0.017)


def brows(parts, look, lod):
    br = add(parts, "brows", "Head")
    thick = look.get("brow_r", 0.017)
    for s in (1, -1):
        pts = [head_point(7 * s, look.get("brow_in", 17), 0.006)[0],
               head_point(19 * s, 22, 0.008)[0],
               head_point(32 * s, look.get("brow_out", 20), 0.004)[0]]
        tube(br, pts, [thick * 0.9, thick, thick * 0.75], L(lod, 6, 5, 4), look.get("brow", "brow"), cap_rings=1,
             samples=L(lod, 4, 3, 3))


# ----------------------------------------------------------------- torso


def build_torso(parts, look, lod, profile, scale, cells, name="torso", push=0.0, w=None, rings=(9, 7, 5), segs=(16, 12, 8)):
    part = add(parts, name, w or hrig.torso)
    geo.lathe(part, profile, L(lod, *rings), L(lod, *segs), cells, scale=scale,
              y_push=(lambda z: push * math.sin(math.pi * max(0.0, min(1.0, (z - 0.85) / 0.45)))) if push else None)
    return part


def build_neck(parts, look, lod):
    n = add(parts, "neck", hrig.neck)
    tube(n, [(0, -0.005, 1.36), (0, -0.01, 1.47)], 0.075, L(lod, 8, 6, 5), look["skin"], caps=False)


def collar(parts, look, lod, cell, major=0.112, minor=0.04, z=1.425):
    if lod >= 2:
        return
    c = add(parts, "collar", hrig.torso)
    torus(c, (0, 0.0, z), major, minor, cell, L(lod, 12, 8), 4, tilt_x=-8)


# ----------------------------------------------------------------- arms and hands


def build_arms(parts, look, lod, sleeve, cuff, r=0.075):
    sz = hp.SHOULDER_Z
    arms = add(parts, "arms", hrig.arm)
    cuffs = add(parts, "cuffs", hrig.arm)
    sg = L(lod, 8, 6, 5)
    for s in (1, -1):
        ellipsoid_xyz(arms, (hp.ARM_JOINT_X * s, 0, sz), (r * 1.18, r * 1.18, r * 1.18), sleeve, L(lod, 8, 6, 6), L(lod, 5, 4, 4))
        tube(arms, [(hp.ARM_JOINT_X * s, 0, sz), (hp.ELBOW_X * s, 0, sz - 0.005), ((hp.WRIST_X - 0.025) * s, 0, sz)],
             [r, r * 0.92, r * 0.86], sg, sleeve, caps=False, samples=L(lod, 7, 5, 3))
        tube(cuffs, [((hp.WRIST_X - 0.05) * s, 0, sz), (hp.WRIST_X * s, 0, sz)], r * 1.04, sg, cuff, caps=False)
    hands(parts, look, lod)


def hands(parts, look, lod):
    sz = hp.SHOULDER_Z
    glove = look.get("glove", "glove")
    palm = add(parts, "palm", hrig.side_bone("Hand"))
    fingers = add(parts, "fingers", hrig.side_bone("HandFingers"))
    for s in (1, -1):
        ellipsoid_xyz(palm, ((hp.WRIST_X + 0.06) * s, 0, sz - 0.004), (0.068, 0.062, 0.044), glove, L(lod, 8, 6, 5), L(lod, 5, 4, 3))
        if lod <= 1:
            ellipsoid_xyz(palm, ((hp.WRIST_X + 0.05) * s, -0.062, sz - 0.012), (0.03, 0.038, 0.028), glove, 6, 4,
                          rot=Matrix.Rotation(math.radians(-25 * s), 3, "Z"))
        ellipsoid_xyz(fingers, ((hp.WRIST_X + 0.135) * s, 0.002, sz - 0.008), (0.06, 0.058, 0.038), glove, L(lod, 8, 6, 5), L(lod, 5, 4, 3))


# ----------------------------------------------------------------- legs and boots


def build_legs(parts, look, lod, pants, r=0.088):
    legs = add(parts, "legs", hrig.leg)
    for s in (1, -1):
        x = hp.HIP_X * s
        ellipsoid_xyz(legs, (x, 0, hp.HIP_JOINT_Z), (r * 1.1, r * 1.1, r * 1.1), pants, L(lod, 8, 6, 6), L(lod, 5, 4, 3))
        tube(legs, [(x, 0, hp.HIP_JOINT_Z), (x, -0.005, hp.KNEE_Z), (x, 0, 0.16)],
             [r, r * 0.86, r * 0.78], L(lod, 8, 6, 5), pants, caps=False, samples=L(lod, 7, 5, 3))


def build_boots(parts, look, lod, boot="boot", sole="sole", shaft_top=0.30, r=0.078):
    boots = add(parts, "boots", hrig.foot)
    for s in (1, -1):
        x = hp.HIP_X * s
        tube(boots, [(x, 0.0, shaft_top), (x, 0.0, 0.09)], [r * 1.05, r], L(lod, 8, 6, 5), boot, caps=False)
        box(boots, (x, 0.075, 0.068), (x, -0.215, 0.06), 0.15, 0.12, (0, 0, 1), boot, chamfer=0.45, taper=0.92)
        if lod <= 1:
            box(boots, (x, 0.085, 0.016), (x, -0.228, 0.016), 0.16, 0.034, (0, 0, 1), sole, chamfer=0.3)
