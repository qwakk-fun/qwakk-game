"""Barn: a timber barn on a stone base with a tile roof, a louvred vent on the ridge, a big double door
(leaves swung open as cover), a hay door with a hoist beam in the front gable and a back door.

Inside: two cattle stalls with a feed trough, a hay cart, a workbench and a tool rack, milk churns,
barrels and hay bales; a hay loft at 2.9 m over the back half (13-step stair along the west wall)
with a supply cache of crates. Exposed posts, tie beams and rafters. 8 loot spots.

Blender space: meters, Z up, the front faces -Y, origin on the ground at the footprint center.
"""

import math

from mathutils import Vector

import furniture as F
import house_kit as hk
import kit
from furniture import at
from kit import Prop, Rng

W, D, H, T = 9.0, 13.0, 5.0, 0.25
IX0, IX1, IY0, IY1 = -W / 2 + T, W / 2 - T, -D / 2 + T, D / 2 - T      # -4.25, 4.25, -6.25, 6.25
FLOOR = 0.1
LOFT = 2.9
LOFT_Y = 0.5
PITCH = 40
BIG_DOOR = (W / 2, 3.4, FLOOR, 3.6)
LOOK = {"roof": "tile", "ridge": "tile_dark", "course": "tile_dark", "gable": "wood_dark", "fascia": "timber", "gutter": "steel"}
STAIR_LOOK = {"tread": "wood_light", "riser": "wood", "stringer": "timber", "rail": "timber"}


def walls():
    return [
        ((-W / 2, -D / 2 + T / 2), (W / 2, -D / 2 + T / 2), [BIG_DOOR]),
        ((W / 2 - T / 2, -D / 2 + T), (W / 2 - T / 2, D / 2 - T), [(3.25, 1.0, 1.3, 2.1), (9.75, 1.0, 1.3, 2.1), (9.75, 1.0, 3.5, 4.4)]),
        ((W / 2, D / 2 - T / 2), (-W / 2, D / 2 - T / 2), [(W / 2 - 2.5, hk.DOOR_W, FLOOR, 2.2), (W / 2 + 0.5, 1.4, 3.2, 4.6)]),
        ((-W / 2 + T / 2, D / 2 - T), (-W / 2 + T / 2, -D / 2 + T), [(2.25, 1.0, 3.5, 4.4)]),
    ]


def shell(p, rng):
    p.boxmm((-W / 2 - 0.1, -D / 2 - 0.1, -0.6), (W / 2 + 0.1, D / 2 + 0.1, FLOOR), "stone_dark", col="floor", top="earth")
    for a, b, ops in walls():
        kit.wall(p, a, b, H, T, "wood_dark", openings=ops, top="timber")
        clipped = [(o[0], o[1], o[2], 0.7) for o in ops if o[2] < 0.6]
        kit.wall(p, a, b, 0.6, T + 0.12, "stone_dark", openings=clipped, col=None, top="stone")
        for o in ops:
            kit.opening_frame(p, a, b, o, T, "timber", size=0.14, depth=0.05)
        # vertical battens outside, posts inside
        a2, b2 = Vector(a), Vector(b)
        d = b2 - a2
        L = d.length
        out = Vector((d.y, -d.x)).normalized()
        yaw = math.degrees(math.atan2(d.y, d.x))
        n = int(L / 0.85)
        for i in range(1, n):
            s = L * i / n
            if any(abs(s - o[0]) < o[1] / 2 + 0.2 for o in ops):
                continue
            pnt = a2 + d.normalized() * s + out * (T / 2 + 0.03)
            p.box((0.09, 0.09, H - 0.6), (pnt.x, pnt.y, 0.6 + (H - 0.6) / 2), "wood", rot_z=yaw, bottom=True)
        for i in range(0, 4):
            s = L * i / 3
            if any(abs(s - o[0]) < o[1] / 2 + 0.2 for o in ops) or i in (0, 3):
                continue
            pnt = a2 + d.normalized() * s - out * (T / 2 + 0.1)
            p.box((0.2, 0.2, H - 0.1), (pnt.x, pnt.y, 0.1 + (H - 0.1) / 2), "timber", rot_z=yaw, bottom=True)
    for sx in (-1, 1):
        for sy in (-1, 1):
            p.box((0.24, 0.24, H - 0.1), (sx * (IX1 - 0.1), sy * (IY1 - 0.1), 0.1 + (H - 0.1) / 2), "timber", bottom=True)
    # big door leaves swung open (cover), X braces
    for sx in (-1, 1):
        x = sx * 1.7 + sx * 0.08
        p.boxmm((x - 0.06, -D / 2 - 1.75, 0.15), (x + 0.06, -D / 2 - 0.05, 3.5), "wood", col="wall", top="wood_dark")
        xo = x - sx * 0.09
        p.tube((xo, -D / 2 - 0.2, 0.4), (xo, -D / 2 - 1.6, 3.2), 0.05, "timber", segs=4)
        p.tube((xo, -D / 2 - 1.6, 0.4), (xo, -D / 2 - 0.2, 3.2), 0.05, "timber", segs=4)
        for z in (0.35, 3.3):
            p.boxmm((xo - 0.03, -D / 2 - 1.7, z - 0.07), (xo + 0.03, -D / 2 - 0.1, z + 0.07), "timber", bottom=True)
    roof = hk.tiled_roof(p, W, D, H, PITCH, 0.5, 0.25, LOOK, along="Y", wall_t=T, gutters=False)
    ridge = roof["ridge"]
    # rafters and tie beams under the roof (mesh only)
    t = math.radians(PITCH)
    for y in [IY0 + 0.4 + k * 1.3 for k in range(10)]:
        for side in (-1, 1):
            p.tube((0, y, ridge - 0.12), (side * (W / 2 - 0.1), y, H - 0.05), 0.07, "timber", segs=4)
    for y in (-4.0, -1.2, 1.8, 4.6):
        p.boxmm((IX0, y - 0.1, 4.75), (IX1, y + 0.1, 4.95), "timber", bottom=True)
        p.box((0.14, 0.14, ridge - 5.0), (0, y, (ridge + 4.95) / 2 - 0.05), "timber", bottom=True)
    # ridge vent (louvred cupola) with a little duck vane
    p.boxmm((-0.55, -0.55, ridge - 0.3), (0.55, 0.55, ridge + 0.75), "wood_dark", bottom=True)
    for sy in (-1, 1):
        for k in range(3):
            z = ridge + 0.05 + k * 0.22
            p.boxmm((-0.42, sy * 0.56 - 0.02, z), (0.42, sy * 0.56 + 0.02, z + 0.08), "dark", bottom=True)
    p.hull([(-0.75, -0.75, ridge + 0.75), (0.75, -0.75, ridge + 0.75), (-0.75, 0.75, ridge + 0.75), (0.75, 0.75, ridge + 0.75), (0, 0, ridge + 1.35)], "tile_dark")
    p.tube((0, 0, ridge + 1.3), (0, 0, ridge + 1.9), 0.03, "iron", segs=4)
    p.sphere((0.2, 0.12, 0.13), (0, 0, ridge + 1.85), "iron", segs=6, rings=3, smooth=False)
    p.sphere(0.09, (0, -0.18, ridge + 1.98), "iron", segs=5, rings=3, smooth=False)
    # hay door in the front gable with a hoist beam, pulley and rope
    yf = -D / 2 - 0.02
    p.boxmm((-0.75, yf - 0.06, H + 0.4), (0.75, yf, H + 1.95), "wood", bottom=True)
    for x0, x1, z0, z1 in ((-0.85, -0.75, H + 0.3, H + 2.05), (0.75, 0.85, H + 0.3, H + 2.05), (-0.85, 0.85, H + 1.95, H + 2.05), (-0.85, 0.85, H + 0.3, H + 0.4)):
        p.boxmm((x0, yf - 0.1, z0), (x1, yf - 0.02, z1), "timber", bottom=True)
    p.tube((-0.7, yf - 0.08, H + 0.45), (0.7, yf - 0.08, H + 1.9), 0.04, "timber", segs=4)
    p.boxmm((-0.12, yf - 1.3, H + 2.35), (0.12, yf + 0.3, H + 2.6), "timber", bottom=True)
    p.cyl(0.14, 0.08, (0, yf - 1.15, H + 2.2), "iron", segs=8, rot=(0, 90, 0))
    p.box((0.025, 0.025, 2.4), (0.0, yf - 1.15, H + 0.95), "hay_dark", bottom=True)
    p.tube((0.0, yf - 1.15, H - 0.25), (0.0, yf - 1.05, H - 0.4), 0.04, "iron", segs=4)
    # lamp over the big door
    p.tube((2.15, yf, 3.9), (2.15, yf - 0.4, 4.05), 0.02, "iron", segs=4)
    p.cyl(0.12, 0.24, (2.15, yf - 0.42, 3.82), "lamp_glass", segs=6, cap_cell="iron")
    return ridge


def interior(p, rng):
    # loft and stairs along the west wall
    hk.stair_run(p, "y", (IX0, IX0 + 1.1), -3.8, 1, FLOOR, LOFT - FLOOR, 13, 0.33, STAIR_LOOK, open_side=1)
    p.boxmm((IX0, LOFT_Y, LOFT - 0.22), (IX1, IY1, LOFT), "wood", col="floor", bottom=True, top="wood_light")
    hk.planks(p, (IX0, LOFT_Y, IX1, IY1), LOFT, cells=("wood_light", "wood"), along="y", width=0.4)
    hk.rail(p, (IX0 + 1.1, LOFT_Y - 0.06), (IX1, LOFT_Y - 0.06), LOFT, cell="timber")
    for x in (-3.0, 0.0, 3.0):
        p.box((0.22, 0.22, LOFT - 0.32), (x, LOFT_Y + 0.1, (LOFT - 0.22 + FLOOR) / 2), "timber", bottom=True)
        p.tube((x - 0.6, LOFT_Y + 0.1, LOFT - 0.8), (x, LOFT_Y + 0.1, LOFT - 0.25), 0.06, "timber", segs=4)
        p.tube((x + 0.6, LOFT_Y + 0.1, LOFT - 0.8), (x, LOFT_Y + 0.1, LOFT - 0.25), 0.06, "timber", segs=4)
    hk.beams(p, (IX0, LOFT_Y, IX1, IY1), LOFT - 0.22, along="x", spacing=1.2, cell="timber")

    # two cattle stalls on the east side of the front half, a trough at the wall
    for yc in (-4.6, -2.2):
        with at(p, IX1 - 1.5, yc, FLOOR, -90):
            F.stall(p, 2.4, 3.0, 1.35)
    # hay cart, workbench and tool rack, churns, barrels, bales
    with p.frame((-1.7, -1.6, FLOOR), rot_z=12):
        p.boxmm((-0.65, -1.1, 0.55), (0.65, 1.1, 0.75), "wood", top="wood_light", bottom=True)
        for sx in (-1, 1):
            p.boxmm((sx * 0.65 - 0.05, -1.1, 0.75), (sx * 0.65 + 0.05, 1.1, 1.05), "wood_dark", bottom=True)
            p.cyl(0.45, 0.1, (sx * 0.78, 0.2, 0.45), "wood_dark", segs=8, rot=(0, 90, 0), cap_cell="wood")
        p.tube((-0.4, -1.1, 0.65), (-0.4, -2.5, 0.35), 0.05, "wood_dark", segs=4)
        p.tube((0.4, -1.1, 0.65), (0.4, -2.5, 0.35), 0.05, "wood_dark", segs=4)
        p.box((1.1, 1.6, 0.4), (0.0, 0.1, 0.95), "hay", bevel=0.08)
        p.col_boxmm("cover", (-0.9, -1.1, 0.0), (0.9, 1.1, 1.15))
    with at(p, IX1 - 0.35, 1.6, FLOOR, -90):
        F.table(p, 2.0, 0.7, h=0.9, top="wood")
        p.box((0.5, 0.3, 0.25), (-0.5, 0.0, 1.02), "steel_dark", bottom=True)
        p.box((0.35, 0.25, 0.2), (0.5, 0.05, 1.0), "olive", bottom=True)
        F.pot(p, 0.1, 0.1, 0.9, r=0.1, cell="rust")
    with at(p, IX1, 1.6, FLOOR, -90):
        F.tool_rack(p, 1.6)
    with at(p, IX0, -5.0, FLOOR, 90):
        F.tool_rack(p, 1.4)
    for x, y in ((1.0, IY1 - 0.4), (1.45, IY1 - 0.35), (1.2, IY1 - 0.8)):
        F.milk_churn(p, x, y, FLOOR)
    for x, y in ((3.9, 5.5), (3.9, 4.85)):
        with at(p, x, y, FLOOR):
            F.barrel(p, 0.29, 0.88, cell="rust", top="rust_dark")
    for x, y, z, yaw in ((-1.2, -5.2, FLOOR, 8), (0.2, 2.6, FLOOR, -5), (0.2, 2.6, FLOOR + 0.52, 12), (-3.4, 4.9, FLOOR, 90)):
        F.hay_bale(p, x, y, z, yaw)
    for x, y in ((-2.2, 5.6), (-1.6, 5.8)):
        F.sack(p, x, y, FLOOR)
    with at(p, -3.6, IY1, FLOOR, 0):
        F.ladder(p, 2.6, lean=-14)
    F.pendant(p, 0.0, -3.0, 4.75, drop=0.9, shade="iron")

    # loft: hay, a shelf, the supply cache
    for x, y, z, yaw in ((2.6, 4.6, LOFT, 4), (2.6, 4.6, LOFT + 0.52, -6), (0.6, 5.3, LOFT, 0), (-2.4, 3.2, LOFT, 80), (3.2, 2.2, LOFT, 92)):
        F.hay_bale(p, x, y, z, yaw)
    with at(p, -3.2, IY1 - 0.21, LOFT):
        F.shop_shelf(p, 2.0, 0.42, 1.6, rng=rng, goods="mixed")
    for x, y, s in ((-0.6, 3.0, 0.7), (0.15, 3.0, 0.7), (-0.25, 3.0, 0.0)):
        if s:
            with at(p, x, y, LOFT):
                F.crate(p, s, cell="olive")
    with at(p, -0.25, 3.0, LOFT + 0.7):
        F.crate(p, 0.55, cell="olive", col=False)
    p.col_boxmm("cover", (-0.5, 2.72, LOFT + 0.7), (0.0, 3.28, LOFT + 1.25))


def exterior_props(p, rng):
    with at(p, W / 2 + 0.6, -3.0, 0.0, -90):
        F.water_trough(p, 1.8, 0.6, 0.6)
    with at(p, -W / 2 - 0.7, 2.0, 0.0, 70):
        F.wheelbarrow(p)
    for x, y in ((-2.6, -D / 2 - 0.5), (-2.95, -D / 2 - 0.35)):
        F.milk_churn(p, x, y, 0.0)


def barn(lod=0):
    if lod > 0:
        return barn_lod(lod)
    p = Prop("barn", "building")
    rng = Rng(404)
    shell(p, rng)
    interior(p, rng)
    exterior_props(p, rng)
    for v, tb in (((-2.0, -2.2, FLOOR), 0), ((0.6, 0.8, FLOOR), 0), ((IX1 - 0.35, 1.0, FLOOR + 0.9), 0), ((-1.7, -1.3, FLOOR + 1.15), 0),
                  ((3.0, -4.0, FLOOR), 0), ((1.5, 3.6, LOFT), 1), ((0.25, 3.0, LOFT + 0.7), 1), ((-2.6, 5.0, LOFT), 0)):
        p.loot_at(v, tb)
    p.meta["probes"] = [((0.0, -9.0, FLOOR), (0.0, -1.5, FLOOR), "big door"), ((2.5, 8.6, FLOOR), (2.5, 4.8, FLOOR), "back door"),
                        ((-3.7, -5.6, FLOOR), (-3.7, -4.0, FLOOR), "stair foot"), ((-3.4, 1.4, LOFT), (1.5, 1.4, LOFT), "loft")]
    p.meta["walk"] = [(0.0, -9.0, 0.0), (0.0, -4.4, FLOOR), (-3.7, -4.4, FLOOR), (-3.7, -2.0, FLOOR + 1.0),
                      (-3.7, 1.0, LOFT), (1.5, 1.4, LOFT), (1.5, 3.6, LOFT)]
    p.meta["cams"] = [("floor", (-3.4, -5.8, 1.7), (2.6, 3.5, 1.4), 20), ("stalls", (-0.8, -0.4, 1.7), (3.8, -5.6, 0.8), 22),
                      ("loft", (-3.8, 0.9, LOFT + 1.6), (3.0, 5.6, LOFT + 0.4), 20), ("front", (5.5, -14.0, 1.7), (0.0, -6.5, 3.6), 32)]
    p.meta["note"] = "timber barn: stalls, hay cart, workbench; hay loft over the back half with a supply cache"
    return p


# ---------------------------------------------------------------- LODs
def barn_lod(lod):
    p = Prop("barn", "building")
    p.boxmm((-W / 2 - 0.1, -D / 2 - 0.1, -0.6), (W / 2 + 0.1, D / 2 + 0.1, 0.6), "stone_dark", top="stone")
    p.boxmm((-W / 2, -D / 2, 0.6), (W / 2, D / 2, H), "wood_dark", bottom=True)
    ridge = H + math.tan(math.radians(PITCH)) * W / 2
    if lod == 1:
        kit.gable_roof(p, W, D, H, PITCH, 0.5, 0.25, "tile", ridge_cell="tile_dark", along="Y", gable_cell="wood_dark", wall_t=T, col=None)
        p.patch((0, -D / 2 - 0.1, 1.85), (0, -1, 0), 3.4, 3.5, "window")
        p.patch((0, -D / 2 - 0.1, H + 1.18), (0, -1, 0), 1.5, 1.55, "wood")
        p.patch((2.5, D / 2 + 0.1, 1.15), (0, 1, 0), 1.1, 2.1, "window")
        p.patch((-0.5, D / 2 + 0.1, 3.9), (0, 1, 0), 1.4, 1.4, "window")
        for sx in (-1, 1):
            p.boxmm((sx * 1.78 - 0.06, -D / 2 - 1.75, 0.15), (sx * 1.78 + 0.06, -D / 2 - 0.05, 3.5), "wood")
        p.boxmm((-0.55, -0.55, ridge - 0.3), (0.55, 0.55, ridge + 0.75), "wood_dark", bottom=True)
        p.hull([(-0.75, -0.75, ridge + 0.75), (0.75, -0.75, ridge + 0.75), (-0.75, 0.75, ridge + 0.75), (0.75, 0.75, ridge + 0.75), (0, 0, ridge + 1.35)], "tile_dark")
    else:
        hk.roof_hull(p, W, D, H, PITCH, 0.5, "tile", along="Y")
        span = W / 2
        for sy in (-1, 1):
            p.prism([(-span, H), (span, H), (0, ridge)], 0.05, (0, sy * (D / 2 + 0.52), 0), "wood_dark", axis="Y")
    return p
