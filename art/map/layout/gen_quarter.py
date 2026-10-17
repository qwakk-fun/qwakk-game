"""Generate the Kavren deathmatch arena (map id canard-quarter) as map_v1 placement data.

A compact walled-in village quarter built from the same prop kit as Yelova: a church square on a
crossroads, five enterable houses (two townhouses, a farmhouse, a ruin, a barn), a churchyard, an orchard,
a farmyard, bombed lots and a trench field, closed by a ring of hedgerows the duck cannot cross.

Pure Python 3, standard library only, fully deterministic (fixed seed, the same mulberry32 RNG as gen_map.py).
Reads the prop manifest written by art/map/blender/build_props.py and writes:
  art/map/export/canard-quarter/map_v1.json          props, roads, zones (callouts), play area, dmSpawns
  art/map/export/canard-quarter/map_v1_heights.bin   73 x 73 int16 little endian, centimeters, row-major (row along z)
  art/map/export/canard-quarter/map_v1_ground.bin    73 x 73 uint8 ground paint ids (legend in the JSON)

Coordinates as in gen_map.py: x east, y up, z south (north is -z), meters, centered at the origin.
rotY is the three.js yaw of a prop (rotY 0: the prop front, +Z in its GLB, faces south).
dmSpawns yaw is the player yaw (the input yaw): 0 looks north (-z), the duck looks along (-sin yaw, -cos yaw).
"""

import json
import math
import os
import struct
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import terrain as T  # noqa: E402  (noise and polygon helpers only; the grid here is its own)
from gen_map import GROUND, HEADER, Grid, Rng, poly_area, rot2, trench_tiles, zigzag  # noqa: E402  (pure helpers, no side effects)

MAP_ID = "canard-quarter"
MAP_ART = os.path.dirname(HERE)
GAME = os.path.dirname(os.path.dirname(MAP_ART))
MANIFEST = os.path.join(GAME, "apps", "client", "public", "models", "props", "manifest.json")
OUT = os.path.join(MAP_ART, "export", MAP_ID)
SEED = 7121
PI = math.pi
FACE_S, FACE_E, FACE_N, FACE_W = 0.0, PI / 2, PI, -PI / 2

# Terrain grid: 72 x 72 cells of 4 m, 288 m across. The play area (inside the hedge ring) is about 160 m;
# the band outside is scenery (fields, tree lines, rising ground) that hides the end of the terrain.
CELLS = 72
CELL = 4.0
SIZE = CELLS * CELL
HALF = SIZE / 2
G = {name: i for i, name in enumerate(GROUND)}
FLUSH = ("stone_wall", "wood_fence", "fuel_barrel")      # placed edge to edge on purpose

# ---------------------------------------------------------------- layout data
# Center line of the outer hedgerow ring (closed polygon, clockwise from the north-west).
RING = [(-80, -77), (-34, -81), (25, -80), (78, -76), (81, -25), (79, 33), (76, 78), (17, 81), (-42, 79),
        (-78, 76), (-81, 17), (-79, -33)]
RING_INNER = 1.4          # the hedge berm reaches 1.3 m from its center line

ROADS = [
    {"id": "rue_du_canard", "width": 7, "pts": [(-81, 0), (-40, 0), (0, 0), (40, 0), (81, 0)]},
    {"id": "rue_de_l_eglise", "width": 6, "pts": [(0, 0), (0, 40), (0, 81)]},
    {"id": "church_lane", "width": 4, "pts": [(-18, -20), (-13, -32), (-13, -58), (-18, -80)]},
    {"id": "barn_track", "width": 4, "pts": [(18, -20), (32, -26), (46, -32)]},
    {"id": "orchard_track", "width": 3, "pts": [(-40, 0), (-41, -24), (-40, -50), (-42, -80)]},
]
PLAZA = (-18, -24, 18, -4)        # the church square, cobbled (x0, z0, x1, z1)

# Buildings: (prop, x, z, facing). Doors face the square, the streets or a yard.
BUILDINGS = [
    ("church", 0, -38, FACE_S),            # front and tower on the square, belfry over both streets
    ("townhouse", -27, -14, FACE_E),       # bakery on the west side of the square
    ("house_ruined", 28, -14, FACE_W),     # shelled house on the east side of the square
    ("townhouse", -16, 12, FACE_N),        # shop front on the Rue du Canard, south-west corner
    ("farmhouse", 16, 34, FACE_W),         # farm on the Rue de l'Old Chapel, south-east
    ("barn", 50, -44, FACE_S),             # barn over the farmyard, north-east
]

CALLOUTS = [
    {"id": "square", "name": "Kavren Square", "poly": [(-18, -24), (18, -24), (18, -4), (-18, -4)]},
    {"id": "church", "name": "Old Chapel", "poly": [(-10, -54), (10, -54), (10, -24), (-10, -24)]},
    {"id": "churchyard", "name": "Chapel Yard", "poly": [(-12, -80), (18, -80), (18, -54), (-12, -54)]},
    {"id": "orchard", "name": "Harman Gardens", "poly": [(-80, -80), (-46, -80), (-46, -26), (-80, -26)]},
    {"id": "bakery", "name": "Bakery", "poly": [(-46, -26), (-20, -26), (-20, -4), (-46, -4)]},
    {"id": "farmyard", "name": "Harman Yard", "poly": [(30, -80), (80, -80), (80, -4), (30, -4)]},
    {"id": "ruin", "name": "Ruins", "poly": [(20, -26), (30, -26), (30, -4), (20, -4)]},
    {"id": "bombed", "name": "Crater Field", "poly": [(-80, 4), (-4, 4), (-4, 80), (-80, 80)]},
    {"id": "trenches", "name": "Trenches", "poly": [(34, 20), (80, 20), (80, 80), (34, 80)]},
    {"id": "farm", "name": "Harman", "poly": [(4, 4), (34, 4), (34, 80), (4, 80)]},
]


# ---------------------------------------------------------------- geometry helpers
def seg_dist(px, pz, a, b):
    d, _ = T.seg_dist(px, pz, a[0], a[1], b[0], b[1])
    return d


def ring_signed(x, z):
    """Signed distance to the ring center line: negative inside the play area, positive outside."""
    d = min(seg_dist(x, z, a, b) for a, b in zip(RING, RING[1:] + RING[:1]))
    return -d if T.point_in_poly(x, z, RING) else d


def road_dist(x, z):
    best = 1e9
    for rd in ROADS:
        for a, b in zip(rd["pts"], rd["pts"][1:]):
            best = min(best, seg_dist(x, z, a, b) - rd["width"] / 2)
    return best


def height_at(heights, x, z):
    """Same bilinear-triangle lookup as terrainHeightAt in packages/shared/src/map.ts, on this grid."""
    n = CELLS
    fx = max(0.0, min(n - 1e-6, (x + HALF) / CELL))
    fz = max(0.0, min(n - 1e-6, (z + HALF) / CELL))
    c, r = int(math.floor(fx)), int(math.floor(fz))
    u, v = fx - c, fz - r
    w = n + 1
    h00 = heights[r * w + c]
    h01 = heights[r * w + c + 1]
    h10 = heights[(r + 1) * w + c]
    h11 = heights[(r + 1) * w + c + 1]
    if u + v <= 1:
        return h00 + (h01 - h00) * u + (h10 - h00) * v
    return h11 + (h10 - h11) * (1 - u) + (h01 - h11) * (1 - v)


def raw_height(x, z):
    """Mostly flat village ground (about 7 m) with gentle swells; the land outside the ring rises into low
    hills so the hedges and tree lines close the view before the end of the terrain."""
    h = 7.0 + 1.4 * (T.fbm(x * 0.013 + 3.7, z * 0.013 - 1.9, SEED, 3) - 0.5)
    h += 1.3 * math.exp(-((x - 50.0) ** 2 + (z + 44.0) ** 2) / (38.0 ** 2))      # the barn knoll
    h -= 0.7 * math.exp(-((x + 44.0) ** 2 + (z - 40.0) ** 2) / (34.0 ** 2))      # the bombed hollow
    out = ring_signed(x, z)
    if out > 3.0:
        k = T.smoothstep(3.0, 46.0, out)
        h += k * (5.0 + 5.0 * T.fbm(x * 0.02 - 8.0, z * 0.02 + 5.0, SEED + 3, 3))
    return h


# ---------------------------------------------------------------- the generator
class Quarter:
    def __init__(self, manifest):
        self.man = manifest["props"]
        self.rng = Rng(SEED)
        self.props = []
        self.pads = []
        self.dips = []
        self.solid = Grid(12.0)
        self.soft = Grid(12.0)
        self.heights = None
        self.dip_centers = []

    def footprint(self, prop, x, z, yaw, scale=1.0, margin=0.0):
        b = self.man[prop]["bounds"]
        (x0, _, z0), (x1, _, z1) = b["min"], b["max"]
        cx, cz = (x0 + x1) / 2 * scale, (z0 + z1) / 2 * scale
        dx, dz = rot2(cx, cz, yaw)
        return (x + dx, z + dz, (x1 - x0) / 2 * scale + margin, (z1 - z0) / 2 * scale + margin, yaw)

    def pad(self, x, z, hx, hz, yaw=0.0, falloff=8.0, y=None):
        self.pads.append({"x": x, "z": z, "hx": hx, "hz": hz, "yaw": yaw, "falloff": falloff, "y": y})

    def pad_for(self, prop, x, z, yaw, margin=3.0, falloff=10.0):
        fp = self.footprint(prop, x, z, yaw, margin=margin)
        self.pad(fp[0], fp[1], fp[2], fp[3], yaw, falloff)

    def build_terrain(self):
        w = CELLS + 1
        pre = [0.0] * (w * w)
        for r in range(w):
            for c in range(w):
                pre[r * w + c] = raw_height(-HALF + c * CELL, -HALF + r * CELL)
        for p in self.pads:
            if p["y"] is None:
                p["y"] = height_at(pre, p["x"], p["z"])
        out = list(pre)
        for r in range(w):
            z = -HALF + r * CELL
            for c in range(w):
                x = -HALF + c * CELL
                h = out[r * w + c]
                for p in self.pads:
                    reach = p["hx"] + p["hz"] + p["falloff"]
                    if abs(x - p["x"]) > reach or abs(z - p["z"]) > reach:
                        continue
                    lx, lz = rot2(x - p["x"], z - p["z"], -p["yaw"])
                    d = math.hypot(max(abs(lx) - p["hx"], 0.0), max(abs(lz) - p["hz"], 0.0))
                    if d >= p["falloff"]:
                        continue
                    k = 1 - d / p["falloff"]
                    h += (p["y"] - h) * k * k * (3 - 2 * k)
                for dx, dz, rad, depth in self.dips:
                    d = math.hypot(x - dx, z - dz)
                    if d < rad:
                        k = 1 - d / rad
                        h -= depth * k * k * (3 - 2 * k)
                out[r * w + c] = h
        self.heights = [round(h * 100) / 100 for h in out]      # centimeters: what the engine loads

    def y_at(self, x, z):
        return height_at(self.heights, x, z)

    def y_footprint(self, prop, x, z, yaw, scale=1.0):
        """Lowest terrain under the footprint corners and center, so props never float."""
        fp = self.footprint(prop, x, z, yaw, scale)
        ys = [self.y_at(fp[0], fp[1])]
        for sx in (-1, 1):
            for sz in (-1, 1):
                dx, dz = rot2(sx * fp[2], sz * fp[3], yaw)
                ys.append(self.y_at(fp[0] + dx, fp[1] + dz))
        return min(ys)

    def place(self, prop, x, z, yaw=0.0, scale=1.0, y=None, layer="solid", check=("solid",), margin=0.4,
              avoid_roads=None, ring_clear=None, sink=0.0, register=True):
        """Place one prop. `ring_clear`: keep the origin at least this far inside the ring center line.
        `register=False` leaves the footprint out of the overlap grids (the caller adds it later)."""
        if prop not in self.man:
            raise KeyError(prop)
        fp = self.footprint(prop, x, z, yaw, scale, margin)
        if avoid_roads is not None and road_dist(x, z) < avoid_roads + max(fp[2], fp[3]) * 0.5:
            return False
        if ring_clear is not None and ring_signed(x, z) > -ring_clear:
            return False
        if "solid" in check and self.solid.hits(fp):
            return False
        if "soft" in check and self.soft.hits(fp):
            return False
        if y is None:
            y = self.y_footprint(prop, x, z, yaw, scale) - sink
        rec = {"prop": prop, "x": round(x, 2), "y": round(y, 2), "z": round(z, 2), "rotY": round(math.atan2(math.sin(yaw), math.cos(yaw)), 4)}
        if scale != 1.0:
            rec["scale"] = round(scale, 3)
        self.props.append(rec)
        if register:
            (self.solid if layer == "solid" else self.soft).add(self.footprint(prop, x, z, yaw, scale, 0.0))
        return True

    def hedge_line(self, pts, closed=False, gates=(), step=7.0, check=("solid",), overrun=0.0):
        """Hedgerow pieces along a polyline, `step` apart (the 8 m collider overlaps the next piece by 1 m),
        plus a piece across every inner vertex. `overrun`: run every edge this far past both of its vertices,
        so at a corner each edge's hedge covers the other's full depth (the ring uses 1.5 m: the escape test
        in apps/server/test/canardQuarter.test.ts found a gap at a square corner without it).
        `gates`: (x, z, half width) openings."""
        segs = list(zip(pts, pts[1:] + pts[:1])) if closed else list(zip(pts, pts[1:]))
        placed = 0
        later = []          # the pieces of one line overlap each other: check against what was there before only
        for a, b in segs:
            L0 = math.hypot(b[0] - a[0], b[1] - a[1])
            ux, uz = (b[0] - a[0]) / L0, (b[1] - a[1]) / L0
            a = (a[0] - ux * overrun, a[1] - uz * overrun)
            b = (b[0] + ux * overrun, b[1] + uz * overrun)
            L = L0 + 2 * overrun
            yaw = math.atan2(b[0] - a[0], b[1] - a[1]) + PI / 2          # hedge local X runs along the edge
            n = max(1, int(math.ceil(L / step)))
            for k in range(n):
                t = (k + 0.5) / n
                x, z = a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t
                if any(math.hypot(x - gx, z - gz) < gw for gx, gz, gw in gates):
                    continue
                if self.place("hedgerow", x, z, yaw, check=check, margin=-0.6, register=False):
                    later.append(self.footprint("hedgerow", x, z, yaw))
                    placed += 1
        corners = range(len(pts)) if closed else range(1, len(pts) - 1)
        for i in corners:
            p0, p1, p2 = pts[i - 1], pts[i], pts[(i + 1) % len(pts)]
            y0 = math.atan2(p1[0] - p0[0], p1[1] - p0[1])
            y1 = math.atan2(p2[0] - p1[0], p2[1] - p1[1])
            mid = math.atan2(math.sin(y0) + math.sin(y1), math.cos(y0) + math.cos(y1)) + PI / 2
            if self.place("hedgerow", p1[0], p1[1], mid, check=(), margin=-0.6, register=False):
                later.append(self.footprint("hedgerow", p1[0], p1[1], mid))
                placed += 1
        for fp in later:
            self.solid.add(fp)
        return placed


# ---------------------------------------------------------------- build
def generate():
    with open(MANIFEST) as f:
        manifest = json.load(f)
    g = Quarter(manifest)
    rng = g.rng

    # ======== phase A: what flattens or dents the terrain
    # The square first, the buildings after: a later pad wins inside its rectangle, so every house floor
    # stays at its pad height (the square's falloff applied last lifted the ground into the ruin's doorway).
    g.pad((PLAZA[0] + PLAZA[2]) / 2, (PLAZA[1] + PLAZA[3]) / 2, (PLAZA[2] - PLAZA[0]) / 2, (PLAZA[3] - PLAZA[1]) / 2, falloff=14.0)
    for prop, x, z, yaw in BUILDINGS:
        g.pad_for(prop, x, z, yaw, margin=3.0 if prop != "church" else 4.0, falloff=12.0)
    trench = zigzag((0, 0), 13, run=4, jog=2, axis="z", sign=1, jog_sign=1)
    tiles = []
    for prop, i, j, yaw in trench_tiles(trench):
        x, z = 54.0 + i * 4.0, 34.0 + j * 4.0
        tiles.append((prop, x, z, yaw))
        g.pad(x, z, 2.0, 2.0, falloff=5.0)
    craters = [(-40, 24), (-58, 34), (-28, 50), (-66, 66), (-46, 66), (-20, 36), (-72, 12), (64, 28), (70, 58), (42, 72)]
    for cx, cz in craters:
        g.dips.append((cx, cz, 3.4, 0.55))
    g.dip_centers = craters
    g.build_terrain()

    # ======== phase B: placement, most important first
    pad_y = {(round(p["x"], 2), round(p["z"], 2)): p["y"] for p in g.pads}
    for prop, x, z, yaw in BUILDINGS:
        fp = g.footprint(prop, x, z, yaw, margin=3.0 if prop != "church" else 4.0)
        y = pad_y[(round(fp[0], 2), round(fp[1], 2))]
        assert g.place(prop, x, z, yaw, y=y, check=(), margin=0.0), prop
        # the ground under the house and one meter around it stays under the 0.15 m floor top and above the
        # 0.6 m wall skirt (no terrain through a floor, no gap under a wall)
        cx, cz, hx, hz, _ = g.footprint(prop, x, z, yaw, margin=1.0)
        for i in range(-10, 11):
            for j in range(-10, 11):
                lx, lz = rot2(hx * i / 10, hz * j / 10, yaw)
                assert -0.5 < g.y_at(cx + lx, cz + lz) - y < 0.1, (prop, x, z, i, j, g.y_at(cx + lx, cz + lz), y)
        g.solid.add(g.footprint(prop, x, z, yaw, margin=2.5))       # a yard: nothing blocks a door
    for prop, x, z, yaw in tiles:
        g.place(prop, x, z, yaw, check=(), margin=0.0)
    for cx, cz in craters:
        g.place("crater", cx, cz, rng.range(0, 2 * PI), check=("solid",), layer="soft", margin=0.0, y=g.y_at(cx, cz) - 0.05)

    ring = g.hedge_line(RING, closed=True, check=(), overrun=1.5)
    inner_hedges(g)
    square(g, rng)
    streets(g, rng)
    churchyard(g, rng)
    orchard(g, rng)
    farmyard(g, rng)
    bombed(g, rng)
    trench_field(g, rng)
    scenery(g, rng)

    g.spawns = dm_spawns(g, rng)
    ground = paint_ground(g)
    return g, ground, ring


def square(g, rng):
    """Kavren Square: a tank wreck and sandbag barricades split the square, crates along the house fronts."""
    g.place("tank_wreck", 7, -13, 0.55, check=("solid",), margin=0.3)
    g.place("signpost", 5.5, 5.5, 2.2, check=("solid",))
    for x, z, yaw in ((-8, -17, 0.0), (-6, -8, PI / 2), (12, -6, 0.0), (14, -18.5, PI / 2)):
        g.place("sandbag_wall", x, z, yaw, check=("solid",), margin=0.2)
    g.place("sandbag_corner", -14, -21, FACE_E, check=("solid",))
    for prop, x, z, yaw in (("crate_large", -15, -9, 0.2), ("crate_small", -15.5, -7.5, 0.7), ("fuel_barrel", 16, -22, 0.0),
                            ("fuel_barrel", 16.6, -21, 0.0), ("crate_small", 15, -5.5, 1.1), ("ammo_box", 0, -21.5, 0.3),
                            ("crate_large", -2, -10, 1.3), ("crate_small", -1, -11.6, 0.4), ("rubble_pile", 18.5, -27, 0.8)):
        g.place(prop, x, z, yaw, check=("solid",), margin=0.0 if prop in FLUSH else 0.2)


def streets(g, rng):
    """The two long lanes: wrecks and barricades along the edges, so every run along them has stops."""
    g.place("truck_wreck", -46, 1.8, FACE_E + 0.1, check=("solid",), margin=0.3)
    g.place("truck_wreck", 56, -1.6, FACE_W + 0.15, check=("solid",), margin=0.3)
    g.place("tank_wreck", -1.6, 50, 0.18, check=("solid",), margin=0.3)
    for x, z, yaw in ((-66, -2.8, 0.0), (-28, 2.6, 0.0), (36, -2.5, 0.0), (68, 2.4, 0.0), (1.8, 24, PI / 2), (-2.2, 64, PI / 2)):
        g.place("sandbag_wall", x, z, yaw, check=("solid",), margin=0.2)
    for x, z, yaw in ((-3, 70, FACE_E), (44, 4.5, FACE_N)):
        g.place("sandbag_corner", x, z, yaw, check=("solid",))
    # stone walls along the north side of the west street (garden fronts), with gaps to slip through
    for x in (-74, -70, -62, -58, -50):
        g.place("stone_wall", x, -5.6, 0.0, check=("solid",), margin=0.0)
    # poplars along the Rue de l'Old Chapel
    for z in range(10, 78, 11):
        for side in (-1, 1):
            if rng() < 0.8:
                g.place("tree_poplar", side * 5.6, z + rng.range(-1.5, 1.5), 0.0, check=("solid",), layer="soft", margin=0.4)


def churchyard(g, rng):
    """Behind the church: a walled yard with gaps, poplars and bushes, a rubble heap from a fallen wall."""
    for x in (-8, -4, 8, 12):
        g.place("stone_wall", x, -57, 0.0, check=("solid",), margin=0.0)
    for z in (-61, -65, -71):
        g.place("stone_wall", 15, z, PI / 2, check=("solid",), margin=0.0)
        g.place("stone_wall", -9, z, PI / 2, check=("solid",), margin=0.0)
    for x, z in ((-4, -74), (10, -73), (-5, -64), (11, -64)):
        g.place("tree_poplar", x, z, 0.0, check=("solid",), layer="soft", margin=0.5)
    for x, z, p in ((2, -63, "bush_round"), (-1, -70, "bush_wide"), (6, -72, "bush_round"), (22, -66, "bush_wide"), (24, -74, "bush_round")):
        g.place(p, x, z, rng.range(0, 2 * PI), check=("solid", "soft"), layer="soft", margin=0.2)
    g.place("rubble_pile", 2, -58.5, 0.3, check=("solid",), margin=0.2)
    g.place("rock_slab", 3, -67, 0.4, check=("solid",), margin=0.2, sink=0.15)
    for prop, x, z, yaw in (("crate_small", 20, -58, 0.4), ("crate_large", 23, -60, 1.4), ("ammo_box", -18, -64, 0.1)):
        g.place(prop, x, z, yaw, check=("solid",), margin=0.0 if prop in FLUSH else 0.2)


def orchard(g, rng):
    """Harman Gardens: apple trees in rows, a walled kitchen garden behind the bakery, a wrecked truck in the lane."""
    for i in range(4):
        for j in range(6):
            x, z = -73 + i * 7 + rng.range(-1, 1), -71 + j * 8 + rng.range(-1, 1)
            g.place("tree_apple", x, z, rng.range(0, 2 * PI), check=("solid",), layer="soft", margin=0.4, avoid_roads=0.5,
                    ring_clear=3.0)
    # the kitchen garden: low walls on two sides, open toward the bakery and the street
    for x, z, yaw in ((-41, -24, 0.0), (-37, -24, 0.0), (-43, -21, PI / 2), (-43, -17, PI / 2), (-43, -13, PI / 2)):
        g.place("stone_wall", x, z, yaw, check=("solid",), margin=0.0)
    for x, z, p in ((-38, -19, "tree_apple"), (-37, -12, "bush_wide"), (-40, -9, "bush_round")):
        g.place(p, x, z, rng.range(0, 2 * PI), check=("solid",), layer="soft", margin=0.2)
    g.place("truck_wreck", -34, -42, 2.6, check=("solid",), margin=0.3)
    for prop, x, z, yaw in (("crate_small", -28, -48, 0.3), ("fuel_barrel", -26, -47, 0.0), ("wood_fence", -30, -32, 0.0),
                            ("wood_fence", -26.8, -32, 0.0), ("rubble_pile", -24, -62, 1.1), ("sandbag_corner", -32, -68, FACE_N),
                            ("crate_large", -22, -72, 0.5)):
        g.place(prop, x, z, yaw, check=("solid",), margin=0.0 if prop in FLUSH else 0.2)


def farmyard(g, rng):
    """Harman Yard: the barn over a fenced yard, a wrecked truck in it, barrels and crates by the barn doors."""
    for x in (37.5, 40.7, 43.9, 51.4, 54.6, 63.6, 66.8):
        g.place("wood_fence", x, -10, 0.0, check=("solid",), margin=0.0)
    for z in (-14, -17.2, -26.8, -30):
        g.place("wood_fence", 70, z, PI / 2, check=("solid",), margin=0.0)
    g.place("truck_wreck", 60, -22, 0.5, check=("solid",), margin=0.3)
    for prop, x, z, yaw in (("fuel_barrel", 41, -32, 0.0), ("fuel_barrel", 41.7, -31.2, 0.0), ("crate_large", 60, -31, 0.4),
                            ("crate_small", 58.6, -29.4, 1.2), ("crate_small", 46, -18, 0.6), ("sandbag_corner", 38, -24, FACE_E),
                            ("rubble_pile", 68, -42, 0.6), ("stone_wall", 64, -46, PI / 2), ("stone_wall", 64, -50, PI / 2),
                            ("crate_large", 36, -46, 2.0), ("ammo_box", 36.5, -44.8, 0.5)):
        g.place(prop, x, z, yaw, check=("solid",), margin=0.0 if prop in FLUSH else 0.2)
    for x, z in ((70, -52), (36, -54), (75, -24)):
        g.place("tree_oak", x, z, rng.range(0, 2 * PI), check=("solid",), layer="soft", margin=-2.0, ring_clear=3.5)
    for x, z, p in ((68, -34, "bush_wide"), (33, -38, "bush_round"), (74, -6, "bush_round")):
        g.place(p, x, z, rng.range(0, 2 * PI), check=("solid", "soft"), layer="soft", margin=0.2)


def bombed(g, rng):
    """Crater Field: the shelled lots south-west of the crossroads, craters, rubble, a tank and sandbag nests."""
    g.place("tank_wreck", -48, 46, 2.3, check=("solid",), margin=0.3)
    for x, z, yaw in ((-36, 18, 0.3), (-62, 22, 1.7), (-22, 58, 2.6), (-56, 52, 0.9), (-70, 40, 0.2), (-40, 72, 1.4), (-12, 46, 0.7)):
        g.place("rubble_pile", x, z, yaw, check=("solid",), margin=0.3)
    for x, z, yaw in ((-30, 28, FACE_S), (-66, 32, FACE_E), (-36, 66, FACE_N), (-68, 70, FACE_W)):
        g.place("sandbag_corner", x, z, yaw, check=("solid",))
    # broken garden walls of the houses that stood here
    for x, z, yaw in ((-56, 14, 0.0), (-52, 14, 0.0), (-73, 26, PI / 2), (-30, 40, 0.0), (-26, 40, 0.0),
                      (-58, 72, 0.0), (-14, 70, PI / 2), (-34, 8, PI / 2)):
        g.place("stone_wall", x, z, yaw, check=("solid",), margin=0.0)
    for x, z in ((-72, 52), (-18, 74), (-64, 8)):
        g.place("tree_oak", x, z, rng.range(0, 2 * PI), check=("solid",), layer="soft", margin=-2.0, ring_clear=3.5)
    for x, z in ((-46, 30), (-62, 46), (-12, 28), (-30, 74), (-50, 76), (-74, 34)):
        g.place(rng.pick(["bush_round", "bush_wide"]), x, z, rng.range(0, 2 * PI), check=("solid", "soft"), layer="soft", margin=0.2)
    for x, z in ((-46, 36), (-22, 22), (-60, 64)):
        g.place(rng.pick(["crate_small", "crate_large", "ammo_box", "fuel_barrel"]), x, z, rng.range(0, 2 * PI), check=("solid",), margin=0.2)
    for x, z, yaw in ((-26, 66, 0.3), (-72, 66, 1.2)):
        g.place("barbed_wire", x, z, yaw, check=("solid",), margin=0.1)


def trench_field(g, rng):
    """Trenches: a zigzag trench across the south-east field, a sandbag nest at each end, wire in front."""
    for x, z, yaw in ((46, 32, FACE_W), (66, 74, FACE_E)):
        g.place("sandbag_corner", x, z, yaw, check=("solid",))
    for x, z, yaw in ((70, 38, 0.2), (72, 48, 1.5), (40, 54, 0.4), (40, 64, 1.4)):
        g.place("barbed_wire", x, z, yaw, check=("solid",), margin=0.1)
    for x, z in ((72, 66), (32, 74), (72, 26)):
        g.place("tree_oak", x, z, rng.range(0, 2 * PI), check=("solid",), layer="soft", margin=-2.0, ring_clear=3.5)
    for x, z in ((46, 48), (66, 52), (24, 64), (28, 50)):
        g.place(rng.pick(["bush_round", "bush_wide"]), x, z, rng.range(0, 2 * PI), check=("solid", "soft"), layer="soft", margin=0.2)
    for prop, x, z, yaw in (("crate_large", 64, 13, 0.3), ("crate_small", 65.5, 14.5, 1.0), ("fuel_barrel", 27, 15, 0.0),
                            ("ammo_box", 48, 28, 0.4), ("rock_boulder", 44, 70, 0.8), ("rubble_pile", 56, 20, 1.9),
                            ("stone_wall", 28, 22, 0.0), ("stone_wall", 24, 22, 0.0), ("wood_fence", 8, 48, PI / 2),
                            ("wood_fence", 8, 51.2, PI / 2), ("wood_fence", 8, 20, PI / 2)):
        g.place(prop, x, z, yaw, check=("solid",), margin=0.0 if prop in FLUSH else 0.2)


def inner_hedges(g):
    """Yelova Fields hedges inside the ring: they cut the long diagonals and make the flanks, each with gates."""
    g.hedge_line([(-47, -80), (-47, -30)], gates=[(-47, -54, 4.5)])                         # orchard edge
    g.hedge_line([(30, -80), (30, -60), (79, -60)], gates=[(56, -60, 4.5), (30, -71, 4.0)])  # behind the barn
    g.hedge_line([(-79, 60), (-28, 60)], gates=[(-48, 60, 4.5)])                             # across the bombed lots
    g.hedge_line([(34, 20), (34, 42)], gates=[])                                            # trench field west edge
    g.hedge_line([(79, 20), (38, 20)], gates=[(58, 20, 4.5)])                               # trench field north edge


def scenery(g, rng):
    """Outside the ring, never reachable: a second hedge line, fields, tree lines on the rising ground."""
    outer = [(x * 1.32, z * 1.32) for x, z in RING]
    g.hedge_line(outer, closed=True, gates=[(0, -128, 10), (-128, 0, 10), (126, 0, 10), (0, 128, 10)], step=8.0, check=())
    count = 0
    for _ in range(900):
        if count >= 120:
            break
        x, z = rng.range(-HALF + 8, HALF - 8), rng.range(-HALF + 8, HALF - 8)
        d = ring_signed(x, z)
        if d < 10 or abs(d - 32) < 6:
            continue
        p = "tree_poplar" if rng() < 0.35 else "tree_oak"
        if g.place(p, x, z, rng.range(0, 2 * PI), scale=rng.range(0.9, 1.25), check=("solid", "soft"), layer="soft", margin=2.0):
            count += 1
    return count


def dm_spawns(g, rng, want=48, min_dist=15.0):
    """Deathmatch spawns on open ground inside the ring: clear of every prop footprint, the house yards and
    the trench, spread out, each looking down its longest open line (preferring the middle of the map)."""
    out = []
    xs = [p[0] for p in RING]
    zs = [p[1] for p in RING]
    for _ in range(20000):
        if len(out) >= want:
            break
        x, z = rng.range(min(xs), max(xs)), rng.range(min(zs), max(zs))
        if ring_signed(x, z) > -6.0:
            continue
        if g.solid.hits((x, z, 1.2, 1.2, 0.0)) or g.soft.hits((x, z, 0.9, 0.9, 0.0)):
            continue
        if any((x - a) ** 2 + (z - c) ** 2 < min_dist ** 2 for a, _, c, _ in out):
            continue
        best, yaw = -1.0, 0.0
        for k in range(16):
            a = k * PI / 8
            dx, dz = -math.sin(a), -math.cos(a)          # player yaw a looks along (-sin a, -cos a)
            free = 0.0
            for step in range(1, 41):
                px, pz = x + dx * step, z + dz * step
                if ring_signed(px, pz) > -2.0 or g.solid.hits((px, pz, 0.35, 0.35, 0.0)):
                    break
                free = step
            toward = -(dx * x + dz * z) / (math.hypot(x, z) or 1.0)      # 1 when looking at the center
            score = free + 6.0 * toward
            if score > best:
                best, yaw = score, a
        out.append((round(x, 2), round(g.y_at(x, z) + 0.1, 2), round(z, 2), round(math.atan2(math.sin(yaw), math.cos(yaw)), 4)))
    return out


# ---------------------------------------------------------------- ground paint
def paint_ground(g):
    w = CELLS + 1
    out = bytearray(w * w)
    orchard = next(c for c in CALLOUTS if c["id"] == "orchard")["poly"]
    yard = [(34, -34), (70, -34), (70, -8), (34, -8)]
    for r in range(w):
        z = -HALF + r * CELL
        for c in range(w):
            x = -HALF + c * CELL
            d = ring_signed(x, z)
            rd = road_dist(x, z)
            if PLAZA[0] <= x <= PLAZA[2] and PLAZA[1] <= z <= PLAZA[3]:
                v = G["cobble"]
            elif rd < 0.8 and d < -1:
                core = abs(x) < 40 and -30 < z < 24
                v = G["cobble"] if core else G["dirt_road"]
            elif d > 5:
                # outside: crop fields in big patches
                k = int(T.fbm(x * 0.012 + 40, z * 0.012 - 9, SEED + 7, 2) * 6) % 4
                v = (G["wheat"], G["green_crop"], G["plowed"], G["grass_dark"])[k]
            elif T.point_in_poly(x, z, orchard):
                v = G["orchard_grass"]
            elif T.point_in_poly(x, z, yard):
                v = G["dirt_road"] if T.fbm(x * 0.08, z * 0.08, 5, 2) < 0.5 else G["grass_dark"]
            elif any(math.hypot(x - cx, z - cz) < 3.4 for cx, cz in g.dip_centers):
                v = G["plowed"]
            else:
                v = G["grass"] if T.fbm(x * 0.03, z * 0.03, 99, 2) < 0.55 else G["grass_dark"]
            out[r * w + c] = v
    return out


# ---------------------------------------------------------------- output
def write(g, ground, ring_count):
    os.makedirs(OUT, exist_ok=True)
    w = CELLS + 1
    with open(os.path.join(OUT, "map_v1_heights.bin"), "wb") as f:
        f.write(struct.pack(HEADER, b"QWHF", 1, w, int(-HALF), int(-HALF), int(CELL * 100), 100))
        f.write(struct.pack("<%dh" % (w * w), *[int(round(h * 100)) for h in g.heights]))
    with open(os.path.join(OUT, "map_v1_ground.bin"), "wb") as f:
        f.write(struct.pack(HEADER, b"QWGP", 1, w, int(-HALF), int(-HALF), int(CELL * 100), len(GROUND)))
        f.write(bytes(ground))
    order = {id(p): i for i, p in enumerate(g.props)}
    for p in g.props:
        p["chunk"] = 0
    props = sorted(g.props, key=lambda p: (p["prop"], order[id(p)]))
    index = {}
    for i, p in enumerate(props):
        e = index.setdefault(p["prop"], {"start": i, "count": 0, "chunks": {"0": [i, 0]}})
        e["count"] += 1
        e["chunks"]["0"][1] += 1
    counts = {k: v["count"] for k, v in sorted(index.items())}
    inner = [list(p) for p in RING]
    doc = {
        "version": 2,
        "name": "Kavren",
        "mode": "deathmatch",
        "seed": SEED,
        "size": SIZE,
        "seaLevel": 0,
        "coords": "x east, y up, z south (north is -z), meters, map centered at the origin. rotY: three.js yaw, "
                  "rotY 0 means the prop front (+Z in its GLB) faces +z (south). y is the prop origin height, already on the terrain.",
        "propsSource": "apps/client/public/models/props/<prop>.glb (LOD0..LOD2 child nodes), colliders in colliders.json, LOD distances in manifest.json",
        "terrain": {
            "cells": CELLS, "cellSize": CELL, "origin": [-HALF, -HALF],
            "heights": "map_v1_heights.bin",
            "heightsEncoding": f"16-byte header <4sHHhhHH: 'QWHF', version 1, samples per side {CELLS + 1}, origin x {-HALF:.0f}, origin z {-HALF:.0f}, cell size 400 cm, 100 units per meter; "
                               f"then {CELLS + 1} x {CELLS + 1} int16 little endian centimeters, row-major, row along z (north to south), col along x (west to east)",
            "ground": "map_v1_ground.bin",
            "groundEncoding": f"16-byte header <4sHHhhHH: 'QWGP', version 1, samples per side {CELLS + 1}, origin x, origin z, cell size cm, legend length; then {CELLS + 1} x {CELLS + 1} uint8, same order as the heights",
            "headerBytes": 16,
            "groundLegend": GROUND,
            "min": round(min(g.heights), 2), "max": round(max(g.heights), 2),
        },
        "chunks": {"grid": 1, "size": SIZE, "origin": [-HALF, -HALF], "id": "one chunk (the map is small): chunk = 0"},
        "water": {"sea": 0.0, "river": [], "riverHalfWidth": 0, "note": "no water: the terrain stays above 4 m everywhere"},
        "roads": [{"id": r["id"], "width": r["width"], "pts": [list(p) for p in r["pts"]]} for r in ROADS],
        "plaza": list(PLAZA),
        "zones": [{"id": c["id"], "name": c["name"], "tier": 1, "drop": "quiet", "poly": [list(p) for p in c["poly"]]} for c in CALLOUTS],
        "zonesNote": "callout areas for the HUD and the kill feed; the deathmatch has no loot tiers",
        "playArea": {"ring": inner, "inset": RING_INNER,
                     "note": "center line of the outer hedgerow ring (closed polygon). The hedges (8 m pieces 7 m apart, a berm to "
                             "0.85 m under a 2.9 m hedge) cannot be crossed; the play area is the polygon shrunk by `inset` m. "
                             "Everything outside is scenery. The loader's invisible walls (size / 2 - 6) stay as a backstop."},
        "dmSpawns": [list(s) for s in g.spawns],
        "dmSpawnsNote": "[x, y, z, yaw]: feet position on open ground (terrain + 0.1 m), at least 15 m apart, clear of every prop. "
                        "yaw is the player yaw (input yaw): 0 looks north (-z), the duck looks along (-sin yaw, -cos yaw); "
                        "each spawn looks down its longest open line, leaning toward the middle of the map",
        "propIndex": index,
        "props": props,
        "stats": {"props": len(props), "byProp": counts, "dmSpawns": len(g.spawns), "ringHedges": ring_count,
                  "playAreaM2": round(poly_area(RING)), "playAcrossM": [max(p[0] for p in RING) - min(p[0] for p in RING),
                                                                        max(p[1] for p in RING) - min(p[1] for p in RING)]},
    }
    path = os.path.join(OUT, "map_v1.json")
    with open(path, "w") as f:
        json.dump(doc, f, separators=(",", ":"))
    return path, doc


def main():
    g, ground, ring = generate()
    path, doc = write(g, ground, ring)
    st = doc["stats"]
    print("MAP", path, os.path.getsize(path) // 1024, "KB")
    print("PROPS", st["props"], st["byProp"])
    print("SPAWNS", st["dmSpawns"], "RING HEDGES", ring, "AREA", st["playAreaM2"], "m2, across", st["playAcrossM"])
    print("HEIGHT", doc["terrain"]["min"], doc["terrain"]["max"])


if __name__ == "__main__":
    main()
