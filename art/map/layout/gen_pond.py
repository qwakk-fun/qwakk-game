"""Generate Pond Keep (map id pond-keep, Turkish Gölet Kalesi), the Hunt Season raid map, as map_v1 placement data.

A storybook duck castle on an island in a pond. The castle (four corner towers, curtain walls with walkable
battlements, a gatehouse over a drawbridge, a courtyard with the QoreChain core) stands on a grassy berm inside a
14 m moat. Reeds on both banks keep every duck out of the water; the drawbridge and four hunters' raft lanes are
the only crossings. Around the pond, 60 to 90 m out, six WWI trench lines with dugouts face the castle; behind
them, at 115 to 130 m, four hunters' watchtowers and three hills with rock nests are the sniper perches. A hedge
ring about 300 m across closes the play area; fields and wooded hills outside it are scenery.

Pure Python 3, standard library only, fully deterministic (fixed seed, the mulberry32 RNG of gen_map.py).
Reads the prop manifest written by art/map/blender/build_props.py (sizes and the castle `anchors`) and writes:
  art/map/export/pond-keep/map_v1.json          props, roads, zones, play area, dmSpawns and the `raid` markup
  art/map/export/pond-keep/map_v1_heights.bin   201 x 201 int16 little endian, centimeters (2 m cells)
  art/map/export/pond-keep/map_v1_ground.bin    201 x 201 uint8 ground paint ids

Coordinates as in the other maps: x east, y up, z south (north is -z), meters, the core at the origin.
rotY is the three.js yaw of a prop (rotY 0: the prop front, +Z in its GLB, faces south). Every yaw in the raid
markup and in dmSpawns is the player yaw (input yaw): 0 looks north, the duck looks along (-sin yaw, -cos yaw).
"""

import json
import math
import os
import struct
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import terrain as T  # noqa: E402  (noise and polygon helpers)
from gen_map import GROUND, HEADER, Grid, Rng, poly_area, rot2, trench_tiles, zigzag  # noqa: E402  (pure helpers)

MAP_ID = "pond-keep"
MAP_ART = os.path.dirname(HERE)
GAME = os.path.dirname(os.path.dirname(MAP_ART))
MANIFEST = os.path.join(GAME, "apps", "client", "public", "models", "props", "manifest.json")
OUT = os.path.join(MAP_ART, "export", MAP_ID)
SEED = 4391
PI = math.pi

CELLS = 200
CELL = 2.0                  # finer than Kavren's 4 m: the moat banks and the rounded corners need it
SIZE = CELLS * CELL
HALF = SIZE / 2
G = {name: i for i, name in enumerate(GROUND)}

# ---------------------------------------------------------------- the pond and the castle
LAND = 1.0                  # island, berm and the banks (the castle origin height)
WATER = 0.0                 # the moat surface (the map's sea level)
BED = -2.4                  # moat bed
ISLAND = 30.0               # island half size (the inner bank)
ISLAND_R = 12.0             # island corner radius
MOAT_W = 14.0               # inner bank to outer bank
BANK_RUN = 2.5              # bank top to bed
WALK = 5.2                  # wall walk (castle.py)
TOP = 9.8                   # tower top
WALL_C = 18.5               # curtain wall center lines
HINGE_Z = 32.5              # drawbridge hinge (inner quay tip)
REED_IN, REED_OUT = -0.6, MOAT_W + 0.6     # reed lines (signed distance from the inner bank)
CORE_RADIUS = 3.8
LEVER = (-3.8, 15.6)        # the drawbridge winch, in the courtyard beside the gate passage

CASTLE = [
    # (prop, x, z, rotY)
    ("castle_core", 0.0, 0.0, 0.0),
    ("castle_tower", WALL_C, WALL_C, 0.0),          # south-east (authored)
    ("castle_tower", -WALL_C, WALL_C, -PI / 2),     # south-west
    ("castle_tower", WALL_C, -WALL_C, PI / 2),      # north-east
    ("castle_tower", -WALL_C, -WALL_C, PI),         # north-west
    ("castle_wall", 0.0, -WALL_C, PI),              # north
    ("castle_wall", WALL_C, 0.0, PI / 2),           # east
    ("castle_wall", -WALL_C, 0.0, -PI / 2),         # west
    ("castle_wall_short", -10.0, WALL_C, 0.0),
    ("castle_wall_short", 10.0, WALL_C, 0.0),
    ("castle_gatehouse", 0.0, WALL_C, 0.0),
    ("castle_bridge", 0.0, HINGE_Z, 0.0),
]
TOWER_NAMES = {(1, 1): "South-East Tower", (-1, 1): "South-West Tower", (1, -1): "North-East Tower", (-1, -1): "North-West Tower"}
COURTYARD = [
    ("castle_well", -9.5, -9.0, 0.3),
    ("hay_cart", 9.8, -9.6, 2.3),
    ("hay_bales", -10.5, 8.0, 0.35),
    ("hay_bales", 8.5, 9.5, 1.25),
    ("sandbag_wall", -6.2, 11.8, 0.0),
    ("sandbag_wall", 6.2, 11.8, 0.0),
    ("crate_large", -12.6, -3.0, 0.3),
    ("crate_small", -12.4, -1.4, 0.9),
    ("crate_small", 12.4, 2.4, 0.2),
    ("ammo_box", 11.6, 3.4, 1.1),
    ("bush_round", -11.6, 11.8, 0.5),
    ("bush_round", 13.0, 7.2, 2.0),
    ("bush_round", -11.8, -11.8, 1.1),
]
# Raft lanes: center on the moat middle line, rotY so the lane's outer end (its GLB front) faces away from the castle
MID = ISLAND + MOAT_W / 2
LANES = [("East Lane", MID, 0.0, PI / 2), ("West Lane", -MID, 0.0, -PI / 2), ("North-East Lane", 14.0, -MID, PI), ("North-West Lane", -14.0, -MID, PI)]

# ---------------------------------------------------------------- the ring around
TRENCH_R = 74.0             # front line (j = 0 cells)
DUGOUT_R = 86.0
WIRE_R = 61.0
SEGMENTS = [0, 60, 120, 180, 240, 300]          # trench segments, degrees from +x toward +z (90 is south, the gate)
SEG_NAMES = {0: "East", 60: "South-East", 120: "South-West", 180: "West", 240: "North-West", 300: "North-East"}
TOWERS_AT = [(30, 118.0), (150, 118.0), (210, 118.0), (330, 118.0)]
TOWER_NAMES_RING = {30: "South-East Watchtower", 150: "South-West Watchtower", 210: "North-West Watchtower", 330: "North-East Watchtower"}
HILLS = [(0, 128.0, "East Hill"), (180, 128.0, "West Hill"), (270, 128.0, "North Hill")]
RING_R = 150.0
RING_INNER = 1.4


def polar(deg, r):
    a = math.radians(deg)
    return r * math.cos(a), r * math.sin(a)


def yaw_toward(dx, dz):
    """Player yaw looking along (dx, dz)."""
    return math.atan2(-dx, -dz)


def rot_facing(dx, dz):
    """Prop rotY whose front (+Z of the GLB) faces along (dx, dz)."""
    return math.atan2(dx, dz)


def wrap(a):
    return math.atan2(math.sin(a), math.cos(a))


# ---------------------------------------------------------------- shapes
def island_sd(x, z, grow=0.0):
    """Signed distance to the island edge (rounded square, half ISLAND, corner radius ISLAND_R), grown by `grow`:
    negative on the island. The outer bank is island_sd = MOAT_W."""
    a = ISLAND - ISLAND_R
    qx, qz = abs(x) - a, abs(z) - a
    out = math.hypot(max(qx, 0.0), max(qz, 0.0)) + min(max(qx, qz), 0.0)
    return out - ISLAND_R - grow


def perimeter(offset, step=0.5):
    """Points along the island edge offset by `offset` (island_sd = offset), clockwise from the south middle
    (x = 0, +z), as a closed polyline with arc lengths: [(s, x, z)], total length."""
    a = ISLAND - ISLAND_R
    r = ISLAND_R + offset
    pts = []
    # from the south middle: the south side toward -x, the south-west corner, the west side toward -z, and so on
    def side(p0, p1):
        L = math.hypot(p1[0] - p0[0], p1[1] - p0[1])
        n = max(1, int(L / step))
        return [(p0[0] + (p1[0] - p0[0]) * k / n, p0[1] + (p1[1] - p0[1]) * k / n) for k in range(n)]

    def arc(cx, cz, a0, a1):
        n = max(2, int(abs(a1 - a0) * r / step))
        return [(cx + math.cos(a0 + (a1 - a0) * k / n) * r, cz + math.sin(a0 + (a1 - a0) * k / n) * r) for k in range(n)]

    h = a + r
    pts += side((0.0, h), (-a, h))
    pts += arc(-a, a, PI / 2, PI)
    pts += side((-h, a), (-h, -a))
    pts += arc(-a, -a, PI, 1.5 * PI)
    pts += side((-a, -h), (a, -h))
    pts += arc(a, -a, -PI / 2, 0.0)
    pts += side((h, -a), (h, a))
    pts += arc(a, a, 0.0, PI / 2)
    pts += side((a, h), (0.0, h))
    out, s = [], 0.0
    for i, p in enumerate(pts):
        if i:
            s += math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1])
        out.append((s, p[0], p[1]))
    total = s + math.hypot(pts[0][0] - pts[-1][0], pts[0][1] - pts[-1][1])
    return out, total


def along(poly, total, s):
    s %= total
    for (s0, x0, z0), (s1, x1, z1) in zip(poly, poly[1:] + [(total, poly[0][1], poly[0][2])]):
        if s0 <= s <= s1:
            t = 0.0 if s1 == s0 else (s - s0) / (s1 - s0)
            return x0 + (x1 - x0) * t, z0 + (z1 - z0) * t
    return poly[-1][1], poly[-1][2]


def project(poly, total, x, z):
    best, bs = 1e9, 0.0
    for (s0, x0, z0), (s1, x1, z1) in zip(poly, poly[1:] + [(total, poly[0][1], poly[0][2])]):
        d, t = T.seg_dist(x, z, x0, z0, x1, z1)
        if d < best:
            best, bs = d, s0 + (s1 - s0) * t
    return bs


def ring_points():
    """The hedge ring's center line: 24 points about RING_R from the core, wobbled a little."""
    rng = Rng(SEED + 17)
    out = []
    for k in range(24):
        a = 2 * PI * k / 24 + PI / 24
        r = RING_R + rng.range(-4.0, 4.0)
        out.append((round(r * math.cos(a), 1), round(r * math.sin(a), 1)))
    return out


RING = ring_points()


def ring_signed(x, z):
    d = min(T.seg_dist(x, z, a[0], a[1], b[0], b[1])[0] for a, b in zip(RING, RING[1:] + RING[:1]))
    return -d if T.point_in_poly(x, z, RING) else d


# ---------------------------------------------------------------- terrain
def raw_height(x, z):
    d0 = island_sd(x, z)
    if d0 <= 0.0:
        return LAND
    if d0 < MOAT_W:
        t = min(d0, MOAT_W - d0)
        return LAND + (BED - LAND) * T.smoothstep(0.0, BANK_RUN, t)
    o = d0 - MOAT_W
    k = T.smoothstep(6.0, 24.0, o)
    h = LAND + 0.9 * k + 1.2 * T.smoothstep(20.0, 70.0, o) + 1.0 * T.smoothstep(55.0, 100.0, o)
    h += k * 1.3 * (T.fbm(x * 0.018 + 4.1, z * 0.018 - 2.7, SEED, 3) - 0.5)
    for deg, r, _ in HILLS:
        hx, hz = polar(deg, r)
        h += 4.6 * math.exp(-((x - hx) ** 2 + (z - hz) ** 2) / (17.0 ** 2))
    # gentle swells under the watchtowers and in the no man's land
    for deg, r in TOWERS_AT:
        tx, tz = polar(deg, r)
        h += 1.6 * math.exp(-((x - tx) ** 2 + (z - tz) ** 2) / (16.0 ** 2))
    out = ring_signed(x, z)
    if out > 2.0:
        h += T.smoothstep(2.0, 42.0, out) * (7.0 + 6.0 * T.fbm(x * 0.022 - 6.0, z * 0.022 + 3.0, SEED + 5, 3))
    return h


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


# ---------------------------------------------------------------- the generator
class Pond:
    def __init__(self, manifest):
        self.man = manifest["props"]
        self.rng = Rng(SEED)
        self.props = []
        self.pads = []
        self.dips = []
        self.solid = Grid(12.0)
        self.soft = Grid(12.0)
        self.heights = None
        self.trenches = []          # [(segment deg, [(x, z) tile centers in path order], tiles)]
        self.raid = {}
        self.reserved = []          # spots the scatter must leave free (hunter spawns)

    def keep_off(self, x, z, r):
        return keep_clear(x, z, r) or any(math.hypot(x - a, z - b) < 3.0 + r for a, b in self.reserved)

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
                if island_sd(x, z) < MOAT_W + 1.0:
                    continue            # the island, the moat and the banks keep their exact shape
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

    def place(self, prop, x, z, yaw=0.0, scale=1.0, y=None, layer="solid", check=("solid",), margin=0.4, sink=0.0, register=True,
              keep_off=None):
        """Place one prop; False when its footprint hits what is there. `keep_off(x, z, r)`: a predicate that
        refuses spots (roads, the moat, lines of sight)."""
        if prop not in self.man:
            raise KeyError(prop)
        fp = self.footprint(prop, x, z, yaw, scale, margin)
        if keep_off is not None and keep_off(x, z, max(fp[2], fp[3])):
            return False
        if "solid" in check and self.solid.hits(fp):
            return False
        if "soft" in check and self.soft.hits(fp):
            return False
        if y is None:
            y = self.y_footprint(prop, x, z, yaw, scale) - sink
        rec = {"prop": prop, "x": round(x, 2), "y": round(y, 2), "z": round(z, 2), "rotY": round(wrap(yaw), 4)}
        if scale != 1.0:
            rec["scale"] = round(scale, 3)
        self.props.append(rec)
        if register:
            (self.solid if layer == "solid" else self.soft).add(self.footprint(prop, x, z, yaw, scale, 0.0))
        return rec

    def anchor(self, rec, name):
        """A prop's anchor (manifest, glTF local) in map coordinates. Lists come back as lists."""
        a = self.man[rec["prop"]]["anchors"][name]
        c, s = math.cos(rec["rotY"]), math.sin(rec["rotY"])

        def w(p):
            lx, ly, lz = p
            return (rec["x"] + c * lx + s * lz, rec["y"] + ly, rec["z"] - s * lx + c * lz)
        return [w(p) for p in a] if isinstance(a[0], list) else w(a)

    def hedge_line(self, pts, closed=False, gates=(), step=7.0, check=("solid",), overrun=0.0):
        """Hedgerow pieces along a polyline (the Kavren recipe, gen_quarter.py): `step` apart, a piece across
        every inner vertex, edges run `overrun` past their vertices so corners are closed."""
        segs = list(zip(pts, pts[1:] + pts[:1])) if closed else list(zip(pts, pts[1:]))
        placed = 0
        later = []
        for a, b in segs:
            L0 = math.hypot(b[0] - a[0], b[1] - a[1])
            ux, uz = (b[0] - a[0]) / L0, (b[1] - a[1]) / L0
            a = (a[0] - ux * overrun, a[1] - uz * overrun)
            b = (b[0] + ux * overrun, b[1] + uz * overrun)
            L = L0 + 2 * overrun
            yaw = math.atan2(b[0] - a[0], b[1] - a[1]) + PI / 2
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


# ---------------------------------------------------------------- layout pieces
def segment_frame(deg):
    """Trench segment grid frame: local +j points away from the castle. Returns (center x, z, frame yaw)."""
    cx, cz = polar(deg, TRENCH_R)
    a = math.radians(deg)
    return cx, cz, math.atan2(math.cos(a), math.sin(a))


def plan_trenches():
    """Each segment: a front line zigzag (11 tiles of 4 m, traverses toward the castle) and a dugout behind it.
    Returns [(deg, tiles [(prop, x, z, rotY)], centers [(x, z)], ends [(x, z, out_x, out_z)])]."""
    out = []
    for deg in SEGMENTS:
        cx, cz, phi = segment_frame(deg)
        cells = zigzag((0, 0), 11, run=3, jog=1, axis="x", sign=1, jog_sign=-1)
        imid = (min(c[0] for c in cells) + max(c[0] for c in cells)) / 2
        tiles, centers, ends = [], [], []
        for prop, i, j, yaw in trench_tiles(cells):
            dx, dz = rot2((i - imid) * 4.0, j * 4.0, phi)
            tiles.append((prop, cx + dx, cz + dz, yaw + phi))
        for i, j in cells:
            dx, dz = rot2((i - imid) * 4.0, j * 4.0, phi)
            centers.append((cx + dx, cz + dz))
        for k in (0, len(cells) - 1):
            i, j = cells[k]
            ni, nj = cells[1] if k == 0 else cells[-2]
            oi, oj = i - ni, j - nj                     # away from the neighbor: the exit ramp side
            dx, dz = rot2((i - imid) * 4.0 + oi * 6.8, j * 4.0 + oj * 6.8, phi)
            ox, oz = rot2(oi, oj, phi)
            ends.append((cx + dx, cz + dz, ox, oz))
        out.append((deg, tiles, centers, ends))
    return out


def generate():
    with open(MANIFEST) as f:
        manifest = json.load(f)
    g = Pond(manifest)
    rng = g.rng
    trenches = plan_trenches()

    # ======== phase A: what flattens or dents the terrain
    for deg, tiles, _, _ in trenches:
        for _, x, z, yaw in tiles:
            g.pad(x, z, 2.0, 2.0, yaw=yaw, falloff=5.0)
        dx, dz = polar(deg, DUGOUT_R)
        g.pad(dx, dz, 3.6, 3.2, yaw=rot_facing(-dx, -dz), falloff=6.0)
    for deg, r in TOWERS_AT:
        tx, tz = polar(deg, r)
        g.pad(tx, tz, 4.2, 4.2, yaw=rot_facing(-tx, -tz), falloff=7.0)
    for deg, r, _ in HILLS:
        hx, hz = polar(deg, r - 2.0)
        g.pad(hx, hz, 3.5, 3.5, yaw=rot_facing(-hx, -hz), falloff=7.0)
    craters = []
    for deg in SEGMENTS:
        for da, rr in ((-14, 63.0), (17, 66.0), (31, 92.0)):
            x, z = polar(deg + da, rr)
            craters.append((x, z))
            g.dips.append((x, z, 3.4, 0.55))
    g.build_terrain()

    # ======== phase B: the castle, the crossings and the moat barrier
    recs = {}
    for prop, x, z, yaw in CASTLE:
        rec = g.place(prop, x, z, yaw, y=LAND, check=(), margin=0.0)
        recs.setdefault(prop, []).append(rec)
    for prop, x, z, yaw in COURTYARD:
        assert g.place(prop, x, z, yaw, y=LAND, check=("solid",), margin=0.2), prop
    lanes = []
    for name, x, z, yaw in LANES:
        rec = g.place("raft_lane", x, z, yaw, y=WATER, check=(), margin=0.0)
        lanes.append((name, rec))
    reeds = place_reeds(g, lanes)
    # beached rafts next to each lane on the outer bank, and two by the bridge
    for name, rec in lanes:
        fx, _, fz = g.anchor(rec, "from")
        ox, oz = math.sin(rec["rotY"]), math.cos(rec["rotY"])
        tx, tz = oz, -ox
        for side in (-1, 1):
            g.place("raft", fx + ox * 3.4 + tx * side * 4.6, fz + oz * 3.4 + tz * side * 4.6, rec["rotY"] + side * 0.35, check=("solid",), margin=0.3)
    for side in (-1, 1):
        g.place("raft", side * 7.6, 49.5, side * 0.5, check=("solid",), margin=0.3)

    # ======== phase C: trenches, dugouts, wire, watchtowers, hills
    trench_out = []
    for deg, tiles, centers, ends in trenches:
        for prop, x, z, yaw in tiles:
            g.place(prop, x, z, yaw, check=(), margin=0.0)
        dx, dz = polar(deg, DUGOUT_R)
        dug = g.place("trench_dugout", dx, dz, rot_facing(-dx, -dz), check=("solid",), margin=0.0)
        assert dug, deg
        trench_out.append((deg, centers, ends, dug))
        # keep the hunters' way out free: the trench exits and the dugout door
        g.reserved += [(x, z) for x, z, _, _ in ends] + [g.anchor(dug, "exit")[0::2]]
    for deg in SEGMENTS:
        for da in (-11.0, -3.5, 4.5, 12.0):
            wx, wz = polar(deg + da, WIRE_R + (1.5 if da > 0 else 0.0))
            g.place("barbed_wire", wx, wz, rot_facing(-wx, -wz) + PI / 2, check=("solid",), margin=0.1)
        # sandbag nests at both ends of the front line, facing the castle
        for da in (-24.0, 24.0):
            sx, sz = polar(deg + da, TRENCH_R - 4.0)
            g.place("sandbag_wall", sx, sz, rot_facing(-sx, -sz), check=("solid",), margin=0.2)
    towers = []
    for deg, r in TOWERS_AT:
        tx, tz = polar(deg, r)
        rec = g.place("hunter_watchtower", tx, tz, rot_facing(-tx, -tz), check=("solid",), margin=0.5)
        assert rec, deg
        towers.append((deg, rec))
    hills = []
    for deg, r, name in HILLS:
        hx, hz = polar(deg, r - 2.0)
        fx, fz = -hx / math.hypot(hx, hz), -hz / math.hypot(hx, hz)
        tx, tz = -fz, fx
        g.place("rock_boulder", hx + fx * 2.6 + tx * 1.7, hz + fz * 2.6 + tz * 1.7, rot_facing(fx, fz) + 0.4, check=("solid",), margin=0.0, sink=0.25)
        g.place("sandbag_wall", hx + fx * 2.2 - tx * 1.4, hz + fz * 2.2 - tz * 1.4, rot_facing(fx, fz), check=("solid",), margin=0.0)
        g.place("rock_slab", hx - fx * 2.6 + tx * 3.0, hz - fz * 2.6 + tz * 3.0, 1.2, check=("solid",), margin=0.0, sink=0.2)
        hills.append((deg, name, (hx, hz), (fx, fz)))
    for (cx, cz) in craters:
        g.place("crater", cx, cz, rng.range(0, 2 * PI), check=("solid",), layer="soft", margin=0.0, y=g.y_at(cx, cz) - 0.05)

    # ======== phase D: the hedge ring, cover in the meadow, scenery
    ring = g.hedge_line(RING, closed=True, check=(), overrun=1.5)
    meadow_cover(g, rng)
    scenery(g, rng)

    # ======== the raid markup
    build_raid(g, recs, lanes, trench_out, towers, hills)
    ground = paint_ground(g, craters)
    return g, ground, ring, reeds


def place_reeds(g, lanes):
    """Reed strips along both banks, edge to edge, ending against the lane rope lines and the bridge quays."""
    count = 0
    for offset in (REED_IN, REED_OUT):
        poly, total = perimeter(offset)
        gaps = []
        bridge_half = 3.55
        gaps.append((project(poly, total, 0.0, ISLAND + offset), bridge_half))
        for _, rec in lanes:
            gaps.append((project(poly, total, rec["x"] + (math.sin(rec["rotY"]) * (offset - MOAT_W / 2)),
                                 rec["z"] + (math.cos(rec["rotY"]) * (offset - MOAT_W / 2))), 1.9))
        cuts = sorted(((s - h) % total, (s + h) % total) for s, h in gaps)
        # free intervals between consecutive gaps (gaps never wrap around s = 0 here: the bridge sits at s = 0)
        spans = []
        bridge = [c for c in cuts if c[0] > c[1]]
        if bridge:
            start = bridge[0][1]
            end = bridge[0][0]
            inner = sorted(c for c in cuts if c[0] <= c[1])
        else:
            start, end, inner = 0.0, total, cuts
        s = start
        for c0, c1 in inner:
            spans.append((s, c0))
            s = c1
        spans.append((s, end))
        for s0, s1 in spans:
            L = s1 - s0
            n = max(1, int(math.ceil(L / 3.8)))
            for k in range(n):
                sc = s0 + L * (k + 0.5) / n
                x, z = along(poly, total, sc)
                xa, za = along(poly, total, sc - 1.0)
                xb, zb = along(poly, total, sc + 1.0)
                yaw = math.atan2(xb - xa, zb - za) + PI / 2
                if g.place("moat_reeds", x, z, yaw, y=LAND, check=(), margin=0.0):
                    count += 1
    return count


def keep_clear(x, z, r):
    """Spots the meadow cover must leave alone: the moat and its banks, the roads, the bridge approach, the trench
    lines and the dugouts, the castle's open view (no tall cover within 4 m of the moat road)."""
    d0 = island_sd(x, z)
    if d0 < MOAT_W + 3.0 + r:
        return True
    if road_dist(x, z) < r + 1.0:
        return True
    if ring_signed(x, z) > -6.0 - r:
        return True
    return False


def meadow_cover(g, rng):
    """Low cover between the moat and the trenches and between the trench segments: rocks, bushes, hay, carts,
    crates, fences. Nothing tall: the walls must see the trenches."""
    picks = ["rock_boulder", "rock_slab", "bush_round", "bush_wide", "hay_bales", "hay_bales", "crate_large", "crate_small", "wood_fence",
             "sandbag_corner", "hay_cart", "stone_wall"]
    placed = 0
    for _ in range(900):
        if placed >= 70:
            break
        a = rng.range(0, 2 * PI)
        r = rng.range(50.0, 112.0)
        x, z = r * math.cos(a), r * math.sin(a)
        prop = rng.pick(picks)
        if prop == "hay_cart" and r < 60:
            continue
        soft = prop.startswith("bush")
        rec = g.place(prop, x, z, rng.range(0, 2 * PI), check=("solid", "soft"), layer="soft" if soft else "solid", margin=1.2,
                      sink=0.2 if prop.startswith("rock") else 0.0, keep_off=g.keep_off)
        if rec:
            placed += 1
    # a few apple trees and oaks out by the watchtowers and the hills (beyond 95 m, off the sight lines)
    trees = 0
    for _ in range(400):
        if trees >= 22:
            break
        a = rng.range(0, 2 * PI)
        r = rng.range(96.0, 140.0)
        x, z = r * math.cos(a), r * math.sin(a)
        deg = math.degrees(a) % 360
        if any(abs(((deg - t + 180) % 360) - 180) < 9 for t, _ in TOWERS_AT) or any(abs(((deg - h + 180) % 360) - 180) < 9 for h, _, _ in HILLS):
            continue
        prop = "tree_apple" if rng() < 0.55 else "tree_oak"
        if g.place(prop, x, z, rng.range(0, 2 * PI), scale=rng.range(0.9, 1.15), check=("solid", "soft"), layer="soft", margin=1.0, keep_off=g.keep_off):
            trees += 1


def scenery(g, rng):
    """Outside the ring, never reachable: a second hedge line, tree lines on the rising ground."""
    outer = [(x * 1.18, z * 1.18) for x, z in RING]
    g.hedge_line(outer, closed=True, gates=[(0, 177, 10), (0, -177, 10), (177, 0, 10), (-177, 0, 10)], step=8.0, check=())
    count = 0
    for _ in range(1500):
        if count >= 170:
            break
        x, z = rng.range(-HALF + 6, HALF - 6), rng.range(-HALF + 6, HALF - 6)
        d = ring_signed(x, z)
        if d < 9 or abs(d - 27) < 5:
            continue
        p = "tree_poplar" if rng() < 0.3 else "tree_oak"
        if g.place(p, x, z, rng.range(0, 2 * PI), scale=rng.range(0.95, 1.3), check=("solid", "soft"), layer="soft", margin=1.5):
            count += 1


# ---------------------------------------------------------------- roads (ground paint only)
def moat_road():
    poly, total = perimeter(MOAT_W + 8.0, step=4.0)
    return [(round(x, 1), round(z, 1)) for _, x, z in poly] + [(round(poly[0][1], 1), round(poly[0][2], 1))]


ROADS = [
    {"id": "hunters_road", "width": 5, "pts": [(0.0, 150.0), (0.0, 100.0), (0.0, 46.0)]},
    {"id": "moat_road", "width": 4, "pts": moat_road()},
]
for _deg in SEGMENTS:
    # a path from behind each trench segment, past its end, to the moat road
    _a = _deg + 20
    ROADS.append({"id": f"path_{_deg}", "width": 3, "pts": [polar(_a, 130.0), polar(_a, 92.0), polar(_a - 6, 70.0), polar(_a - 10, 52.0)]})
ROADS = [{"id": r["id"], "width": r["width"], "pts": [(round(x, 1), round(z, 1)) for x, z in r["pts"]]} for r in ROADS]


def road_dist(x, z):
    best = 1e9
    for rd in ROADS:
        for a, b in zip(rd["pts"], rd["pts"][1:]):
            best = min(best, T.seg_dist(x, z, a[0], a[1], b[0], b[1])[0] - rd["width"] / 2)
    return best


# ---------------------------------------------------------------- the raid markup
def r2(v):
    return round(v, 2)


def build_raid(g, recs, lanes, trench_out, towers, hills):
    raid = {}
    core = recs["castle_core"][0]
    raid["core"] = [r2(core["x"]), r2(core["y"]), r2(core["z"])]
    raid["coreRadius"] = CORE_RADIUS
    gh = recs["castle_gatehouse"][0]
    gx, gy, gz = g.anchor(gh, "gate")
    raid["gate"] = {"x": r2(gx), "y": r2(gy), "z": r2(gz), "yaw": round(yaw_toward(0.0, 1.0), 4), "width": 4.0, "height": 4.2}
    fx, fy, fz = g.anchor(gh, "front")
    raid["gateFront"] = [r2(fx), r2(fy), r2(fz)]
    br = recs["castle_bridge"][0]
    hx, hy, hz = g.anchor(br, "hinge")
    ex, _, ez = g.anchor(br, "far")
    length = math.hypot(ex - hx, ez - hz)
    raid["drawbridge"] = {"hingeX": r2(hx), "hingeY": r2(hy), "hingeZ": r2(hz), "yaw": round(yaw_toward(ex - hx, ez - hz), 4),
                          "length": r2(length), "width": 4.4,
                          "walk": [[r2(hx - 2.2), r2(hz)], [r2(hx + 2.2), r2(hz)], [r2(ex + 2.2), r2(ez)], [r2(ex - 2.2), r2(ez)]]}
    cannons, uses, tops = [], [], []
    for t in recs["castle_tower"]:
        cx, cy, cz = g.anchor(t, "cannon")
        ax, _, az = g.anchor(t, "cannonAim")
        ux, uy, uz = g.anchor(t, "cannonUse")
        cannons.append([r2(cx), r2(cy), r2(cz), round(yaw_toward(ax - cx, az - cz), 4)])
        uses.append([r2(ux), r2(uy), r2(uz)])
        tx, ty, tz = g.anchor(t, "top")
        tops.append([r2(tx), r2(ty), r2(tz)])
    raid["cannons"] = cannons
    raid["cannonUse"] = uses
    raid["towerTops"] = tops
    # dynamic GLBs the game places and animates (never in `props`)
    props = [{"prop": "castle_drawbridge", "role": "drawbridge", "x": r2(hx), "y": r2(hy), "z": r2(hz), "rotY": br["rotY"]},
             {"prop": "castle_gate", "role": "gate", "x": r2(gx), "y": r2(gy), "z": r2(gz), "rotY": gh["rotY"]}]
    for (cx, cy, cz, yaw) in cannons:
        props.append({"prop": "bread_cannon", "role": "cannon", "x": cx, "y": cy, "z": cz, "rotY": round(wrap(yaw + PI), 4)})
    props.append({"prop": "castle_lever", "role": "lever", "x": LEVER[0], "y": LAND, "z": LEVER[1], "rotY": 0.0})
    raid["props"] = props
    raid["lever"] = [LEVER[0], LAND, LEVER[1]]
    assert not g.solid.hits((LEVER[0], LEVER[1], 0.9, 0.6, 0.0))
    # inside the walls (to the gate's line) and the island (the inner bank)
    gz = r2(gz)
    raid["keep"] = [[-20.0, -20.0], [20.0, -20.0], [20.0, 20.0], [6.0, 20.0], [6.0, gz], [-6.0, gz], [-6.0, 20.0], [-20.0, 20.0]]
    poly, _ = perimeter(0.0, step=3.0)
    raid["island"] = [[r2(x), r2(z)] for _, x, z in poly]
    # wall walk polylines at the walk height: each curtain wall, the gatehouse top
    walks = []
    for prop in ("castle_wall", "castle_wall_short", "castle_gatehouse"):
        for rec in recs[prop]:
            pts = g.anchor(rec, "walk")
            walks.append([[r2(x), r2(y), r2(z)] for x, y, z in pts])
    raid["wallWalk"] = walks
    # duck spawns: around the core and on the wall walks
    duck = []
    for x, z, look in ((0.0, -9.5, (0, -1)), (-10.5, -3.0, (-1, 0)), (10.5, -2.5, (1, 0)), (-4.5, 9.0, (0, 1)), (4.5, 8.5, (0, 1)),
                       (-6.0, -12.0, (0, -1)), (6.0, -11.5, (0, -1)), (-12.5, 4.0, (-1, 0)), (12.5, -6.0, (1, 0)), (0.0, 13.0, (0, 1))):
        assert not g.solid.hits((x, z, 0.9, 0.9, 0.0)), (x, z)
        duck.append([r2(x), r2(LAND + 0.1), r2(z), round(yaw_toward(*look), 4)])
    for rec in recs["castle_wall"]:
        a, b = g.anchor(rec, "walk")
        for t in (0.3, 0.7):
            x, z = a[0] + (b[0] - a[0]) * t, a[2] + (b[2] - a[2]) * t
            out = (x / max(1e-6, math.hypot(x, z)), z / max(1e-6, math.hypot(x, z)))
            n = (round(out[0]), round(out[1]))
            duck.append([r2(x), r2(LAND + WALK + 0.1), r2(z), round(yaw_toward(*n), 4)])
    raid["duckSpawns"] = duck
    # hunter spawns: trench exits and dugout doors, facing the core
    hunters, polylines = [], []
    for deg, centers, ends, dug in trench_out:
        for x, z, ox, oz in ends:
            assert not g.solid.hits((x, z, 0.8, 0.8, 0.0)), (deg, x, z)
            hunters.append([r2(x), r2(g.y_at(x, z) + 0.1), r2(z), round(yaw_toward(-x, -z), 4)])
        dx, _, dz = g.anchor(dug, "exit")
        assert not g.solid.hits((dx, dz, 0.8, 0.8, 0.0)), (deg, dx, dz)
        hunters.append([r2(dx), r2(g.y_at(dx, dz) + 0.1), r2(dz), round(yaw_toward(-dx, -dz), 4)])
        polylines.append([[r2(x), r2(z)] for x, z in centers])
    raid["hunterSpawns"] = hunters
    raid["trenches"] = polylines
    perches = []
    for deg, rec in towers:
        px, py, pz = g.anchor(rec, "perch")
        perches.append([r2(px), r2(py + 0.1), r2(pz), round(yaw_toward(-px, -pz), 4)])
    for deg, name, (hx2, hz2), (fx2, fz2) in hills:
        x, z = hx2 - fx2 * 0.6, hz2 - fz2 * 0.6
        perches.append([r2(x), r2(g.y_at(x, z) + 0.1), r2(z), round(yaw_toward(fx2, fz2), 4)])
    raid["sniperPerches"] = perches
    lanes_out = []
    for name, rec in lanes:
        fx, _, fz = g.anchor(rec, "from")
        tx, _, tz = g.anchor(rec, "to")
        lanes_out.append({"name": name, "from": [r2(fx), r2(fz)], "to": [r2(tx), r2(tz)]})
    raid["raftLanes"] = lanes_out
    g.raid = raid


# ---------------------------------------------------------------- zones (callouts)
def zones(g):
    out = [{"id": "gatehouse", "name": "Gatehouse", "poly": [(-7.5, 14.5), (7.5, 14.5), (7.5, 27.0), (-7.5, 27.0)]}]
    for (sx, sz), name in TOWER_NAMES.items():
        cx, cz = sx * WALL_C, sz * WALL_C
        out.append({"id": name.lower().replace(" ", "_").replace("-", "_"), "name": name,
                    "poly": [(cx - 5.2, cz - 5.2), (cx + 5.2, cz - 5.2), (cx + 5.2, cz + 5.2), (cx - 5.2, cz + 5.2)]})
    out.append({"id": "courtyard", "name": "Courtyard", "poly": [(-17.0, -17.0), (17.0, -17.0), (17.0, 17.0), (-17.0, 17.0)]})
    out.append({"id": "north_wall", "name": "North Wall", "poly": [(-14.0, -21.0), (14.0, -21.0), (14.0, -17.0), (-14.0, -17.0)]})
    out.append({"id": "east_wall", "name": "East Wall", "poly": [(17.0, -14.0), (21.0, -14.0), (21.0, 14.0), (17.0, 14.0)]})
    out.append({"id": "west_wall", "name": "West Wall", "poly": [(-21.0, -14.0), (-17.0, -14.0), (-17.0, 14.0), (-21.0, 14.0)]})
    out.append({"id": "south_wall", "name": "South Wall", "poly": [(-14.0, 17.0), (14.0, 17.0), (14.0, 21.0), (-14.0, 21.0)]})
    out.append({"id": "drawbridge", "name": "Drawbridge", "poly": [(-4.5, 27.0), (4.5, 27.0), (4.5, 47.0), (-4.5, 47.0)]})
    poly, total = perimeter(MOAT_W, step=6.0)
    out.append({"id": "moat", "name": "Moat", "poly": [(round(x, 1), round(z, 1)) for _, x, z in poly]})
    for deg in SEGMENTS:
        pts = [polar(deg + da, r) for da, r in ((-20, 56.0), (20, 56.0), (20, 96.0), (-20, 96.0))]
        name = SEG_NAMES[deg] + " Trenches"
        out.append({"id": name.lower().replace(" ", "_").replace("-", "_"), "name": name, "poly": pts})
    for deg, r in TOWERS_AT:
        cx, cz = polar(deg, r)
        name = TOWER_NAMES_RING[deg]
        out.append({"id": name.lower().replace(" ", "_").replace("-", "_"), "name": name,
                    "poly": [(cx - 12, cz - 12), (cx + 12, cz - 12), (cx + 12, cz + 12), (cx - 12, cz + 12)]})
    for deg, r, name in HILLS:
        cx, cz = polar(deg, r)
        out.append({"id": name.lower().replace(" ", "_"), "name": name, "poly": [(cx - 16, cz - 16), (cx + 16, cz - 16), (cx + 16, cz + 16), (cx - 16, cz + 16)]})
    out.append({"id": "meadow", "name": "Pond Meadow", "poly": list(RING)})
    for z in out:
        z["poly"] = [[round(p[0], 1), round(p[1], 1)] for p in z["poly"]]
    return out


# ---------------------------------------------------------------- ground paint
def paint_ground(g, craters):
    w = CELLS + 1
    out = bytearray(w * w)
    for r in range(w):
        z = -HALF + r * CELL
        for c in range(w):
            x = -HALF + c * CELL
            d0 = island_sd(x, z)
            rd = road_dist(x, z)
            if abs(x) < 17.0 and abs(z) < 17.0:
                v = G["cobble"]
            elif abs(x) <= 7.0 and 22.0 <= z <= 31.0:
                v = G["cobble"]                                         # the apron in front of the gate
            elif 0.6 < d0 < MOAT_W - 0.6:
                v = G["river_mud"]
            elif -1.2 <= d0 <= 0.6 or MOAT_W - 0.6 <= d0 <= MOAT_W + 1.2:
                v = G["grass_dark"]
            elif d0 < 0:
                v = G["grass"] if T.fbm(x * 0.06, z * 0.06, 77, 2) < 0.6 else G["grass_dark"]
            elif rd < 0.4 and ring_signed(x, z) < -1:
                v = G["dirt_road"]
            elif ring_signed(x, z) > 4:
                k = int(T.fbm(x * 0.013 + 40, z * 0.013 - 9, SEED + 7, 2) * 6) % 4
                v = (G["wheat"], G["green_crop"], G["plowed"], G["grass_dark"])[k]
            elif any(math.hypot(x - cx, z - cz) < 3.4 for cx, cz in craters):
                v = G["plowed"]
            elif 64.0 < math.hypot(x, z) < 92.0 and T.fbm(x * 0.05, z * 0.05, 31, 2) < 0.42:
                v = G["plowed"]                                         # churned no man's land around the trenches
            else:
                v = G["grass"] if T.fbm(x * 0.03, z * 0.03, 99, 2) < 0.55 else G["grass_dark"]
            out[r * w + c] = v
    return out


# ---------------------------------------------------------------- output
def write(g, ground, ring_count, reeds):
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
    raid = dict(g.raid)
    raid["note"] = ("Hunt Season markup (docs/pond-keep.md). Positions are map coordinates, y is the feet (or the base) height; every yaw is "
                    "the player yaw (0 looks north, a duck looks along (-sin yaw, -cos yaw)); a prop's rotY = yaw + PI. "
                    "props: animated GLBs to place in code (never in `props`).")
    doc = {
        "version": 2,
        "name": "Pond Keep",
        "nameTr": "Gölet Kalesi",
        "mode": "raid",
        "seed": SEED,
        "size": SIZE,
        "seaLevel": WATER,
        "coords": "x east, y up, z south (north is -z), meters, the core at the origin. rotY: three.js yaw, "
                  "rotY 0 means the prop front (+Z in its GLB) faces +z (south). y is the prop origin height, already on the terrain.",
        "propsSource": "apps/client/public/models/props/<prop>.glb (LOD0..LOD2 child nodes), colliders in colliders.json, LOD distances in manifest.json",
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
        "water": {"sea": WATER, "river": [], "riverHalfWidth": 0,
                  "note": f"the moat: the terrain is under the water surface ({WATER} m) only in the moat (bed {BED} m); reeds on both banks "
                          "(moat_reeds, fence colliders) keep ducks out of it; the drawbridge and the raft lanes cross it"},
        "roads": [{"id": r["id"], "width": r["width"], "pts": [list(p) for p in r["pts"]]} for r in ROADS],
        "plaza": [-15, -15, 15, 15],
        "zones": [{"id": c["id"], "name": c["name"], "tier": 1, "drop": "quiet", "poly": c["poly"]} for c in zones(g)],
        "zonesNote": "callout areas for the HUD and the kill feed, first match wins (the castle parts come first, Pond Meadow last)",
        "playArea": {"ring": [list(p) for p in RING], "inset": RING_INNER,
                     "note": "center line of the outer hedgerow ring (closed polygon, about 300 m across). The hedges cannot be crossed; "
                             "the play area is the polygon shrunk by `inset` m. Everything outside is scenery."},
        "dmSpawns": [list(s) for s in g.raid["duckSpawns"]],
        "dmSpawnsNote": "fallback spawns for modes that read dmSpawns: the raid's duck spawns (courtyard and wall walks)",
        "raid": raid,
        "propIndex": index,
        "props": props,
        "stats": {"props": len(props), "byProp": counts, "ringHedges": ring_count, "reeds": reeds,
                  "playAreaM2": round(poly_area(RING)), "playAcrossM": [round(max(p[0] for p in RING) - min(p[0] for p in RING)),
                                                                        round(max(p[1] for p in RING) - min(p[1] for p in RING))],
                  "duckSpawns": len(raid["duckSpawns"]), "hunterSpawns": len(raid["hunterSpawns"]), "sniperPerches": len(raid["sniperPerches"])},
    }
    path = os.path.join(OUT, "map_v1.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(doc, f, separators=(",", ":"), ensure_ascii=False)
    return path, doc


def main():
    g, ground, ring, reeds = generate()
    path, doc = write(g, ground, ring, reeds)
    st = doc["stats"]
    print("MAP", path, os.path.getsize(path) // 1024, "KB")
    print("PROPS", st["props"], st["byProp"])
    print("RING HEDGES", ring, "REEDS", reeds, "AREA", st["playAreaM2"], "m2, across", st["playAcrossM"])
    print("RAID duck", st["duckSpawns"], "hunter", st["hunterSpawns"], "perches", st["sniperPerches"])
    print("HEIGHT", doc["terrain"]["min"], doc["terrain"]["max"])


if __name__ == "__main__":
    main()
