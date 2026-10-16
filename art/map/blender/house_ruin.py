"""Ruined house: the farmhouse footprint after a shelling. The west half still stands to the eaves under a
holed slate roof with charred rafters; the east half is knocked down to waist and chest height and
full of rubble. Part of the upper floor has collapsed into a debris ramp (33 degrees), a second way up
next to the stairs, and a shell breach opens the west gable.

Inside: the cold hearth, an overturned table, a sandbagged firing position at the broken floor edge
upstairs with an ammo box, a bed and a toppled wardrobe. 8 loot spots.

Blender space: meters, Z up, the front faces -Y, origin on the ground at the footprint center.
"""

import math

from mathutils import Vector

import furniture as F
import house_farm as farm
import house_kit as hk
from furniture import at
from house_kit import EAVE, GF, STORY, UF
from kit import Prop, Rng

W, D, T = farm.W, farm.D, farm.T
IX0, IX1, IY0, IY1 = farm.IX0, farm.IX1, farm.IY0, farm.IY1
PITCH = farm.PITCH
BREACH = 0.9                       # west wall shell hole center (world y)
RAMP = (-1.0, 3.6, -0.9, 1.3)      # collapsed floor: top edge x, foot x, y0, y1
ROOF_X = (-5.0, -1.0)              # the standing roof covers this x range (walls)
HOLE = farm.HOLE

LOOK = dict(farm.LOOK, frame="char", shutter="shutter_green")
BANDS = [(0.0, GF + 1.1, "wood_dark"), (GF + 1.1, 99.0, "plaster_dark")]
OPENINGS = {
    "front": [("door", -1.5), ("win", -3.5, 1.0), ("win", 3.0, 1.2), ("uwin", -3.0, 1.0), ("uwin", 0.0, 1.0), ("uwin", 3.0, 1.0)],
    "east": [("win", 0.2, 1.2), ("gap", -2.2, 1.6)],
    "back": [("door", 3.0), ("uwin", -1.5, 1.0), ("uwin", 3.0, 1.0)],
    "west": [("breach", BREACH, 1.5), ("uwin", 1.0, 0.9)],
}


def base_top(x, y):
    """Wall top before the jagged noise: eaves in the west, broken in the middle, low in the east."""
    if x < -1.4:
        return EAVE + 0.5
    if x < 1.6:
        return EAVE - (x + 1.4) / 3.0 * 3.4
    return 2.6 - (x - 1.6) * 0.4


def jag_top():
    rough = hk.jag(17, base_top, 0.55)

    def fn(x, y):
        v = rough(x, y)
        return EAVE if x < -1.4 and v > EAVE else v
    return fn


def op_of(kind, u, w):
    if kind == "breach":
        return (u, w, GF + 0.1, 2.5)
    if kind == "gap":
        return (u, w, GF + 0.2, 3.0)
    return farm.op_of(kind, u, w)


def scorch(p, x, y, z, w, h, normal):
    """Soot mark on a wall face (mesh only)."""
    if normal in ("+y", "-y"):
        s = 1 if normal == "+y" else -1
        p.boxmm((x - w / 2, y + min(0, s * 0.012), z), (x + w / 2, y + max(0, s * 0.012), z + h), "char", bottom=True)
    else:
        s = 1 if normal == "+x" else -1
        p.boxmm((x + min(0, s * 0.012), y - w / 2, z), (x + max(0, s * 0.012), y + w / 2, z + h), "char", bottom=True)


def shell(p, rng):
    top_fn = jag_top()
    p.boxmm((-W / 2 - 0.12, -D / 2 - 0.12, -0.6), (W / 2 + 0.12, D / 2 + 0.12, GF), LOOK["plinth"], col="floor")
    for key, a, b, conv in farm.walls_def():
        items = OPENINGS[key]
        ops = [op_of(k, conv(v), rest[0] if rest else hk.DOOR_W if k == "door" else 1.0) for k, v, *rest in items]
        hk.wall2(p, a, b, EAVE, T, LOOK["wall"], BANDS, openings=ops, top="rubble", top_fn=top_fn)
        hk.wall_stones(p, a, b, 2.4, T, ("stone_dark", "rock_light"), ops, rng, 4)
        A, B = Vector(a), Vector(b)
        for (k, v, *rest), op in zip(items, ops):
            mid = A + (B - A).normalized() * op[0]
            if top_fn(mid.x, mid.y) < op[3] + 0.3 or k in ("breach", "gap"):
                continue
            if k == "door":
                hk.doorway(p, a, b, op, T, LOOK, hinge=-1, step=True)
            else:
                hk.window(p, a, b, op, T, LOOK, leaves=False, shutters=(int(v * 10) % 3 != 0))
    # the west gable and its chimney still stand; the roof covers the west half
    t = math.tan(math.radians(PITCH))
    ridge = EAVE + t * D / 2
    p.prism([(-D / 2, EAVE), (D / 2, EAVE), (0, ridge)], T, (-W / 2 + T / 2, 0, 0), LOOK["wall"], axis="X", col="wall")
    hk.chimney(p, farm.CHIMNEY[0], farm.CHIMNEY[1], EAVE - 0.3, ridge + 1.0, "brick", pots="char")
    roof(p, rng, ridge)
    hk.quoins(p, W, D, 2.0, LOOK["quoin"])
    # soot over the windows of the standing half, breach rubble spilling out
    for x in (-3.5, -1.5, -3.0):
        scorch(p, x, -D / 2 - 0.01, 2.3 if x != -3.0 else UF + 2.1, 1.2, 0.9, "-y")
    scorch(p, -W / 2 - 0.01, BREACH, 2.4, 1.8, 1.2, "-x")
    hk.rubble_heap(p, -W / 2 - 0.9, BREACH, 1.1, rng)
    hk.rubble_heap(p, W / 2 + 0.6, -2.2, 0.9, rng)
    hk.rubble_heap(p, 2.6, -D / 2 - 1.0, 0.8, rng)


def roof(p, rng, ridge):
    """Holed slate roof over the standing half: slabs in bands with two missing, rafters across the gaps,
    tile courses on the bands that remain, broken rafters reaching east past the roof."""
    pitch, over, thick = PITCH, 0.45, 0.28
    t = math.radians(pitch)
    span = D / 2
    run = span + over
    slope_len = run / math.cos(t)
    x0, x1 = ROOF_X[0] - over, ROOF_X[1] + 0.4
    bands = [(x0, -3.6), (-3.6, -2.7), (-2.7, -1.7), (-1.7, x1)]
    missing = {(-1, 1), (1, 2)}
    for side in (-1, 1):
        u = (0, side * math.cos(t), -math.sin(t))
        n = (0, side * math.sin(t), math.cos(t))
        cz = ridge - math.tan(t) * run / 2 + math.cos(t) * thick / 2
        off = run / 2 + math.sin(t) * thick / 2
        for i, (a, b) in enumerate(bands):
            if (side, i) in missing:
                continue
            p.box((b - a, slope_len, thick), ((a + b) / 2, side * off, cz), "slate", rot=(-side * pitch, 0, 0), col="roof", bottom=True)
            s = 0.35
            while s < slope_len - 0.12:
                c = (0, n[1] * (thick + 0.022) + u[1] * s, ridge + n[2] * (thick + 0.022) + u[2] * s)
                p.box((b - a - 0.04, 0.09, 0.045), ((a + b) / 2, c[1], c[2]), "slate_dark", rot=(-side * pitch, 0, 0), bottom=True)
                s += 0.42
        # rafters under the roof every 0.6 m, charred where they cross the holes and past the east end
        xr = x0 + 0.3
        while xr < x1 + 0.7:
            burnt = xr > x1 - 0.1 or any((side, i) in missing and a <= xr <= b for i, (a, b) in enumerate(bands))
            length = slope_len if xr < x1 else slope_len * rng.range(0.35, 0.7)
            top = (xr, 0.0, ridge - 0.05)
            end = (xr + (rng.range(-0.15, 0.15) if xr > x1 else 0), side * math.cos(t) * length, ridge - 0.05 - math.sin(t) * length)
            p.tube(top, end, 0.07, "char" if burnt else "timber", segs=4)
            xr += 0.6
    p.tube((x0, 0, ridge - 0.02), (x1 + 0.9, 0.1, ridge - 0.35), 0.1, "char", segs=5)
    p.box((x1 - x0 + 0.1, 0.36, 0.22), ((x0 + x1) / 2, 0, ridge + thick * 0.55), "slate_dark", rot=(45, 0, 0), bottom=True)


def floors(p, rng):
    hk.flagstones(p, (IX0, IY0, 1.2, IY1), GF, rng, base="flagstone", dark="rubble")
    rx0, rx1, ry0, ry1 = RAMP
    # what is left of the upper floor: the west room, a strip north of the collapse, the landing
    slabs = [(IX0, IY0, rx0, HOLE[1]), (IX0, HOLE[1], HOLE[0], IY1), (rx0, ry1, 1.2, HOLE[1]), (HOLE[2], HOLE[1], 1.2, IY1)]
    for a0, b0, a1, b1 in slabs:
        p.boxmm((a0, b0, UF - hk.SLAB), (a1, b1, UF), "wood_dark", col="floor", bottom=True, top="wood")
        hk.planks(p, (a0, b0, a1, b1), UF, cells=("wood", "char"), along="y", width=0.36)
    hk.beams(p, (IX0, IY0, rx0, IY1), UF - hk.SLAB, along="y", spacing=1.25, holes=[HOLE], cell="timber")
    # broken joists sticking out over the void
    for y in (-3.0, -2.2, -1.4):
        p.box((0.9, 0.16, 0.2), (rx0 + 0.35, y, UF - hk.SLAB - 0.05), "char", rot=(0, rng.range(8, 22), rng.range(-8, 8)), bottom=True)
    # the collapsed slab: a solid debris wedge (ramp collider) with the tilted floor on top
    top_cells = lambda c, n: "wood" if n.z > 0.5 else "rubble"
    pts = [(rx0, ry0, UF), (rx0, ry1, UF), (rx1, ry0, GF), (rx1, ry1, GF), (rx0, ry0, GF), (rx0, ry1, GF)]
    p.hull(pts, "rubble", col="ramp", cells_fn=top_cells)
    L = math.hypot(rx1 - rx0, UF - GF)
    ang = math.degrees(math.atan2(UF - GF, rx1 - rx0))
    with p.frame(((rx0 + rx1) / 2, (ry0 + ry1) / 2, (UF + GF) / 2), rot=(0, ang, 0)):
        n = 6
        for i in range(n):
            y0 = ry0 + (ry1 - ry0) * i / n - (ry0 + ry1) / 2
            p.boxmm((-L / 2, y0 + 0.01, 0.0), (L / 2 - 0.1 * (i % 2), y0 + (ry1 - ry0) / n - 0.01, 0.03), "wood" if i % 2 else "wood_dark")
    for k in range(4):
        x = rx0 + 0.8 + k * 0.9
        z = UF - (x - rx0) / (rx1 - rx0) * (UF - GF)
        p.box((0.3, 0.22, 0.14), (x, ry0 - 0.06, z - 0.25), "stone", rot=(rng.range(-20, 20), 0, rng.range(0, 40)), bottom=True)
    # stairs (charred banister), what is left of the stair rail
    look = {"tread": "wood", "riser": "wood_dark", "stringer": "char", "rail": "char"}
    st = farm.STAIR
    hk.stair_run(p, "x", st["band"], st["start"], 1, GF, STORY, st["steps"], st["run"], look, open_side=-1)
    hk.rail(p, (-3.6, 2.24), (-1.2, 2.24), UF, cell="char")
    hk.rail(p, (-3.66, 2.3), (-3.66, 3.4), UF, cell="char")


def furnishing(p, rng):
    # ---- ground floor
    with at(p, -4.3, farm.CHIMNEY[1], GF, 90):
        F.fireplace(p, w=1.8, d=0.6, h=STORY - hk.SLAB, rng=rng, lit=False)
    with p.frame((-2.4, 1.6, GF)):
        with p.frame((0, 0, 0.45), rot=(0, 0, 0)):
            with p.frame((0, 0, 0), rot=(90, 0, 12)):
                F.table(p, 1.8, 0.9)
    with p.frame((-2.2, -0.2, GF), rot=(0, 0, 30)):
        F.bench(p, 1.6)
    with p.frame((-2.9, 2.0, GF + 0.2), rot=(0, 75, 40)):
        F.chair(p, col=False)
    for x, y in ((-2.0, -0.2), (-1.6, 0.4), (-3.3, 0.9)):
        F.plate(p, x, y, GF, cell="cream")
    hk.rubble_heap(p, 2.2, -3.0, 0.7, rng)
    hk.rubble_heap(p, 2.4, 2.6, 1.1, rng)
    hk.rubble_heap(p, 4.0, 2.4, 0.8, rng)
    hk.rubble_heap(p, 0.2, -2.9, 0.6, rng)
    p.tube((0.6, 1.6, GF + 0.1), (3.2, 3.2, GF + 1.5), 0.12, "char", segs=5, col="cover")
    p.tube((1.0, -3.25, GF + 0.1), (3.4, -3.0, GF + 0.9), 0.11, "timber", segs=5, col="cover")
    with at(p, 4.2, -3.0, GF, -90):
        F.crate(p, 0.6)

    # ---- upstairs: sandbagged firing step at the broken edge, ammo, bed, toppled wardrobe
    for i in range(4):
        y = -3.25 + i * 0.58
        for row in range(3):
            z = UF + row * 0.22
            yy = y + (0.29 if row % 2 else 0.0)
            if yy > -1.05:
                continue
            p.box((0.5, 0.56, 0.22), (RAMP[0] - 0.3, yy, z + 0.11), "sandbag", rot=(0, 0, rng.range(-6, 6)), bottom=True)
    p.col_boxmm("cover", (RAMP[0] - 0.56, -3.4, UF), (RAMP[0] - 0.04, -1.05, UF + 0.66))
    p.box((0.5, 0.32, 0.36), (-2.8, -2.9, UF + 0.18), "olive", bottom=True, col="cover")
    p.box((0.52, 0.06, 0.08), (-2.8, -2.9, UF + 0.4), "olive_dark", bottom=True)
    p.boxmm((IX0, -2.4, UF), (IX0 + 0.5, -1.0, EAVE - 0.3), "stone", col="wall", bottom=True)
    with at(p, -3.6, 0.0, UF, 90):
        F.bed(p, 1.4, 2.0, blanket="char")
    with p.frame((-3.9, -3.0, UF), rot=(0, 0, 0)):
        with p.frame((0, 0, 0), rot=(-18, 0, 70)):
            F.wardrobe(p, 1.0, 0.55, 1.95)
    F.picture(p, -2.6, IY1, UF + 1.5, 0.7, 0.5, "-y", art="char", sky="plaster_dark")


def house_ruined(lod=0):
    if lod > 0:
        return ruin_lod(lod)
    p = Prop("house_ruined", "building")
    rng = Rng(303)
    shell(p, rng)
    floors(p, rng)
    furnishing(p, rng)
    for v, tb in [((-3.3, -1.7, GF), 0), ((-1.6, 2.0, GF), 0), ((3.2, -1.9, GF), 0), ((-2.8, -2.9, UF + 0.36), 1),
                  ((-3.6, 0.3, UF + 0.55), 1), ((-1.6, 0.4, UF), 0), ((0.8, 2.85, UF), 0), ((-4.2, 2.1, GF), 0)]:
        p.loot_at(v, tb)
    p.meta["probes"] = [
        ((-1.5, -5.6, GF), (-1.5, -2.2, GF), "front door"), ((-6.3, BREACH, GF), (-3.5, BREACH, GF), "breach"),
        ((-1.5, -2.2, GF), (3.9, -2.0, GF), "under the collapse"), ((-3.5, -0.6, GF), (-4.1, 1.8, GF), "hearth to stair"),
        ((-4.1, 1.8, GF), (-4.1, 2.85, GF), "stair foot"), ((0.8, 2.85, UF), (0.6, 1.8, UF), "landing"),
        ((0.6, 1.8, UF), (-2.0, 1.8, UF), "upper strip"), ((-2.0, 1.8, UF), (-2.0, -2.8, UF), "west room"),
    ]
    p.meta["walk"] = [
        [(-1.5, -6.0, 0.0), (-1.5, -2.2, GF), (-3.55, -0.6, GF), (-4.1, 1.9, GF), (-4.1, 2.85, GF), (-3.3, 2.85, GF + 0.2),
         (0.8, 2.85, UF), (0.6, 1.8, UF), (-2.0, 1.8, UF), (-2.0, -2.6, UF)],
        [(-1.5, -6.0, 0.0), (-1.5, -2.2, GF), (3.9, -2.0, GF), (4.1, 0.2, GF), (3.3, 0.2, GF + 0.2), (-0.7, 0.2, UF), (-2.0, -0.2, UF)],
    ]
    p.meta["cams"] = [("ground", (-3.9, -2.9, GF + 1.6), (3.0, 1.5, GF + 0.6), 20), ("ramp", (4.2, -2.6, GF + 1.6), (-1.5, 0.5, UF + 0.6), 22),
                      ("upstairs", (0.7, 2.9, UF + 1.6), (-3.5, -2.6, UF + 0.5), 20), ("breach", (-9.0, 3.5, 1.7), (-3.0, 0.0, 2.2), 30)]
    p.meta["note"] = "farmhouse footprint after shelling: west half and its upper floor stand, collapsed floor ramp, west breach"
    return p


# ---------------------------------------------------------------- LODs
def ruin_lod(lod):
    p = Prop("house_ruined", "building")
    top_fn = jag_top()
    p.boxmm((-W / 2 - 0.12, -D / 2 - 0.12, -0.6), (W / 2 + 0.12, D / 2 + 0.12, GF), "stone_dark")
    t = math.tan(math.radians(PITCH))
    ridge = EAVE + t * D / 2
    if lod == 1:
        for key, a, b, conv in farm.walls_def():
            hk.wall2(p, a, b, EAVE, T, "stone", None, openings=[], top="rubble", col=None, top_fn=top_fn, strip=1.6)
        p.boxmm((IX0, IY0, UF - hk.SLAB), (RAMP[0], IY1, UF), "wood_dark", bottom=True)
        p.prism([(-D / 2, EAVE), (D / 2, EAVE), (0, ridge)], T, (-W / 2 + T / 2, 0, 0), "stone", axis="X")
        with p.frame((-3.0, 0, 0)):
            hk.roof_hull(p, 4.0, D, EAVE, PITCH, 0.45, "slate")
        p.hull([(RAMP[0], RAMP[2], UF), (RAMP[0], RAMP[3], UF), (RAMP[1], RAMP[2], GF), (RAMP[1], RAMP[3], GF),
                (RAMP[0], RAMP[2], GF), (RAMP[0], RAMP[3], GF)], "rubble")
        p.hull([(1.2, -3.3, 0), (4.5, -3.3, 0), (1.2, 3.2, 0), (4.5, 3.2, 0), (3.0, 2.4, 1.2), (2.4, -2.6, 0.9)], "rubble")
        p.box((0.9, 0.7, ridge + 1.0 - EAVE), (farm.CHIMNEY[0], farm.CHIMNEY[1], (ridge + 1.0 + EAVE) / 2), "brick", bottom=True)
    else:
        for (x0, x1, h) in ((-W / 2, -1.2, EAVE), (-1.2, W / 2, 2.2)):
            p.boxmm((x0, -D / 2, 0), (x1, -D / 2 + T, h), "stone", top="rubble")
            p.boxmm((x0, D / 2 - T, 0), (x1, D / 2, h), "stone", top="rubble")
        p.boxmm((-W / 2, -D / 2 + T, 0), (-W / 2 + T, D / 2 - T, EAVE), "stone", top="rubble")
        p.boxmm((W / 2 - T, -D / 2 + T, 0), (W / 2, D / 2 - T, 1.8), "stone", top="rubble")
        with p.frame((-3.0, 0, 0)):
            hk.roof_hull(p, 4.0, D, EAVE, PITCH, 0.45, "slate")
        p.prism([(-D / 2, EAVE), (D / 2, EAVE), (0, ridge)], 0.05, (-W / 2 - 0.47, 0, 0), "stone", axis="X")
    return p
