"""Wrecks and the drop plane. Fictional factions only:
- Pond Brigade: olive drab, yellow ring insignia (the landing craft, the truck, the drop plane).
- Grey Gull Corps: field grey, orange triangle insignia (the tank wreck).

Blender space: meters, Z up, front faces -Y, origin on the ground (the plane: origin at the fuselage center).
"""

import math

from mathutils import Vector

import kit
from kit import Prop, Rng
from props_military import ring_decal


def gull_mark(p, at, axis_sign, size=0.45):
    """Grey Gull Corps mark on a side face (normal +-X): orange down-pointing triangle on a dark square."""
    x = at[0] + axis_sign * 0.012
    p.box((0.025, size * 1.25, size * 1.15), (x, at[1], at[2]), "dark", bottom=True)
    tri = [(at[1] - size * 0.5, at[2] + size * 0.38), (at[1] + size * 0.5, at[2] + size * 0.38), (at[1], at[2] - size * 0.45)]
    p.prism(tri, 0.03, (x + axis_sign * 0.02, 0, 0), "orange", axis="X")


def wheel(p, at, r, w, cell="tire", hub="steel_dark", segs=10):
    p.cyl(r, w, at, cell, segs=segs, rot=(0, 90, 0), cap_cell=hub)


# ---------------------------------------------------------------- tank wreck
def tank_lod(lod):
    p = Prop("tank_wreck", "vehicle")
    track = [(-2.3, 0.0), (2.4, 0.0), (2.85, 0.15), (3.0, 0.55), (2.8, 0.95), (-2.75, 1.0), (-3.0, 0.5), (-2.75, 0.12)]
    for sx in (-1, 1):
        if lod == 1:
            p.prism(track if sx > 0 else [(-1.6, 0.0)] + track[1:5] + [(-1.6, 1.0)], 0.5, (sx * 1.22, 0, 0), "steel_dark", axis="X")
        else:
            p.boxmm((sx * 1.22 - 0.25, -2.9 if sx > 0 else -1.6, 0), (sx * 1.22 + 0.25, 2.95, 1.0), "steel_dark")
    p.boxmm((-1.5, -2.0, 0.35), (1.5, 2.85, 1.55), "field_grey", top="field_grey_dark")
    glacis = []
    for sx in (-1, 1):
        glacis += [(sx * 1.5, -2.0, 1.55), (sx * 1.5, -2.0, 0.95), (sx * 1.0, -3.0, 0.62), (sx * 1.0, -3.0, 0.95)]
    p.hull(glacis, "field_grey")
    with p.frame((0.25, 0.35, 1.55), rot=(5, -6, 31)):
        if lod == 1:
            pts = []
            for z, r in ((0.0, 1.05), (0.78, 0.88)):
                for k in range(7):
                    a = 2 * math.pi * k / 7
                    pts.append((math.cos(a) * r, math.sin(a) * r * 1.18 + 0.1, z))
            p.hull(pts, "field_grey", cells_fn=lambda c, n: "field_grey_dark" if n.z > 0.6 else "field_grey")
            p.tube((0, -1.35, 0.42), (0.05, -3.2, 0.5), 0.1, "steel_dark", segs=4, caps=False)
            gull_mark(p, (1.0, 0.0, 0.4), 1, size=0.32)
        else:
            p.boxmm((-0.95, -1.1, 0.0), (0.95, 1.3, 0.75), "field_grey", top="field_grey_dark")
            p.box((0.16, 1.9, 0.16), (0.02, -2.2, 0.45), "steel_dark")
    return p


def tank_wreck(lod=0):
    if lod > 0:
        return tank_lod(lod)
    p = Prop("tank_wreck", "vehicle")
    rng = Rng(81)
    track = [(-2.3, 0.0), (2.4, 0.0), (2.85, 0.15), (3.0, 0.55), (2.8, 0.95), (-2.75, 1.0), (-3.0, 0.5), (-2.75, 0.12)]
    for sx in (-1, 1):
        x = sx * 1.22
        if sx > 0:
            p.prism(track, 0.5, (x, 0, 0), "steel_dark", axis="X", side_cell="steel_dark")
            p.col_boxmm("block", (x - 0.25, -3.0, 0), (x + 0.25, 3.0, 1.0))
        else:
            short = [(-1.6, 0.0), (2.4, 0.0), (2.85, 0.15), (3.0, 0.55), (2.8, 0.95), (-1.6, 1.0)]
            p.prism(short, 0.5, (x, 0, 0), "steel_dark", axis="X", side_cell="steel_dark")
            p.col_boxmm("block", (x - 0.25, -1.6, 0), (x + 0.25, 3.0, 1.0))
            # the thrown track lying on the ground in front
            for i in range(6):
                p.box((0.5, 0.42, 0.08), (x + 0.15 * i * 0.2, -2.0 - i * 0.44, 0.04), "steel_dark", rot=(0, 0, 4 * i))
        for i, y in enumerate((-2.0, -1.0, 0.0, 1.0, 2.0)):
            if sx < 0 and y < -1.5:
                p.cyl(0.36, 0.14, (sx * 1.2, y - 0.2, 0.32), "rust", segs=10, rot=(80, 0, 20), cap_cell="rust_dark")
                continue
            wheel(p, (sx * 1.5, y, 0.42), 0.36, 0.12, cell="rust", hub="rust_dark")
        wheel(p, (sx * 1.5, -2.65, 0.62), 0.3, 0.14, cell="steel", hub="rust_dark", segs=8)
    p.boxmm((-0.97, -2.6, 0.35), (0.97, 2.75, 1.2), "field_grey_dark", col="block")
    for sx in (-1, 1):
        x0, x1 = sorted((sx * 0.95, sx * 1.52))
        p.boxmm((x0, -2.9 if sx > 0 else -1.2, 0.98), (x1, 3.0, 1.06), "field_grey", top="field_grey_dark")
        if sx < 0:
            p.box((0.55, 0.9, 0.06), (-1.25, -1.75, 0.95), "field_grey", rot=(-25, 8, 0))
    p.boxmm((-1.5, -2.0, 1.0), (1.5, 2.85, 1.55), "field_grey", col="block", top="field_grey_dark")
    glacis = []
    for sx in (-1, 1):
        glacis += [(sx * 1.5, -2.0, 1.55), (sx * 1.5, -2.0, 0.95), (sx * 1.0, -3.0, 0.62), (sx * 1.0, -3.0, 0.95)]
    p.hull(glacis, "field_grey", col="block", cells_fn=lambda c, n: "field_grey" if n.z > 0.3 else "field_grey_dark")
    # spare track links on the glacis, engine deck grille, exhausts
    for i in range(3):
        p.box((0.4, 0.3, 0.07), (-0.6 + i * 0.45, -2.5, 1.32), "steel_dark", rot=(-33, 0, rng.range(-6, 6)), bottom=True)
    for i in range(4):
        p.box((2.0, 0.12, 0.05), (0, 1.3 + i * 0.32, 1.57), "steel_dark", bottom=True)
    for sx in (-1, 1):
        p.tube((sx * 0.55, 2.85, 1.1), (sx * 0.55, 3.25, 1.18), 0.12, "rust_dark", segs=6)
    # burn and rust patches
    for at, size in (((0.5, 0.6, 1.56), (1.2, 1.4)), ((-0.9, 2.2, 1.56), (0.6, 0.6)), ((-1.0, -2.3, 1.25), (0.5, 0.5))):
        p.box((size[0], size[1], 0.02), at, "char", bottom=True)
    for sx in (-1, 1):
        p.box((0.02, 1.2, 0.3), (sx * 1.51, 1.6, 1.3), "rust", bottom=True)
        gull_mark(p, (sx * 1.5, 0.3, 1.28), sx, size=0.4)
    # turret knocked askew
    with p.frame((0.25, 0.35, 1.55), rot=(5, -6, 31)):
        pts = []
        for z, r, sy in ((0.0, 1.05, 1.18), (0.42, 1.12, 1.2), (0.78, 0.88, 1.12)):
            for k in range(10):
                a = 2 * math.pi * k / 10
                pts.append((math.cos(a) * r, math.sin(a) * r * sy + 0.1, z))
        p.hull(pts, "field_grey", col="block", cells_fn=lambda c, n: "field_grey_dark" if n.z > 0.6 else "field_grey")
        p.box((0.95, 0.35, 0.6), (0, -1.25, 0.4), "field_grey_dark", bevel=0.06)
        p.tube((0, -1.35, 0.42), (0.05, -3.2, 0.5), 0.1, "steel_dark", segs=8, col="block")
        p.cyl(0.13, 0.12, (0.05, -3.25, 0.5), "char", segs=8, rot=(90, 0, 0))
        p.cyl(0.33, 0.24, (0.35, 0.4, 0.88), "field_grey_dark", segs=10)
        with p.frame((0.35, 0.75, 1.0), rot=(-65, 0, 0)):
            p.cyl(0.32, 0.06, (0, 0.3, 0), "field_grey", segs=10)
        p.box((0.6, 0.6, 0.02), (-0.3, 0.2, 0.795), "char", bottom=True)
        gull_mark(p, (1.0, 0.0, 0.4), 1, size=0.32)
    p.meta["note"] = "Grey Gull Corps medium tank, burnt out; left track thrown"
    return p


# ---------------------------------------------------------------- supply truck wreck
def truck_lod(lod):
    p = Prop("truck_wreck", "vehicle")
    with p.frame((0, 0, 0.12), rot=(4.5, -3.5, 0)):
        if lod == 1:
            for sx in (-1, 1):
                for y in (1.2, 2.45):
                    p.cyl(0.5, 0.32, (sx * 0.95, y, 0.5), "tire", segs=6, rot=(0, 90, 0), cap_cell="steel_dark")
            p.cyl(0.5, 0.3, (-0.95, -2.3, 0.5), "tire", segs=6, rot=(0, 90, 0), cap_cell="steel_dark")
        if lod == 2:
            p.boxmm((-1.1, -2.8, 0.0), (1.1, 2.9, 0.5), "tire", bottom=False)
        p.boxmm((-0.68, -3.25, 0.5), (0.68, -1.9, 1.62), "olive", top="olive_dark")
        p.boxmm((-1.05, -1.9, 0.6), (1.05, -0.55, 2.25), "olive", top="canvas")
        p.boxmm((-1.15, -0.5, 0.45), (1.15, 3.3, 1.65), "olive", top="wood")
        p.boxmm((-1.17, -0.42, 1.65), (1.17, 1.25, 2.68), "canvas", bottom=True)
        if lod == 1:
            p.patch((0, -1.9, 1.82), (0, -1, 0), 1.8, 0.55, "window")
            for sx in (-1, 1):
                p.patch((sx * 1.05, -1.25, 1.15), (sx, 0, 0), 0.42, 0.42, "yellow")
    if lod == 1:
        p.cyl(0.5, 0.3, (1.85, -3.3, 0.15), "tire", segs=6, cap_cell="steel_dark")
    return p


def truck_wreck(lod=0):
    if lod > 0:
        return truck_lod(lod)
    p = Prop("truck_wreck", "vehicle")
    rng = Rng(82)
    with p.frame((0, 0, 0.12), rot=(4.5, -3.5, 0)):
        p.boxmm((-0.48, -3.1, 0.5), (0.48, 3.25, 0.72), "steel_dark")
        for sx in (-1, 1):
            for y in (1.2, 2.45):
                wheel(p, (sx * 0.95, y, 0.5), 0.5, 0.32, segs=12)
        wheel(p, (-0.95, -2.3, 0.5), 0.5, 0.3, segs=12)
        # hood, fenders, grille, bumper
        p.boxmm((-0.68, -3.2, 0.75), (0.68, -1.9, 1.62), "olive", col="block", top="olive_dark")
        p.boxmm((-0.62, -3.24, 0.85), (0.62, -3.18, 1.55), "steel_dark")
        p.boxmm((-1.15, -3.38, 0.5), (1.15, -3.18, 0.72), "steel_dark")
        for sx in (-1, 1):
            p.box((0.5, 1.3, 0.1), (sx * 0.92, -2.35, 1.08), "olive_dark", rot=(8, 0, 0), bottom=True)
        # cab
        p.boxmm((-1.05, -1.9, 0.8), (1.05, -0.55, 2.25), "olive", col="block", top="canvas")
        p.boxmm((-0.92, -1.93, 1.55), (0.92, -1.88, 2.1), "window")
        for sx in (-1, 1):
            x0, x1 = sorted((sx * 1.05, sx * 1.08))
            p.boxmm((x0, -1.75, 1.6), (x1, -0.75, 2.1), "window")
            ring_decal(p, (sx * 1.065, -1.25, 1.15), (0, sx * 90, 0), 0.22, 0.14, "yellow", depth=0.02)
        # cargo bed with sides
        p.boxmm((-1.15, -0.45, 0.92), (1.15, 3.3, 1.08), "wood", col="floor", top="wood_light")
        for sx in (-1, 1):
            x0, x1 = sorted((sx * 1.15, sx * 1.05))
            p.boxmm((x0, -0.45, 1.08), (x1, 3.3, 1.65), "olive", top="olive_dark")
        p.boxmm((-1.15, -0.5, 1.08), (1.15, -0.4, 1.65), "olive", top="olive_dark")
        p.col_boxmm("block", (-1.15, -0.5, 0.5), (1.15, 3.3, 1.65))
        # tailgate hanging open
        p.box((2.25, 0.08, 0.55), (0, 3.38, 0.82), "olive_dark", rot=(-12, 0, 0))
        # canvas: front half still covered, rear hoops bare
        p.boxmm((-1.17, -0.42, 2.55), (1.17, 1.25, 2.68), "canvas", bottom=True)
        for sx in (-1, 1):
            x0, x1 = sorted((sx * 1.17, sx * 1.09))
            p.boxmm((x0, -0.42, 1.6), (x1, 1.25, 2.6), "canvas", bottom=True)
        p.col_boxmm("cover", (-1.17, -0.42, 1.6), (1.17, 1.25, 2.68))
        for y in (1.9, 2.6, 3.2):
            for sx in (-1, 1):
                p.tube((sx * 1.1, y, 1.6), (sx * 1.1, y, 2.5), 0.035, "steel_dark", segs=4)
            p.tube((-1.1, y, 2.5), (1.1, y, 2.6 + rng.range(-0.2, 0.05)), 0.035, "steel_dark", segs=4)
        p.quad([(1.12, 1.25, 2.6), (1.12, 2.1, 2.55), (1.12, 1.9, 1.9), (1.12, 1.25, 1.7)], "canvas")
        # cargo: crates and a barrel inside the bed
        p.box((0.75, 0.75, 0.7), (-0.4, 2.3, 1.43), "wood_light", bevel=0.03, rot=(0, 0, 12))
        p.cyl(0.29, 0.88, (0.5, 2.5, 1.52), "olive", segs=10, cap_cell="olive_dark")
        p.box((1.6, 1.2, 0.02), (0.1, -1.2, 2.26), "char", bottom=True)
    # the missing front wheel, lying flat next to the truck
    p.cyl(0.5, 0.3, (1.85, -3.3, 0.15), "tire", segs=12, cap_cell="steel_dark")
    p.meta["note"] = "Pond Brigade cargo truck, nose down on its lost front wheel"
    return p


# ---------------------------------------------------------------- landing craft, beached with the ramp down
def landing_lod(lod):
    p = Prop("landing_craft", "vehicle")
    L0, L1, hw, H = -4.6, 5.5, 1.65, 2.0
    p.boxmm((-hw, L0, 0.0), (hw, L1, 0.5), "olive_dark", top="plank_grey")
    for sx in (-1, 1):
        x0, x1 = sorted((sx * (hw - 0.15), sx * hw))
        p.boxmm((x0, L0 - 0.25, 0.0), (x1, L1, H), "olive", top="olive_dark")
        if lod == 1:
            p.patch((sx * hw, -2.8, 1.2), (sx, 0, 0), 0.8, 0.8, "yellow")
    p.boxmm((-hw, L1 - 0.12, 0), (hw, L1, H), "olive", top="olive_dark")
    p.boxmm((-hw + 0.15, 3.3, 0.5), (hw - 0.15, L1 - 0.12, 1.15), "plank_grey", bottom=True)
    if lod == 1:
        p.boxmm((0.35, 3.6, 1.15), (1.45, 3.75, 2.45), "steel", bottom=True)
    ang = math.degrees(math.asin(0.48 / 2.6))
    with p.frame((0, L0, 0.5), rot=(ang, 0, 0)):
        p.boxmm((-1.45, -2.6, -0.14), (1.45, 0, 0.0), "plank_grey", top="wood")
    return p


def landing_craft(lod=0):
    if lod > 0:
        return landing_lod(lod)
    p = Prop("landing_craft", "vehicle")
    L0, L1, hw, H = -4.6, 5.5, 1.65, 2.0
    FLOOR = 0.5
    # hull bottom with chines
    p.hull([(-hw, L0, 0.15), (hw, L0, 0.15), (-hw, L1, 0.2), (hw, L1, 0.2), (-hw + 0.3, L0, 0), (hw - 0.3, L0, 0),
            (-hw + 0.3, L1, 0), (hw - 0.3, L1, 0), (-hw, L0, FLOOR), (hw, L0, FLOOR), (-hw, L1, FLOOR), (hw, L1, FLOOR)],
           "olive_dark", col="floor", cells_fn=lambda c, n: "plank_grey" if n.z > 0.9 else "olive_dark")
    for sx in (-1, 1):
        x0, x1 = sorted((sx * (hw - 0.15), sx * hw))
        p.boxmm((x0, L0, 0.0), (x1, L1, H), "olive", col="wall", top="olive_dark")
        p.boxmm((min(x0, x1) - 0.03, L0 - 0.02, H - 0.08), (max(x0, x1) + 0.03, L1, H + 0.05), "olive_dark", bottom=True)
        ring_decal(p, (sx * (hw + 0.005), -2.8, 1.2), (0, sx * 90, 0), 0.42, 0.27, "yellow", depth=0.025)
        # ramp side cheeks
        p.boxmm((x0, L0 - 0.25, FLOOR), (x1, L0, H), "olive_dark")
    # transom and aft deck, coxswain armor, machine gun posts
    p.boxmm((-hw, L1 - 0.12, 0), (hw, L1, H), "olive", col="wall", top="olive_dark")
    p.boxmm((-hw + 0.15, 3.3, FLOOR), (hw - 0.15, L1 - 0.12, 1.15), "plank_grey", col="floor", top="wood_dark")
    p.boxmm((0.35, 3.6, 1.15), (1.45, 3.75, 2.45), "steel", col="cover", top="steel_dark")
    p.boxmm((0.35, 3.6, 1.15), (0.5, 4.6, 2.45), "steel", top="steel_dark")
    p.cyl(0.12, 0.6, (0.9, 4.3, 1.45), "steel_dark", segs=6)
    for sx in (-1, 1):
        p.tube((sx * 1.2, 5.0, 1.15), (sx * 1.2, 5.0, 2.3), 0.05, "steel_dark", segs=5)
        p.tube((sx * 1.2, 5.0, 2.3), (sx * 1.2, 4.0, 2.38), 0.045, "dark", segs=5)
        p.box((0.16, 0.4, 0.2), (sx * 1.2, 4.9, 2.3), "steel_dark", bottom=True)
    # bow ramp, lowered onto the sand (walkable, about 11 degrees)
    ang = math.degrees(math.asin((FLOOR - 0.02) / 2.6))
    with p.frame((0, L0, FLOOR), rot=(ang, 0, 0)):
        p.boxmm((-1.45, -2.6, -0.14), (1.45, 0, 0.0), "plank_grey", col="ramp", top="wood")
        for i in range(5):
            p.box((2.7, 0.07, 0.04), (0, -0.3 - i * 0.48, 0.02), "wood_dark", bottom=True)
        for sx in (-1, 1):
            p.boxmm((sx * 1.45 - 0.08, -2.6, -0.14), (sx * 1.45 + 0.08, 0, 0.25), "olive_dark")
    # crates left behind in the well
    p.box((0.75, 0.75, 0.7), (-0.8, 1.6, FLOOR + 0.35), "wood_light", bevel=0.03, rot=(0, 0, 18))
    p.loot_at((0.0, 0.0, FLOOR), 1)
    p.loot_at((-0.8, 2.6, FLOOR))
    p.meta["note"] = "Pond Brigade landing craft; ramp end is the front (+Z), place it facing inland"
    p.meta["probes"] = [((0.0, -7.6, 0.0), (0.0, -4.4, FLOOR), "bow ramp"), ((0.0, -4.0, FLOOR), (0.0, 3.0, FLOOR), "well deck")]
    return p


# ---------------------------------------------------------------- the drop plane (flyover visual only)
def fuselage_stations():
    st = [(-9.65, 0.0), (-9.5, 0.42), (-9.25, 0.72), (-8.85, 0.98), (-8.3, 1.17), (-7.6, 1.3), (-6.6, 1.39), (-5.2, 1.43),
          (-3.0, 1.44), (-0.5, 1.43), (1.5, 1.38), (3.0, 1.27), (4.5, 1.1), (5.6, 0.95), (6.6, 0.8), (7.6, 0.62),
          (8.5, 0.45), (9.2, 0.32), (9.7, 0.18)]
    out = []
    for y, r in st:
        zc = 0.0 if y < 1.0 else 0.58 * ((y - 1.0) / 8.7) ** 1.4
        out.append((y, r, zc))
    return out


def transport_plane():
    p = Prop("transport_plane", "vehicle")
    segs = 22
    st = fuselage_stations()
    verts, faces, cells = [], [], []
    for y, r, zc in st[1:]:
        for j in range(segs):
            a = 2 * math.pi * j / segs
            verts.append(Vector((math.cos(a) * r, y, zc + math.sin(a) * r * 1.07)))
    n = len(st) - 1
    nose = len(verts)
    verts.append(Vector((0, st[0][0], st[0][2])))
    tail = len(verts)
    verts.append(Vector((0, st[-1][0] + 0.12, st[-1][2])))

    def band_cell(y, z, zc, r):
        if 4.2 < y < 6.0:
            return "yellow" if int((y - 4.2) / 0.45) % 2 == 0 else "dark"
        if z < zc - 0.35 * r:
            return "plane_belly"
        return "plane"

    for i in range(n - 1):
        for j in range(segs):
            a0, a1 = i * segs + j, i * segs + (j + 1) % segs
            b0, b1 = a0 + segs, a1 + segs
            faces.append((a0, a1, b1, b0))
            c = (verts[a0] + verts[b1]) / 2
            y0, r0, z0 = st[i + 1]
            cells.append(band_cell(c.y, c.z, z0, r0))
    for j in range(segs):
        faces.append((nose, (j + 1) % segs, j))
        cells.append("plane")
        last = (n - 1) * segs
        faces.append((tail, last + j, last + (j + 1) % segs))
        cells.append("plane")
    p.add(verts, faces, "plane", smooth=True, cells=cells)
    # cockpit glazing, cabin windows, the open jump door
    for sx in (-1, 1):
        with p.frame((sx * 0.5, -8.55, 0.82), rot=(-38, 0, sx * -28)):
            p.box((0.62, 0.5, 0.06), (0, 0, 0), "window")
        for i in range(7):
            y = -5.3 + i * 1.02
            p.box((0.08, 0.34, 0.3), (sx * 1.415, y, 0.28), "window")
    p.box((0.1, 1.5, 1.55), (1.39, 3.0, 0.02), "window")
    p.box((0.12, 1.66, 0.08), (1.38, 3.0, 0.82), "plane_belly")
    p.box((0.4, 0.4, 0.22), (0, -6.2, 1.45), "glass")                 # astrodome
    p.tube((0, -4.0, 1.4), (0, -2.8, 2.0), 0.03, "steel_dark", segs=4)  # antenna mast
    p.tube((0, -2.8, 2.0), (0, 8.6, 2.6), 0.012, "steel_dark", segs=3, caps=False)
    # fuselage roundel
    for sx in (-1, 1):
        ring_decal(p, (sx * 1.425, 0.4, 0.15), (0, sx * 90, 0), 0.62, 0.38, "yellow", depth=0.03, dot="dark")

    # wings: tapered with dihedral, built from spanwise slices so the stripes get their own cells
    def section(s, sx):
        x = sx * (1.1 + 13.4 * s)
        le = -3.05 + 1.6 * s
        chord = 4.6 - 3.0 * s
        zc = -0.78 + s * 13.4 * math.tan(math.radians(5.5))
        t = 0.62 - 0.44 * s
        pts = [(le, 0.0), (le + 0.12 * chord, 0.42 * t), (le + 0.35 * chord, 0.55 * t), (le + 0.75 * chord, 0.3 * t),
               (le + chord, 0.02 * t), (le + 0.75 * chord, -0.18 * t), (le + 0.3 * chord, -0.36 * t), (le + 0.08 * chord, -0.28 * t)]
        return [(x, y, zc + z) for y, z in pts]

    cuts = [0.0, 0.1, 0.2, 0.3, 0.32, 0.355, 0.39, 0.425, 0.46, 0.495, 0.53, 0.62, 0.72, 0.82, 0.91, 1.0]
    stripe = {3: "yellow", 4: "dark", 5: "yellow", 6: "dark", 7: "yellow", 8: "dark", 9: "yellow"}
    for sx in (-1, 1):
        for k, (s0, s1) in enumerate(zip(cuts, cuts[1:])):
            cell = stripe.get(k, "plane")
            p.hull(section(s0, sx) + section(s1, sx), cell,
                   cells_fn=(lambda c, n, cell=cell: cell if cell != "plane" else ("plane_belly" if n.z < -0.2 else "plane")))
        # rounded tip cap
        tip = section(1.0, sx)
        p.hull(tip + [(sx * 14.75, -1.0, 0.55), (sx * 14.7, 0.0, 0.52)], "plane")
        # flap and aileron lines
        for s0, s1 in ((0.04, 0.27), (0.6, 0.95)):
            a, b = section(s0, sx)[4], section(s1, sx)[4]
            p.tube((a[0], a[1] - 0.35, a[2] + 0.06), (b[0], b[1] - 0.25, b[2] + 0.04), 0.03, "plane_belly", segs=3)
        # engine nacelle and cowling
        nx = sx * 4.4
        nz = -0.45
        prof = [(-4.75, 0.55), (-4.6, 0.74), (-3.4, 0.78), (-2.2, 0.66), (-0.4, 0.55), (1.0, 0.36), (1.9, 0.12)]
        nverts, nfaces, ncells = [], [], []
        ns = 14
        for y, r in prof:
            for j in range(ns):
                a = 2 * math.pi * j / ns
                nverts.append(Vector((nx + math.cos(a) * r, y, nz + math.sin(a) * r * 1.05)))
        for i in range(len(prof) - 1):
            for j in range(ns):
                a0, a1 = i * ns + j, i * ns + (j + 1) % ns
                nfaces.append((a0, a1, a1 + ns, a0 + ns))
                ncells.append("steel_dark" if i < 2 else "plane")
        front = len(nverts)
        nverts.append(Vector((nx, -4.75, nz)))
        back = len(nverts)
        nverts.append(Vector((nx, 2.0, nz)))
        last = (len(prof) - 1) * ns
        for j in range(ns):
            nfaces.append((front, (j + 1) % ns, j))
            ncells.append("dark")
            nfaces.append((back, last + j, last + (j + 1) % ns))
            ncells.append("plane")
        p.add(nverts, nfaces, "plane", smooth=True, cells=ncells)
        p.cyl(0.24, 0.5, (nx, -5.0, nz), "plane_belly", r2=0.04, segs=10, rot=(90, 0, 0), smooth=True)
        p.tube((nx + sx * 0.5, -2.8, nz - 0.5), (nx + sx * 0.45, -1.4, nz - 0.62), 0.07, "char", segs=5)
        # spinning propeller as a child node: 3 blades around the hub
        prop = Prop("PropLeft" if sx > 0 else "PropRight", "vehicle")
        for b in range(3):
            with prop.frame((0, 0, 0), rot=(0, b * 120, 0)):
                prop.box((0.2, 0.05, 1.55), (0, 0, 0.85), "steel_dark", rot=(0, 0, 18), bevel=0.02)
                prop.box((0.21, 0.06, 0.16), (0, 0, 1.55), "yellow", rot=(0, 0, 18))
        if not hasattr(p, "children"):
            p.children = []
        p.children.append((prop, (nx, -4.95, nz)))
        ring_decal(p, (sx * 10.2, -0.85, -0.78 + 9.1 * math.tan(math.radians(5.5)) + (0.2 if sx > 0 else -0.16)),
                   ((0, -sx * 5.5, 0) if sx > 0 else (180, sx * 5.5, 0)), 0.75, 0.46, "yellow", depth=0.03, dot="dark")
    # tail: fin, rudder, stabilizers, tail wheel
    fin = []
    for x in (-0.13, 0.13):
        fin += [(x, 6.3, 0.95), (x, 9.55, 0.95), (x, 9.75, 3.0), (x, 9.2, 3.65), (x, 8.55, 3.75), (x, 7.6, 2.2)]
    p.hull(fin, "plane")
    p.hull([(-0.08, 9.6, 1.0), (0.08, 9.6, 1.0), (-0.06, 10.2, 1.2), (0.06, 10.2, 1.2), (-0.05, 9.85, 3.4), (0.05, 9.85, 3.4),
            (-0.05, 9.4, 3.7), (0.05, 9.4, 3.7)], "plane_belly")
    for sx in (-1, 1):
        p.hull([(sx * 0.3, 7.6, 0.75), (sx * 0.3, 9.6, 0.78), (sx * 0.3, 8.0, 0.93), (sx * 0.3, 9.4, 0.85),
                (sx * 5.1, 8.75, 0.82), (sx * 5.1, 9.5, 0.82), (sx * 5.0, 9.1, 0.9), (sx * 4.7, 8.5, 0.82)], "plane",
               cells_fn=lambda c, n: "plane_belly" if n.z < -0.2 else "plane")
    p.meta["note"] = "flyover only, no colliders. Nodes PropLeft and PropRight spin around their local glTF Z axis (the flight axis)"
    p.meta["nodes"] = ["PropLeft", "PropRight"]
    return p


BUILDERS = [tank_wreck, truck_wreck, landing_craft, transport_plane]
