"""Duck Plaza props (the social hub, map id `duck-plaza`): the mode portal arch, the fountain, park bench,
street lamp, duck statue, flower bed, the leaderboard board, a market stall and a cafe set.

Blender space: meters, Z up, the front faces -Y (glTF +Z), origin centered on the ground. Built with the
kit (kit.py) and its palette only. Every prop has one LOD (LOD0).

Numbers the game code depends on (Blender coordinates; glTF is x, z, -y):

plaza_portal   overall x -3.5..3.5, y -0.8..0.8, top about 7.25.
               OPENING (walk-through, nothing inside it but 0.02 m mesh-only paving): x -2.1..2.1,
               straight sides z 0..3.4, then a semicircle of radius 2.1 centered at (x 0, z 3.4), peak z 5.5.
               PLAQUE: cream rectangle x -1.6..1.6, z 5.7..6.4 on both faces, at y -0.86 (front) and +0.86 (back),
               framed in wood_dark bars proud to |y| 0.89.
               Colliders ("wall"): pillars x -3.5..-2.1 and 2.1..3.5, y -0.8..0.8, z 0..6.6;
               top box x -3.5..3.5, y -0.8..0.8, z 5.5..6.6.
plaza_fountain basin outer r 3.4, rim r 3.0..3.4, rim top z 0.65, water z 0.5. Colliders: floor cylinder r 3.0
               z 0..0.25 ("floor"); 12 rim boxes of 30 degrees, radial 3.0..3.4, z 0..0.65 ("cover"); center column
               cylinder r 0.45 z 0..3.3 ("block"); middle bowl cylinder r 1.3 z 1.55..1.85 ("cover").
plaza_bench    1.9 x 0.7, seat top z 0.48, backrest on +Y to z 0.95 (the sitter faces -Y). Colliders ("cover"):
               seat x +-0.95, y -0.35..0.35, z 0..0.5; back x +-0.95, y 0.2..0.35, z 0.5..0.95.
plaza_lamp     base r 0.22 h 0.4, post r 0.09, lantern z 3.4..4.1. Collider cylinder r 0.18 z 0..3.6 ("block").
plaza_statue   plinth 1.8 x 1.8 x 1.3, bronze duck on it to about 3.4. Colliders: plinth box, duck cylinder r 0.7
               z 1.3..3.3 (both "block").
plaza_flowerbed 3.2 x 1.4, border 0.35 tall, earth z 0.3. Collider box x +-1.6, y +-0.7, z 0..0.35 ("cover").
plaza_board    posts at x +-3.0 (y 0..0.3) to z 5.2, panel x -3.1..3.1, y -0.125..0.125, z 1.4..4.8, roof z 4.9..5.3.
               FACE: dark (#151619) rectangle x -2.9..2.9, z 1.55..4.65 at y -0.13 (front); the client draws the
               top 10 on a plane right over it. Colliders: posts ("block"), panel x +-3.1, y +-0.15, z 1.4..4.8 ("wall").
plaza_stall    market stall 3.0 x 1.8: counter on the front (-Y) 1.0 high, four posts, striped awning.
plaza_cafe     round table r 0.45 (top z 0.75), two chairs at y +-0.8, a parasol r 1.4 at about 2.3.
"""

import math

from mathutils import Vector

from kit import Prop, Rng


def blob(p, at, r, cell, rng, squash=1.0, segs=7, rings=5, jitter=0.1):
    p.sphere((r, r * rng.range(0.88, 1.08), r * squash), at, cell, segs=segs, rings=rings, smooth=True, jitter=jitter, rng=rng,
             rot=(0, 0, rng.range(0, 360)))


def ring(p, r_in, r_out, z0, z1, cell, segs=24, top=None, inner=None, a0=0.0, a1=360.0, closed_ring=True):
    """Annulus solid (rectangular section) between r_in and r_out, z0..z1. Faces: outer `cell`, top `top`,
    inner `inner`. A full ring when closed_ring, else an arc a0..a1 degrees with end caps."""
    n = segs if closed_ring else segs + 1
    verts = []
    for j in range(n):
        a = math.radians(a0 + (a1 - a0) * j / segs)
        c, s = math.cos(a), math.sin(a)
        verts += [Vector((c * r_in, s * r_in, z0)), Vector((c * r_out, s * r_out, z0)),
                  Vector((c * r_out, s * r_out, z1)), Vector((c * r_in, s * r_in, z1))]
    faces, cells = [], []
    m = segs
    for j in range(m):
        a = 4 * j
        b = 4 * ((j + 1) % n) if closed_ring else 4 * (j + 1)
        faces += [(a + 1, b + 1, b + 2, a + 2), (a + 2, b + 2, b + 3, a + 3), (a + 3, b + 3, b + 0, a + 0), (a + 0, b + 0, b + 1, a + 1)]
        cells += [cell, top or cell, inner or cell, cell]
    if not closed_ring:
        faces += [(0, 1, 2, 3), (4 * m + 3, 4 * m + 2, 4 * m + 1, 4 * m)]
        cells += [cell, cell]
    p.add(verts, faces, cell, cells=cells)


def card2(p, pts, cell):
    """Double-sided polygon (parasol panels, awning scallops)."""
    vs = [Vector(v) for v in pts]
    n = len(vs)
    p.add(vs, [tuple(range(n)), tuple(reversed(range(n)))], cell, closed=False)


# ---------------------------------------------------------------- the portal arch
R_OPEN = 2.1
Z_SPRING = 3.4


def plaza_portal():
    p = Prop("plaza_portal", "plaza")
    rng = Rng(301)
    # pillars (brick) on a stone plinth, stone quoins on the outer corners, a capital band at the springing line
    for sx in (-1, 1):
        x0, x1 = sorted((sx * R_OPEN, sx * 3.5))
        p.boxmm((x0, -0.8, 0.0), (x1, 0.8, 6.6), "brick", bevel=0.03)
        p.boxmm((x0, -0.9, 0.0), (x1, 0.9, 0.6), "stone", top="stone_dark", bevel=0.05)
        p.boxmm((x0, -0.88, Z_SPRING - 0.25), (x1, 0.88, Z_SPRING), "stone_dark", bevel=0.04, bottom=True)
        # quoins: alternating stone blocks on the outer edge, both faces
        z = 0.75
        k = 0
        while z < Z_SPRING - 0.4:
            w = 0.55 if k % 2 == 0 else 0.38
            xo = sx * 3.5
            xi = xo - sx * w
            for sy in (-1, 1):
                p.boxmm((min(xo, xi), sy * 0.8 - 0.05 if sy > 0 else -0.85, z), (max(xo, xi), 0.85 if sy > 0 else -0.8 + 0.05, z + 0.32),
                        "stone" if k % 2 == 0 else "rock_light", bevel=0.03, bottom=True)
            z += 0.4
            k += 1
        # a small round lantern-ish yellow boss on each pillar face at the springing line
        for sy in (-1, 1):
            p.sphere((0.16, 0.08, 0.16), (sx * 2.8, sy * 0.9, Z_SPRING - 0.6), "yellow", segs=8, rings=4, smooth=True)
    # arch infill above the opening: trapezoid hulls from the arc up to z 6.6, plaster
    n = 16
    for j in range(n):
        a0 = math.pi * j / n
        a1 = math.pi * (j + 1) / n
        x0, z0 = R_OPEN * math.cos(a0), Z_SPRING + R_OPEN * math.sin(a0)
        x1, z1 = R_OPEN * math.cos(a1), Z_SPRING + R_OPEN * math.sin(a1)
        pts = []
        for y in (-0.8, 0.8):
            pts += [(x0, y, z0), (x1, y, z1), (x1, y, 6.6), (x0, y, 6.6)]
        p.hull(pts, "plaster", cells_fn=lambda c, nn: "stone_dark" if nn.z < -0.3 else "plaster")
    # voussoir band around the arc, both faces, stopping short of the plaque (the plaque is the keystone)
    vn = 6
    for side in (0, 1):
        for j in range(vn):
            lo = 0.0 if side == 0 else 118.0
            a0 = math.radians(lo + 62.0 * j / vn)
            a1 = math.radians(lo + 62.0 * (j + 1) / vn)
            cell = "stone" if j % 2 == 0 else "rock_light"
            for sy in (-1, 1):
                y_in, y_out = sy * 0.8, sy * 0.85
                pts = []
                for y in (y_in, y_out):
                    for a in (a0, a1):
                        pts += [(R_OPEN * math.cos(a), y, Z_SPRING + R_OPEN * math.sin(a)),
                                ((R_OPEN + 0.36) * math.cos(a), y, Z_SPRING + (R_OPEN + 0.36) * math.sin(a))]
                p.hull(pts, cell)
    # cornice and crown
    p.boxmm((-3.65, -0.98, 6.6), (3.65, 0.98, 6.86), "stone_dark", bevel=0.05)
    p.boxmm((-1.2, -0.7, 6.86), (1.2, 0.7, 7.02), "orange", bevel=0.04, bottom=True)
    p.prism([(-0.9, 0.0), (0.9, 0.0), (0.0, 0.32)], 1.2, (0, 0, 7.02), "yellow", axis="Y")
    for sx in (-1, 1):
        p.cyl(0.2, 0.16, (sx * 3.1, 0, 6.94), "stone", segs=8)
        p.sphere((0.19, 0.19, 0.2), (sx * 3.1, 0, 7.15), "yellow", segs=10, rings=6, smooth=True)
    # plaque on both faces: cream plate with its face at |y| 0.86, wood_dark frame bars proud to 0.89
    for sy in (-1, 1):
        yf = sy * 0.86
        p.boxmm((-1.6, min(sy * 0.8, yf), 5.7), (1.6, max(sy * 0.8, yf), 6.4), "cream", bottom=True)
        y0, y1 = sorted((sy * 0.8, sy * 0.89))
        p.boxmm((-1.72, y0, 6.4), (1.72, y1, 6.5), "wood_dark", bottom=True)
        p.boxmm((-1.72, y0, 5.6), (1.72, y1, 5.7), "wood_dark", bottom=True)
        for sx in (-1, 1):
            xa, xb = sorted((sx * 1.6, sx * 1.72))
            p.boxmm((xa, y0, 5.7), (xb, y1, 6.4), "wood_dark", bottom=True)
    # flush paving in the opening (mesh only)
    p.boxmm((-R_OPEN, -0.8, 0.0), (R_OPEN, 0.8, 0.02), "stone_dark")
    # little flower tubs at the outer feet, both faces (outside the opening)
    for sx in (-1, 1):
        for sy in (-1, 1):
            at = (sx * 3.05, sy * 1.25, 0)
            p.cyl(0.28, 0.42, (at[0], at[1], 0.21), "brick", segs=8, r2=0.32)
            for i in range(3):
                blob(p, (at[0] + rng.range(-0.12, 0.12), at[1] + rng.range(-0.12, 0.12), 0.52 + rng.range(0, 0.08)), 0.15,
                     ("flower_pink", "yellow", "white", "orange")[i + (sx + sy + 2) % 2], rng, segs=6, rings=4)
            blob(p, (at[0], at[1], 0.45), 0.24, "leaf", rng, squash=0.7, segs=6, rings=4)
    p.col_boxmm("wall", (-3.5, -0.8, 0.0), (-R_OPEN, 0.8, 6.6))
    p.col_boxmm("wall", (R_OPEN, -0.8, 0.0), (3.5, 0.8, 6.6))
    p.col_boxmm("wall", (-3.5, -0.8, 5.5), (3.5, 0.8, 6.6))
    p.meta["note"] = ("mode portal: opening x -2.1..2.1, straight to 3.4, semicircle r 2.1 (peak 5.5); "
                      "plaque x -1.6..1.6, y 5.7..6.4 at z +-0.86 (glTF); the client draws the swirl and the sign")
    # probes through the opening (checked in build_plaza_props.py)
    p.meta["probes"] = [((x, -3.0, 0.0), (x, 3.0, 0.0), f"opening x={x}") for x in (0.0, -1.4, 1.4)]
    return p


# ---------------------------------------------------------------- fountain
def plaza_fountain():
    p = Prop("plaza_fountain", "plaza")
    rng = Rng(302)
    # basin wall and coping
    ring(p, 3.0, 3.4, 0.0, 0.55, "stone", segs=24, top="stone", inner="stone_dark")
    ring(p, 2.92, 3.5, 0.55, 0.68, "rock_light", segs=24, top="rock_light", inner="stone_dark")
    # water and a floor below it
    p.cyl(3.0, 0.03, (0, 0, 0.485), "water", segs=24)
    p.cyl(3.0, 0.24, (0, 0, 0.12), "stone_dark", segs=24, caps=True)
    # center column, bowls and the duck finial
    p.cyl(0.55, 0.3, (0, 0, 0.5 + 0.15), "stone_dark", segs=10)
    p.cyl(0.35, 1.3, (0, 0, 0.3 + 0.65), "stone", segs=10)
    p.cyl(0.5, 0.3, (0, 0, 1.7), "rock_light", segs=14, r2=1.3, cap_cell="water")
    ring(p, 1.18, 1.32, 1.82, 1.9, "rock_light", segs=14)
    p.cyl(0.25, 0.7, (0, 0, 2.2), "stone", segs=8)
    p.cyl(0.35, 0.2, (0, 0, 2.6), "rock_light", segs=10, r2=0.7, cap_cell="water")
    p.sphere((0.26, 0.34, 0.22), (0, 0.04, 2.94), "yellow", segs=10, rings=6)
    p.sphere((0.17, 0.17, 0.17), (0, -0.2, 3.16), "yellow", segs=10, rings=6)
    p.box((0.12, 0.14, 0.06), (0, -0.39, 3.14), "orange", bevel=0.02)
    p.sphere((0.1, 0.12, 0.08), (0, 0.32, 3.0), "yellow", segs=6, rings=4)
    for sx in (-1, 1):
        p.sphere((0.03, 0.03, 0.03), (sx * 0.1, -0.33, 3.22), "dark", segs=5, rings=3)
    # stylized water streams: from the top bowl rim into the middle bowl, and from the middle bowl into the basin
    for k in range(6):
        a = 2 * math.pi * k / 6 + 0.26
        c, s = math.cos(a), math.sin(a)
        p.tube((c * 0.7, s * 0.7, 2.62), (c * 0.86, s * 0.86, 1.86), 0.035, "water", segs=5, smooth=True)
    for k in range(8):
        a = 2 * math.pi * k / 8
        c, s = math.cos(a), math.sin(a)
        p.tube((c * 1.3, s * 1.3, 1.8), (c * 1.62, s * 1.62, 0.5), 0.04, "water", segs=5, smooth=True)
        p.sphere((0.16, 0.16, 0.05), (c * 1.66, s * 1.66, 0.51), "white", segs=6, rings=3)
    # lily pads
    for k in range(4):
        a = rng.range(0, 2 * math.pi)
        r = rng.range(2.1, 2.6)
        p.cyl(0.24, 0.02, (math.cos(a) * r, math.sin(a) * r, 0.51), "leaf", segs=7)
    # colliders
    p.col_cyl("floor", (0, 0, 0.125), 3.0, 0.25)
    for k in range(12):
        a = math.radians(30 * k + 15)
        rot_z = math.degrees(a)
        r_mid = 3.2
        chord = 2 * 3.4 * math.sin(math.radians(15))
        p.col_box("cover", (math.cos(a) * r_mid, math.sin(a) * r_mid, 0.325), (0.4, chord, 0.65), rot_z=rot_z)
    p.col_cyl("block", (0, 0, 1.65), 0.45, 3.3)
    p.col_cyl("cover", (0, 0, 1.7), 1.3, 0.3)
    return p


# ---------------------------------------------------------------- bench
def plaza_bench():
    p = Prop("plaza_bench", "plaza")
    # iron side frames (legs, armrests)
    for sx in (-1, 1):
        x = sx * 0.88
        p.box((0.08, 0.08, 0.44), (x, -0.26, 0.22), "iron", bevel=0.015)
        p.box((0.08, 0.08, 0.95), (x, 0.28, 0.475), "iron", bevel=0.015, rot=(-8, 0, 0))
        p.box((0.08, 0.62, 0.07), (x, 0.0, 0.42), "iron", bevel=0.015)
        p.box((0.09, 0.56, 0.06), (x, -0.02, 0.68), "iron", bevel=0.02)
        p.box((0.08, 0.08, 0.26), (x, -0.27, 0.56), "iron", bevel=0.015)
        p.sphere((0.06, 0.06, 0.06), (x, -0.3, 0.71), "iron", segs=6, rings=4)
    # seat slats
    for k, y in enumerate((-0.27, -0.12, 0.03, 0.18)):
        p.box((1.84, 0.13, 0.05), (0, y, 0.455), "wood" if k % 2 == 0 else "wood_light", bevel=0.015)
    # back slats, leaning back a little
    for k, z in enumerate((0.6, 0.73, 0.86)):
        p.box((1.84, 0.045, 0.1), (0, 0.28 + (z - 0.6) * 0.14, z), "wood" if k % 2 == 0 else "wood_light", bevel=0.012, rot=(-8, 0, 0))
    p.col_boxmm("cover", (-0.95, -0.35, 0.0), (0.95, 0.35, 0.5))
    p.col_boxmm("cover", (-0.95, 0.2, 0.5), (0.95, 0.35, 0.95))
    return p


# ---------------------------------------------------------------- lamp
def plaza_lamp():
    p = Prop("plaza_lamp", "plaza")
    p.cyl(0.22, 0.4, (0, 0, 0.2), "iron", segs=8, r2=0.17)
    p.cyl(0.15, 0.12, (0, 0, 0.46), "iron", segs=8, r2=0.1)
    p.cyl(0.09, 2.9, (0, 0, 1.95), "iron", segs=8, r2=0.07, caps=False)
    p.cyl(0.12, 0.1, (0, 0, 1.3), "yellow", segs=8)
    p.cyl(0.11, 0.12, (0, 0, 3.36), "iron", segs=8)
    # lantern: four glass panes in an iron frame, a small roof and finial
    p.box((0.4, 0.4, 0.06), (0, 0, 3.43), "iron", bevel=0.01)
    p.box((0.34, 0.34, 0.46), (0, 0, 3.69), "lamp_glass")
    for sx in (-1, 1):
        for sy in (-1, 1):
            p.box((0.05, 0.05, 0.5), (sx * 0.18, sy * 0.18, 3.69), "iron")
    p.box((0.44, 0.44, 0.05), (0, 0, 3.94), "iron", bevel=0.01)
    p.cyl(0.33, 0.13, (0, 0, 4.03), "iron", segs=4, r2=0.04, phase=math.pi / 4)
    p.sphere((0.05, 0.05, 0.05), (0, 0, 4.12), "yellow", segs=6, rings=4)
    p.col_cyl("block", (0, 0, 1.8), 0.18, 3.6)
    return p


# ---------------------------------------------------------------- statue
def plaza_statue():
    p = Prop("plaza_statue", "plaza")
    p.boxmm((-0.9, -0.9, 0.0), (0.9, 0.9, 0.25), "stone_dark", bevel=0.04)
    p.boxmm((-0.8, -0.8, 0.25), (0.8, 0.8, 1.15), "stone", bevel=0.03, bottom=True)
    p.boxmm((-0.9, -0.9, 1.15), (0.9, 0.9, 1.3), "stone_dark", bevel=0.04, bottom=True)
    p.boxmm((-0.5, -0.83, 0.55), (0.5, -0.8, 0.85), "bronze", bottom=True)
    p.boxmm((-0.44, -0.84, 0.6), (0.44, -0.83, 0.8), "yellow", bottom=True)
    # the duck (front -Y), shaped like the game's duck: big round head, round body, chest out, waving one wing
    with p.frame((0, 0.0, 1.3)):
        for sx in (-1, 1):
            p.sphere((0.17, 0.26, 0.06), (sx * 0.2, -0.12, 0.06), "bronze", segs=10, rings=5)
            p.cyl(0.06, 0.32, (sx * 0.18, 0.0, 0.25), "bronze", segs=8)
        p.sphere((0.6, 0.56, 0.58), (0, 0.04, 0.88), "bronze", segs=18, rings=11)
        p.sphere((0.42, 0.3, 0.42), (0, -0.24, 0.98), "bronze", segs=16, rings=10)
        p.sphere((0.2, 0.22, 0.26), (0, 0.58, 1.02), "bronze", segs=10, rings=6, rot=(40, 0, 0))
        p.sphere((0.46, 0.44, 0.46), (0, -0.1, 1.72), "bronze", segs=18, rings=11)
        p.sphere((0.23, 0.2, 0.075), (0, -0.56, 1.64), "yellow", segs=12, rings=6)
        for sx in (-1, 1):
            p.sphere((0.055, 0.04, 0.075), (sx * 0.17, -0.5, 1.82), "dark", segs=8, rings=5)
        p.sphere((0.05, 0.1, 0.16), (0, -0.05, 2.22), "bronze", segs=8, rings=5, rot=(-25, 0, 0))
        # wings: the left one folded, the right one up in a wave
        p.sphere((0.11, 0.36, 0.28), (-0.58, 0.08, 0.92), "bronze", segs=12, rings=7, rot=(-12, 8, 0))
        p.sphere((0.11, 0.2, 0.4), (0.72, -0.04, 1.5), "bronze", segs=12, rings=7, rot=(0, 38, 0))
    p.col_boxmm("block", (-0.9, -0.9, 0.0), (0.9, 0.9, 1.3))
    p.col_cyl("block", (0, 0, 2.3), 0.7, 2.0)
    return p


# ---------------------------------------------------------------- flower bed
FLOWERS = ("flower_pink", "yellow", "white", "orange", "lamp_red")


def plaza_flowerbed():
    p = Prop("plaza_flowerbed", "plaza")
    rng = Rng(306)
    t = 0.16
    for sy in (-1, 1):
        p.boxmm((-1.6, sy * 0.7 - (t if sy > 0 else 0), 0), (1.6, sy * 0.7 + (0 if sy > 0 else t), 0.35), "stone", top="rock_light", bevel=0.03)
    for sx in (-1, 1):
        p.boxmm((sx * 1.6 - (t if sx > 0 else 0), -0.7 + t, 0), (sx * 1.6 + (0 if sx > 0 else t), 0.7 - t, 0.35), "stone", top="rock_light", bevel=0.03)
    p.boxmm((-1.6 + t, -0.7 + t, 0), (1.6 - t, 0.7 - t, 0.3), "earth_dark", top="earth")
    for i in range(9):
        x = -1.25 + 2.5 * i / 8 + rng.range(-0.08, 0.08)
        blob(p, (x, rng.range(-0.2, 0.2), 0.36), rng.range(0.22, 0.28), "leaf" if i % 2 else "leaf_dark", rng, squash=0.6, segs=6, rings=4)
    for i in range(26):
        x = -1.3 + 2.6 * ((i * 0.618) % 1.0)
        y = rng.range(-0.38, 0.38)
        blob(p, (x, y, 0.5 + rng.range(0, 0.12)), rng.range(0.09, 0.13), FLOWERS[i % len(FLOWERS)], rng, squash=0.85, segs=6, rings=4, jitter=0.06)
    p.col_boxmm("cover", (-1.6, -0.7, 0.0), (1.6, 0.7, 0.35))
    return p


# ---------------------------------------------------------------- leaderboard board
def plaza_board():
    p = Prop("plaza_board", "plaza")
    for sx in (-1, 1):
        p.boxmm((sx * 3.0 - 0.15, 0.0, 0.0), (sx * 3.0 + 0.15, 0.3, 5.2), "wood_dark", bevel=0.03)
        p.boxmm((sx * 3.0 - 0.25, -0.05, 0.0), (sx * 3.0 + 0.25, 0.35, 0.35), "stone", top="stone_dark", bevel=0.04)
    # panel (wood back), the dark face, a yellow trim frame around it
    p.boxmm((-3.1, -0.125, 1.4), (3.1, 0.125, 4.8), "wood", bevel=0.02)
    p.boxmm((-2.9, -0.13, 1.55), (2.9, -0.12, 4.65), "dark", bottom=True)
    for z0, z1 in ((1.4, 1.55), (4.65, 4.8)):
        p.boxmm((-3.1, -0.17, z0), (3.1, -0.125, z1), "yellow", bottom=True)
    for sx in (-1, 1):
        xa, xb = sorted((sx * 2.9, sx * 3.1))
        p.boxmm((xa, -0.17, 1.55), (xb, -0.125, 4.65), "yellow", bottom=True)
    # header boss and roof
    p.boxmm((-0.9, -0.2, 4.8), (0.9, 0.2, 4.95), "orange", bevel=0.03)
    p.prism([(-0.5, 0.0), (0.5, 0.0), (0.0, 0.4)], 7.0, (0, 0.15, 4.9), "tile", axis="X", side_cell="tile_dark")
    p.boxmm((-3.4, -0.4, 4.86), (3.4, 0.7, 4.93), "wood_dark", bottom=True)
    p.col_boxmm("block", (-3.15, 0.0, 0.0), (-2.85, 0.3, 5.2))
    p.col_boxmm("block", (2.85, 0.0, 0.0), (3.15, 0.3, 5.2))
    p.col_boxmm("wall", (-3.1, -0.15, 1.4), (3.1, 0.15, 4.8))
    return p


# ---------------------------------------------------------------- market stall
def plaza_stall():
    p = Prop("plaza_stall", "plaza")
    rng = Rng(308)
    # counter on the front
    p.boxmm((-1.5, -0.9, 0.0), (1.5, -0.4, 0.92), "wood", bevel=0.03)
    p.boxmm((-1.56, -0.96, 0.92), (1.56, -0.34, 1.0), "wood_light", bevel=0.02)
    for x in (-1.0, 0.0, 1.0):
        p.boxmm((x - 0.42, -0.92, 0.15), (x + 0.42, -0.9, 0.8), "wood_dark", bottom=True)
    # back table
    p.boxmm((-1.4, 0.45, 0.0), (1.4, 0.85, 0.75), "wood_dark", bevel=0.02)
    # posts: front lower, back higher
    posts = [(-1.4, -0.8, 2.2), (1.4, -0.8, 2.2), (-1.4, 0.8, 2.6), (1.4, 0.8, 2.6)]
    for x, y, h in posts:
        p.box((0.12, 0.12, h), (x, y, h / 2), "wood_dark", bevel=0.02)
    # striped awning sloping from the back (2.65) to the front (2.25), with scallops
    ns = 6
    w = 3.4 / ns
    slope = math.degrees(math.atan2(0.4, 1.9))
    for k in range(ns):
        x = -1.7 + w * (k + 0.5)
        p.box((w, 2.0, 0.06), (x, -0.05, 2.45), "awning_red" if k % 2 == 0 else "cream", rot=(-slope, 0, 0))
        card2(p, [(x - w / 2, -1.04, 2.24), (x + w / 2, -1.04, 2.24), (x, -1.04, 2.0)], "awning_red" if k % 2 == 0 else "cream")
    # produce crates on the counter
    crates = [(-1.0, "apple"), (0.0, "bread"), (1.0, "flower_pink")]
    for x, fill in crates:
        p.boxmm((x - 0.38, -0.85, 1.0), (x + 0.38, -0.45, 1.22), "wood_light", bevel=0.02, bottom=True)
        for i in range(5):
            r = 0.1 if fill != "bread" else 0.12
            cell = fill if fill != "flower_pink" else ("flower_pink", "yellow", "white", "orange", "lamp_red")[i]
            p.sphere((r, r * (1.6 if fill == "bread" else 1.0), r), (x - 0.26 + 0.13 * i, -0.65 + rng.range(-0.06, 0.06), 1.27),
                     cell, segs=6, rings=4, rot=(0, 0, 90 if fill == "bread" else 0))
    # a few crates by the side
    p.box((0.6, 0.5, 0.45), (1.85, 0.2, 0.225), "wood", bevel=0.03, rot_z=12)
    for i in range(4):
        p.sphere((0.1, 0.1, 0.1), (1.72 + 0.1 * i, 0.2, 0.52), "apple", segs=6, rings=4)
    p.col_boxmm("cover", (-1.56, -0.96, 0.0), (1.56, -0.34, 1.0))
    for x, y, h in posts:
        p.col_boxmm("block", (x - 0.08, y - 0.08, 0.0), (x + 0.08, y + 0.08, h))
    return p


# ---------------------------------------------------------------- cafe set
def plaza_cafe():
    p = Prop("plaza_cafe", "plaza")
    # table
    p.cyl(0.25, 0.04, (0, 0, 0.02), "iron", segs=8)
    p.cyl(0.04, 0.68, (0, 0, 0.38), "iron", segs=6)
    p.cyl(0.45, 0.04, (0, 0, 0.73), "wood_light", segs=12)
    # chairs facing the table
    for sy in (-1, 1):
        with p.frame((0, sy * 0.8, 0), rot_z=0 if sy < 0 else 180):
            for sx in (-1, 1):
                for ly in (-0.17, 0.17):
                    p.box((0.04, 0.04, 0.45), (sx * 0.17, ly, 0.225), "iron")
            p.box((0.44, 0.42, 0.05), (0, 0, 0.47), "wood", bevel=0.015)
            p.box((0.04, 0.04, 0.45), (-0.19, -0.19, 0.72), "iron")
            p.box((0.04, 0.04, 0.45), (0.19, -0.19, 0.72), "iron")
            p.box((0.42, 0.04, 0.16), (0, -0.19, 0.86), "wood", bevel=0.012)
    # parasol
    p.cyl(0.03, 2.55, (0, 0, 1.275 + 0.0), "wood_dark", segs=6, caps=True)
    n = 8
    apex = (0, 0, 2.6)
    for k in range(n):
        a0 = 2 * math.pi * k / n
        a1 = 2 * math.pi * (k + 1) / n
        card2(p, [apex, (1.4 * math.cos(a0), 1.4 * math.sin(a0), 2.22), (1.4 * math.cos(a1), 1.4 * math.sin(a1), 2.22)],
              "awning_red" if k % 2 == 0 else "cream")
        am = (a0 + a1) / 2
        card2(p, [(1.4 * math.cos(a0), 1.4 * math.sin(a0), 2.22), (1.4 * math.cos(a1), 1.4 * math.sin(a1), 2.22),
                  (1.3 * math.cos(am), 1.3 * math.sin(am), 2.08)], "awning_red" if k % 2 == 0 else "cream")
    p.sphere((0.06, 0.06, 0.07), (0, 0, 2.66), "yellow", segs=6, rings=4)
    # a little flower vase on the table
    p.cyl(0.05, 0.12, (0.12, 0.05, 0.81), "white", segs=6)
    p.sphere((0.06, 0.06, 0.06), (0.12, 0.05, 0.92), "flower_pink", segs=6, rings=4)
    p.col_cyl("cover", (0, 0, 0.4), 0.5, 0.8)
    for sy in (-1, 1):
        p.col_boxmm("cover", (-0.22, sy * 0.8 - 0.21, 0.0), (0.22, sy * 0.8 + 0.21, 0.5))
    return p


BUILDERS = [plaza_portal, plaza_fountain, plaza_bench, plaza_lamp, plaza_statue, plaza_flowerbed, plaza_board, plaza_stall, plaza_cafe]
