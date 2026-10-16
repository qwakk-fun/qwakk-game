"""Townhouse: a plastered village house with a bakery on the ground floor, a red and cream striped
awning, a painted shop sign (a loaf, no text) and two Juliet balconies upstairs.

Ground floor: the shop (terracotta and cream tiles, a glass display case behind the shop window, a
counter with a till, shelves of bread and jars, a cafe table) and a bakehouse at the back (brick bread
oven, kneading table, stove). A 15-step stair along the west wall climbs to a living room (piano,
sofa, sideboard with a radio) and a bedroom. 10 loot spots.

Blender space: meters, Z up, the front faces -Y, origin on the ground at the footprint center.
"""

import math

import furniture as F
import house_kit as hk
import kit
from furniture import at
from house_kit import EAVE, GF, SLAB, STORY, UF
from kit import Prop, Rng

W, D, T = 8.4, 7.4, 0.35
IX0, IX1, IY0, IY1 = -W / 2 + T, W / 2 - T, -D / 2 + T, D / 2 - T      # -3.85, 3.85, -3.35, 3.35
PITCH = 42
PART_Y = 1.1           # ground floor partition between the shop and the bakehouse
UDIV_Y = 0.1           # upper floor partition between the living room and the bedroom
STAIR = {"band": (IX0, IX0 + 1.1), "start": -2.2, "run": 0.27, "steps": 15}
HOLE = (IX0, -2.2, IX0 + 1.1, 1.85)
CHIMNEY = (-1.95, 2.55)
SHOP_DOOR = (0.7, 1.2, GF, GF + 2.45)
AWNING = (-3.05, 1.55)

LOOK = {
    "wall": "plaster", "top": "plaster_dark", "frame": "white", "shutter": "shutter_blue", "shutter_dark": "slate",
    "lintel": "stone", "sill": "stone", "door": "shop_green", "door_dark": "wood_dark", "door_frame": "shop_green",
    "roof": "tile", "ridge": "tile_dark", "course": "tile_dark", "gable": "plaster", "fascia": "wood_dark", "gutter": "steel",
    "quoin": "stone", "plinth": "stone_dark",
}
SHOP_LOOK = dict(LOOK, frame="shop_green")
STAIR_LOOK = {"tread": "wood_light", "riser": "wood_dark", "stringer": "wood_dark", "rail": "wood_dark"}
BANDS = [(0.0, GF + 1.0, "shop_green"), (GF + 1.0, UF, "plaster_warm"), (UF, 99.0, "wallpaper_rose")]

# kind: door, shopdoor, shop (display window), win, uwin, french
OPENINGS = {
    "front": [("shop", -1.6, 2.4), ("shopdoor", SHOP_DOOR[0], SHOP_DOOR[1]), ("win", 2.85, 1.0),
              ("french", -2.0, 1.0), ("french", 0.4, 1.0), ("uwin", 2.8, 1.0)],
    "east": [("win", 2.2, 1.0), ("uwin", -1.6, 1.0)],
    "back": [("door", 2.4, hk.DOOR_W), ("uwin", 0.6, 1.0), ("uwin", -1.7, 0.9)],
    "west": [("uwin", -2.9, 0.8)],
}


def walls_def():
    return [
        ("front", (-W / 2, -D / 2 + T / 2), (W / 2, -D / 2 + T / 2), lambda v: v + W / 2),
        ("east", (W / 2 - T / 2, -D / 2 + T), (W / 2 - T / 2, D / 2 - T), lambda v: v + D / 2 - T),
        ("back", (W / 2, D / 2 - T / 2), (-W / 2, D / 2 - T / 2), lambda v: W / 2 - v),
        ("west", (-W / 2 + T / 2, D / 2 - T), (-W / 2 + T / 2, -D / 2 + T), lambda v: D / 2 - T - v),
    ]


def op_of(kind, u, w):
    return {"door": lambda: hk.door_op(u, w), "shopdoor": lambda: (u, w, SHOP_DOOR[2], SHOP_DOOR[3]),
            "shop": lambda: (u, w, 1.0, 2.45), "win": lambda: hk.win_op(u, w), "uwin": lambda: hk.uwin_op(u, w),
            "french": lambda: hk.french_op(u, w)}[kind]()


def awning(p):
    """Striped canvas awning over the shop window and door, iron arms, scalloped valance (mesh only)."""
    x0, x1 = AWNING
    y_wall = -D / 2 - 0.02
    z_top, depth, drop = 2.95, 1.35, 0.42
    ang = math.degrees(math.atan2(drop, depth))
    slope = math.hypot(depth, drop)
    n = 13
    sw = (x1 - x0) / n
    for i in range(n):
        cx = x0 + (i + 0.5) * sw
        p.box((sw + 0.002, slope, 0.04), (cx, y_wall - depth / 2, z_top - drop / 2), "awning_red" if i % 2 == 0 else "cream",
              rot=(ang, 0, 0), bottom=True)
        tri = [(cx - sw / 2, z_top - drop - 0.02), (cx + sw / 2, z_top - drop - 0.02), (cx, z_top - drop - 0.2)]
        p.prism(tri, 0.03, (0, y_wall - depth - 0.01, 0), "awning_red" if i % 2 == 0 else "cream", axis="Y")
    p.box((x1 - x0 + 0.1, 0.12, 0.12), ((x0 + x1) / 2, y_wall - 0.06, z_top + 0.02), "shop_green", bottom=True)
    for x in (x0 + 0.08, x1 - 0.08):
        p.tube((x, y_wall, z_top - 0.75), (x, y_wall - depth, z_top - drop - 0.02), 0.025, "iron", segs=4)


def shop_sign(p):
    """Painted fascia board over the awning: a loaf and two wheat ears, no lettering."""
    x0, x1 = AWNING
    y = -D / 2 - 0.02
    p.boxmm((x0, y - 0.07, 3.0), (x1, y, 3.12 + 0.0), "shop_green", bottom=True)
    p.boxmm((x0 + 0.05, y - 0.05, 2.97), (x1 - 0.05, y, 3.1), "shop_green", bottom=True)
    cx = (x0 + x1) / 2
    with p.frame((cx, y - 0.06, 3.04)):
        p.sphere((0.32, 0.05, 0.06), (0, 0, 0), "bread", segs=8, rings=3, smooth=False)
        for sx in (-1, 1):
            for k in range(3):
                p.sphere((0.05, 0.02, 0.025), (sx * (0.55 + k * 0.1), 0, 0.0), "hay", segs=5, rings=3, smooth=False)
            p.box((0.32, 0.01, 0.012), (sx * 0.62, 0.0, -0.03), "hay_dark", bottom=True)


def wall_lamp(p, x, y_face, z):
    p.tube((x, y_face, z), (x, y_face - 0.4, z + 0.15), 0.02, "iron", segs=4)
    p.cyl(0.13, 0.25, (x, y_face - 0.42, z - 0.05), "lamp_glass", segs=6, cap_cell="iron")
    p.cyl(0.17, 0.08, (x, y_face - 0.42, z + 0.11), "iron", segs=6, r2=0.04)


def bread_oven(p):
    """Brick bake oven against a wall (back at +Y): fire door, ash slot, a peel leaning on it."""
    w, d, h = 1.4, 1.2, 1.55
    p.boxmm((-w / 2, -d / 2, 0), (w / 2, d / 2, 0.75), "brick", top="stone_dark", bottom=True)
    p.boxmm((-w / 2, -d / 2 + 0.1, 0.75), (w / 2, d / 2, h), "brick", top="char", bottom=True)
    p.boxmm((-w / 2 - 0.04, -d / 2 - 0.04, 0.72), (w / 2 + 0.04, -d / 2 + 0.1, 0.8), "stone_dark", bottom=True)
    p.boxmm((-0.3, -d / 2 + 0.07, 0.82), (0.3, -d / 2 + 0.1, 1.22), "iron", bottom=True)
    p.box((0.1, 0.04, 0.04), (0.18, -d / 2 + 0.05, 1.02), "bronze", bottom=True)
    p.boxmm((-0.35, -d / 2 - 0.01, 0.2), (0.35, -d / 2, 0.4), "char", bottom=True)
    p.cyl(0.12, 2.9 - h, (0.3, 0.2, h + (2.9 - h) / 2), "iron", segs=6)
    p.tube((w / 2 + 0.1, -d / 2 - 0.15, 0.0), (w / 2 + 0.05, -d / 2 + 0.05, 1.9), 0.025, "wood_light", segs=4)
    p.box((0.32, 0.03, 0.4), (w / 2 + 0.1, -d / 2 - 0.14, 0.2), "wood_light", rot=(-6, 0, 0), bottom=True)
    p.col_boxmm("cover", (-w / 2, -d / 2, 0), (w / 2, d / 2, h))


def shell(p, rng):
    p.boxmm((-W / 2 - 0.12, -D / 2 - 0.12, -0.6), (W / 2 + 0.12, D / 2 + 0.12, GF), LOOK["plinth"], col="floor")
    for key, a, b, conv in walls_def():
        items = OPENINGS[key]
        ops = [op_of(k, conv(v), w) for k, v, w in items]
        hk.wall2(p, a, b, EAVE, T, LOOK["wall"], BANDS, openings=ops, top=LOOK["top"])
        hk.plaster_patches(p, a, b, EAVE, T, ops, rng, 2 if key in ("front", "back") else 1)
        for (k, v, w), op in zip(items, ops):
            if k == "door":
                hk.doorway(p, a, b, op, T, LOOK, hinge=1)
            elif k == "shopdoor":
                hk.doorway(p, a, b, op, T, SHOP_LOOK, hinge=1, step=True)
                # transom bar and glass over the shop door
                _, _, length, yaw, mid = hk._frame_of(a, b)
                x0, x1 = op[0] - length / 2 - w / 2, op[0] - length / 2 + w / 2
                with p.frame((mid.x, mid.y, 0.0), rot_z=yaw):
                    p.boxmm((x0, -T / 2 + 0.05, GF + 2.08), (x1, -T / 2 + 0.12, GF + 2.15), "shop_green", bottom=True)
            elif k == "shop":
                hk.window(p, a, b, op, T, SHOP_LOOK, leaves=False, shutters=False, mullions=(2, 1.05))
            elif k == "french":
                hk.window(p, a, b, op, T, LOOK, rail="iron", flowers=None)
            else:
                hk.window(p, a, b, op, T, LOOK)
    hk.quoins(p, W, D, EAVE, LOOK["quoin"], t=T)
    roof = hk.tiled_roof(p, W, D, EAVE, PITCH, 0.4, 0.26, LOOK, along="X", wall_t=T)
    hk.chimney(p, CHIMNEY[0], CHIMNEY[1], EAVE - 0.3, roof["ridge"] + 0.7, "plaster_dark", cap="stone", pots="tile")
    hk.downpipe(p, -W / 2 + 0.22, -D / 2 - 0.08, EAVE - 0.2, -D / 2 - 0.4 - 0.12)
    hk.downpipe(p, W / 2 - 0.22, D / 2 + 0.08, EAVE - 0.2, D / 2 + 0.4 + 0.12)
    awning(p)
    shop_sign(p)
    wall_lamp(p, 2.1, -D / 2 - 0.02, 2.75)
    # flower pots on the Juliet balconies
    for x in (-2.0, 0.4):
        for dx, cell in ((-0.3, "flower_pink"), (0.3, "fabric_red")):
            p.cyl(0.1, 0.16, (x + dx, -D / 2 + 0.1, UF + 0.08), "tile", segs=6, r2=0.12, cap_cell="earth_dark")
            p.sphere((0.13, 0.11, 0.1), (x + dx, -D / 2 + 0.1, UF + 0.22), cell, segs=5, rings=3, smooth=False)


def interior(p, rng):
    # floors
    hk.flagstones(p, (IX0, IY0, IX1, PART_Y - 0.1), GF, rng, base="cream", dark="tile", size=0.6)
    hk.planks(p, (IX0, PART_Y + 0.1, IX1, IY1), GF, cells=("wood", "wood_dark"), along="x")
    # partition (shop | bakehouse), upstairs partition (living room | bedroom)
    hk.inner_wall(p, (IX1, PART_Y), (STAIR["band"][1], PART_Y), STORY - SLAB, 0.2, ("plaster_warm", "plaster_warm"),
                  openings=[(IX1 - 2.4, hk.DOOR_W, 0, hk.DOOR_H)], z0=GF, trim="shop_green")
    hk.inner_wall(p, (IX1, UDIV_Y), (-1.6, UDIV_Y), EAVE - SLAB - UF, 0.2, ("wallpaper_rose", "wallpaper_green"),
                  openings=[(IX1 - 2.9, hk.DOOR_W, 0, hk.DOOR_H)], z0=UF, trim="white")
    # stairs along the west wall climbing north, upper floor, rails, ceilings
    hk.stair_run(p, "y", STAIR["band"], STAIR["start"], 1, GF, STORY, STAIR["steps"], STAIR["run"], STAIR_LOOK, open_side=1)
    hk.slab_with_hole(p, (IX0, IY0, IX1, IY1), HOLE, UF, "wood_dark", top="wood")
    hk.planks(p, (IX0, IY0, IX1, IY1), UF, cells=("wood_light", "wood"), along="y", holes=[HOLE])
    hk.rail(p, (HOLE[2] + 0.06, HOLE[1]), (HOLE[2] + 0.06, HOLE[3]), UF, cell="wood_dark")
    hk.rail(p, (IX0, HOLE[1] - 0.06), (HOLE[2], HOLE[1] - 0.06), UF, cell="wood_dark")
    hk.beams(p, (IX0, IY0, IX1, IY1), UF - SLAB, along="x", spacing=1.3, holes=[HOLE], cell="wood_dark")
    p.boxmm((IX0, IY0, EAVE - SLAB), (IX1, IY1, EAVE), "white", col="floor", bottom=True)

    # ---- the shop
    with at(p, -1.2, IY0 + 0.6, GF):
        F.display_case(p, 1.4, 0.55, 0.95)
    with at(p, 2.4, -1.0, GF, -90):
        F.shop_counter(p, 2.2, 0.62, 1.0)
    with at(p, IX1 - 0.21, -1.7, GF, -90):
        F.shop_shelf(p, 2.6, 0.42, 2.1, rng=rng, goods="mixed")
    with at(p, -1.15, PART_Y - 0.1 - 0.21, GF):
        F.shop_shelf(p, 2.4, 0.42, 2.1, rng=rng, goods="bread")
    with at(p, -1.3, -1.0, GF):
        F.round_table(p, 0.42, 0.75, top="cream")
    with at(p, -0.6, -1.0, GF, -90):
        F.chair(p)
    with at(p, -1.3, -0.3, GF, 180):
        F.chair(p)
    F.bottle(p, -1.4, -1.1, GF + 0.75, cell="glass")
    F.plate(p, -1.15, -0.95, GF + 0.75)
    for x, y, r in ((-2.4, 0.45, 15), (-2.3, -0.15, -30)):
        F.sack(p, x, y, GF, rot=r, cell="cream")
    with at(p, 1.75, IY0 + 0.35, GF):
        F.coat_rack(p)
    F.pendant(p, -0.8, -1.6, UF - SLAB - 0.2, shade="shop_green")
    F.pendant(p, 2.0, -1.0, UF - SLAB - 0.2, shade="shop_green")
    F.picture(p, IX1, 0.4, 1.9, 0.6, 0.45, "-x", art="bread", sky="cream")

    # ---- the bakehouse
    with at(p, -1.95, IY1 - 0.6, GF):
        bread_oven(p)
    with at(p, 0.5, 2.3, GF):
        F.table(p, 1.6, 0.8, h=0.82, top="cream")
        F.loaf(p, -0.4, 0.1, 0.82)
        F.loaf(p, -0.1, -0.15, 0.82, rot=30)
        p.sphere((0.2, 0.16, 0.08), (0.45, 0.1, 0.86), "cream", segs=6, rings=3, smooth=False)
    with at(p, 3.4, IY1 - 0.4, GF):
        F.crate(p, 0.65)
    with at(p, 3.45, IY1 - 0.4, GF + 0.65):
        F.crate(p, 0.5, col=False)
    for x, y in ((-3.4, 2.4), (-3.1, 3.0), (-3.5, 3.0)):
        F.sack(p, x, y, GF, rot=x * 40)
    with at(p, -0.6, IY1 - 0.31, GF):
        F.range_stove(p, 0.9, 0.62, flue_to=UF - SLAB)
    F.pendant(p, 0.5, 2.3, UF - SLAB - 0.2)

    # ---- upstairs: living room
    with at(p, 1.05, UDIV_Y - 0.1 - 0.3, UF):
        F.piano(p)
    with at(p, -0.8, -1.3, UF):
        F.sofa(p, 1.9, "fabric_blue")
    with at(p, -0.8, -2.3, UF):
        F.table(p, 0.9, 0.5, h=0.45)
    with at(p, 0.75, -2.3, UF, -90):
        F.armchair(p, "fabric_red")
    with at(p, IX1 - 0.25, -2.6, UF, -90):
        F.chest_of_drawers(p, 1.0, 0.5, 0.9)
    F.radio(p, IX1 - 0.25, -2.85, UF + 0.9)
    F.rug(p, -1.7, -2.9, 0.1, -1.7, UF + 0.012, outer="rug_gold", inner="fabric_red")
    F.picture(p, -0.6, UDIV_Y - 0.1, UF + 1.75, 0.9, 0.6, "-y", art="water", sky="glass")
    F.pendant(p, -0.6, -1.6, EAVE - SLAB - 0.05)

    # ---- upstairs: bedroom and landing
    with at(p, IX1 - 1.0, 1.9, UF, -90):
        F.bed(p, 1.4, 2.0, blanket="fabric_green")
    with at(p, IX1 - 0.25, 2.95, UF, -90):
        F.nightstand(p)
    with at(p, 1.55, 1.9, UF, 90):
        F.trunk(p)
    with at(p, -0.6, IY1 - 0.29, UF):
        F.wardrobe(p, 1.1, 0.58, 2.0)
    with at(p, 1.6, IY1 - 0.22, UF):
        F.washstand(p)
    F.rug(p, -0.6, 0.6, 0.9, 2.5, UF + 0.012, outer="fabric_blue", inner="cream")
    F.pendant(p, 0.8, 1.7, EAVE - SLAB - 0.05)


def exterior_props(p, rng):
    # produce stand under the awning, a bench and a cafe table outside the side window
    with at(p, -1.6, -D / 2 - 0.45, 0.0, 180):
        F.table(p, 1.7, 0.55, h=0.7, top="wood")
    for i, cell in enumerate(("apple", "leaf_light", "hay")):
        with at(p, -2.15 + i * 0.55, -D / 2 - 0.45, 0.7):
            F.produce_crate(p, cell=cell, w=0.48, d=0.4, h=0.2)
    with at(p, 2.85, -D / 2 - 0.85, 0.0):
        F.round_table(p, 0.38, 0.72, top="cream")
    with at(p, 2.85, -D / 2 - 1.45, 0.0):
        F.chair(p)
    with at(p, W / 2 + 0.45, 0.0, 0.0, -90):
        F.barrel(p, 0.3, 0.9)


def townhouse(lod=0):
    if lod > 0:
        return townhouse_lod(lod)
    p = Prop("townhouse", "building")
    rng = Rng(202)
    shell(p, rng)
    interior(p, rng)
    exterior_props(p, rng)
    for v, tb in [((-1.2, IY0 + 0.6, GF + 0.95), 0), ((2.4, -1.5, GF + 1.0), 0), ((3.1, -0.4, GF), 0),
                  ((0.5, 2.5, GF + 0.82), 0), ((2.9, 2.0, GF), 0),
                  ((-0.8, -2.3, UF + 0.45), 1), ((IX1 - 0.25, -2.35, UF + 0.9), 1), ((IX1 - 1.0, 1.7, UF + 0.55), 1),
                  ((1.55, 1.9, UF + 0.55), 0), ((-3.3, 2.9, UF), 0)]:
        p.loot_at(v, tb)
    p.meta["probes"] = [
        ((0.7, -5.4, GF), (0.7, -1.6, GF), "shop door"), ((2.4, 5.4, GF), (2.4, 1.6, GF), "back door"),
        ((2.4, 0.55, GF), (2.4, 2.0, GF), "bakehouse door"), ((0.7, -1.8, GF), (-2.3, -1.85, GF), "shop floor"),
        ((-2.3, -1.85, GF), (-2.35, -2.75, GF), "to the stair foot"), ((-3.3, -2.75, GF), (-3.3, -2.3, GF), "stair foot"),
        ((-3.3, 2.6, UF), (-2.2, 2.6, UF), "landing"), ((-2.2, 2.6, UF), (-2.2, -2.5, UF), "upstairs hall"),
        ((2.9, -0.8, UF), (2.9, 0.8, UF), "bedroom door"),
    ]
    p.meta["walk"] = [(0.7, -6.0, 0.0), (0.7, -1.9, GF), (-2.3, -1.85, GF), (-2.35, -2.75, GF), (-3.3, -2.75, GF),
                      (-3.3, -1.9, GF + 0.2), (-3.3, 2.6, UF), (-2.2, 2.6, UF), (-2.2, -0.2, UF), (-2.3, -2.5, UF)]
    p.meta["cams"] = [("shop", (0.4, -2.9, GF + 1.6), (2.6, 0.6, GF + 0.8), 20), ("shop_window", (2.9, 0.6, GF + 1.6), (-2.2, -2.8, GF + 0.9), 20),
                      ("bakehouse", (3.3, 1.5, GF + 1.6), (-2.4, 3.2, GF + 0.8), 20), ("living", (-2.35, -0.4, UF + 1.6), (2.0, -2.6, UF + 0.7), 20),
                      ("bedroom", (-2.3, 1.2, UF + 1.6), (3.4, 2.4, UF + 0.6), 20), ("street", (3.5, -10.5, 1.6), (-0.8, -3.5, 2.3), 30)]
    p.meta["note"] = "plastered townhouse with a bakery: shop and bakehouse below, living room and bedroom upstairs, Juliet balconies"
    return p


# ---------------------------------------------------------------- LODs
def lod_patches():
    out = []
    for key, items in OPENINGS.items():
        for k, v, w in items:
            bot, tp = op_of(k, 0.0, w)[2:]
            out.append((key, v, bot, tp, w, "door" if k in ("door", "shopdoor") else ("shop" if k in ("shop", "french") else "win")))
    return out


def townhouse_lod(lod):
    p = Prop("townhouse", "building")
    p.boxmm((-W / 2 - 0.12, -D / 2 - 0.12, -0.6), (W / 2 + 0.12, D / 2 + 0.12, GF), LOOK["plinth"])
    p.boxmm((-W / 2, -D / 2, GF), (W / 2, D / 2, EAVE), LOOK["wall"], bottom=True)
    ridge = EAVE + math.tan(math.radians(PITCH)) * D / 2
    x0, x1 = AWNING
    if lod == 1:
        kit.gable_roof(p, W, D, EAVE, PITCH, 0.4, 0.26, LOOK["roof"], ridge_cell=LOOK["ridge"], along="X",
                       gable_cell=LOOK["wall"], wall_t=T, col=None)
        p.box((0.9, 0.7, ridge + 0.7 - (EAVE - 0.3)), (CHIMNEY[0], CHIMNEY[1], (ridge + 0.7 + EAVE - 0.3) / 2), "plaster_dark", bottom=True)
        hk.shell_patches(p, W, D, lod_patches(), LOOK)
        ang = math.degrees(math.atan2(0.42, 1.35))
        for i in range(5):
            sw = (x1 - x0) / 5
            p.box((sw, 1.42, 0.05), (x0 + (i + 0.5) * sw, -D / 2 - 0.69, 2.74), "awning_red" if i % 2 == 0 else "cream", rot=(ang, 0, 0), bottom=True)
        p.boxmm((x0, -D / 2 - 0.08, 2.97), (x1, -D / 2, 3.12), "shop_green", bottom=True)
    else:
        hk.roof_hull(p, W, D, EAVE, PITCH, 0.4, LOOK["roof"])
        for sx in (-1, 1):
            p.prism([(-D / 2, EAVE), (D / 2, EAVE), (0, ridge)], 0.05, (sx * (W / 2 + 0.42), 0, 0), LOOK["wall"], axis="X")
        ang = math.degrees(math.atan2(0.42, 1.35))
        p.box((x1 - x0, 1.42, 0.05), ((x0 + x1) / 2, -D / 2 - 0.69, 2.74), "awning_red", rot=(ang, 0, 0), bottom=True)
        hk.shell_patches(p, W, D, lod_patches(), {})
    return p
