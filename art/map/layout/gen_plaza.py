"""Generate Duck Plaza (map id duck-plaza), the social hub between matches, as map_v1 placement data.

A cozy toony town square, about 104 x 104 m inside a hedge ring: the Duck Pond in the middle (shallow,
ducks wade in it) with the bronze duck statue on its little island, a cobbled promenade around it with
benches, lamps and flower beds, the Fountain Square in the south where ducks appear (fountain, market
stalls, cafe tables, the leaderboard board), three portal arches on paved aprons (Deathmatch in the north,
Battle Royale in the west, Hunt Season in the east), park corners with trees and townhouses in the corners.
No combat: the layout is for walking, meeting and sitting around, every portal visible from the spawn.

Pure Python 3, standard library only, fully deterministic (fixed seed, mulberry32 from gen_map.py).
Reads the kit manifest (apps/client/public/models/props/manifest.json) and the plaza props manifest
(plaza_manifest.json, art/map/blender/build_plaza_props.py) and writes:
  art/map/export/duck-plaza/map_v1.json          props, roads, zones, the hub section (portals, spawns, exits, board)
  art/map/export/duck-plaza/map_v1_heights.bin   65 x 65 int16 little endian, centimeters (2 m cells)
  art/map/export/duck-plaza/map_v1_ground.bin    65 x 65 uint8 ground paint ids (legend in the JSON)

Coordinates as in gen_map.py: x east, y up, z south (north is -z), meters, centered at the origin.
rotY is the three.js yaw of a prop (rotY 0: the prop front, +Z in its GLB, faces south).
Spawn and exit yaws are player yaws: 0 looks north (-z), the duck looks along (-sin yaw, -cos yaw).
"""

import json
import math
import os
import struct
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import terrain as T  # noqa: E402  (noise and polygon helpers only)
from gen_map import GROUND, HEADER, Grid, Rng, poly_area, rot2  # noqa: E402

MAP_ID = "duck-plaza"
MAP_ART = os.path.dirname(HERE)
GAME = os.path.dirname(os.path.dirname(MAP_ART))
PROPS_DIR = os.path.join(GAME, "apps", "client", "public", "models", "props")
MANIFESTS = [os.path.join(PROPS_DIR, "manifest.json"), os.path.join(PROPS_DIR, "plaza_manifest.json")]
OUT = os.path.join(MAP_ART, "export", MAP_ID)
SEED = 4417
PI = math.pi
FACE_S, FACE_E, FACE_N, FACE_W = 0.0, PI / 2, PI, -PI / 2

# Terrain: 64 x 64 cells of 2 m (128 m). The hedge ring closes the square at about +-52 m; the band outside
# rises into wooded hills so the view ends in trees, never in the end of the terrain.
CELLS = 64
CELL = 2.0
SIZE = CELLS * CELL
HALF = SIZE / 2
G = {name: i for i, name in enumerate(GROUND)}

GROUND_Y = 3.0              # the square's ground
WATER_Y = 2.0               # the pond surface (map water level)
POND = (0.0, -4.0, 12.5, 8.5)          # center x, z and radii of the Duck Pond
ISLAND = (0.0, -4.0, 3.0)              # the statue island: center and flat top radius
RING_HALF = 52.0            # the hedge ring's center line (a rounded square)
RING_CORNER = 14.0

# The portals: mode, position, facing (their fronts face the pond) and the exit spot (player yaw away from it).
PORTALS = [
    ("dm", 0.0, -38.0, FACE_S, (0.0, -30.5, PI)),
    ("br", -37.0, -4.0, FACE_E, (-29.5, -4.0, -PI / 2)),
    ("raid", 37.0, -4.0, FACE_W, (29.5, -4.0, PI / 2)),
]
SQUARE = (-15.0, 14.0, 15.0, 38.0)     # Fountain Square (x0, z0, x1, z1): spawn, fountain, market, cafe, board
FOUNTAIN = (0.0, 29.0)

ROADS = [
    {"id": "north_walk", "width": 5, "pts": [(0, -12.5), (0, -33)]},
    {"id": "west_walk", "width": 5, "pts": [(-12.5, -4), (-32, -4)]},
    {"id": "east_walk", "width": 5, "pts": [(12.5, -4), (32, -4)]},
    {"id": "south_walk", "width": 6, "pts": [(0, 4.5), (0, 15)]},
]

CALLOUTS = [
    {"id": "pond", "name": "Duck Pond", "poly": [(-15, -15), (15, -15), (15, 7), (-15, 7)]},
    {"id": "square", "name": "Fountain Square", "poly": [(-15, 14), (15, 14), (15, 38), (-15, 38)]},
    {"id": "dm_gate", "name": "Deathmatch Gate", "poly": [(-8, -46), (8, -46), (8, -30), (-8, -30)]},
    {"id": "br_gate", "name": "Battle Royale Gate", "poly": [(-46, -12), (-30, -12), (-30, 4), (-46, 4)]},
    {"id": "raid_gate", "name": "Hunt Season Gate", "poly": [(30, -12), (46, -12), (46, 4), (30, 4)]},
]


# ---------------------------------------------------------------- shape helpers
def pond_e(x, z):
    """Elliptic radius of the pond: below 1 inside the water line."""
    cx, cz, rx, rz = POND
    return math.hypot((x - cx) / rx, (z - cz) / rz)


def ring_poly():
    """The hedge ring's center line: a square with rounded corners, clockwise from the north-west."""
    pts = []
    h, c = RING_HALF, RING_CORNER
    for cx, cz, a0 in ((-h + c, -h + c, PI), (h - c, -h + c, 1.5 * PI), (h - c, h - c, 0.0), (-h + c, h - c, 0.5 * PI)):
        for k in range(4):
            a = a0 + (PI / 2) * k / 3
            pts.append((round(cx + c * math.cos(a), 2), round(cz + c * math.sin(a), 2)))
    return pts


RING = ring_poly()


def seg_dist(px, pz, a, b):
    d, _ = T.seg_dist(px, pz, a[0], a[1], b[0], b[1])
    return d


def ring_signed(x, z):
    """Signed distance to the ring center line: negative inside the square, positive outside."""
    d = min(seg_dist(x, z, a, b) for a, b in zip(RING, RING[1:] + RING[:1]))
    return -d if T.point_in_poly(x, z, RING) else d


def road_dist(x, z):
    best = 1e9
    for rd in ROADS:
        for a, b in zip(rd["pts"], rd["pts"][1:]):
            best = min(best, seg_dist(x, z, a, b) - rd["width"] / 2)
    return best


def apron_dist(x, z):
    """Distance outside the paved portal aprons (negative inside)."""
    best = 1e9
    for _, px, pz, yaw, _ in PORTALS:
        lx, lz = rot2(x - px, z - pz, -yaw)
        d = max(abs(lx) - 6.5, abs(lz - 3.0) - 6.0)
        best = min(best, d)
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
    """Flat square at GROUND_Y with a faint swell in the parks, the pond bowl, its island, hills outside."""
    h = GROUND_Y + 0.35 * (T.fbm(x * 0.03 + 1.3, z * 0.03 - 2.1, SEED, 2) - 0.5)
    e = pond_e(x, z)
    if e < 1.6:
        # Shore: from the ground down to just under the water line at e = 1, then a shallow bed (0.6 m at most).
        if e >= 1.0:
            k = T.smoothstep(1.0, 1.6, e)
            h = (WATER_Y - 0.12) + (h - (WATER_Y - 0.12)) * k
        else:
            h = WATER_Y - 0.12 - 0.5 * T.smoothstep(1.0, 0.25, e)
    ix, iz, ir = ISLAND
    d = math.hypot(x - ix, z - iz)
    if d < ir + 2.0:
        top = WATER_Y + 0.45
        k = T.smoothstep(ir + 2.0, ir, d)
        h = h + (top - h) * k
    out = ring_signed(x, z)
    if out > 2.0:
        k = T.smoothstep(2.0, 12.0, out)
        h += k * (3.0 + 4.0 * T.fbm(x * 0.05 - 7.0, z * 0.05 + 3.0, SEED + 5, 3))
    return h


# ---------------------------------------------------------------- the generator
class Plaza:
    def __init__(self, manifest):
        self.man = manifest
        self.rng = Rng(SEED)
        self.props = []
        self.pads = []
        self.solid = Grid(8.0)
        self.soft = Grid(8.0)
        self.heights = None

    def footprint(self, prop, x, z, yaw, scale=1.0, margin=0.0):
        b = self.man[prop]["bounds"]
        (x0, _, z0), (x1, _, z1) = b["min"], b["max"]
        cx, cz = (x0 + x1) / 2 * scale, (z0 + z1) / 2 * scale
        dx, dz = rot2(cx, cz, yaw)
        return (x + dx, z + dz, (x1 - x0) / 2 * scale + margin, (z1 - z0) / 2 * scale + margin, yaw)

    def pad(self, x, z, hx, hz, yaw=0.0, falloff=6.0, y=None):
        self.pads.append({"x": x, "z": z, "hx": hx, "hz": hz, "yaw": yaw, "falloff": falloff, "y": y})

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
                out[r * w + c] = h
        self.heights = [round(h * 100) / 100 for h in out]

    def y_at(self, x, z):
        return height_at(self.heights, x, z)

    def y_footprint(self, prop, x, z, yaw, scale=1.0):
        fp = self.footprint(prop, x, z, yaw, scale)
        ys = [self.y_at(fp[0], fp[1])]
        for sx in (-1, 1):
            for sz in (-1, 1):
                dx, dz = rot2(sx * fp[2], sz * fp[3], yaw)
                ys.append(self.y_at(fp[0] + dx, fp[1] + dz))
        return min(ys)

    def place(self, prop, x, z, yaw=0.0, scale=1.0, y=None, layer="solid", check=("solid",), margin=0.3, sink=0.0, register=True):
        if prop not in self.man:
            raise KeyError(prop)
        fp = self.footprint(prop, x, z, yaw, scale, margin)
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

    def keep_clear(self, x, z, hx, hz, yaw=0.0):
        """Reserve ground nothing may be placed on (walkways, portal fronts, spawns)."""
        self.solid.add((x, z, hx, hz, yaw))


def face_toward(x, z, tx, tz):
    """The prop rotY whose front (+Z) faces the point (tx, tz)."""
    return math.atan2(tx - x, tz - z)


# ---------------------------------------------------------------- build
def generate():
    manifest = {}
    for path in MANIFESTS:
        with open(path) as f:
            manifest.update(json.load(f)["props"])
    g = Plaza(manifest)
    rng = g.rng

    # ======== phase A: flat pads for the square, the aprons and the houses
    g.pad((SQUARE[0] + SQUARE[2]) / 2, (SQUARE[1] + SQUARE[3]) / 2, (SQUARE[2] - SQUARE[0]) / 2, (SQUARE[3] - SQUARE[1]) / 2, falloff=8.0, y=GROUND_Y)
    for _, px, pz, yaw, _ in PORTALS:
        lx, lz = rot2(0.0, 3.0, yaw)
        g.pad(px + lx, pz + lz, 7.0, 7.0, yaw, falloff=6.0, y=GROUND_Y)
    houses = [
        ("townhouse", -38.0, -38.0, face_toward(-38, -38, 0, -4)),
        ("townhouse", 38.0, -38.0, face_toward(38, -38, 0, -4)),
        ("townhouse", -38.0, 34.0, face_toward(-38, 34, 0, 20)),
        ("townhouse", 38.0, 34.0, face_toward(38, 34, 0, 20)),
        ("townhouse", -20.0, 45.5, FACE_N),
        ("townhouse", 20.0, 45.5, FACE_N),
    ]
    for prop, x, z, yaw in houses:
        fp = g.footprint(prop, x, z, yaw, margin=2.5)
        g.pad(fp[0], fp[1], fp[2], fp[3], yaw, falloff=6.0, y=GROUND_Y)
    g.build_terrain()

    # ======== phase B: what must stay walkable
    for _, px, pz, yaw, (ex, ez, _) in PORTALS:
        # the opening and the ground in front of and behind it
        g.keep_clear(px, pz, 2.3, 6.0, yaw)
    for rd in ROADS:
        (ax, az), (bx, bz) = rd["pts"][0], rd["pts"][-1]
        g.keep_clear((ax + bx) / 2, (az + bz) / 2, max(abs(bx - ax) / 2, rd["width"] / 2), max(abs(bz - az) / 2, rd["width"] / 2))
    spawns = spawn_points(g)
    for x, _, z, _ in spawns:
        g.keep_clear(x, z, 1.2, 1.2)

    # ======== phase C: placement, landmarks first
    for pid, px, pz, yaw, _ in PORTALS:
        assert g.place("plaza_portal", px, pz, yaw, y=GROUND_Y, check=(), margin=0.0), pid
    assert g.place("plaza_statue", ISLAND[0], ISLAND[1], FACE_S, y=WATER_Y + 0.45, check=(), margin=0.0)
    assert g.place("plaza_fountain", FOUNTAIN[0], FOUNTAIN[1], 0.0, y=GROUND_Y, check=(), margin=0.0)
    board = (21.0, 21.0, face_toward(21, 21, 3, 15))
    assert g.place("plaza_board", board[0], board[1], board[2], y=GROUND_Y, check=(), margin=0.0)
    for prop, x, z, yaw in houses:
        assert g.place(prop, x, z, yaw, y=GROUND_Y, check=(), margin=0.0), (prop, x, z)
        g.solid.add(g.footprint(prop, x, z, yaw, margin=2.0))      # the door stays free

    ring = hedge_ring(g)
    square(g, rng)
    promenade(g, rng)
    gates(g)
    parks(g, rng)
    scenery(g, rng)

    hub = {
        "portals": [{"id": pid, "x": px, "y": GROUND_Y, "z": pz, "rotY": round(yaw, 4)} for pid, px, pz, yaw, _ in PORTALS],
        "spawns": [list(s) for s in spawns],
        "exits": {pid: exit_points(ex, ez, eyaw) for pid, _, _, _, (ex, ez, eyaw) in PORTALS},
        "board": {"x": board[0], "y": GROUND_Y, "z": board[1], "rotY": round(board[2], 4)},
        "pond": {"x": POND[0], "z": POND[1], "rx": POND[2], "rz": POND[3], "water": WATER_Y},
        "fountain": {"x": FOUNTAIN[0], "y": GROUND_Y, "z": FOUNTAIN[1], "water": GROUND_Y + 0.5},
    }
    ground = paint_ground(g)
    return g, ground, ring, hub


def spawn_points(g):
    """Where fresh ducks appear: an arc on the north side of the Fountain Square, looking at the pond and the Deathmatch gate."""
    out = []
    for i in range(12):
        x = -9.0 + i * (18.0 / 11)
        z = 19.0 + 1.6 * abs(x) / 9.0
        out.append((round(x, 2), round(g.y_at(x, z) + 0.1, 2), round(z, 2), 0.0))
    return out


def exit_points(ex, ez, yaw):
    """Back from a mode: a small fan of spots in front of the portal, looking away from it toward the pond."""
    out = []
    fx, fz = -math.sin(yaw), -math.cos(yaw)       # where the duck looks
    sx, sz = -fz, fx
    for k in (-2, -1, 0, 1, 2):
        x, z = ex + sx * k * 1.6, ez + sz * k * 1.6
        out.append([round(x, 2), round(GROUND_Y + 0.1, 2), round(z, 2), round(yaw, 4)])
    return out


def hedge_ring(g):
    """The hedgerow ring that closes the square (8 m pieces 7 m apart, a piece across every corner point)."""
    placed = 0
    pts = RING
    for a, b in zip(pts, pts[1:] + pts[:1]):
        L = math.hypot(b[0] - a[0], b[1] - a[1])
        ux, uz = (b[0] - a[0]) / L, (b[1] - a[1]) / L
        a2 = (a[0] - ux * 1.0, a[1] - uz * 1.0)
        b2 = (b[0] + ux * 1.0, b[1] + uz * 1.0)
        L2 = L + 2.0
        yaw = math.atan2(b2[0] - a2[0], b2[1] - a2[1]) + PI / 2
        n = max(1, int(math.ceil(L2 / 7.0)))
        for k in range(n):
            t = (k + 0.5) / n
            x, z = a2[0] + (b2[0] - a2[0]) * t, a2[1] + (b2[1] - a2[1]) * t
            if g.place("hedgerow", x, z, yaw, check=(), margin=-0.6, register=False):
                placed += 1
    for (x, z) in pts:
        g.solid.add((x, z, 4.0, 1.3, 0.0))
    return placed


def square(g, rng):
    """Fountain Square: flower beds round the fountain, the market (west), the cafe (east), lamps, benches."""
    fx, fz = FOUNTAIN
    placed = []
    for k in range(4):
        a = PI / 4 + k * PI / 2
        x, z = fx + 6.2 * math.cos(a), fz + 6.2 * math.sin(a)
        placed.append(g.place("plaza_flowerbed", x, z, face_toward(x, z, fx, fz), check=("solid",), margin=0.2))
    for x, z, yaw in ((-12.0, 23.0, FACE_E), (-12.0, 30.0, FACE_E), (-9.0, 36.0, FACE_N)):
        placed.append(g.place("plaza_stall", x, z, yaw, check=("solid",), margin=0.3))
    for x, z in ((10.5, 33.5), (13.5, 29.5), (9.0, 28.0)):
        placed.append(g.place("plaza_cafe", x, z, rng.range(0, 2 * PI), check=("solid",), margin=0.2))
    for x, z in ((-14.0, 15.5), (14.0, 15.5), (-14.0, 37.0), (14.0, 37.0), (-5.0, 15.0), (5.0, 15.0)):
        placed.append(g.place("plaza_lamp", x, z, 0.0, check=("solid",), margin=0.2))
    for x, z in ((-4.5, 37.0), (4.5, 37.0)):
        placed.append(g.place("plaza_bench", x, z, FACE_N, check=("solid",), margin=0.2))
    # crates and barrels by the market, the board's flower boxes
    for prop, x, z, yaw in (("crate_small", -14.4, 26.4, 0.3), ("crate_large", -14.6, 33.4, 1.4), ("fuel_barrel", -6.0, 37.6, 0.0)):
        g.place(prop, x, z, yaw, check=("solid",), margin=0.1)
    assert all(placed), placed


def promenade(g, rng):
    """The walk round the Duck Pond: benches looking at the water, lamps, flower beds, between the four walks."""
    cx, cz, rx, rz = POND
    walk_angles = [-PI / 2, PI, 0.0, PI / 2]        # north, west, east, south walks (angle in the ellipse)
    benches = 0
    for k in range(16):
        a = (k + 0.5) * 2 * PI / 16
        if any(abs(math.atan2(math.sin(a - w), math.cos(a - w))) < 0.33 for w in walk_angles):
            continue
        x, z = cx + (rx + 5.6) * math.cos(a), cz + (rz + 5.6) * math.sin(a)
        if g.place("plaza_bench", x, z, face_toward(x, z, cx, cz), check=("solid",), margin=0.2):
            benches += 1
    for k in range(8):
        a = k * 2 * PI / 8 + PI / 8
        x, z = cx + (rx + 3.4) * math.cos(a), cz + (rz + 3.4) * math.sin(a)
        g.place("plaza_lamp", x, z, 0.0, check=("solid",), margin=0.2)
    for k in range(8):
        a = k * 2 * PI / 8 + PI / 4 + 0.2
        x, z = cx + (rx + 8.6) * math.cos(a), cz + (rz + 8.6) * math.sin(a)
        g.place("plaza_flowerbed", x, z, face_toward(x, z, cx, cz), check=("solid",), margin=0.2)
    assert benches >= 8, benches


def gates(g):
    """Each portal on its apron: flower beds and lamps on both sides, a low stone wall behind."""
    for _, px, pz, yaw, _ in PORTALS:
        for side in (-1, 1):
            lx, lz = rot2(side * 6.0, 2.0, yaw)
            assert g.place("plaza_flowerbed", px + lx, pz + lz, yaw + PI / 2, check=("solid",), margin=0.1)
            lx, lz = rot2(side * 5.2, 6.5, yaw)
            assert g.place("plaza_lamp", px + lx, pz + lz, 0.0, check=("solid",), margin=0.1)
            for k in (1, 2):
                lx, lz = rot2(side * (4.0 + k * 4.0), -1.5, yaw)
                g.place("stone_wall", px + lx, pz + lz, yaw, check=("solid",), margin=0.0)


def parks(g, rng):
    """The four park corners between the walks: oaks, apple trees and bushes, never on the walks."""
    count = 0
    for _ in range(1200):
        if count >= 46:
            break
        x, z = rng.range(-47, 47), rng.range(-47, 47)
        if ring_signed(x, z) > -5.0 or pond_e(x, z) < 1.85:
            continue
        if road_dist(x, z) < 3.0 or apron_dist(x, z) < 2.0:
            continue
        if SQUARE[0] - 3 < x < SQUARE[2] + 3 and SQUARE[1] - 3 < z < SQUARE[3] + 3:
            continue
        r = rng()
        prop = "tree_oak" if r < 0.4 else "tree_apple" if r < 0.75 else ("bush_round" if r < 0.88 else "bush_wide")
        layer = "soft"
        if g.place(prop, x, z, rng.range(0, 2 * PI), scale=rng.range(0.9, 1.15), check=("solid", "soft"), layer=layer, margin=1.2 if prop.startswith("tree") else 0.4):
            count += 1
    return count


def scenery(g, rng):
    """Outside the ring, never reachable: poplars and oaks on the rising ground."""
    count = 0
    for _ in range(1500):
        if count >= 110:
            break
        x, z = rng.range(-HALF + 3, HALF - 3), rng.range(-HALF + 3, HALF - 3)
        if ring_signed(x, z) < 4.0:
            continue
        p = "tree_poplar" if rng() < 0.45 else "tree_oak"
        if g.place(p, x, z, rng.range(0, 2 * PI), scale=rng.range(0.9, 1.3), check=("soft",), layer="soft", margin=0.6):
            count += 1
    return count


# ---------------------------------------------------------------- ground paint
def paint_ground(g):
    w = CELLS + 1
    out = bytearray(w * w)
    cx, cz, rx, rz = POND
    for r in range(w):
        z = -HALF + r * CELL
        for c in range(w):
            x = -HALF + c * CELL
            e = pond_e(x, z)
            d_ring = ring_signed(x, z)
            if math.hypot(x - ISLAND[0], z - ISLAND[1]) < ISLAND[2] + 0.8:
                v = G["grass"]
            elif e < 1.0:
                v = G["seabed"] if e < 0.8 else G["river_mud"]
            elif e < 1.18:
                v = G["sand"]
            elif 1.3 <= e < 1.62:
                v = G["cobble"]
            elif SQUARE[0] <= x <= SQUARE[2] and SQUARE[1] <= z <= SQUARE[3]:
                v = G["cobble"]
            elif road_dist(x, z) < 0.6 or apron_dist(x, z) < 0.0:
                v = G["cobble"]
            elif d_ring > 3:
                v = G["forest_floor"] if T.fbm(x * 0.06, z * 0.06, SEED + 9, 2) < 0.55 else G["grass_dark"]
            else:
                v = G["grass"] if T.fbm(x * 0.05, z * 0.05, 99, 2) < 0.58 else G["orchard_grass"]
            out[r * w + c] = v
    return out


# ---------------------------------------------------------------- output
def write(g, ground, ring_count, hub):
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
    doc = {
        "version": 2,
        "name": "Duck Plaza",
        "mode": "hub",
        "seed": SEED,
        "size": SIZE,
        "seaLevel": WATER_Y,
        "coords": "x east, y up, z south (north is -z), meters, map centered at the origin. rotY: three.js yaw, "
                  "rotY 0 means the prop front (+Z in its GLB) faces +z (south). y is the prop origin height, already on the terrain.",
        "propsSource": "apps/client/public/models/props/<prop>.glb; plaza_* props in plaza_manifest.json, their colliders in "
                       "art/map/export/duck-plaza/plaza_colliders.json (npm run map:sync merges them into this map's colliders.json)",
        "propManifests": ["plaza_manifest.json"],
        "terrain": {
            "cells": CELLS, "cellSize": CELL, "origin": [-HALF, -HALF],
            "heights": "map_v1_heights.bin",
            "heightsEncoding": f"16-byte header <4sHHhhHH: 'QWHF', version 1, samples per side {CELLS + 1}, origin x {-HALF:.0f}, origin z {-HALF:.0f}, cell size 200 cm, 100 units per meter; "
                               f"then {CELLS + 1} x {CELLS + 1} int16 little endian centimeters, row-major, row along z (north to south), col along x (west to east)",
            "ground": "map_v1_ground.bin",
            "groundEncoding": f"16-byte header <4sHHhhHH: 'QWGP', version 1, samples per side {CELLS + 1}, origin x, origin z, cell size cm, legend length; then {CELLS + 1} x {CELLS + 1} uint8, same order as the heights",
            "headerBytes": 16,
            "groundLegend": GROUND,
            "min": round(min(g.heights), 2), "max": round(max(g.heights), 2),
        },
        "chunks": {"grid": 1, "size": SIZE, "origin": [-HALF, -HALF], "id": "one chunk (the map is small): chunk = 0"},
        "water": {"sea": WATER_Y, "river": [], "riverHalfWidth": 0,
                  "note": "the Duck Pond: the terrain dips under the water level only in the pond (at most 0.62 m deep, ducks wade); "
                          "the hub client draws its own pond surface"},
        "roads": [{"id": r["id"], "width": r["width"], "pts": [list(p) for p in r["pts"]]} for r in ROADS],
        "plaza": list(SQUARE),
        "zones": [{"id": c["id"], "name": c["name"], "tier": 1, "drop": "quiet", "poly": [list(p) for p in c["poly"]]} for c in CALLOUTS],
        "playArea": {"ring": [list(p) for p in RING], "inset": 1.4,
                     "note": "center line of the hedge ring (closed polygon); the loader's invisible walls (size / 2 - 6) stay as a backstop"},
        "hub": hub,
        "hubNote": "portals: the three mode gates (plaza_portal; id dm, br, raid), y is the ground; their walk-through trigger is "
                   "PORTAL_TRIGGER in packages/shared/src/hub/constants.ts. spawns: where fresh ducks appear, exits: where ducks "
                   "come back from each mode; both [x, y, z, yaw] with the player yaw. board: the leaderboard billboard (plaza_board)",
        "propIndex": index,
        "props": props,
        "stats": {"props": len(props), "byProp": counts, "ringHedges": ring_count, "playAreaM2": round(poly_area(RING)),
                  "spawns": len(hub["spawns"])},
    }
    path = os.path.join(OUT, "map_v1.json")
    with open(path, "w") as f:
        json.dump(doc, f, separators=(",", ":"))
    return path, doc


def main():
    g, ground, ring, hub = generate()
    path, doc = write(g, ground, ring, hub)
    st = doc["stats"]
    print("MAP", path, os.path.getsize(path) // 1024, "KB")
    print("PROPS", st["props"], st["byProp"])
    print("RING HEDGES", ring, "AREA", st["playAreaM2"], "m2")
    print("HEIGHT", doc["terrain"]["min"], doc["terrain"]["max"])


if __name__ == "__main__":
    main()
