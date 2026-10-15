"""Enterable buildings and landmarks: farmhouse, townhouse, ruined house, church, barn, lighthouse, stone bridge.

Blender space: meters, Z up, the front faces -Y, origin on the ground at the footprint center.
Walls go counterclockwise seen from above, so each wall's local -Y is outside (shutters, frames).
Floors: ground floor top at 0.15 m, upper floor top at 3.15 m, doors 1.1 x 2.1 m.
"""

import math

from mathutils import Vector

import kit
from kit import Prop, Rng, gable_roof, opening_frame, stairs, stairs_x

GF = 0.15            # ground floor top
STORY = 3.0
UF = GF + STORY      # upper floor top
SLAB = 0.25
DOOR_W, DOOR_H = 1.1, 2.1


def door(at):
    return (at, DOOR_W, GF, GF + DOOR_H)


def win(at, w=1.0):
    return (at, w, 1.05, 2.25)


def uwin(at, w=1.0):
    return (at, w, UF + 0.85, UF + 2.1)


# ---------------------------------------------------------------- ruin support
def ruin_wall(p, a, b, height, thick, cell, openings, top_fn, top=None, col="wall", z0=0.0, strip=0.7):
    """Like kit.wall, but each solid piece is cut into ~0.7 m strips capped by top_fn(world_xy)."""
    a, b = Vector(a), Vector(b)
    d = b - a
    length = d.length
    yaw = math.degrees(math.atan2(d.y, d.x))
    mid = (a + b) / 2
    dirn = d.normalized()

    def piece(u0, u1, zb, zt):
        n = max(1, round((u1 - u0) / strip))
        for i in range(n):
            s0 = u0 + (u1 - u0) * i / n
            s1 = u0 + (u1 - u0) * (i + 1) / n
            w = a + dirn * ((s0 + s1) / 2 + length / 2)
            cap = top_fn(w.x, w.y)
            zt2 = min(zt, cap)
            if zt2 - zb > 0.08:
                p.boxmm((s0, -thick / 2, zb), (s1, thick / 2, zt2), cell, col=col, top=top or "rubble", bottom=zb > 0.01)

    with p.frame((mid.x, mid.y, z0), rot_z=yaw):
        for u0, u1, zb, zt in kit.solid_pieces(length, height, openings):
            piece(u0, u1, zb, zt)


def jag(seed, base_fn, amp=0.6):
    rng_cache = {}

    def fn(x, y):
        key = (round(x * 1.4), round(y * 1.4))
        if key not in rng_cache:
            r = Rng(seed + key[0] * 7919 + key[1] * 104729)
            rng_cache[key] = r.range(-amp, amp)
        return base_fn(x, y) + rng_cache[key]
    return fn


# ---------------------------------------------------------------- generic two-story house
def quoins(p, W, D, height, cell, step=0.5):
    for sx in (-1, 1):
        for sy in (-1, 1):
            cx, cy = sx * W / 2, sy * D / 2
            k = 0
            z = 0.3
            while z + step <= height:
                long_x = k % 2 == 0
                lx, ly = (0.75, 0.42) if long_x else (0.42, 0.75)
                p.box((lx, ly, step - 0.06), (cx - sx * (lx / 2 - 0.04), cy - sy * (ly / 2 - 0.04), z + step / 2), cell, bottom=True)
                z += step
                k += 1


def slab_with_hole(p, rect, hole, z_top, cell, col="floor", thick=SLAB):
    x0, y0, x1, y1 = rect
    pieces = []
    if hole is None:
        pieces.append((x0, y0, x1, y1))
    else:
        hx0, hy0, hx1, hy1 = hole
        if hx0 > x0 + 1e-3:
            pieces.append((x0, y0, hx0, y1))
        if hx1 < x1 - 1e-3:
            pieces.append((hx1, y0, x1, y1))
        if hy0 > y0 + 1e-3:
            pieces.append((hx0, y0, hx1, hy0))
        if hy1 < y1 - 1e-3:
            pieces.append((hx0, hy1, hx1, y1))
    for a0, b0, a1, b1 in pieces:
        p.boxmm((a0, b0, z_top - thick), (a1, b1, z_top), cell, col=col, bottom=True, top="wood")


def rail(p, a, b, z, cell="wood_dark", h=0.95, t=0.12):
    a, b = Vector(a), Vector(b)
    d = b - a
    yaw = math.degrees(math.atan2(d.y, d.x))
    mid = (a + b) / 2
    with p.frame((mid.x, mid.y, z), rot_z=yaw):
        p.boxmm((-d.length / 2, -t / 2, h - 0.1), (d.length / 2, t / 2, h), cell, col="cover", bottom=True)
        n = max(2, int(d.length / 0.6) + 1)
        for i in range(n):
            x = -d.length / 2 + d.length * i / (n - 1)
            x = max(-d.length / 2 + 0.05, min(d.length / 2 - 0.05, x))
            p.box((0.08, 0.08, h - 0.1), (x, 0, (h - 0.1) / 2), cell, bottom=True)


def house(name, W, D, look, spec, ruined=False):
    """Two-story house. `look`: wall, top, trim, shutter, roof, ridge, quoin cells and roof pitch.
    `spec`: openings per wall (world x or y), stairs, divider and loot. See farmhouse() for the fields."""
    p = Prop(name, "building")
    t = 0.4
    H = 6.0                        # eave (wall top)
    ix0, ix1, iy0, iy1 = -W / 2 + t, W / 2 - t, -D / 2 + t, D / 2 - t
    rng = Rng(len(name) * 31)

    # plinth and ground floor
    p.boxmm((-W / 2 - 0.12, -D / 2 - 0.12, -0.6), (W / 2 + 0.12, D / 2 + 0.12, GF), look["plinth"], col="floor")
    p.boxmm((ix0, iy0, GF - 0.01), (ix1, iy1, GF), "wood_dark", bottom=False)

    walls = {
        "front": ((-W / 2, -D / 2 + t / 2), (W / 2, -D / 2 + t / 2), lambda v: v + W / 2, W),
        "east": ((W / 2 - t / 2, -D / 2 + t), (W / 2 - t / 2, D / 2 - t), lambda v: v + D / 2 - t, D - 2 * t),
        "back": ((W / 2, D / 2 - t / 2), (-W / 2, D / 2 - t / 2), lambda v: W / 2 - v, W),
        "west": ((-W / 2 + t / 2, D / 2 - t), (-W / 2 + t / 2, -D / 2 + t), lambda v: D / 2 - t - v, D - 2 * t),
    }
    top_fn = spec.get("ruin_top") if ruined else None
    for key, (a, b, conv, length) in walls.items():
        ops = []
        for kind, v, *rest in spec["openings"].get(key, []):
            w = rest[0] if rest else (DOOR_W if kind == "door" else 1.0)
            at = conv(v)
            ops.append(door(at) if kind == "door" else (win(at, w) if kind == "win" else uwin(at, w)))
        if top_fn:
            ruin_wall(p, a, b, H, t, look["wall"], ops, top_fn, top=look["top"])
        else:
            kit.wall(p, a, b, H, t, look["wall"], openings=ops, top=look["top"])
        for o in ops:
            if top_fn and top_fn(*(Vector(a) + (Vector(b) - Vector(a)).normalized() * o[0])) < o[3] + 0.2:
                continue
            opening_frame(p, a, b, o, t, look["trim"], shutters=look["shutter"] if o[2] > 0.5 else None,
                          sill_cell=look["top"])

    # interior divider (ground floor) with a doorway
    dv = spec.get("divider")
    if dv:
        x = dv["x"]
        if ruined and dv.get("ruin_top"):
            ruin_wall(p, (x, iy0), (x, iy1), STORY - SLAB - GF + 0.15, 0.2, look["inner"], [(dv["door_y"] - iy0, DOOR_W, 0, DOOR_H)], dv["ruin_top"], z0=GF)
        else:
            kit.wall(p, (x, iy0), (x, iy1), STORY - SLAB, 0.2, look["inner"], openings=[(dv["door_y"] - iy0, DOOR_W, 0, DOOR_H)], z0=GF)
    udv = spec.get("upper_divider")
    if udv and not ruined:
        (ax, ay), (bx, by) = udv
        kit.wall(p, (ax, ay), (bx, by), H - SLAB - UF, 0.2, look["inner"], z0=UF)

    # stairs
    st = spec["stairs"]
    steps = 15
    if st["axis"] == "x":
        stairs_x(p, st["band"][0], st["band"][1], st["start"], st["dir"], GF, STORY, steps, st["run"], "wood")
    else:
        stairs(p, st["band"][0], st["band"][1], st["start"], st["dir"], GF, STORY, steps, st["run"], "wood")

    # upper floor with the stairwell hole
    rect = spec.get("upper_rect", (ix0, iy0, ix1, iy1))
    slab_with_hole(p, rect, spec["hole"], UF, look["ceiling"])
    for a, b in spec.get("rails", []):
        rail(p, a, b, UF)
    if not ruined:
        # ceiling under the roof void, then the roof
        p.boxmm((ix0, iy0, H - SLAB), (ix1, iy1, H), look["ceiling"], col="floor", bottom=True)
        pitch = look["pitch"]
        gable_roof(p, W, D, H, pitch, 0.45, 0.28, look["roof"], ridge_cell=look["ridge"], along="X",
                   gable_cell=look["wall"], wall_t=t)
        ch = spec.get("chimney")
        if ch:
            ridge = H + math.tan(math.radians(pitch)) * D / 2
            p.box((0.9, 0.7, ridge + 1.0 - (H - 0.3)), (ch[0], ch[1], (ridge + 1.0 + H - 0.3) / 2), look["chimney"], bottom=True, top="char")
        quoins(p, W, D, H, look["quoin"])
    else:
        # charred rafters over the standing part
        for x in spec.get("rafters", []):
            p.tube((x, -D / 2 + 0.2, H - 0.4 + rng.range(-0.3, 0.2)), (x + rng.range(-0.5, 0.5), D / 2 - 0.2 - rng.range(0, 2.5), H - 0.6 + rng.range(-1.2, 0.3)), 0.11, "char", segs=5)
        for r in spec.get("rubble", []):
            rubble(p, r[0], r[1], r[2], rng)
    for v, tb in spec.get("loot", []):
        p.loot_at(v, tb)
    p.meta["probes"] = spec.get("probes", [])
    return p


def rubble(p, cx, cy, size, rng):
    pts = []
    for k in range(10):
        a = 2 * math.pi * k / 10
        r = size * rng.range(0.75, 1.1)
        pts.append((cx + math.cos(a) * r, cy + math.sin(a) * r * 0.8, 0.0))
    for k in range(5):
        a = 2 * math.pi * k / 5 + 0.3
        r = size * rng.range(0.2, 0.45)
        pts.append((cx + math.cos(a) * r, cy + math.sin(a) * r, size * rng.range(0.45, 0.65)))
    p.hull(pts, "rubble", col="berm", cells_fn=lambda c, n: "rubble" if n.z > 0.5 else "stone_dark")
    for k in range(6):
        a = rng.range(0, 2 * math.pi)
        r = size * rng.range(0.3, 0.9)
        s = rng.range(0.25, 0.5)
        p.box((s * 1.4, s, s * 0.7), (cx + math.cos(a) * r, cy + math.sin(a) * r, size * 0.25 + rng.range(0, 0.2)), "stone",
              rot=(rng.range(-25, 25), rng.range(-25, 25), rng.range(0, 90)), bevel=0.04, bottom=True)


FARM_LOOK = {"wall": "stone", "top": "stone_dark", "trim": "wood_dark", "shutter": "shutter_green", "roof": "slate",
             "ridge": "slate_dark", "quoin": "stone_dark", "plinth": "stone_dark", "inner": "plaster", "ceiling": "wood_dark",
             "chimney": "brick", "pitch": 48}
TOWN_LOOK = {"wall": "plaster", "top": "plaster_dark", "trim": "wood_dark", "shutter": "shutter_blue", "roof": "tile",
             "ridge": "tile_dark", "quoin": "stone", "plinth": "stone_dark", "inner": "plaster_dark", "ceiling": "wood_dark",
             "chimney": "stone_dark", "pitch": 42}


def farmhouse_spec():
    W, D = 10.0, 7.6
    return W, D, {
        "openings": {
            "front": [("door", -1.5), ("win", -3.5), ("win", 3.0, 1.2), ("uwin", -3.0), ("uwin", 0.0), ("uwin", 3.0)],
            "east": [("win", 0.2, 1.2), ("uwin", 0.2)],
            "back": [("door", 3.0), ("uwin", -1.5), ("uwin", 3.0)],
            "west": [("win", -1.0), ("uwin", -0.5)],
        },
        # 15 steps of 0.2 m along the back wall, climbing toward +X; foot at x = -3.6
        "stairs": {"axis": "x", "band": (2.3, 3.4), "start": -3.6, "dir": 1, "run": 0.27},
        "hole": (-3.6, 2.3, 0.45, 3.4),
        "rails": [((-3.6, 2.24), (0.45, 2.24)), ((-3.66, 2.3), (-3.66, 3.4))],
        "divider": {"x": 1.3, "door_y": -1.2},
        "upper_divider": ((1.3, -3.4), (1.3, 0.6)),
        "chimney": (3.4, 0.9),
        "loot": [((-2.6, -1.6, GF), 0), ((3.0, -1.6, GF), 0), ((-2.6, -1.4, UF), 1), ((3.2, 1.6, UF), 1), ((1.2, 2.85, UF), 0)],
        "probes": [((-1.5, -5.6, GF), (-1.5, -2.0, GF), "front door"), ((3.0, 5.6, GF), (3.0, 2.0, GF), "back door"),
                   ((0.0, -1.2, GF), (2.6, -1.2, GF), "divider door"), ((-4.1, -2.5, GF), (-4.1, 2.85, GF), "stair foot"),
                   ((0.8, 2.85, UF), (3.6, 2.85, UF), "stair top"), ((-2.5, 1.5, UF), (3.6, 1.5, UF), "upper floor")],
    }


# ---------------------------------------------------------------- furniture (cover and loot spots)
def table(p, x0, y0, x1, y1, z, h=0.78, cell="wood", top="wood_light"):
    p.boxmm((x0, y0, z + h - 0.08), (x1, y1, z + h), cell, top=top, bevel=0.02)
    for x in (x0 + 0.08, x1 - 0.08):
        for y in (y0 + 0.08, y1 - 0.08):
            p.box((0.08, 0.08, h - 0.08), (x, y, z + (h - 0.08) / 2), "wood_dark", bottom=True)
    p.col_boxmm("cover", (x0, y0, z), (x1, y1, z + h))


def bench(p, x0, y0, x1, y1, z, h=0.45):
    p.boxmm((x0, y0, z + h - 0.07), (x1, y1, z + h), "wood", bottom=True)
    for x in (x0 + 0.1, x1 - 0.1):
        p.boxmm((x - 0.04, y0 + 0.03, z), (x + 0.04, y1 - 0.03, z + h - 0.07), "wood_dark", bottom=True)
    p.col_boxmm("cover", (x0, y0, z), (x1, y1, z + h))


def chair(p, x, y, z, facing_y=1):
    p.boxmm((x - 0.22, y - 0.22, z + 0.38), (x + 0.22, y + 0.22, z + 0.45), "wood", bottom=True)
    p.boxmm((x - 0.22, y - 0.22 * facing_y - 0.03, z), (x + 0.22, y - 0.22 * facing_y + 0.03, z + 0.95), "wood_dark", bottom=True)
    for dx in (-0.17, 0.17):
        p.box((0.06, 0.06, 0.38), (x + dx, y + 0.17 * facing_y, z + 0.19), "wood_dark", bottom=True)
    p.col_boxmm("cover", (x - 0.22, y - 0.25, z), (x + 0.22, y + 0.25, z + 0.95))


def bed(p, x0, y0, x1, y1, z, head="y0"):
    """Bed with a headboard at the x0 or y0 end, a blanket and a pillow."""
    p.boxmm((x0, y0, z), (x1, y1, z + 0.3), "wood_dark", bottom=True)
    p.boxmm((x0 + 0.04, y0 + 0.04, z + 0.3), (x1 - 0.04, y1 - 0.04, z + 0.44), "white", bevel=0.04, bottom=True)
    if head == "y0":
        p.boxmm((x0, y0, z), (x1, y0 + 0.08, z + 0.95), "wood_dark", top="wood", bottom=True)
        p.boxmm((x0 + 0.02, y0 + 0.75, z + 0.42), (x1 - 0.02, y1 - 0.02, z + 0.5), "shutter_blue", bottom=True)
        p.box((x1 - x0 - 0.4, 0.32, 0.14), ((x0 + x1) / 2, y0 + 0.32, z + 0.5), "white", bevel=0.05)
    else:
        p.boxmm((x0, y0, z), (x0 + 0.08, y1, z + 0.95), "wood_dark", top="wood", bottom=True)
        p.boxmm((x0 + 0.75, y0 + 0.02, z + 0.42), (x1 - 0.02, y1 - 0.02, z + 0.5), "shutter_blue", bottom=True)
        p.box((0.32, y1 - y0 - 0.4, 0.14), (x0 + 0.32, (y0 + y1) / 2, z + 0.5), "white", bevel=0.05)
    p.col_boxmm("cover", (x0, y0, z), (x1, y1, z + 0.55))


def shelf(p, x0, y0, x1, y1, z, h=1.9, open_dir="-x"):
    """Open shelf unit against a wall: back panel, two sides, four boards with a few jars and boxes."""
    t = 0.05
    along_x = open_dir in ("-y", "+y")
    if open_dir == "-x":
        p.boxmm((x1 - t, y0, z), (x1, y1, z + h), "wood_dark", bottom=True)
    elif open_dir == "+x":
        p.boxmm((x0, y0, z), (x0 + t, y1, z + h), "wood_dark", bottom=True)
    elif open_dir == "-y":
        p.boxmm((x0, y1 - t, z), (x1, y1, z + h), "wood_dark", bottom=True)
    else:
        p.boxmm((x0, y0, z), (x1, y0 + t, z + h), "wood_dark", bottom=True)
    if along_x:
        p.boxmm((x0, y0, z), (x0 + t, y1, z + h), "wood_dark", bottom=True)
        p.boxmm((x1 - t, y0, z), (x1, y1, z + h), "wood_dark", bottom=True)
    else:
        p.boxmm((x0, y0, z), (x1, y0 + t, z + h), "wood_dark", bottom=True)
        p.boxmm((x0, y1 - t, z), (x1, y1, z + h), "wood_dark", bottom=True)
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    for k in range(4):
        zz = z + 0.08 + k * 0.58
        p.boxmm((x0 + t, y0 + t, zz - 0.04) if not along_x else (x0 + t, y0, zz - 0.04),
                (x1 - t, y1 - t, zz) if not along_x else (x1 - t, y1, zz), "wood", bottom=True)
        if 0 < k < 3:
            for j, cell in enumerate(("tile", "olive", "khaki")):
                f = 0.25 + 0.25 * j
                at = (cx, y0 + (y1 - y0) * f, zz + 0.12) if not along_x else (x0 + (x1 - x0) * f, cy, zz + 0.12)
                if (j + k) % 2:
                    p.cyl(0.08, 0.24, at, cell, segs=6)
                else:
                    p.box((0.2, 0.2, 0.2), (at[0], at[1], zz + 0.1), cell, bevel=0.02, bottom=True)
    p.col_boxmm("cover", (x0, y0, z), (x1, y1, z + h))


def farmhouse(lod=0):
    W, D, spec = farmhouse_spec()
    if lod > 0:
        return house_lod("farmhouse", W, D, FARM_LOOK, spec, lod)
    p = house("farmhouse", W, D, FARM_LOOK, spec)
    # ground floor, west room: kitchen table with benches, a chest under the window
    table(p, -3.5, -0.65, -2.0, 0.25, GF)
    bench(p, -3.4, -1.05, -2.1, -0.75, GF)
    bench(p, -3.4, 0.55, -2.1, 0.85, GF)
    p.boxmm((-4.45, -3.4, GF), (-3.55, -2.95, GF + 0.6), "wood", top="wood_dark", col="cover")
    # ground floor, east room: shelf, small table and chairs
    shelf(p, 4.15, 1.0, 4.6, 3.0, GF, open_dir="-x")
    table(p, 2.8, -2.8, 3.8, -2.0, GF)
    chair(p, 2.5, -2.4, GF, facing_y=1)
    # upper floor: two beds, a wardrobe, a desk
    bed(p, -4.5, -3.3, -2.6, -2.3, UF, head="x")
    p.boxmm((-4.6, 0.6, UF), (-4.05, 1.8, UF + 2.0), "wood_dark", top="wood", col="cover")
    bed(p, 3.0, -3.3, 4.5, -1.4, UF)
    table(p, 3.95, 2.25, 4.55, 3.3, UF, h=0.75)
    p.loot.clear()
    for v, tb in [((-2.75, -0.2, GF + 0.78), 0), ((-4.0, -3.15, GF + 0.6), 0), ((4.38, 2.0, GF + 1.24), 0), ((3.3, -2.4, GF + 0.78), 0),
                  ((-3.5, -2.8, UF + 0.48), 1), ((3.75, -2.3, UF + 0.48), 1), ((4.25, 2.8, UF + 0.75), 1), ((1.2, 2.85, UF), 0)]:
        p.loot_at(v, tb)
    p.meta["probes"] = [pr if pr[2] != "stair top" else ((0.8, 2.85, UF), (3.3, 2.85, UF), "stair top") for pr in p.meta["probes"]]
    return p


def townhouse(lod=0):
    W, D = 8.0, 7.0
    spec = {
        "openings": {
            "front": [("door", 0.6), ("win", -2.0), ("win", 2.6), ("uwin", -2.0), ("uwin", 0.6), ("uwin", 2.6)],
            "east": [("win", 0.0), ("uwin", 0.0)],
            "back": [("door", 2.4), ("uwin", 0.0), ("uwin", 2.4)],
            "west": [("uwin", -1.0)],
        },
        # along the west wall, climbing toward +Y
        "stairs": {"axis": "y", "band": (-3.6, -2.5), "start": -2.1, "dir": 1, "run": 0.27},
        "hole": (-3.6, -2.1, -2.5, 1.95),
        "rails": [((-2.44, -2.1), (-2.44, 1.95)), ((-3.6, -2.16), (-2.5, -2.16))],
        "upper_divider": ((0.8, 0.5), (3.6, 0.5)),
        "chimney": (-2.6, 0.6),
        "loot": [],
        "probes": [((0.6, -5.2, GF), (0.6, -1.5, GF), "front door"), ((2.4, 5.2, GF), (2.4, 1.5, GF), "back door"),
                   ((-3.05, -2.7, GF), (-3.05, -2.2, GF), "stair foot"), ((-3.0, 2.6, UF), (2.5, 2.6, UF), "upper floor")],
    }
    if lod > 0:
        return house_lod("townhouse", W, D, TOWN_LOOK, spec, lod)
    p = house("townhouse", W, D, TOWN_LOOK, spec)
    # cafe: counter, two round tables with chairs, a shelf on the back wall
    p.boxmm((2.6, -2.0, GF), (3.2, 0.8, GF + 1.05), "wood", col="cover", top="wood_light", bottom=True)
    for tx, ty in ((-0.9, -1.0), (0.4, 1.9)):
        p.cyl(0.45, 0.06, (tx, ty, GF + 0.75), "wood_light", segs=10)
        p.cyl(0.06, 0.72, (tx, ty, GF + 0.36), "wood_dark", segs=5)
        p.col_cyl("cover", (tx, ty, GF + 0.39), 0.45, 0.78)
        chair(p, tx - 0.75, ty, GF, facing_y=1)
    shelf(p, -1.5, 2.72, 0.5, 3.1, GF, open_dir="-y")
    # upper floor: bed, wardrobe, table
    bed(p, 1.2, -3.0, 3.5, -1.6, UF, head="x")
    p.boxmm((-1.3, -3.1, UF), (-0.1, -2.6, UF + 2.0), "wood_dark", top="wood", col="cover")
    table(p, 1.4, 1.0, 2.6, 1.7, UF)
    for v, tb in [((2.9, -0.6, GF + 1.05), 0), ((-0.9, -1.0, GF + 0.78), 0), ((-0.5, 2.9, GF + 1.24), 0),
                  ((2.3, -2.3, UF + 0.48), 1), ((2.0, 1.35, UF + 0.78), 1), ((-1.0, 2.2, UF), 0)]:
        p.loot_at(v, tb)
    return p


def house_ruined(lod=0):
    W, D, spec = farmhouse_spec()

    def base(x, y):
        # west part stands up to the eave, east part is knocked down to 1 to 2.5 m
        if x < 0.5:
            return 5.6 - max(0.0, y - 2.0) * 0.4
        return 2.6 - (x - 0.5) * 0.3

    spec = dict(spec)
    spec["ruin_top"] = jag(17, base, 0.7)
    spec["divider"] = {"x": 1.3, "door_y": -1.2, "ruin_top": jag(5, lambda x, y: 2.4 if y < 1.0 else 1.4, 0.4)}
    spec["upper_rect"] = (-4.6, -3.4, 1.2, 3.4)
    spec["hole"] = (-3.6, 2.3, 0.45, 3.4)
    spec["rails"] = [((-3.6, 2.24), (0.45, 2.24)), ((-3.66, 2.3), (-3.66, 3.4))]
    spec["rafters"] = [-3.8, -2.2, -0.6]
    spec["rubble"] = [(3.0, 0.6, 1.4), (5.6, -2.0, 1.1), (2.6, -4.6, 0.9)]
    spec["loot"] = [((-2.6, -1.6, GF), 0), ((-2.6, -1.4, UF), 1), ((0.6, 2.85, UF), 0), ((3.2, -2.2, GF), 0)]
    spec["probes"] = [((-1.5, -5.6, GF), (-1.5, -2.0, GF), "front door"), ((-4.1, -2.5, GF), (-4.1, 2.85, GF), "stair foot"),
                      ((0.8, 2.85, UF), (1.0, -2.5, UF), "stair top")]
    if lod > 0:
        return ruin_lod(W, D, base, spec, lod)
    p = house("house_ruined", W, D, FARM_LOOK, spec, ruined=True)
    p.meta["note"] = "farmhouse footprint; west half keeps its upper floor (reached by the stairs), east half is rubble"
    return p


# ---------------------------------------------------------------- building LODs (closed shells, no interior)
def opening_patches(p, W, D, spec, look, t=0.4):
    """Dark window and door decals on the outside faces of a closed shell, with flat shutters beside windows."""
    for key, items in spec["openings"].items():
        for kind, v, *rest in items:
            w = rest[0] if rest else (DOOR_W if kind == "door" else 1.0)
            bot, tp = {"door": (GF, GF + DOOR_H), "win": (1.05, 2.25), "uwin": (UF + 0.85, UF + 2.1)}[kind]
            if key == "front":
                c, n = (v, -D / 2, 0), (0, -1, 0)
            elif key == "back":
                c, n = (v, D / 2, 0), (0, 1, 0)
            elif key == "east":
                c, n = (W / 2, v, 0), (1, 0, 0)
            else:
                c, n = (-W / 2, v, 0), (-1, 0, 0)
            zc = (bot + tp) / 2
            p.patch((c[0], c[1], zc), n, w, tp - bot, "wood_dark" if kind == "door" else "window")
            if kind != "door" and look.get("shutter"):
                nv = Vector(n)
                r = Vector((0, 0, 1)).cross(nv)
                for sgn in (-1, 1):
                    sc = Vector((c[0], c[1], zc)) + r * sgn * (w / 2 + 0.12 + w / 4)
                    p.patch(sc, n, w / 2, tp - bot - 0.04, look["shutter"])


def roof_hull(p, W, D, H, pitch, overhang, cell, along="X"):
    span = (D if along == "X" else W) / 2
    ridge = H + math.tan(math.radians(pitch)) * span
    ox, oy = W / 2 + overhang, D / 2 + overhang
    if along == "X":
        pts = [(sx * ox, sy * oy, H - 0.1) for sx in (-1, 1) for sy in (-1, 1)] + [(sx * ox, 0, ridge + 0.2) for sx in (-1, 1)]
    else:
        pts = [(sx * ox, sy * oy, H - 0.1) for sx in (-1, 1) for sy in (-1, 1)] + [(0, sy * oy, ridge + 0.2) for sy in (-1, 1)]
    p.hull(pts, cell)
    return ridge


def house_lod(name, W, D, look, spec, lod):
    p = Prop(name, "building")
    H = 6.0
    p.boxmm((-W / 2 - 0.12, -D / 2 - 0.12, -0.6), (W / 2 + 0.12, D / 2 + 0.12, GF), look["plinth"])
    p.boxmm((-W / 2, -D / 2, GF), (W / 2, D / 2, H), look["wall"], bottom=True)
    if lod == 1:
        gable_roof(p, W, D, H, look["pitch"], 0.45, 0.28, look["roof"], ridge_cell=look["ridge"], along="X",
                   gable_cell=look["wall"], wall_t=0.4)
        ch = spec.get("chimney")
        if ch:
            ridge = H + math.tan(math.radians(look["pitch"])) * D / 2
            p.box((0.9, 0.7, ridge + 1.0 - (H - 0.3)), (ch[0], ch[1], (ridge + 1.0 + H - 0.3) / 2), look["chimney"], bottom=True)
        opening_patches(p, W, D, spec, look)
    else:
        roof_hull(p, W, D, H, look["pitch"], 0.45, look["roof"])
        # gable ends: the hull covers the walls, so fill the triangles in the wall color
        span = D / 2
        ridge = H + math.tan(math.radians(look["pitch"])) * span
        for sx in (-1, 1):
            p.prism([(-span, H), (span, H), (0, ridge)], 0.05, (sx * (W / 2 + 0.47), 0, 0), look["wall"], axis="X")
        opening_patches(p, W, D, spec, {k: v for k, v in look.items() if k != "shutter"})
    return p


def ruin_lod(W, D, base, spec, lod):
    p = Prop("house_ruined", "building")
    t = 0.4
    p.boxmm((-W / 2 - 0.12, -D / 2 - 0.12, -0.6), (W / 2 + 0.12, D / 2 + 0.12, GF), "stone_dark")
    walls = [((-W / 2, -D / 2 + t / 2), (W / 2, -D / 2 + t / 2)), ((W / 2 - t / 2, -D / 2 + t), (W / 2 - t / 2, D / 2 - t)),
             ((W / 2, D / 2 - t / 2), (-W / 2, D / 2 - t / 2)), ((-W / 2 + t / 2, D / 2 - t), (-W / 2 + t / 2, -D / 2 + t))]
    if lod == 1:
        for a, b in walls:
            ruin_wall(p, a, b, 6.0, t, "stone", [], spec["ruin_top"], top="rubble", strip=1.6)
        p.boxmm((-4.6, -3.4, UF - SLAB), (1.2, 3.4, UF), "wood_dark", bottom=True)
        p.hull([(1.5, -2.5, 0), (5.2, -2.5, 0), (1.5, 3.0, 0), (5.2, 3.0, 0), (3.0, 0.5, 1.4)], "rubble")
    else:
        for (x0, x1, h) in ((-W / 2, 0.5, 5.2), (0.5, W / 2, 2.0)):
            p.boxmm((x0, -D / 2, 0), (x1, -D / 2 + t, h), "stone", top="rubble")
            p.boxmm((x0, D / 2 - t, 0), (x1, D / 2, h), "stone", top="rubble")
        p.boxmm((-W / 2, -D / 2 + t, 0), (-W / 2 + t, D / 2 - t, 5.2), "stone", top="rubble")
        p.boxmm((W / 2 - t, -D / 2 + t, 0), (W / 2, D / 2 - t, 2.0), "stone", top="rubble")
    return p


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


# ---------------------------------------------------------------- barn with a hay loft
def barn_lod(lod):
    p = Prop("barn", "building")
    W, D, H = 9.0, 13.0, 5.0
    p.boxmm((-W / 2 - 0.1, -D / 2 - 0.1, -0.6), (W / 2 + 0.1, D / 2 + 0.1, 0.6), "stone_dark", top="stone")
    p.boxmm((-W / 2, -D / 2, 0.6), (W / 2, D / 2, H), "wood_dark", bottom=True)
    if lod == 1:
        gable_roof(p, W, D, H, 40, 0.5, 0.25, "tile", ridge_cell="tile_dark", along="Y", gable_cell="wood_dark", wall_t=0.25)
        p.patch((0, -D / 2 - 0.1, 1.85), (0, -1, 0), 3.4, 3.5, "window")
        p.patch((2.5, D / 2 + 0.1, 1.15), (0, 1, 0), 1.1, 2.1, "window")
        p.patch((-0.5, D / 2 + 0.1, 3.9), (0, 1, 0), 1.4, 1.4, "window")
        for sx in (-1, 1):
            p.boxmm((sx * 1.78 - 0.06, -D / 2 - 1.75, 0.15), (sx * 1.78 + 0.06, -D / 2 - 0.05, 3.5), "wood")
    else:
        roof_hull(p, W, D, H, 40, 0.5, "tile", along="Y")
        span = W / 2
        ridge = H + math.tan(math.radians(40)) * span
        for sy in (-1, 1):
            p.prism([(-span, H), (span, H), (0, ridge)], 0.05, (0, sy * (D / 2 + 0.52), 0), "wood_dark", axis="Y")
    return p


def barn(lod=0):
    if lod > 0:
        return barn_lod(lod)
    p = Prop("barn", "building")
    W, D, H, t = 9.0, 13.0, 5.0, 0.25
    LOFT = 2.9
    p.boxmm((-W / 2 - 0.1, -D / 2 - 0.1, -0.6), (W / 2 + 0.1, D / 2 + 0.1, 0.1), "stone_dark", col="floor", top="earth")
    big = (W / 2, 3.4, 0.1, 3.6)
    walls = [
        ((-W / 2, -D / 2 + t / 2), (W / 2, -D / 2 + t / 2), [big]),
        ((W / 2 - t / 2, -D / 2 + t), (W / 2 - t / 2, D / 2 - t), [(3.25 - 0.0, 1.0, 1.3, 2.1), (9.75, 1.0, 1.3, 2.1), (9.75 + 0.0, 1.0, 3.5, 4.4)]),
        ((W / 2, D / 2 - t / 2), (-W / 2, D / 2 - t / 2), [(W / 2 - 2.5, DOOR_W, 0.1, 2.2), (W / 2 + 0.5, 1.4, 3.2, 4.6)]),
        ((-W / 2 + t / 2, D / 2 - t), (-W / 2 + t / 2, -D / 2 + t), [(2.25, 1.0, 3.5, 4.4)]),
    ]
    for a, b, ops in walls:
        kit.wall(p, a, b, H, t, "wood_dark", openings=ops, top="timber")
        clipped = [(o[0], o[1], o[2], 0.7) for o in ops if o[2] < 0.6]
        kit.wall(p, a, b, 0.6, t + 0.12, "stone_dark", openings=clipped, col=None, top="stone")
        for o in ops:
            opening_frame(p, a, b, o, t, "timber", size=0.14, depth=0.05)
        # vertical battens on the outside
        a2, b2 = Vector(a), Vector(b)
        d = b2 - a2
        L = d.length
        out = Vector((d.y, -d.x)).normalized()
        n = int(L / 0.85)
        for i in range(1, n):
            s = L * i / n
            if any(abs(s - o[0]) < o[1] / 2 + 0.2 for o in ops):
                continue
            pnt = a2 + d.normalized() * s + out * (t / 2 + 0.03)
            p.box((0.09, 0.09, H - 0.6), (pnt.x, pnt.y, 0.6 + (H - 0.6) / 2), "wood", rot_z=math.degrees(math.atan2(d.y, d.x)), bottom=True)
    # open door leaves
    for sx in (-1, 1):
        p.boxmm((sx * 1.7 - 0.06 + sx * 0.08, -D / 2 - 1.75, 0.15), (sx * 1.7 + 0.06 + sx * 0.08, -D / 2 - 0.05, 3.5), "wood", col="wall", top="wood_dark")
        x = sx * 1.7 + sx * 0.08 - sx * 0.09
        p.tube((x, -D / 2 - 0.2, 0.4), (x, -D / 2 - 1.6, 3.2), 0.05, "timber", segs=4)
    # loft and stairs along the west wall
    stairs(p, -W / 2 + t, -W / 2 + t + 1.1, -3.8, 1, 0.1, LOFT - 0.1, 13, 0.33, "wood")
    p.boxmm((-W / 2 + t, 0.5, LOFT - 0.22), (W / 2 - t, D / 2 - t, LOFT), "wood", col="floor", bottom=True, top="wood_light")
    rail(p, (-W / 2 + t + 1.1, 0.44), (W / 2 - t, 0.44), LOFT)
    for x in (-3.0, 0.0, 3.0):
        p.box((0.22, 0.22, LOFT - 0.32), (x, 0.6, (LOFT - 0.22 + 0.1) / 2), "timber", bottom=True)
    # hay bales (cover)
    rng = Rng(9)
    bales = [(2.8, -4.6, 0.1), (2.8, -4.6, 0.62), (3.2, -2.9, 0.1), (-1.5, -5.0, 0.1), (2.6, 4.6, LOFT), (2.6, 4.6, LOFT + 0.52),
             (0.6, 5.2, LOFT), (-2.4, 3.2, LOFT), (1.0, 2.0, 0.1)]
    for x, y, z in bales:
        yaw = rng.range(-12, 12)
        p.box((1.2, 0.62, 0.52), (x, y, z + 0.26), "hay", rot_z=yaw, bevel=0.06, col="cover", top="hay_dark", bottom=True)
    gable_roof(p, W, D, H, 40, 0.5, 0.25, "tile", ridge_cell="tile_dark", along="Y", gable_cell="wood_dark", wall_t=t)
    # workbench with tools along the east wall, a hay cart, barrels, a shelf in the loft
    table(p, 3.55, -1.6, 4.25, 0.4, 0.1, h=0.9, cell="wood_dark", top="wood")
    p.box((0.3, 0.5, 0.25), (3.9, -1.0, 1.13), "steel_dark", bevel=0.03, bottom=True)
    p.box((0.25, 0.35, 0.2), (3.9, 0.0, 1.1), "olive", bevel=0.03, bottom=True)
    with p.frame((-1.7, -1.6, 0.1), rot_z=12):
        p.boxmm((-0.65, -1.1, 0.55), (0.65, 1.1, 0.75), "wood", top="wood_light", bottom=True)
        for sx in (-1, 1):
            p.boxmm((sx * 0.65 - 0.05, -1.1, 0.75), (sx * 0.65 + 0.05, 1.1, 1.05), "wood_dark", bottom=True)
            p.cyl(0.45, 0.1, (sx * 0.78, 0.2, 0.45), "wood_dark", segs=8, rot=(0, 90, 0), cap_cell="wood")
        p.tube((-0.4, -1.1, 0.65), (-0.4, -2.5, 0.35), 0.05, "wood_dark", segs=4)
        p.tube((0.4, -1.1, 0.65), (0.4, -2.5, 0.35), 0.05, "wood_dark", segs=4)
        p.box((1.1, 1.6, 0.4), (0.0, 0.1, 0.95), "hay", bevel=0.08)
        p.col_boxmm("cover", (-0.9, -1.1, 0.0), (0.9, 1.1, 1.15))
    for x, y in ((3.9, 5.5), (3.9, 4.8)):
        p.cyl(0.29, 0.88, (x, y, 0.1 + 0.44), "rust", segs=10, cap_cell="rust_dark", col="block")
    shelf(p, -4.2, 5.75, -2.2, 6.25, LOFT, h=1.6, open_dir="-y")
    for v in ((-2.0, -2.0, 0.1), (2.5, 2.8, 0.1), (1.5, 3.6, LOFT), (-2.6, 5.0, LOFT), (3.9, -0.6, 1.0), (-1.7, -1.3, 1.15), (-3.2, 6.0, LOFT + 0.67)):
        p.loot_at(v)
    p.meta["probes"] = [((0.0, -9.0, 0.1), (0.0, -1.5, 0.1), "big door"), ((2.5, 8.6, 0.1), (2.5, 4.8, 0.1), "back door"),
                        ((-3.7, -5.6, 0.1), (-3.7, -4.0, 0.1), "stair foot"), ((-3.4, 1.4, LOFT), (1.5, 1.4, LOFT), "loft")]
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


BUILDERS = [farmhouse, townhouse, house_ruined, church, barn, lighthouse, bridge_stone]
