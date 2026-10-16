"""Landmarks: church with a climbable bell tower, lighthouse, stone bridge; and the list of every building
builder. The enterable houses live in their own modules: house_farm (farmhouse), house_town (townhouse
with the bakery), house_ruin (ruined house), house_barn (barn); shared parts in house_kit and furniture.

Blender space: meters, Z up, the front faces -Y, origin on the ground at the footprint center.
Walls go counterclockwise seen from above, so each wall's local -Y is outside (shutters, frames).
"""

import math

from mathutils import Vector

import house_barn
import house_farm
import house_ruin
import house_town
import kit
from house_kit import DOOR_H, DOOR_W, GF, rail, roof_hull
from kit import Prop, Rng, gable_roof, opening_frame, stairs, stairs_x


# ---------------------------------------------------------------- church with a climbable bell tower
def pointed_cap(p, a, b, opening, thick, cell, rise=0.55):
    """Dark gothic point above an opening, on both faces."""
    a, b = Vector(a), Vector(b)
    d = b - a
    yaw = math.degrees(math.atan2(d.y, d.x))
    mid = (a + b) / 2
    at, w, bot, tp = opening
    x = at - d.length / 2
    with p.frame((mid.x, mid.y, 0), rot_z=yaw):
        for side in (-1, 1):
            y = side * (thick / 2 + 0.012)
            p.prism([(x - w / 2, tp), (x + w / 2, tp), (x, tp + rise)], 0.03, (0, y, 0), cell, axis="Y")


def church_lod(lod):
    p = Prop("church", "building")
    p.boxmm((-4.5, -6.0, -0.6), (4.5, 10.0, 6.5), "stone", top="stone_dark")
    p.boxmm((-3.0, 9.7, -0.3), (3.0, 14.0, 5.0), "stone")
    p.boxmm((-2.5, -11.0, -0.6), (2.5, -6.0, 15.0), "stone", top="stone_dark")
    p.boxmm((-2.8, -11.3, 15.0), (2.8, -5.7, 15.4), "stone_dark", bottom=True)
    cy = -8.5
    p.hull([(-2.6, cy - 2.6, 15.4), (2.6, cy - 2.6, 15.4), (-2.6, cy + 2.6, 15.4), (2.6, cy + 2.6, 15.4), (0, cy, 24.0)], "slate")
    with p.frame((0, 2.0, 0)):
        roof_hull(p, 9.0, 16.0, 6.5, 52, 0.4, "slate", along="Y")
    with p.frame((0, 11.9, 0)):
        roof_hull(p, 6.0, 4.2, 5.0, 52, 0.35, "slate", along="Y")
    if lod == 1:
        for y in (-0.5, 3.5, 7.5):
            for sx in (-1, 1):
                p.patch((sx * 4.5, y, 3.8), (sx, 0, 0), 1.0, 2.8, "window")
        for sx in (-1, 1):
            p.patch((sx * 4.5, -3.8, 1.45), (sx, 0, 0), 1.3, 2.6, "wood_dark")
        p.patch((0, -11.0, 1.5), (0, -1, 0), 1.2, 2.75, "wood_dark")
        for n, c in (((0, -1, 0), (0, -11.0, 13.2)), ((0, 1, 0), (0, -6.0, 13.2)), ((1, 0, 0), (2.5, -8.5, 13.2)), ((-1, 0, 0), (-2.5, -8.5, 13.2))):
            p.patch(c, n, 1.6, 2.0, "window")
        p.patch((0, -11.0, 8.4), (0, -1, 0), 1.5, 1.5, "white")
        p.sphere((0.4, 0.25, 0.3), (0, cy, 25.0), "yellow", segs=5, rings=3, smooth=False)
    return p


def church(lod=0):
    if lod > 0:
        return church_lod(lod)
    p = Prop("church", "building")
    rng = Rng(77)
    t = 0.6
    # ---- nave
    NH = 6.5
    p.boxmm((-4.5, -6.0, -0.6), (4.5, 10.0, GF), "stone_dark", col="floor")
    nwin = lambda at: (at, 1.0, 2.4, 5.2)
    naves = [
        ((-4.5, -5.7), (4.5, -5.7), []),
        ((4.2, -5.4), (4.2, 9.4), [(1.6, 1.3, GF, GF + 2.6), nwin(4.9), nwin(8.9), nwin(12.9)]),
        ((4.5, 9.7), (-4.5, 9.7), [(4.5, 4.0, GF, 4.6)]),
        ((-4.2, 9.4), (-4.2, -5.4), [(13.2, 1.3, GF, GF + 2.6), nwin(9.9), nwin(5.9), nwin(1.9)]),
    ]
    for a, b, ops in naves:
        kit.wall(p, a, b, NH, t, "stone", openings=ops, top="stone_dark")
        for o in ops:
            if o[2] > 1.0:
                pointed_cap(p, a, b, o, t, "window")
            else:
                opening_frame(p, a, b, o, t, "stone_dark", size=0.16)
    with p.frame((0, 2.0, 0)):
        gable_roof(p, 9.0, 16.0, NH, 52, 0.4, 0.3, "slate", ridge_cell="slate_dark", along="Y", gable_cell="stone", wall_t=t)
    # buttresses
    for y in (1.9, 5.9, 9.6):
        for sx in (-1, 1):
            x0, x1 = sorted((sx * 4.5, sx * 5.05))
            p.boxmm((x0, y - 0.4, 0), (x1, y + 0.4, 3.6), "stone_dark", col="block", top="stone")
            x0, x1 = sorted((sx * 4.5, sx * 4.8))
            p.boxmm((x0, y - 0.3, 3.6), (x1, y + 0.3, 5.0), "stone_dark", top="stone", bottom=True)
    # pews and the altar
    for row in range(7):
        y = -2.4 + row * 1.3
        for sx in (-1, 1):
            cx = sx * 2.2
            p.boxmm((cx - 1.3, y - 0.25, GF), (cx + 1.3, y + 0.2, GF + 0.48), "wood", top="wood_light", bottom=True)
            p.boxmm((cx - 1.3, y + 0.2, GF), (cx + 1.3, y + 0.3, GF + 0.95), "wood_dark", bottom=True)
            p.col_boxmm("cover", (cx - 1.3, y - 0.25, GF), (cx + 1.3, y + 0.3, GF + 0.95))
    # ---- chancel
    p.boxmm((-2.75, 9.4, GF), (2.75, 13.5, GF + 0.3), "stone_dark", col="floor", bottom=True, top="stone")
    chancel = [((2.75, 10.0), (2.75, 13.5), []), ((3.0, 13.75), (-3.0, 13.75), [(3.0, 1.0, 2.0, 4.2)]),
               ((-2.75, 13.5), (-2.75, 10.0), [])]
    for a, b, ops in chancel:
        kit.wall(p, a, b, 5.0, 0.5, "stone", openings=ops, top="stone_dark")
        for o in ops:
            pointed_cap(p, a, b, o, 0.5, "window")
    with p.frame((0, 11.9, 0)):
        gable_roof(p, 6.0, 4.2, 5.0, 52, 0.35, 0.28, "slate", ridge_cell="slate_dark", along="Y", gable_cell="stone", wall_t=0.5)
    p.boxmm((-1.0, 12.4, GF + 0.3), (1.0, 13.2, GF + 1.3), "white", col="cover", top="bronze", bottom=True)

    # ---- bell tower: 5 x 5 m outside, 3.8 x 3.8 m inside, belfry floor at 11.35 m
    TH = 15.0
    BF = GF + 8 * 1.4             # belfry floor top
    bel = lambda at: (at, 1.6, BF + 0.85, BF + 2.85)
    towers = [
        ((-2.5, -10.7), (2.5, -10.7), [(2.5, 1.2, GF, GF + 2.75), bel(2.5)]),
        ((2.2, -10.4), (2.2, -6.6), [bel(1.9)]),
        ((2.5, -6.3), (-2.5, -6.3), [bel(2.5)]),
        ((-2.2, -6.6), (-2.2, -10.4), [(1.9, DOOR_W, GF, GF + DOOR_H), bel(1.9)]),
    ]
    p.boxmm((-2.5, -11.0, -0.6), (2.5, -6.0, GF), "stone_dark", col="floor")
    for a, b, ops in towers:
        kit.wall(p, a, b, TH, t, "stone", openings=ops, top="stone_dark")
        for o in ops:
            if o[2] > 5:
                pointed_cap(p, a, b, o, t, "window", rise=0.7)
            else:
                opening_frame(p, a, b, o, t, "stone_dark", size=0.16)
    # string courses
    for z in (5.0, BF - 0.3):
        p.boxmm((-2.62, -11.12, z), (2.62, -5.98, z + 0.25), "stone_dark", bottom=True)
    # square spiral stairs: 8 flights of 7 steps, 0.2 m rise, corner landings
    fx0, fx1, fy0, fy1 = -1.9, 1.9, -10.4, -6.6
    w = 0.9
    run = (3.8 - 2 * w) / 7
    z = GF
    flights = [("E", 1), ("B", -1), ("W", -1), ("F", 1)] * 2
    corner_after = {"E": "BE", "B": "BW", "W": "FW", "F": "FE"}
    corners = {"BE": (1.0, -7.5), "BW": (-1.9, -7.5), "FW": (-1.9, -10.4), "FE": (1.0, -10.4)}
    for i, (side, d) in enumerate(flights):
        if side == "E":
            stairs(p, fx1 - w, fx1, fy0 + w, 1, z, 1.4, 7, run, "stone_dark", thick=0.3)
        elif side == "W":
            stairs(p, fx0, fx0 + w, fy1 - w, -1, z, 1.4, 7, run, "stone_dark", thick=0.3)
        elif side == "B":
            stairs_x(p, fy1 - w, fy1, fx1 - w, -1, z, 1.4, 7, run, "stone_dark", thick=0.3)
        else:
            stairs_x(p, fy0, fy0 + w, fx0 + w, 1, z, 1.4, 7, run, "stone_dark", thick=0.3)
        z += 1.4
        if i < len(flights) - 1:
            cx, cy = corners[corner_after[side]]
            p.boxmm((cx, cy, z - 0.3), (cx + w, cy + w, z), "stone_dark", col="stairs", bottom=True, top="stone")
    # belfry floor (hole over the last flights), rails, the bell
    for a0, b0, a1, b1 in ((-1.0, -9.5, 1.9, -6.6), (-1.9, -8.3, -1.0, -6.6), (1.0, -10.4, 1.9, -9.5)):
        p.boxmm((a0, b0, BF - 0.3), (a1, b1, BF), "wood_dark", col="floor", bottom=True, top="wood")
    rail(p, (-1.0, -9.44), (1.0, -9.44), BF)
    rail(p, (-0.94, -9.5), (-0.94, -8.3), BF)
    rail(p, (-1.9, -8.24), (-1.0, -8.24), BF)
    p.tube((-1.9, -8.0, TH - 0.6), (1.9, -8.0, TH - 0.6), 0.12, "timber", segs=6)
    p.cyl(0.5, 0.75, (0, -8.0, TH - 1.25), "bronze", segs=10, r2=0.28, cap_cell="bronze", col="block")
    p.sphere((0.28, 0.28, 0.16), (0, -8.0, TH - 0.86), "bronze", segs=10, rings=4)
    # cornice, spire, weathervane duck
    p.boxmm((-2.8, -11.3, TH), (2.8, -5.7, TH + 0.4), "stone_dark", col="roof", bottom=True)
    cy = -8.5
    p.hull([(-2.6, cy - 2.6, TH + 0.4), (2.6, cy - 2.6, TH + 0.4), (-2.6, cy + 2.6, TH + 0.4), (2.6, cy + 2.6, TH + 0.4),
            (0, cy, TH + 9.0)], "slate", col="roof")
    p.tube((0, cy, TH + 8.8), (0, cy, TH + 10.3), 0.05, "steel_dark", segs=4)
    p.sphere((0.34, 0.2, 0.22), (0, cy, TH + 10.1), "yellow", segs=8, rings=4)
    p.sphere(0.17, (0, cy - 0.32, TH + 10.32), "yellow", segs=8, rings=4)
    p.box((0.12, 0.16, 0.06), (0, cy - 0.5, TH + 10.3), "orange", bottom=True)
    # clock face on the front (no numerals)
    with p.frame((0, -11.02, 8.4), rot=(90, 0, 0)):
        p.cyl(0.78, 0.08, (0, 0, 0), "white", segs=16, cap_cell="white")
        p.cyl(0.86, 0.06, (0, 0, -0.02), "stone_dark", segs=16)
        p.box((0.07, 0.5, 0.05), (0, 0.22, 0.06), "dark", bottom=True)
        p.box((0.36, 0.06, 0.05), (0.16, 0, 0.06), "dark", bottom=True)
    p.loot_at((1.4, -8.0, BF), 2)
    p.loot_at((0.0, 12.8, GF + 0.3), 1)
    p.loot_at((-2.0, 5.0, GF), 0)
    p.loot_at((2.2, -4.2, GF), 0)
    p.loot_at((0.0, -9.6, GF), 0)
    p.meta["probes"] = [
        ((0.0, -13.0, GF), (0.0, -9.6, GF), "tower front door"), ((-4.0, -8.5, GF), (-0.5, -8.5, GF), "tower side door"),
        ((6.5, -3.8, GF), (0.0, -3.8, GF), "east door"), ((-6.5, -3.8, GF), (0.0, -3.8, GF), "west door"),
        ((0.0, -4.5, GF), (0.0, 11.0, GF), "aisle"), ((1.45, -10.05, GF), (1.45, -9.6, GF), "stair foot"),
        ((1.45, -9.9, BF), (1.45, -7.0, BF), "belfry arrival"),
    ]
    p.meta["note"] = "tower door on the front and west side; 8 flights to the belfry at 11.35 m with sniper openings on all sides"
    return p


# ---------------------------------------------------------------- lighthouse
def lighthouse():
    p = Prop("lighthouse", "landmark")
    bands = [(0.0, 0.9, "stone_dark"), (0.9, 5.0, "white"), (5.0, 7.0, "lamp_red"), (7.0, 11.0, "white"),
             (11.0, 13.0, "lamp_red"), (13.0, 16.0, "white")]
    r0, r1, top = 3.0, 2.2, 16.0
    rad = lambda z: r0 + (r1 - r0) * z / top
    for z0, z1, cell in bands:
        p.cyl(rad(z0), z1 - z0, (0, 0, (z0 + z1) / 2), cell, r2=rad(z1), segs=10, caps=False, phase=math.pi / 10)
    pts = []
    for k in range(10):
        a = 2 * math.pi * k / 10 + math.pi / 10
        pts += [(math.cos(a) * r0, math.sin(a) * r0, 0), (math.cos(a) * r1, math.sin(a) * r1, top)]
    p.col_hull("wall", pts)
    p.cyl(3.1, 0.35, (0, 0, top + 0.17), "steel_dark", segs=10, phase=math.pi / 10, col="roof")
    for k in range(10):
        a = 2 * math.pi * k / 10
        p.box((0.07, 0.07, 1.0), (math.cos(a) * 2.95, math.sin(a) * 2.95, top + 0.85), "steel_dark", bottom=True)
        a2 = 2 * math.pi * (k + 1) / 10
        pa = Vector((math.cos(a) * 2.95, math.sin(a) * 2.95, top + 1.32))
        pb = Vector((math.cos(a2) * 2.95, math.sin(a2) * 2.95, top + 1.32))
        p.tube(pa, pb, 0.04, "steel_dark", segs=4)
    p.cyl(1.55, 2.2, (0, 0, top + 1.45), "lamp_glass", segs=8)
    for k in range(8):
        a = 2 * math.pi * k / 8 + math.pi / 8
        p.box((0.1, 0.1, 2.2), (math.cos(a) * 1.58, math.sin(a) * 1.58, top + 1.45), "dark", bottom=True)
    p.cyl(1.85, 1.3, (0, 0, top + 3.2), "lamp_red", r2=0.2, segs=8)
    p.sphere(0.22, (0, 0, top + 4.0), "steel_dark", segs=8, rings=4)
    # door and keeper's hut
    p.box((1.2, 0.3, 2.2), (0, -2.95, 1.1), "window", bottom=True)
    p.box((1.5, 0.35, 0.25), (0, -3.0, 2.3), "stone_dark", bottom=True)
    with p.frame((0, 4.4, 0)):
        p.boxmm((-2.4, -1.6, 0), (2.4, 1.6, 2.7), "plaster", col="wall", top="plaster_dark")
        gable_roof(p, 4.8, 3.2, 2.7, 38, 0.3, 0.22, "slate", ridge_cell="slate_dark", along="X")
        p.box((0.9, 0.08, 1.8), (1.2, -1.62, 0.9), "shutter_blue", bottom=True)
    p.meta["note"] = "exterior landmark, not enterable"
    return p


# ---------------------------------------------------------------- stone arch bridge
def bridge_stone():
    """Spans along Y over a river flowing along X. Road surface 0.3 m above the banks at the middle;
    the river bed is expected 3 m below the bank level."""
    p = Prop("bridge_stone", "landmark")
    hw = 2.6
    p.boxmm((-hw, -6.0, -0.6), (hw, 6.0, 0.3), "stone", col="floor", top="rubble")
    for s in (-1, 1):
        y0, y1 = (6.0, 10.0) if s > 0 else (-10.0, -6.0)
        ya, yb = (6.0, 10.0) if s > 0 else (-6.0, -10.0)
        p.hull([(-hw, ya, 0.3), (hw, ya, 0.3), (-hw, yb, 0.0), (hw, yb, 0.0), (-hw, ya, -0.6), (hw, ya, -0.6), (-hw, yb, -0.6), (hw, yb, -0.6)],
               "stone", col="ramp", cells_fn=lambda c, n: "rubble" if n.z > 0.5 else "stone")
        # abutments into the banks
        p.boxmm((-hw - 0.2, min(5.0 * s, 9.0 * s), -3.4), (hw + 0.2, max(5.0 * s, 9.0 * s), -0.6), "stone_dark", col="block", bottom=True)
    # segmental arch: crown underside at -0.75, springing at -3.0 at y = +-5
    pts = []
    for i in range(9):
        y = -5.0 + 10.0 * i / 8
        z = -3.0 + 2.25 * (1 - (y / 5.0) ** 2) ** 0.5
        pts.append((y, z))
    for (ya, za), (yb, zb) in zip(pts, pts[1:]):
        p.hull([(-hw, ya, za), (hw, ya, za), (-hw, yb, zb), (hw, yb, zb), (-hw, ya, -0.6), (hw, ya, -0.6), (-hw, yb, -0.6), (hw, yb, -0.6)],
               "stone", col="block", cells_fn=lambda c, n: "stone_dark" if n.z < -0.3 else "stone")
    # voussoir ring on both faces
    for sx in (-1, 1):
        for (ya, za), (yb, zb) in zip(pts, pts[1:]):
            ym, zm = (ya + yb) / 2, (za + zb) / 2
            ang = math.degrees(math.atan2(zb - za, yb - ya))
            p.box((0.14, math.hypot(yb - ya, zb - za) - 0.06, 0.5), (sx * (hw + 0.05), ym, zm + 0.2), "stone_dark", rot=(ang, 0, 0), bottom=True)
    # parapets and end posts
    for sx in (-1, 1):
        x0, x1 = sorted((sx * hw, sx * (hw - 0.4)))
        p.boxmm((x0, -6.0, 0.3), (x1, 6.0, 1.2), "stone", col="cover", top="stone_dark", bottom=True)
        for sy in (-1, 1):
            p.box((0.6, 0.6, 1.5), (sx * (hw - 0.2), sy * 6.3, 0.75), "stone_dark", col="block", top="stone", bottom=True)
    p.meta["note"] = "deck spans y -10..10 (glTF z), banks at y = 0, river bed at -3.0 under the arch"
    return p


BUILDERS = [house_farm.farmhouse, house_town.townhouse, house_ruin.house_ruined, church, house_barn.barn, lighthouse, bridge_stone]
