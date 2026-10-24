"""Two cheap horde "minion" looks on the shared hunter skeleton, for Hunt Season's melee waves.

They read as weak at a glance: no guns, kitchen and garden gear, silly hats.
  - Beater: a lanky villager in a blue smock with a rope belt and a patched knee, a cooking pot for a
    helmet and an oversized wooden spoon held like a club.
  - Recruit: a kid-sized hunter (Root scale 0.72) swimming in a too-big camo jacket, huge boots and an
    oversized blaze cap that slides over his eyebrows, swinging a butterfly net.
Both use the same skeleton, the same clips and the same two-handed hold as the other hunters (the spoon
and the net handle pass under the left fist at socket y = hp.SUPPORT_Y). The item's working end (the
spoon bowl, the net hoop) is the `Muzzle` point: read it as the bonk's contact point.

LODs are cheaper than the regular hunters': minion LOD0, LOD1, LOD2 are built from the hunter detail
levels 1, 2 and 3 (`lods` below; level 3 is level 2 with small parts dropped), under about 2,000
triangles at LOD0.
"""

import math

from mathutils import Matrix, Vector

import hp
import hrig
import human as H
import looks as LK
from mesh import L, box, ellipsoid_xyz, geo, tube

RECRUIT_SCALE = 0.72


def _spoon(parts, lod):
    g = LK.gun_part(parts)
    LK.gtube(g, -0.22, 0.47, 0.0, 0.021, "wood", lod, segs=8)
    ellipsoid_xyz(g, LK.G(0, -0.225, 0.0), (0.026, 0.026, 0.026), "wood_deep", L(lod, 6, 6, 6, 5), 3)
    # the bowl: a wide shallow scoop at the end, tipped up a little
    c = LK.G(0, 0.585, 0.012)
    m = Matrix((LK.SOCK_R, LK.SOCK_B, LK.SOCK_U)).transposed()
    geo.ellipsoid(g, c, (0.088, 0.032, 0.125), m @ Matrix(((1, 0, 0), (0, 0, 1), (0, -1, 0))), L(lod, 10, 8, 6, 6),
                  L(lod, 6, 5, 4, 4), "wood")
    if lod <= 2:
        geo.ellipsoid(g, LK.G(0, 0.585, 0.034), (0.068, 0.012, 0.098), m @ Matrix(((1, 0, 0), (0, 0, 1), (0, -1, 0))),
                      L(lod, 8, 8, 6), 3, "wood_deep")
    return (0.0, 0.585, 0.012)


def _net(parts, lod):
    g = LK.gun_part(parts)
    LK.gtube(g, -0.26, 0.64, 0.0, 0.017, "wood", lod, segs=6)
    ellipsoid_xyz(g, LK.G(0, -0.265, 0.0), (0.022, 0.022, 0.022), "blaze", 6, 3)
    # the hoop: a ring in the item's x-y plane, attached to the handle at its near rim
    hoop_c = LK.G(0, 0.80, 0.0)
    n = L(lod, 14, 12, 10, 8)
    pts = []
    for i in range(n + 1):
        a = 2 * math.pi * i / n
        pts.append(hoop_c + LK.SOCK_B * (-0.155 * math.cos(a)) + LK.SOCK_R * (0.135 * math.sin(a)))
    tube(g, pts, 0.011, 4, "gunmetal", caps=False, samples=len(pts))
    # the net bag hanging from the hoop (down the item's -z), a soft cone
    bag = H.add(parts, "netbag", "WeaponSocket", outline=0.6)
    rings = []
    seg = L(lod, 10, 8, 8, 6)
    for k, (s, drop) in enumerate(((1.0, 0.0), (0.82, 0.10), (0.52, 0.19), (0.16, 0.25))):
        ring = []
        for j in range(seg):
            a = 2 * math.pi * j / seg
            ring.append(hoop_c + LK.SOCK_B * (-0.15 * s * math.cos(a)) + LK.SOCK_R * (0.13 * s * math.sin(a))
                        - LK.SOCK_U * drop)
        rings.append(ring)
    bag.ring_stack(rings, ["net", "net", "net_deep"], None, hoop_c - LK.SOCK_U * 0.27)
    return (0.0, 0.80, 0.0)


def dress_beater(parts, look, lod):
    k = 0.84                                       # lanky: a narrow chest on the same skeleton
    H.build_torso(parts, look, lod, LK.scaled(LK.REG_TORSO, k), (1.0, 0.82),
                  lambda c: "smock_deep" if c.z < 0.86 else "smock", rings=(9, 6, 5, 4), segs=(16, 10, 8, 8))
    if lod <= 2:
        belt = H.add(parts, "belt", hrig.torso)
        H.torus(belt, (0, 0.0, 0.965), 0.192, 0.018, "rope", L(lod, 12, 12, 8), 4)
    LK.pelvis(parts, lod, "pants", k=0.92)
    H.build_arms(parts, look, lod, "smock", "smock_deep", r=0.062)
    H.build_legs(parts, look, lod, "pants", r=0.074)
    if lod <= 1:
        knee = H.add(parts, "patch", hrig.leg)
        box(knee, (0.11, -0.07, 0.53), (0.11, -0.072, 0.44), 0.10, 0.012, (0, -1, 0), "patch", chamfer=0.4)
    H.build_boots(parts, look, lod, boot="boot", shaft_top=0.25, r=0.07)
    H.build_neck(parts, look, lod)
    _head(parts, look, lod)
    # the cooking pot helmet, with a handle sticking out to the side and a little dent of a lid knob
    hat = H.add(parts, "hat", "Hat")
    prof = [(0, 1.642), (0.212, 1.645), (0.214, 1.70), (0.206, 1.80), (0.18, 1.832), (0, 1.836)]
    geo.lathe(hat, prof, L(lod, 4, 4, 3, 3), L(lod, 14, 10, 8, 8), lambda c: "pot_deep" if c.z < 1.66 else "pot",
              center=(0, -0.01, 0))
    geo.lathe(hat, [(0, 1.640), (0.232, 1.636), (0.236, 1.652), (0, 1.656)], 2, L(lod, 14, 10, 8, 8), "pot_deep",
              center=(0, -0.01, 0))
    box(hat, (0.20, -0.01, 1.765), (0.36, -0.01, 1.775), 0.045, 0.03, (0, 0, 1), "dark", chamfer=0.4)
    return _spoon(parts, lod)


def dress_recruit(parts, look, lod):
    # the jacket is two sizes too big: a wide torso and fat sleeves whose cuffs swallow the hands
    H.build_torso(parts, look, lod, LK.scaled(LK.REG_TORSO, 1.12), (1.0, 0.86),
                  lambda c: "jacket_deep" if (c.z < 0.83 or (c.y < 0 and abs(c.x) < 0.022)) else "camo0",
                  rings=(9, 6, 5, 4), segs=(16, 10, 8, 8))
    hem = [(0, 0.70), (0.25, 0.705), (0.275, 0.74), (0.27, 0.86), (0.25, 0.92), (0, 0.93)]
    skirt = H.add(parts, "coat_skirt", hrig.skirt)
    geo.lathe(skirt, hem, L(lod, 4, 3, 3, 2), L(lod, 14, 10, 8, 8), lambda c: "jacket_deep" if c.z < 0.745 else "camo0",
              scale=(1.0, 0.86))
    LK.pelvis(parts, lod, "pants")
    H.build_arms(parts, look, lod, "camo0", "jacket_deep", r=0.088)
    H.build_legs(parts, look, lod, "pants", r=0.084)
    H.build_boots(parts, look, lod, boot="boot", shaft_top=0.30, r=0.095)
    H.build_neck(parts, look, lod)
    _head(parts, look, lod)
    # the oversized blaze cap: a big dome sliding down to the brows and a long drooping brim
    hat = H.add(parts, "hat", "Hat")
    LK.cap_dome(hat, lod, "blaze", r=0.236, bottom=1.622, top=1.868)
    box(hat, (0, -0.17, 1.652), (0, -0.43, 1.598), 0.33, 0.026, (0, 0.2, 1), "blaze_deep", chamfer=0.5, taper=0.86)
    if lod <= 1:
        tag = H.add(parts, "badge", "Hat")
        box(tag, (0, -0.226, 1.74), (0, -0.236, 1.74), 0.07, 0.05, (0, 0, 1), "yellow", chamfer=0.35)
    return _net(parts, lod)


def _head(parts, look, lod):
    """The base head, dropping the small parts at the minions' last detail level."""
    if lod < 3:
        H.build_head(parts, look, lod)
        return
    skin, deep = look["skin"], look["skin"] + "_deep"
    head = H.add(parts, "head", "Head")
    ellipsoid_xyz(head, H.C, hp.HEAD_RADII, skin, 8, 6)
    if look.get("hair"):
        hair = H.add(parts, "hair", "Head")
        ellipsoid_xyz(hair, (0.0, 0.035, 1.605), (0.19, 0.165, 0.175), look["hair"], 8, 4)
    nose = H.add(parts, "nose", "Head")
    p, _ = H.head_point(0, -9, 0.022)
    big = look.get("nose_scale", 1.0)
    ellipsoid_xyz(nose, p, (0.052 * big, 0.048 * big, 0.046 * big), deep, 5, 3)
    whites = H.add(parts, "eyes", "Head")
    pupils = H.add(parts, "pupils", "Head")
    for s in (1, -1):
        H.on_face(whites, 21 * s, 4, (0.044, 0.022, 0.054), "eye_white", 6, 3, out=-0.008)
        H.on_face(pupils, (21 - look.get("look_in", 3.0)) * s, 2, (0.024, 0.012, 0.03), "pupil", 5, 3, out=0.006)


MINION_LOOKS = {
    "beater": dict(id="beater", name="Beater", skin="skin_a", hair="straw", dress=dress_beater, glove="skin_a",
                   brow="straw_deep", brow_in=24, brow_out=10, nose_scale=1.25, look_in=-2.0, minion=True,
                   lods=(1, 2, 3), scale=1.0),
    "recruit": dict(id="recruit", name="Recruit", skin="skin_b", hair="hair_brown", dress=dress_recruit,
                    glove="jacket_deep", brow_in=10, brow_out=24, nose_scale=0.85, look_in=4.0, minion=True,
                    lods=(1, 2, 3), scale=RECRUIT_SCALE),
}
