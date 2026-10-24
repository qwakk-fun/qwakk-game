"""The four hunter looks on the shared body: clothes, hats, faces, back gear and each one's gun.

Guns are built in WeaponSocket space (x: the gun's right, y: the barrel, z: the gun's top; origin at the
right fist) and skinned rigidly to WeaponSocket. Every gun puts its forend under the left fist at
y = hp.SUPPORT_Y, so one set of clips holds all of them.
"""

import math

from mathutils import Matrix, Vector

import hp
import hrig
import human as H
from mesh import L, box, ellipsoid_xyz, geo, tube

REG_TORSO = [(0, 0.80), (0.17, 0.805), (0.22, 0.84), (0.228, 0.92), (0.232, 1.04), (0.242, 1.17), (0.247, 1.27),
             (0.236, 1.34), (0.19, 1.40), (0.10, 1.445), (0, 1.455)]
PELVIS = [(0, 0.76), (0.17, 0.765), (0.205, 0.80), (0.215, 0.88), (0.215, 0.95), (0.19, 0.99), (0, 1.0)]


def scaled(profile, k):
    return [(r * k, z) for r, z in profile]


# ----------------------------------------------------------------- gun space

SOCK_O = hrig.fist(-1)
SOCK_B = hrig.SOCKET_B
SOCK_U = hrig.SOCKET_U
SOCK_R = SOCK_B.cross(SOCK_U)


def G(x, y, z):
    return SOCK_O + SOCK_R * x + SOCK_B * y + SOCK_U * z


def gbox(part, y0, y1, z0, z1, w, h, cell, x=0.0, taper=1.0, chamfer=0.32):
    box(part, G(x, y0, z0), G(x, y1, z1), w, h, SOCK_U, cell, chamfer=chamfer, taper=taper)


def gtube(part, y0, y1, z, r, cell, lod, x=0.0, segs=8):
    tube(part, [G(x, y0, z), G(x, y1, z)], r, L(lod, segs, 6, 5), cell, caps=True, cap_rings=1)


def gun_part(parts):
    return H.add(parts, "gun", "WeaponSocket")


def rifle(parts, lod):
    g = gun_part(parts)
    gbox(g, -0.37, -0.05, -0.025, 0.03, 0.05, 0.115, "wood", taper=0.62)
    if lod <= 1:
        gbox(g, -0.385, -0.362, -0.026, -0.026, 0.054, 0.12, "dark")
    if lod <= 1:
        gbox(g, -0.07, 0.04, 0.0, 0.04, 0.042, 0.05, "wood_deep")
    gbox(g, -0.01, 0.21, 0.058, 0.058, 0.046, 0.058, "gunmetal")
    gtube(g, 0.19, 0.77, 0.066, 0.0145, "gunmetal", lod)
    gbox(g, 0.15, 0.47, 0.036, 0.042, 0.044, 0.04, "wood", taper=0.85)
    if lod <= 1:
        gtube(g, -0.03, 0.25, 0.128, 0.024, "gunmetal", lod, segs=10)
        gtube(g, 0.215, 0.255, 0.128, 0.03, "blaze", lod, segs=10)
    if lod == 0:
        gbox(g, 0.02, 0.05, 0.09, 0.09, 0.02, 0.04, "gun_light")
        gbox(g, 0.17, 0.20, 0.09, 0.09, 0.02, 0.04, "gun_light")
        tube(g, [G(0.02, 0.10, 0.06), G(0.065, 0.085, 0.045)], 0.008, 6, "gun_light")
        ellipsoid_xyz(g, G(0.068, 0.084, 0.044), (0.014, 0.014, 0.014), "gun_light", 6, 4)
    return (0.0, 0.775, 0.066)


def shotgun(parts, lod):
    g = gun_part(parts)
    gbox(g, -0.34, -0.05, -0.02, 0.03, 0.052, 0.11, "wood_deep", taper=0.62)
    if lod <= 1:
        gbox(g, -0.355, -0.335, -0.021, -0.021, 0.056, 0.115, "dark")
    if lod <= 1:
        gbox(g, -0.07, 0.03, 0.0, 0.04, 0.044, 0.05, "wood_deep")
    gbox(g, -0.02, 0.19, 0.06, 0.06, 0.054, 0.072, "gunmetal")
    gtube(g, 0.17, 0.67, 0.076, 0.017, "gunmetal", lod)
    if lod <= 1:
        gtube(g, 0.17, 0.60, 0.043, 0.0135, "gun_light", lod)
    gbox(g, 0.25, 0.43, 0.045, 0.045, 0.054, 0.052, "wood")
    if lod == 0:
        ellipsoid_xyz(g, G(0, 0.66, 0.097), (0.006, 0.006, 0.006), "blaze", 6, 3)
    return (0.0, 0.68, 0.076)


def light_gun(parts, lod):
    g = gun_part(parts)
    gbox(g, -0.30, -0.05, -0.015, 0.028, 0.046, 0.095, "wood", taper=0.66)
    gbox(g, -0.20, -0.12, 0.0, 0.0, 0.05, 0.10, "blaze")
    if lod <= 1:
        gbox(g, -0.06, 0.03, 0.0, 0.036, 0.04, 0.046, "wood_deep")
    gbox(g, -0.01, 0.13, 0.054, 0.054, 0.042, 0.05, "gunmetal")
    gtube(g, 0.12, 0.52, 0.062, 0.0135, "gunmetal", lod)
    gbox(g, 0.13, 0.40, 0.036, 0.04, 0.04, 0.036, "wood", taper=0.85)
    if lod == 0:
        gtube(g, 0.085, 0.13, 0.054, 0.025, "brass", lod)
    return (0.0, 0.53, 0.062)


def double_barrel(parts, lod):
    g = gun_part(parts)
    gbox(g, -0.40, -0.05, -0.03, 0.03, 0.066, 0.135, "wood_deep", taper=0.6)
    if lod <= 1:
        gbox(g, -0.415, -0.39, -0.031, -0.031, 0.07, 0.14, "dark")
    if lod <= 1:
        gbox(g, -0.07, 0.03, 0.0, 0.04, 0.05, 0.055, "wood_deep")
    gbox(g, -0.03, 0.13, 0.058, 0.058, 0.08, 0.078, "brass")
    for x in (0.023, -0.023):
        gtube(g, 0.11, 0.82, 0.068, 0.021, "gunmetal", lod, x=x)
    gbox(g, 0.13, 0.43, 0.036, 0.04, 0.075, 0.042, "wood", taper=0.9)
    if lod <= 1:
        gbox(g, 0.12, 0.80, 0.093, 0.093, 0.016, 0.012, "gun_light")
    if lod == 0:
        for x in (0.023, -0.023):
            gtube(g, 0.80, 0.83, 0.068, 0.025, "gun_light", lod, x=x)
    return (0.0, 0.835, 0.068)


# ----------------------------------------------------------------- shared pieces


def pelvis(parts, lod, cell, k=1.0):
    p = H.add(parts, "pelvis", hrig.pelvis)
    geo.lathe(p, scaled(PELVIS, k), L(lod, 5, 4, 3), L(lod, 14, 10, 8), cell, scale=(1.0, 0.8))


def mustache(parts, lod, cell, size=1.0):
    m = H.add(parts, "mustache", "Head")
    for s in (1, -1):
        p, n = H.head_point(6 * s, -18, 0.03)
        geo.ellipsoid(m, p + Vector((0.025 * s * size, 0, 0)), (0.05 * size, 0.024 * size, 0.024 * size),
                      geo.frame_from_normal(n), L(lod, 6, 6, 4), L(lod, 4, 4, 3), cell)


def cap_dome(part, lod, cell, r=0.198, bottom=1.648, top=1.815, cy=-0.01):
    prof = [(0, bottom), (r * 0.96, bottom + 0.004), (r, bottom + 0.05), (r * 0.95, bottom + 0.11), (r * 0.74, top - 0.03),
            (r * 0.38, top - 0.004), (0, top)]
    geo.lathe(part, prof, L(lod, 6, 5, 3), L(lod, 14, 10, 8), cell, center=(0, cy, 0))


# ----------------------------------------------------------------- looks


def dress_rifleman(parts, look, lod):
    H.build_torso(parts, look, lod, REG_TORSO, (1.0, 0.8),
                  lambda c: "jacket_deep" if c.z < 0.865 else "camo0")
    vest = [(0, 0.97), (0.2, 0.975), (0.243, 1.0), (0.25, 1.08), (0.26, 1.18), (0.265, 1.27), (0.252, 1.33), (0.2, 1.375),
            (0, 1.385)]

    def vest_cells(c):
        if c.y < 0 and abs(c.x) < 0.022:
            return "dark"
        if c.z < 1.03:
            return "blaze_deep"
        return "blaze"
    H.build_torso(parts, look, lod, vest, (1.0, 0.8), vest_cells, name="vest", rings=(6, 5, 4))
    H.collar(parts, look, lod, "jacket_olive")
    pelvis(parts, lod, "pants")
    H.build_arms(parts, look, lod, "camo0", "jacket_deep")
    H.build_legs(parts, look, lod, "pants")
    H.build_boots(parts, look, lod)
    H.build_neck(parts, look, lod)
    H.build_head(parts, look, lod)
    mustache(parts, lod, "hair_brown")
    hat = H.add(parts, "hat", "Hat")
    cap_dome(hat, lod, "blaze")
    box(hat, (0, -0.13, 1.682), (0, -0.335, 1.664), 0.27, 0.026, (0, 0, 1), "blaze_deep", chamfer=0.5, taper=0.8)
    if lod == 0:
        ellipsoid_xyz(hat, (0, -0.01, 1.815), (0.022, 0.022, 0.014), "blaze_deep", 6, 3)
    return rifle(parts, lod)


def dress_trapper(parts, look, lod):
    k = 1.1
    H.build_torso(parts, look, lod, scaled(REG_TORSO, k), (1.0, 0.8),
                  lambda c: "coat_deep" if (c.y < 0 and abs(c.x) < 0.02) else "camo1")
    sk = H.add(parts, "coat_skirt", hrig.skirt)
    skirt = [(0, 0.62), (0.24, 0.625), (0.272, 0.66), (0.262, 0.80), (0.255, 0.93), (0.24, 1.0), (0, 1.01)]
    geo.lathe(sk, skirt, L(lod, 6, 4, 3), L(lod, 16, 12, 8),
              lambda c: "coat_deep" if (c.z < 0.665 or (c.y < 0 and abs(c.x) < 0.02)) else "camo1", scale=(1.0, 0.82))
    H.collar(parts, look, lod, "fur", major=0.125, minor=0.055, z=1.42)
    pelvis(parts, lod, "pants_deep")
    H.build_arms(parts, look, lod, "camo1", "fur", r=0.084)
    H.build_legs(parts, look, lod, "pants_deep", r=0.092)
    H.build_boots(parts, look, lod, shaft_top=0.33, r=0.082)
    H.build_neck(parts, look, lod)
    H.build_head(parts, look, lod)
    beard = H.add(parts, "beard", "Head")
    ellipsoid_xyz(beard, (0, -0.04, 1.50), (0.178, 0.158, 0.115), "brow", L(lod, 10, 8, 8), L(lod, 6, 5, 4))
    mustache(parts, lod, "brow", 0.9)
    hat = H.add(parts, "hat", "Hat")
    cap_dome(hat, lod, "blaze", r=0.205, bottom=1.645, top=1.84)
    H.torus(hat, (0, -0.01, 1.675), 0.198, 0.04, "fur", L(lod, 12, 10, 8), 4)
    for s in (1, -1):
        ellipsoid_xyz(hat, (0.196 * s, 0.0, 1.55), (0.045, 0.085, 0.105), "fur", L(lod, 6, 6, 4), L(lod, 5, 4, 3))
    # back gear: a pack with a rolled net on top and a rope coil
    gear = H.add(parts, "gear", "Spine2")
    box(gear, (0, 0.27, 1.02), (0, 0.27, 1.33), 0.32, 0.15, (0, 1, 0), "bag", chamfer=0.4)
    box(gear, (0, 0.175, 1.30), (0, 0.175, 1.05), 0.36, 0.03, (0, 1, 0), "bag_deep", chamfer=0.3)
    straps = H.add(parts, "packstraps", hrig.torso)
    for sx in (1, -1):
        tube(straps, [(0.12 * sx, 0.2, 1.32), (0.15 * sx, 0.05, 1.45), (0.16 * sx, -0.17, 1.36), (0.15 * sx, -0.22, 1.20),
                      (0.14 * sx, -0.22, 1.06)], 0.022, 4, "blaze", ry=0.009, samples=L(lod, 5, 4, 3), cap_rings=1)
    tube(gear, [(-0.21, 0.28, 1.40), (0.21, 0.28, 1.40)], 0.075, L(lod, 8, 6, 5), "net", caps=True, cap_rings=1)
    if lod <= 1:
        for x in (-0.12, 0.12):
            tube(gear, [(x, 0.28, 1.40 - 0.08), (x, 0.28 + 0.08, 1.40), (x, 0.28, 1.40 + 0.08), (x, 0.28 - 0.08, 1.40)],
                 0.011, 4, "net_deep", caps=True, cap_rings=1, samples=L(lod, 6, 5))
        rope = H.add(parts, "rope", "Spine2")
        rot_pts = []
        for i in range(13):
            a = 2 * math.pi * i / 12
            rot_pts.append((0.185, 0.27 + 0.075 * math.cos(a), 1.13 + 0.075 * math.sin(a)))
        tube(rope, rot_pts, 0.02, 4, "rope", caps=True, cap_rings=1, samples=L(lod, 11, 8))
    return shotgun(parts, lod)


def dress_decoy(parts, look, lod):
    H.build_torso(parts, look, lod, REG_TORSO, (1.0, 0.8), "camo0")
    bib = [(0, 0.80), (0.2, 0.805), (0.236, 0.85), (0.245, 0.95), (0.25, 1.06), (0.26, 1.16), (0.258, 1.205), (0.2, 1.222),
           (0, 1.226)]
    H.build_torso(parts, look, lod, bib, (1.0, 0.8),
                  lambda c: "wader_deep" if c.z > 1.19 else "wader", name="waders", rings=(6, 5, 4))
    H.collar(parts, look, lod, "camo0", major=0.11, minor=0.036)
    pelvis(parts, lod, "wader")
    H.build_arms(parts, look, lod, "camo0", "jacket_deep")
    H.build_legs(parts, look, lod, "wader", r=0.094)
    H.build_boots(parts, look, lod, boot="wader_deep", shaft_top=0.26, r=0.088)
    straps = H.add(parts, "straps", hrig.torso)
    for s in (1, -1):
        tube(straps, [(0.10 * s, -0.205, 1.20), (0.12 * s, -0.19, 1.33), (0.14 * s, -0.06, 1.425), (0.14 * s, 0.08, 1.40),
                      (0.11 * s, 0.195, 1.27), (0.09 * s, 0.205, 1.19)], 0.016, 4, "wader_deep",
             ry=0.008, samples=L(lod, 8, 6, 4), cap_rings=1)
    H.build_neck(parts, look, lod)
    H.build_head(parts, look, lod)
    # round glasses
    gl = H.add(parts, "glasses", "Head")
    rings = []
    for s in (1, -1):
        p, n = H.head_point(21 * s, 4, 0.022)
        rings.append(p)
        _torus_facing(gl, p, n, 0.052, 0.009, "glass_frame", L(lod, 8, 8, 6), 3)
        ear, _ = H.head_point(78 * s, 2, 0.006)
        if lod <= 1:
            tube(gl, [p + Vector((0.05 * s, 0.0, 0.0)), ear], 0.007, 4, "glass_frame", caps=True, cap_rings=1)
    tube(gl, [rings[0] - Vector((0.05, 0, -0.006)), rings[1] + Vector((0.05, 0, 0.006))], 0.008, 4, "glass_frame",
         caps=False)
    # bucket hat: camo dome, blaze band, wide soft brim
    hat = H.add(parts, "hat", "Hat")
    cap_dome(hat, lod, "camo0", r=0.2, bottom=1.655, top=1.83)
    geo.lathe(hat, [(0, 1.66), (0.29, 1.635), (0.305, 1.652), (0.22, 1.692), (0, 1.71)], L(lod, 4, 3, 3), L(lod, 14, 10, 8),
              "camo0", center=(0, -0.01, 0))
    H.torus(hat, (0, -0.01, 1.70), 0.197, 0.022, "blaze", L(lod, 10, 8, 8), 3)
    # duck call on a cord
    call = H.add(parts, "call", "Spine2")
    tube(call, [(0, -0.232, 1.30), (0, -0.236, 1.22)], 0.021, L(lod, 6, 6, 4), "wood", caps=True, cap_rings=1)
    tube(call, [(0, -0.236, 1.225), (0, -0.236, 1.195)], 0.014, L(lod, 6, 4, 4), "dark", caps=True, cap_rings=1)
    if lod <= 1:
        cord = H.add(parts, "cord", hrig.torso)
        tube(cord, [(-0.11, -0.12, 1.43), (-0.05, -0.215, 1.34), (0, -0.232, 1.30), (0.05, -0.215, 1.34), (0.11, -0.12, 1.43)],
             0.006, 3, "rope", caps=True, cap_rings=1, samples=L(lod, 6, 5))
    # bag of wooden decoys on the left hip, strap over the right shoulder
    bag = H.add(parts, "bag", "Hips")
    box(bag, (0.27, 0.0, 0.76), (0.27, 0.0, 1.00), 0.12, 0.25, (0, 1, 0), "bag", chamfer=0.45)
    for y in ((-0.06, 0.07) if lod <= 1 else (-0.06,)):
        ellipsoid_xyz(bag, (0.27, y, 1.035), (0.045, 0.05, 0.045), "decoy_head", L(lod, 6, 6, 4), L(lod, 4, 4, 3))
        if lod <= 1:
            ellipsoid_xyz(bag, (0.27, y - 0.05, 1.03), (0.02, 0.03, 0.012), "decoy_bill", 6, 3)
    strap = H.add(parts, "bagstrap", hrig.torso)
    tube(strap, [(0.25, -0.05, 1.0), (0.17, -0.2, 1.12), (-0.05, -0.22, 1.30), (-0.17, -0.13, 1.40), (-0.19, 0.04, 1.40),
                 (-0.10, 0.19, 1.28), (0.12, 0.2, 1.10), (0.25, 0.06, 1.0)], 0.02, 4, "bag_deep", ry=0.008,
         samples=L(lod, 10, 8, 6), cap_rings=1)
    return light_gun(parts, lod)


def _torus_facing(part, center, normal, major, minor, cell, n_major, n_minor):
    n = Vector(normal).normalized()
    a = Vector((1, 0, 0))
    a = (a - n * a.dot(n)).normalized()
    b = n.cross(a)
    rings = []
    for i in range(n_major + 1):
        t = 2 * math.pi * i / n_major
        d = a * math.cos(t) + b * math.sin(t)
        ring = []
        for j in range(n_minor):
            u = 2 * math.pi * j / n_minor
            ring.append(Vector(center) + d * (major + math.cos(u) * minor) + n * (math.sin(u) * minor))
        rings.append(ring)
    part.ring_stack(rings, cell)


def dress_boss(parts, look, lod):
    prof = [(0, 0.80), (0.2, 0.81), (0.26, 0.86), (0.29, 0.95), (0.30, 1.05), (0.295, 1.15), (0.28, 1.25), (0.262, 1.33),
            (0.21, 1.40), (0.11, 1.45), (0, 1.46)]

    def coat_cells(c):
        if c.y < 0 and c.z > 1.16 and abs(c.x) < (c.z - 1.16) * 0.75:
            return "shirt"
        if c.y < 0 and abs(c.x) < 0.02:
            return "coat_deep"
        return "coat_brown"
    H.build_torso(parts, look, lod, prof, (1.0, 0.84), coat_cells, push=0.035)
    sk = H.add(parts, "coat_skirt", hrig.skirt)
    skirt = [(0, 0.42), (0.27, 0.425), (0.305, 0.47), (0.29, 0.70), (0.285, 0.88), (0.27, 0.99), (0, 1.0)]
    geo.lathe(sk, skirt, L(lod, 6, 4, 3), L(lod, 16, 12, 8),
              lambda c: "coat_deep" if (c.z < 0.47 or (c.y < 0 and abs(c.x) < 0.022)) else "coat_brown", scale=(1.0, 0.86))
    H.collar(parts, look, lod, "coat_deep", major=0.13, minor=0.05, z=1.425)
    pelvis(parts, lod, "pants_deep", k=1.12)
    H.build_arms(parts, look, lod, "coat_brown", "coat_deep", r=0.09)
    H.build_legs(parts, look, lod, "pants_deep", r=0.10)
    H.build_boots(parts, look, lod, shaft_top=0.36, r=0.088)
    H.build_neck(parts, look, lod)
    H.build_head(parts, look, lod)
    beard = H.add(parts, "beard", "Head")
    ellipsoid_xyz(beard, (0, -0.085, 1.47), (0.19, 0.15, 0.15), "beard", L(lod, 10, 8, 8), L(lod, 6, 5, 4))
    ellipsoid_xyz(beard, (0, -0.15, 1.35), (0.13, 0.105, 0.12), "beard", L(lod, 8, 6, 6), L(lod, 5, 4, 3))
    mustache(parts, lod, "beard_deep", 1.25)
    # bandolier with shells, left shoulder to right hip
    band = H.add(parts, "bandolier", hrig.torso)
    pts = [(0.19, -0.13, 1.40), (0.09, -0.262, 1.24), (-0.07, -0.30, 1.07), (-0.2, -0.24, 0.94), (-0.28, -0.05, 0.92)]
    tube(band, pts, 0.032, 4, "blaze", ry=0.012, samples=L(lod, 6, 5, 4), cap_rings=1)
    if lod <= 1:
        path = geo.catmull(pts, 9)
        for k in range(2, 7, 2):
            p = path[k]
            n = Vector((p.x * 0.3, p.y, 0)).normalized()
            tube(band, [p + n * 0.012 + Vector((0, 0, 0.03)), p + n * 0.012 - Vector((0, 0, 0.03))], 0.012, 5,
                 "shell_red" if k % 2 else "brass", caps=True)
    # whistle on a lanyard
    cord = H.add(parts, "lanyard", hrig.lanyard)
    w = Vector(hp.WHISTLE_REST)
    tube(cord, [(-0.10, -0.16, 1.41), (-0.04, -0.27, 1.27), w + Vector((0, 0.005, 0.03)), (0.04, -0.27, 1.27),
                (0.10, -0.16, 1.41)], 0.007, 3, "rope", caps=True, cap_rings=1, samples=L(lod, 6, 5, 5))
    wh = H.add(parts, "whistle", "Whistle")
    box(wh, w + Vector((0, 0, 0.025)), w + Vector((0, 0, -0.04)), 0.05, 0.035, (0, -1, 0), "whistle", chamfer=0.5)
    if lod <= 1:
        tube(wh, [w + Vector((0, 0, -0.035)), w + Vector((0, 0, -0.075))], 0.011, 6, "yellow", caps=True, cap_rings=1)
    # felt hat: tall pinched crown, wide brim, blaze band, a big yellow feather
    hat = H.add(parts, "hat", "Hat")
    crown = [(0, 1.66), (0.2, 1.662), (0.205, 1.70), (0.19, 1.80), (0.17, 1.89), (0.12, 1.935), (0.04, 1.925), (0, 1.915)]
    geo.lathe(hat, crown, L(lod, 5, 5, 4), L(lod, 12, 10, 8), "felt", center=(0, -0.01, 0), scale=(1.0, 0.92))
    geo.lathe(hat, [(0, 1.665), (0.33, 1.65), (0.35, 1.67), (0.24, 1.70), (0, 1.71)], L(lod, 4, 3, 3), L(lod, 14, 12, 8),
              "felt_deep", center=(0, -0.01, 0))
    H.torus(hat, (0, -0.01, 1.705), 0.197, 0.028, "blaze", L(lod, 10, 8, 8), 3, scale_y=0.92)
    fpts = [(0.17, 0.06, 1.71), (0.23, 0.13, 1.84), (0.22, 0.23, 1.98), (0.17, 0.33, 2.06)]
    tube(hat, fpts, [0.03, 0.042, 0.032, 0.008], L(lod, 6, 5, 4), "yellow", ry=[0.012, 0.014, 0.012, 0.004],
         samples=L(lod, 7, 5, 4), cap_rings=1)
    if lod <= 1:
        tube(hat, fpts[:3], 0.006, 3, "yellow_deep", samples=5, cap_rings=1)
    return double_barrel(parts, lod)


LOOKS = {
    "rifleman": dict(id="rifleman", name="Rifleman", skin="skin_a", hair="hair_brown", dress=dress_rifleman),
    "trapper": dict(id="trapper", name="Trapper", skin="skin_c", hair="brow", dress=dress_trapper, brow_in=14,
                    nose_scale=1.08),
    "decoy": dict(id="decoy", name="Decoy thrower", skin="skin_b", hair="hair_brown", dress=dress_decoy, look_in=1.0,
                  brow_in=20, brow_out=18),
    "boss": dict(id="boss", name="Big Hunter", skin="skin_a", hair="hair_ginger", dress=dress_boss, beard=True,
                 brow="beard", brow_r=0.025, brow_in=13, nose="nose_red", nose_scale=1.3, boss=True, hair_segs=(10, 8, 6)),
}


from minions import MINION_LOOKS  # noqa: E402  (the minion looks reuse the helpers above)

LOOKS.update(MINION_LOOKS)


def scale_of(look_id):
    """The Root node scale a look ships with (boss 1.24, recruit 0.72, everyone else 1)."""
    look = LOOKS[look_id]
    if look.get("boss"):
        return hp.BOSS_SCALE
    return look.get("scale", 1.0)


def build(look_id, lod):
    """Parts of one look at one LOD, plus the Muzzle in WeaponSocket space."""
    look = LOOKS[look_id]
    parts = []
    muzzle = look["dress"](parts, look, lod)
    return parts, muzzle
