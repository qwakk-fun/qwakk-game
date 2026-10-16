"""Farmhouse: a two-storey Normandy stone farmhouse with a slate roof, two dormers, a porch canopy and
green shutters.

Ground floor: farm kitchen (flagstones, a big hearth on the west gable, long table with benches, a plate
dresser, a stone sink with a hand pump) and a parlour (sofa, armchairs, radio table, bookcase, a
grandfather clock). A 15-step stair along the back wall climbs to a bedroom with a double bed and a
study bedroom with a desk. 9 loot spots, most on furniture tops.

Blender space: meters, Z up, the front faces -Y, origin on the ground at the footprint center.
"""

import math

import furniture as F
import house_kit as hk
from furniture import at
from house_kit import EAVE, GF, SLAB, STORY, UF
from kit import Prop, Rng

W, D, T = 10.0, 7.6, 0.4
IX0, IX1, IY0, IY1 = -W / 2 + T, W / 2 - T, -D / 2 + T, D / 2 - T      # -4.6, 4.6, -3.4, 3.4
DIV_X = 1.3
PITCH = 48
CHIMNEY = (-4.45, -1.7)
STAIR = {"band": (2.3, 3.4), "start": -3.6, "run": 0.27, "steps": 15}
HOLE = (-3.6, 2.3, 0.45, 3.4)

LOOK = {
    "wall": "stone", "top": "stone_dark", "frame": "wood_dark", "shutter": "shutter_green", "shutter_dark": "hedge_dark",
    "lintel": "stone_dark", "sill": "stone_dark", "door": "wood", "door_dark": "wood_dark", "door_frame": "timber",
    "roof": "slate", "ridge": "slate_dark", "course": "slate_dark", "gable": "stone", "fascia": "timber", "gutter": "steel",
    "dormer": "plaster", "quoin": "stone_dark", "plinth": "stone_dark", "chimney": "brick",
}
STAIR_LOOK = {"tread": "wood_light", "riser": "wood", "stringer": "wood_dark", "rail": "wood_dark"}
BANDS = [(0.0, GF + 1.1, "wood"), (GF + 1.1, UF, "plaster_warm"), (UF, 99.0, "wallpaper_green")]

# (kind, v): v is world x on the front and back walls, world y on the east and west walls
OPENINGS = {
    "front": [("door", -1.5), ("win", -3.5, 1.0), ("win", 3.0, 1.2), ("uwin", -3.0, 1.0), ("uwin", 0.0, 1.0), ("uwin", 3.0, 1.0)],
    "east": [("win", 0.2, 1.2), ("uwin", 0.2, 1.0)],
    "back": [("door", 3.0), ("uwin", -1.5, 1.0), ("uwin", 3.0, 1.0)],
    "west": [("win", 1.0, 0.9), ("uwin", 1.0, 0.9)],
}


FLOWERS = {("front", "uwin", -3.0): ["flower_pink", "fabric_red", "cream"], ("front", "uwin", 3.0): ["fabric_red", "cream", "flower_pink"],
           ("front", "win", 3.0): ["flower_pink", "cream", "fabric_red", "flower_pink"]}


def walls_def():
    """Outer walls counterclockwise: (key, a, b, v -> distance along the wall)."""
    return [
        ("front", (-W / 2, -D / 2 + T / 2), (W / 2, -D / 2 + T / 2), lambda v: v + W / 2),
        ("east", (W / 2 - T / 2, -D / 2 + T), (W / 2 - T / 2, D / 2 - T), lambda v: v + D / 2 - T),
        ("back", (W / 2, D / 2 - T / 2), (-W / 2, D / 2 - T / 2), lambda v: W / 2 - v),
        ("west", (-W / 2 + T / 2, D / 2 - T), (-W / 2 + T / 2, -D / 2 + T), lambda v: D / 2 - T - v),
    ]


def op_of(kind, at_, w):
    return hk.door_op(at_) if kind == "door" else (hk.win_op(at_, w) if kind == "win" else hk.uwin_op(at_, w))


def shell(p, rng):
    """Plinth, outer walls with windows and doors, stone details, roof, dormers, chimney."""
    p.boxmm((-W / 2 - 0.12, -D / 2 - 0.12, -0.6), (W / 2 + 0.12, D / 2 + 0.12, GF), LOOK["plinth"], col="floor")
    for key, a, b, conv in walls_def():
        items = OPENINGS[key]
        ops = [op_of(k, conv(v), rest[0] if rest else 1.0) for k, v, *rest in items]
        hk.wall2(p, a, b, EAVE, T, LOOK["wall"], BANDS, openings=ops, top=LOOK["top"])
        hk.wall_stones(p, a, b, EAVE, T, ("stone_dark", "rock_light", "rubble"), ops, rng, 9)
        for (k, v, *rest), op in zip(items, ops):
            if k == "door":
                hk.doorway(p, a, b, op, T, LOOK, hinge=-1, porch="slate" if key == "front" else None)
            else:
                hk.window(p, a, b, op, T, LOOK, flowers=FLOWERS.get((key, k, v)))
    hk.string_course(p, W, D, UF - 0.15, "stone_dark")
    hk.quoins(p, W, D, EAVE, LOOK["quoin"])
    roof = hk.tiled_roof(p, W, D, EAVE, PITCH, 0.45, 0.28, LOOK, along="X", wall_t=T)
    for x in (-1.5, 1.5):
        hk.dormer(p, x, EAVE, PITCH, D, LOOK)
    hk.chimney(p, CHIMNEY[0], CHIMNEY[1], EAVE - 0.3, roof["ridge"] + 1.0, LOOK["chimney"])
    hk.downpipe(p, W / 2 - 0.25, -D / 2 - 0.08, EAVE - 0.2, -D / 2 - 0.45 - 0.12)
    hk.downpipe(p, -W / 2 + 0.25, D / 2 + 0.08, EAVE - 0.2, D / 2 + 0.45 + 0.12)
    return roof


def interior(p, rng):
    # floors: flagstones in the kitchen, boards in the parlour and upstairs
    hk.flagstones(p, (IX0, IY0, DIV_X - 0.1, IY1), GF, rng)
    hk.planks(p, (DIV_X + 0.1, IY0, IX1, IY1), GF, along="y")
    # partition with a doorway, upstairs partition
    hk.inner_wall(p, (DIV_X, IY0), (DIV_X, IY1), STORY - SLAB, 0.2, ("wallpaper_green", "plaster_warm"),
                  openings=[(-1.2 - IY0, hk.DOOR_W, 0, hk.DOOR_H)], z0=GF, trim="wood_dark")
    hk.inner_wall(p, (DIV_X, IY0), (DIV_X, 0.6), EAVE - SLAB - UF, 0.2, ("wallpaper_green", "wallpaper_green"), z0=UF)
    # stairs along the back wall, climbing east; upper floor with the stairwell, rails
    hk.stair_run(p, "x", STAIR["band"], STAIR["start"], 1, GF, STORY, STAIR["steps"], STAIR["run"], STAIR_LOOK, open_side=-1)
    hk.slab_with_hole(p, (IX0, IY0, IX1, IY1), HOLE, UF, "wood_dark", top="wood")
    hk.planks(p, (IX0, IY0, IX1, IY1), UF, cells=("wood", "wood_light"), along="x", holes=[HOLE])
    hk.rail(p, (-3.6, 2.24), (0.45, 2.24), UF)
    hk.rail(p, (-3.66, 2.3), (-3.66, 3.4), UF)
    hk.beams(p, (IX0, IY0, IX1, IY1), UF - SLAB, along="y", spacing=1.25, holes=[HOLE])
    # attic ceiling with beams
    p.boxmm((IX0, IY0, EAVE - SLAB), (IX1, IY1, EAVE), "wood_dark", col="floor", bottom=True)
    hk.beams(p, (IX0, IY0, IX1, IY1), EAVE - SLAB, along="y", spacing=1.6, size=(0.18, 0.22))

    # ---- kitchen
    with at(p, -4.3, CHIMNEY[1], GF, 90):
        F.fireplace(p, w=1.8, d=0.6, h=STORY - SLAB, rng=rng)
    with at(p, -2.2, 0.25, GF):
        F.table(p, 1.8, 0.9, top="wood_light")
        for x in (-0.55, 0.0, 0.55):
            F.plate(p, x, -0.22, 0.78)
        F.loaf(p, 0.3, 0.15, 0.78)
        F.bottle(p, -0.4, 0.2, 0.78)
    with at(p, -2.2, -0.5, GF):
        F.bench(p, 1.6)
    with at(p, -2.2, 1.0, GF):
        F.bench(p, 1.6)
    with at(p, -0.85, 0.25, GF, -90):
        F.chair(p)
    with at(p, 0.15, IY0 + 0.25, GF, 180):
        F.hutch(p, 1.5, 0.5, rng=rng)
    with at(p, DIV_X - 0.1 - 0.3, 0.6, GF, -90):
        F.sink_counter(p, 1.8, 0.6)
    with at(p, -4.25, -3.05, GF):
        F.barrel(p, 0.28, 0.8)
    F.sack(p, -3.75, -3.1, GF, rot=20)
    F.pendant(p, -2.2, 0.25, UF - SLAB - 0.2)

    # ---- parlour
    with at(p, IX1 - 0.18, -2.9, GF, -90):
        F.clock(p)
    with at(p, IX1 - 0.44, 0.2, GF, -90):
        F.sofa(p, 1.9, "fabric_green")
    with at(p, 2.05, 0.6, GF, 90):
        F.armchair(p, "fabric_red")
    with at(p, 1.95, -2.7, GF, 90):
        F.armchair(p, "fabric_blue")
    with at(p, 2.95, -2.55, GF):
        F.round_table(p, 0.42, 0.72)
    F.radio(p, 3.05, -2.65, GF + 0.72)
    with at(p, 3.0, 0.2, GF):
        F.table(p, 0.9, 0.55, h=0.45)
    F.rug(p, 2.3, -0.75, 3.65, 1.15, GF + 0.012)
    with at(p, DIV_X + 0.1 + 0.18, 2.2, GF, 90):
        F.bookcase(p, 1.2, 0.36, 1.9, rng=rng)
    F.picture(p, DIV_X + 0.1, -2.6, 1.75, 0.7, 0.55, "+x")
    F.picture(p, 2.2, IY1, 1.7, 0.9, 0.6, "-y", art="hay", sky="glass")
    F.pendant(p, 3.0, 0.2, UF - SLAB - 0.2)

    # ---- upstairs west: main bedroom
    p.boxmm((IX0, -2.4, UF), (IX0 + 0.5, -1.0, EAVE - SLAB), "stone", col="wall", bottom=True)
    with at(p, 0.2, -1.8, UF, -90):
        F.bed(p, 1.4, 2.0, blanket="fabric_red")
    with at(p, 0.95, -3.0, UF, -90):
        F.nightstand(p)
    with at(p, -1.5, IY0 + 0.25, UF, 180):
        F.chest_of_drawers(p, 1.0, 0.5, 0.9, mirror=True)
    with at(p, IX0 + 0.29, 0.75, UF, 90):
        F.wardrobe(p)
    with at(p, -1.2, -1.8, UF, 90):
        F.trunk(p)
    F.rug(p, -3.4, -2.6, -1.8, -0.2, UF + 0.012, outer="fabric_blue", inner="cream")
    F.picture(p, -2.6, IY1, UF + 1.7, 0.8, 0.55, "-y")
    F.pendant(p, -1.8, -1.0, EAVE - SLAB - 0.22)

    # ---- upstairs east: study bedroom and landing
    with at(p, 4.05, -2.4, UF, 180):
        F.bed(p, 0.95, 1.95, blanket="fabric_blue")
    with at(p, IX1 - 0.3, 0.2, UF, -90):
        F.desk(p, 1.2, 0.6)
    with at(p, 3.7, 0.2, UF, 90):
        F.chair(p)
    with at(p, DIV_X + 0.1 + 0.18, -2.2, UF, 90):
        F.bookcase(p, 1.2, 0.36, 1.9, rng=rng)
    with at(p, 2.15, IY0 + 0.22, UF, 180):
        F.washstand(p)
    with at(p, 4.15, 2.95, UF, 180):
        F.trunk(p, 0.9, 0.5)
    F.rug(p, 2.0, -1.2, 3.4, 0.0, UF + 0.012)
    F.pendant(p, 3.0, -0.8, EAVE - SLAB - 0.22)


def exterior_props(p, rng):
    with at(p, W / 2 + 0.35, 2.3, 0.0, 90):
        F.woodpile(p, 1.8, 0.7, 1.0, rng=rng)
    with at(p, 0.0, -D / 2 - 0.42, 0.0, 180):
        F.bench(p, 1.3, 0.34)
    with at(p, W / 2 - 0.45, -D / 2 - 0.42, 0.0):
        F.barrel(p, 0.3, 0.9, cell="wood", top="water")
    with at(p, -W / 2 - 0.5, -2.7, 0.0, -90):
        F.ladder(p, 3.2)


def farmhouse(lod=0):
    if lod > 0:
        return farmhouse_lod(lod)
    p = Prop("farmhouse", "building")
    rng = Rng(101)
    shell(p, rng)
    interior(p, rng)
    exterior_props(p, rng)
    for v, tb in [((-2.2, 0.35, GF + 0.78), 0), ((0.15, IY0 + 0.4, GF + 0.92), 0), ((0.85, 1.25, GF + 0.9), 0),
                  ((2.85, -2.35, GF + 0.72), 0), ((3.0, 0.2, GF + 0.45), 0), ((3.9, 2.6, GF), 0),
                  ((0.2, -1.55, UF + 0.55), 1), ((-1.5, IY0 + 0.25, UF + 0.9), 1), ((IX1 - 0.3, -0.05, UF + 0.76), 1),
                  ((1.0, 2.85, UF), 0)]:
        p.loot_at(v, tb)
    p.meta["probes"] = [
        ((-1.5, -5.6, GF), (-1.5, -2.0, GF), "front door"), ((3.0, 5.6, GF), (3.0, 2.0, GF), "back door"),
        ((0.0, -1.2, GF), (2.6, -1.2, GF), "divider door"), ((-3.5, -0.6, GF), (-4.1, 1.8, GF), "hearth to stair"),
        ((-4.1, 1.8, GF), (-4.1, 2.85, GF), "stair foot"), ((0.8, 2.85, UF), (3.3, 2.85, UF), "stair top"),
        ((-2.5, 1.5, UF), (3.6, 1.5, UF), "upper floor"), ((2.6, 1.4, UF), (3.0, -1.0, UF), "east room"),
    ]
    p.meta["walk"] = [(-1.5, -6.0, 0.0), (-1.5, -2.2, GF), (-3.55, -0.6, GF), (-4.1, 1.9, GF), (-4.1, 2.85, GF),
                      (-3.3, 2.85, GF + 0.2), (0.8, 2.85, UF), (2.6, 1.5, UF), (3.0, -0.9, UF)]
    p.meta["cams"] = [("kitchen", (0.7, -2.7, GF + 1.6), (-3.6, 0.6, GF + 0.9), 20), ("parlour", (1.75, 2.9, GF + 1.6), (4.2, -2.2, GF + 0.8), 20),
                      ("stairs", (-4.2, -0.2, GF + 1.5), (-0.5, 3.0, GF + 2.2), 22), ("bedroom", (-3.9, 1.9, UF + 1.6), (0.6, -2.2, UF + 0.6), 20),
                      ("study", (2.0, 2.9, UF + 1.6), (4.3, -2.6, UF + 0.6), 20)]
    p.meta["note"] = "stone farmhouse: kitchen with hearth, parlour, two bedrooms upstairs; stairs along the back wall"
    return p


# ---------------------------------------------------------------- LODs: closed shells, no interior
def lod_patches():
    out = []
    zr = {"door": (GF, GF + hk.DOOR_H), "win": (1.05, 2.25), "uwin": (UF + 0.85, UF + 2.1)}
    for key, items in OPENINGS.items():
        for k, v, *rest in items:
            w = rest[0] if rest else hk.DOOR_W
            out.append((key, v, zr[k][0], zr[k][1], w, "door" if k == "door" else "win"))
    return out


def farmhouse_lod(lod):
    p = Prop("farmhouse", "building")
    p.boxmm((-W / 2 - 0.12, -D / 2 - 0.12, -0.6), (W / 2 + 0.12, D / 2 + 0.12, GF), LOOK["plinth"])
    p.boxmm((-W / 2, -D / 2, GF), (W / 2, D / 2, EAVE), LOOK["wall"], bottom=True)
    ridge = EAVE + math.tan(math.radians(PITCH)) * D / 2
    if lod == 1:
        import kit
        kit.gable_roof(p, W, D, EAVE, PITCH, 0.45, 0.28, LOOK["roof"], ridge_cell=LOOK["ridge"], along="X",
                       gable_cell=LOOK["wall"], wall_t=T, col=None)
        p.box((0.9, 0.7, ridge + 1.0 - (EAVE - 0.3)), (CHIMNEY[0], CHIMNEY[1], (ridge + 1.0 + EAVE - 0.3) / 2), LOOK["chimney"], bottom=True)
        t = math.tan(math.radians(PITCH))
        for x in (-1.5, 1.5):
            zs = EAVE + 0.9 * t
            p.boxmm((x - 0.75, -D / 2 + 0.9, zs - 0.4), (x + 0.75, -D / 2 + 3.1, zs + 1.45), LOOK["dormer"], bottom=True)
            p.prism([(x - 0.93, zs + 1.43), (x + 0.93, zs + 1.43), (x, zs + 2.07)], 2.45, (0, -D / 2 + 1.88, 0), LOOK["roof"], axis="Y")
            p.patch((x, -D / 2 + 0.9, zs + 0.7), (0, -1, 0), 0.9, 1.0, "window", offset=0.02)
        p.box((2.1, 1.1, 0.1), (-1.5, -D / 2 - 0.55, GF + hk.DOOR_H + 0.55), "slate", bottom=True)
        hk.shell_patches(p, W, D, lod_patches(), LOOK)
    else:
        hk.roof_hull(p, W, D, EAVE, PITCH, 0.45, LOOK["roof"])
        span = D / 2
        for sx in (-1, 1):
            p.prism([(-span, EAVE), (span, EAVE), (0, ridge)], 0.05, (sx * (W / 2 + 0.47), 0, 0), LOOK["wall"], axis="X")
        p.box((0.9, 0.7, 1.6), (CHIMNEY[0], CHIMNEY[1], ridge - 0.2), LOOK["chimney"], bottom=True)
        hk.shell_patches(p, W, D, lod_patches(), {})
    return p
