"""Generate map_v1: the Sainte-Canard island layout as placement data for the shared sim.

Pure Python 3, standard library only, fully deterministic (fixed seed, own RNG). Reads the prop manifest
(footprints, loot points) written by art/map/blender/build_props.py and writes:
  art/map/export/map_v1.json          props, zones, roads, river, loot, flight paths, circle hints
  art/map/export/map_v1_heights.bin   211 x 211 int16 little endian, centimeters, row-major (row along z)
  art/map/export/map_v1_ground.bin    211 x 211 uint8 ground paint ids (legend in the JSON)

Coordinates: x east, y up, z south (north is -z), meters, island centered at the origin, sea at y = 0.
rotY is the three.js yaw: a prop with rotY = 0 has its front (+Z in the GLB) facing south (+z).
"""

import json
import math
import os
import struct
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import terrain as T  # noqa: E402

MAP_ART = os.path.dirname(HERE)
GAME = os.path.dirname(os.path.dirname(MAP_ART))
MANIFEST = os.path.join(GAME, "apps", "client", "public", "models", "props", "manifest.json")
OUT = os.path.join(MAP_ART, "export")
SEED = 4417
PI = math.pi
FACE_S, FACE_E, FACE_N, FACE_W = 0.0, PI / 2, PI, -PI / 2


class Rng:
    """mulberry32, so the same sequence can be reproduced in TypeScript if ever needed."""

    def __init__(self, seed):
        self.a = seed & 0xFFFFFFFF

    def __call__(self):
        self.a = (self.a + 0x6D2B79F5) & 0xFFFFFFFF
        t = self.a
        t = ((t ^ (t >> 15)) * (t | 1)) & 0xFFFFFFFF
        t ^= (t + (((t ^ (t >> 7)) * (t | 61)) & 0xFFFFFFFF)) & 0xFFFFFFFF
        return ((t ^ (t >> 14)) & 0xFFFFFFFF) / 4294967296.0

    def range(self, a, b):
        return a + (b - a) * self()

    def pick(self, items):
        return items[int(self() * len(items)) % len(items)]


# ---------------------------------------------------------------- layout data
ZONES = [
    {"id": "beach", "name": "Mallard Beach", "tier": 2, "drop": "medium",
     "poly": [(-168, -352), (238, -352), (238, -262), (-168, -262)]},
    {"id": "headland", "name": "Pointe du Bec", "tier": 3, "drop": "medium",
     "poly": [(-405, -395), (-182, -395), (-166, -305), (-200, -222), (-300, -208), (-398, -210)]},
    {"id": "village", "name": "Sainte-Canard", "tier": 3, "drop": "hot",
     "poly": [(-58, -262), (150, -262), (150, -105), (-58, -105)]},
    {"id": "bridge", "name": "Pont Vieux", "tier": 2, "drop": "medium",
     "poly": [(166, -186), (238, -186), (238, -112), (166, -112)]},
    {"id": "ridge", "name": "Feather Ridge", "tier": 3, "drop": "medium",
     "poly": [(240, -112), (328, -112), (328, 178), (240, 178)]},
    {"id": "farm", "name": "Ferme Colvert", "tier": 2, "drop": "medium",
     "poly": [(-218, -8), (-104, -8), (-104, 100), (-218, 100)]},
    {"id": "crossroads", "name": "Convoy Crossroads", "tier": 3, "drop": "hot",
     "poly": [(-38, 18), (78, 18), (78, 106), (-38, 106)]},
    {"id": "forest", "name": "Bois des Plumes", "tier": 1, "drop": "quiet",
     "poly": [(-366, 128), (-150, 118), (-118, 250), (-182, 345), (-300, 338), (-362, 252)]},
    {"id": "orchard", "name": "Le Verger", "tier": 1, "drop": "quiet",
     "poly": [(-28, 188), (112, 188), (112, 302), (-28, 302)]},
    {"id": "hamlet", "name": "Hameau Sud", "tier": 2, "drop": "quiet",
     "poly": [(202, 236), (278, 236), (278, 312), (202, 312)]},
]
COUNTRYSIDE = {"id": "countryside", "name": "Bocage", "tier": 1, "drop": "quiet"}

ROADS = [
    {"id": "main", "width": 6, "pts": [(40, -296), (40, -150), (32, -40), (20, 60), (32, 180), (55, 300), (62, 372)]},
    {"id": "coast_road", "width": 5, "pts": [(-58, -190), (-150, -212), (-245, -250), (-300, -292), (-322, -322)]},
    {"id": "village_street", "width": 6, "pts": [(-58, -190), (40, -190), (140, -180), (180, -152), (222, -150), (252, -130), (300, -108)]},
    {"id": "farm_road", "width": 5, "pts": [(-332, 70), (-240, 55), (-150, 45), (-60, 55), (20, 60), (110, 84), (182, 120), (204, 120), (262, 140)]},
    {"id": "hamlet_lane", "width": 4, "pts": [(262, 140), (256, 210), (240, 270)]},
    {"id": "orchard_lane", "width": 4, "pts": [(32, 180), (-40, 228), (-130, 252)]},
]
PLAZA = (22, -208, 58, -176)

# Buildings: (prop, x, z, facing). Hand placed so streets read and doors face the street.
BUILDINGS = [
    ("church", 40, -221.3, FACE_S),
    ("townhouse", 22, -251, FACE_E), ("farmhouse", 59, -252, FACE_W),
    ("townhouse", 8, -226, FACE_E), ("farmhouse", 8, -208, FACE_E), ("house_ruined", 8, -170, FACE_E), ("townhouse", 8, -152, FACE_E),
    ("farmhouse", 72, -226, FACE_W), ("townhouse", 72, -208, FACE_W), ("townhouse", 72, -170, FACE_W), ("house_ruined", 72, -152, FACE_W),
    ("townhouse", -16, -204, FACE_S), ("farmhouse", -38, -204, FACE_S), ("house_ruined", -16, -175, FACE_N), ("townhouse", -38, -175, FACE_N),
    ("townhouse", 96, -201, FACE_S), ("house_ruined", 116, -198, FACE_S), ("farmhouse", 96, -166, FACE_N), ("townhouse", 117, -164, FACE_N),
    ("townhouse", 22, -134, FACE_E), ("house_ruined", 21, -116, FACE_E), ("farmhouse", 54, -134, FACE_W), ("townhouse", 53, -116, FACE_W),
    # Pointe du Bec
    ("lighthouse", -334, -342, FACE_S), ("townhouse", -296, -302, FACE_N), ("barn", -262, -262, FACE_W),
    # Ferme Colvert
    ("farmhouse", -166, 46, FACE_E), ("barn", -126, 30, FACE_W), ("barn", -150, 80, FACE_N),
    # crossroads corner
    ("townhouse", 5, 36, FACE_E), ("house_ruined", 41, 88, FACE_W), ("farmhouse", 50, 36, FACE_W),
    # orchard farm, hamlet, forest lodge
    ("farmhouse", 92, 256, FACE_W), ("barn", 92, 226, FACE_W),
    ("townhouse", 226, 254, FACE_S), ("farmhouse", 252, 262, FACE_W), ("house_ruined", 224, 290, FACE_N), ("barn", 258, 294, FACE_W),
    ("house_ruined", -262, 232, FACE_S),
]
BRIDGES = [(201.0, -150.0, FACE_E), (192.6, 120.0, FACE_E)]

FINAL_CIRCLES = [
    {"name": "Feather Ridge south", "x": 278, "z": 70, "r": 60, "weight": 3},
    {"name": "Convoy Crossroads", "x": 22, "z": 62, "r": 55, "weight": 3},
    {"name": "Ferme Colvert", "x": -145, "z": 48, "r": 55, "weight": 2},
    {"name": "Le Verger", "x": 40, "z": 240, "r": 55, "weight": 2},
    {"name": "Sainte-Canard south", "x": 40, "z": -135, "r": 50, "weight": 2},
    {"name": "Hameau Sud", "x": 236, "z": 272, "r": 50, "weight": 1},
    {"name": "Bois des Plumes edge", "x": -170, "z": 150, "r": 55, "weight": 1},
    {"name": "Pont Vieux", "x": 205, "z": -150, "r": 45, "weight": 1},
]

GROUND = ["grass", "grass_dark", "sand", "rock", "dirt_road", "cobble", "wheat", "green_crop", "plowed",
          "forest_floor", "river_mud", "seabed", "orchard_grass"]
G = {name: i for i, name in enumerate(GROUND)}


# ---------------------------------------------------------------- helpers
def zone_at(x, z):
    for zn in ZONES:
        if T.point_in_poly(x, z, zn["poly"]):
            return zn
    return COUNTRYSIDE


def road_dist(x, z, roads=ROADS):
    best = 1e9
    for rd in roads:
        for a, b in zip(rd["pts"], rd["pts"][1:]):
            d, _ = T.seg_dist(x, z, a[0], a[1], b[0], b[1])
            best = min(best, d - rd["width"] / 2)
    return best


def rot2(lx, lz, yaw):
    c, s = math.cos(yaw), math.sin(yaw)
    return c * lx + s * lz, -s * lx + c * lz


class Grid:
    """Spatial hash of oriented footprints for overlap tests."""

    def __init__(self, cell=16.0):
        self.cell = cell
        self.items = {}

    def _keys(self, fp):
        r = math.hypot(fp[2], fp[3])
        x0, x1 = int(math.floor((fp[0] - r) / self.cell)), int(math.floor((fp[0] + r) / self.cell))
        z0, z1 = int(math.floor((fp[1] - r) / self.cell)), int(math.floor((fp[1] + r) / self.cell))
        for i in range(x0, x1 + 1):
            for j in range(z0, z1 + 1):
                yield (i, j)

    def add(self, fp):
        for k in self._keys(fp):
            self.items.setdefault(k, []).append(fp)

    def hits(self, fp):
        seen = set()
        for k in self._keys(fp):
            for o in self.items.get(k, ()):
                if id(o) in seen:
                    continue
                seen.add(id(o))
                if obb_overlap(fp, o):
                    return True
        return False


def obb_overlap(a, b):
    """2D separating axis test for (cx, cz, hx, hz, yaw) rectangles."""
    def axes(r):
        c, s = math.cos(r[4]), math.sin(r[4])
        return [(c, -s), (s, c)]

    def corners(r):
        out = []
        for sx in (-1, 1):
            for sz in (-1, 1):
                dx, dz = rot2(sx * r[2], sz * r[3], r[4])
                out.append((r[0] + dx, r[1] + dz))
        return out

    ca, cb = corners(a), corners(b)
    for ax in axes(a) + axes(b):
        pa = [p[0] * ax[0] + p[1] * ax[1] for p in ca]
        pb = [p[0] * ax[0] + p[1] * ax[1] for p in cb]
        if max(pa) < min(pb) or max(pb) < min(pa):
            return False
    return True


# ---------------------------------------------------------------- the generator
class MapGen:
    def __init__(self, manifest):
        self.man = manifest["props"]
        self.rng = Rng(SEED)
        self.props = []
        self.loot = []
        self.pads = []
        self.dips = []
        self.solid = Grid()
        self.soft = Grid(12.0)
        self.heights = None
        self.sds = None

    # -- footprints
    def footprint(self, prop, x, z, yaw, scale=1.0, margin=0.0):
        b = self.man[prop]["bounds"]
        (x0, _, z0), (x1, _, z1) = b["min"], b["max"]
        cx, cz = (x0 + x1) / 2 * scale, (z0 + z1) / 2 * scale
        dx, dz = rot2(cx, cz, yaw)
        return (x + dx, z + dz, (x1 - x0) / 2 * scale + margin, (z1 - z0) / 2 * scale + margin, yaw)

    # -- phase A: pads (decided before the heights are final)
    def pad_for(self, prop, x, z, yaw, margin=2.5, falloff=10.0, y=None):
        fp = self.footprint(prop, x, z, yaw, margin=margin)
        self.pads.append({"x": fp[0], "z": fp[1], "hx": fp[2], "hz": fp[3], "yaw": yaw, "falloff": falloff, "y": y})

    def apply_pads(self, pre):
        w = T.CELLS + 1
        for p in self.pads:
            if p["y"] is None:
                p["y"] = T.height_at(pre, p["x"], p["z"])
        out = list(pre)
        for r in range(w):
            z = -T.HALF + r * T.CELL
            for c in range(w):
                x = -T.HALF + c * T.CELL
                h = out[r * w + c]
                for p in self.pads:
                    if abs(x - p["x"]) > p["hx"] + p["hz"] + p["falloff"] or abs(z - p["z"]) > p["hx"] + p["hz"] + p["falloff"]:
                        continue
                    lx, lz = rot2(x - p["x"], z - p["z"], -p["yaw"])
                    ox, oz = max(abs(lx) - p["hx"], 0.0), max(abs(lz) - p["hz"], 0.0)
                    d = math.hypot(ox, oz)
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
        # quantize to centimeters: this is exactly what the engine loads
        return [round(h * 100) / 100 for h in out]

    def y_at(self, x, z):
        return T.height_at(self.heights, x, z)

    def y_footprint(self, prop, x, z, yaw, scale=1.0):
        """Lowest terrain under the footprint corners and center, so props never float."""
        fp = self.footprint(prop, x, z, yaw, scale)
        ys = [self.y_at(fp[0], fp[1])]
        for sx in (-1, 1):
            for sz in (-1, 1):
                dx, dz = rot2(sx * fp[2], sz * fp[3], yaw)
                ys.append(self.y_at(fp[0] + dx, fp[1] + dz))
        return min(ys)

    def sd_at(self, x, z):
        return T.height_at(self.sds, x, z)

    # -- phase B: placement
    def place(self, prop, x, z, yaw=0.0, scale=1.0, y=None, layer="solid", check=("solid",), margin=0.4,
              on_land=True, avoid_roads=None, zone=None, loot=True, sink=0.0):
        if prop not in self.man:
            raise KeyError(prop)
        fp = self.footprint(prop, x, z, yaw, scale, margin)
        if on_land and self.sd_at(x, z) < 1.0:
            return False
        if avoid_roads is not None and road_dist(x, z) < avoid_roads + max(fp[2], fp[3]) * 0.5:
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
        tight = self.footprint(prop, x, z, yaw, scale, 0.0)
        (self.solid if layer == "solid" else self.soft).add(tight)
        zn = zone or zone_at(x, z)
        if loot:
            ent = self.man[prop]
            for lp in ent.get("loot", []):
                lx, ly, lz = lp["p"]
                wx, wz = rot2(lx * scale, lz * scale, yaw)
                kind = {"building": "building", "beach": "bunker", "vehicle": "vehicle", "trench": "trench"}.get(ent["category"], "ground")
                if ent.get("container"):
                    kind = "container"
                pt = {"x": round(x + wx, 2), "y": round(y + ly * scale, 2), "z": round(z + wz, 2),
                      "tier": min(4, zn["tier"] + lp.get("tierBonus", 0)), "kind": kind, "zone": zn["id"]}
                if ent.get("container"):
                    pt["container"] = ent["container"]
                self.loot.append(pt)
        return True

    def scatter_loot(self, zn, density, tries_mult=4):
        """Floor loot on open ground inside a zone polygon: `density` points per 1000 m2."""
        xs = [p[0] for p in zn["poly"]]
        zs = [p[1] for p in zn["poly"]]
        area = poly_area(zn["poly"])
        want = int(area / 1000.0 * density)
        got = 0
        for _ in range(want * tries_mult):
            if got >= want:
                break
            x, z = self.rng.range(min(xs), max(xs)), self.rng.range(min(zs), max(zs))
            if not T.point_in_poly(x, z, zn["poly"]) or self.sd_at(x, z) < 2:
                continue
            if self.solid.hits((x, z, 0.6, 0.6, 0.0)):
                continue
            self.loot.append({"x": round(x, 2), "y": round(self.y_at(x, z), 2), "z": round(z, 2), "tier": zn["tier"], "kind": "ground", "zone": zn["id"]})
            got += 1


def poly_area(poly):
    s = 0.0
    for (ax, az), (bx, bz) in zip(poly, poly[1:] + poly[:1]):
        s += ax * bz - bx * az
    return abs(s) / 2


def zone_by_id(i):
    return next(z for z in ZONES if z["id"] == i)


# ---------------------------------------------------------------- trench paths on a 4 m grid
def trench_tiles(cells):
    """cells: list of (i, j) grid steps (4 m) forming a path. Returns (prop, i, j, yaw) tiles."""
    def d(a, b):
        return (b[0] - a[0], b[1] - a[1])

    corner_yaw = {frozenset({(0, 1), (1, 0)}): 0.0, frozenset({(1, 0), (0, -1)}): PI / 2,
                  frozenset({(0, -1), (-1, 0)}): PI, frozenset({(-1, 0), (0, 1)}): -PI / 2}
    out = []
    n = len(cells)
    for k, c in enumerate(cells):
        nbrs = []
        if k > 0:
            nbrs.append(d(c, cells[k - 1]))
        if k < n - 1:
            nbrs.append(d(c, cells[k + 1]))
        if len(nbrs) == 1:
            nx, nz = nbrs[0]
            out.append(("trench_end", c[0], c[1], math.atan2(nx, nz)))
        elif nbrs[0][0] == -nbrs[1][0] and nbrs[0][1] == -nbrs[1][1]:
            out.append(("trench_straight", c[0], c[1], 0.0 if nbrs[0][0] == 0 else PI / 2))
        else:
            out.append(("trench_corner", c[0], c[1], corner_yaw[frozenset(nbrs)]))
    return out


def zigzag(start, length, run=5, jog=2, axis="z", sign=1, jog_sign=1):
    """Grid path: `run` steps along the axis, then `jog` steps sideways, alternating sides."""
    i, j = start
    cells = [(i, j)]
    side = jog_sign
    while len(cells) < length:
        for _ in range(run):
            if axis == "z":
                j += sign
            else:
                i += sign
            cells.append((i, j))
        for _ in range(jog):
            if axis == "z":
                i += side
            else:
                j += side
            cells.append((i, j))
        side = -side
    return cells[:length]


# ---------------------------------------------------------------- main build
def generate():
    with open(MANIFEST) as f:
        manifest = json.load(f)
    g = MapGen(manifest)
    rng = g.rng

    # ======== phase A: what flattens or dents the terrain
    for prop, x, z, yaw in BUILDINGS:
        g.pad_for(prop, x, z, yaw, margin=3.0 if prop != "church" else 4.0, falloff=12.0)
    g.pads.append({"x": (PLAZA[0] + PLAZA[2]) / 2, "z": (PLAZA[1] + PLAZA[3]) / 2, "hx": (PLAZA[2] - PLAZA[0]) / 2,
                   "hz": (PLAZA[3] - PLAZA[1]) / 2, "yaw": 0.0, "falloff": 14.0, "y": None})
    g.pads.append({"x": 20, "z": 60, "hx": 18, "hz": 18, "yaw": 0.0, "falloff": 16.0, "y": None})
    for bx, bz, yaw in BRIDGES:
        _, bed = T.river_info(bx, bz)
        for s in (-1, 1):
            ex, ez = rot2(0, s * 13.0, yaw)
            g.pads.append({"x": bx + ex, "z": bz + ez, "hx": 4.0, "hz": 3.2, "yaw": yaw, "falloff": 9.0, "y": bed + 3.0})
    # trench networks (grid origin per network)
    trench_nets = []
    ridge = zigzag((0, 0), 64, run=6, jog=2, axis="z", sign=1, jog_sign=-1)
    trench_nets.append(("ridge", 282.0, -96.0, ridge))
    head = zigzag((0, 0), 16, run=4, jog=2, axis="x", sign=1, jog_sign=1)
    trench_nets.append(("headland", -352.0, -288.0, head))
    for bxs in (-140.0, -6.0, 120.0):
        trench_nets.append(("beach", bxs, -272.0, [(k, 0) for k in range(7)]))
    tiles = []
    for name, ox, oz, cells in trench_nets:
        for prop, i, j, yaw in trench_tiles(cells):
            x, z = ox + i * 4.0, oz + j * 4.0
            tiles.append((name, prop, x, z, yaw))
            g.pads.append({"x": x, "z": z, "hx": 2.0, "hz": 2.0, "yaw": 0.0, "falloff": 5.0, "y": None})
    # shell craters (terrain dips under the crater decal)
    craters = []
    for _ in range(14):
        craters.append((rng.range(-150, 220), rng.range(-338, -292)))
    for _ in range(10):
        craters.append((rng.range(250, 312), rng.range(-90, 160)))
    for _ in range(6):
        craters.append((rng.range(-30, 70), rng.range(25, 100)))
    for _ in range(4):
        craters.append((rng.range(-50, 140), rng.range(-250, -110)))
    for cx, cz in craters:
        g.dips.append((cx, cz, 3.4, 0.55))

    pre, sds = T.sample_grid(SEED)
    g.sds = sds
    g.heights = g.apply_pads(pre)

    # ======== phase B: placement, most important first
    pad_y = {}
    for p in g.pads:
        pad_y[(round(p["x"], 2), round(p["z"], 2))] = p["y"]
    for prop, x, z, yaw in BUILDINGS:
        fp = g.footprint(prop, x, z, yaw, margin=3.0 if prop != "church" else 4.0)
        y = pad_y[(round(fp[0], 2), round(fp[1], 2))]
        ok = g.place(prop, x, z, yaw, y=y, check=(), margin=0.0)
        assert ok, prop
    for bx, bz, yaw in BRIDGES:
        _, bed = T.river_info(bx, bz)
        g.place("bridge_stone", bx, bz, yaw, y=bed + 3.0, check=(), on_land=False, margin=0.0)
    for name, prop, x, z, yaw in tiles:
        g.place(prop, x, z, yaw, check=(), margin=0.0, loot=False)
    tile_loot = 0
    for name, prop, x, z, yaw in tiles:
        if prop == "trench_straight":
            tile_loot += 1
            if tile_loot % 3 == 0:
                zn = zone_at(x, z)
                g.loot.append({"x": round(x, 2), "y": round(g.y_at(x, z) + 0.05, 2), "z": round(z, 2), "tier": zn["tier"], "kind": "trench", "zone": zn["id"]})
    for cx, cz in craters:
        g.place("crater", cx, cz, rng.range(0, 2 * PI), check=("solid",), layer="soft", margin=0.0, y=g.y_at(cx, cz) - 0.05)

    beach(g, rng)
    headland(g, rng)
    village(g, rng)
    bridges(g, rng)
    ridge_defenses(g, rng)
    farm(g, rng)
    crossroads(g, rng)
    hamlet_and_orchard(g, rng)
    fields = bocage(g, rng)
    nature(g, rng)

    for zn, dens in (("village", 1.5), ("crossroads", 2.0), ("beach", 0.4), ("ridge", 0.8), ("headland", 0.8),
                     ("farm", 0.8), ("hamlet", 1.0), ("orchard", 0.4), ("forest", 0.25), ("bridge", 1.0)):
        g.scatter_loot(zone_by_id(zn), dens)
    countryside_loot(g, rng)

    g.spawns = ground_spawns(g, rng)
    ground = paint_ground(g, fields)
    return g, fields, ground


def ground_spawns(g, rng, want=48, min_dist=70.0):
    """Fallback ground spawn points spread over open land (late join, bot fill, tests without the plane)."""
    out = []
    for _ in range(6000):
        if len(out) >= want:
            break
        x, z = rng.range(-390, 390), rng.range(-390, 390)
        if g.sd_at(x, z) < 15 or T.river_info(x, z)[0] < 14 or g.y_at(x, z) < 1.0:
            continue
        if g.solid.hits((x, z, 1.5, 1.5, 0.0)) or g.soft.hits((x, z, 1.0, 1.0, 0.0)):
            continue
        if any((x - a) ** 2 + (z - c) ** 2 < min_dist ** 2 for a, _, c in out):
            continue
        out.append((round(x, 2), round(g.y_at(x, z) + 0.1, 2), round(z, 2)))
    return out


# ---------------------------------------------------------------- zones
def beach(g, rng):
    zn = zone_by_id("beach")
    # bunker line on the bluff top, facing the sea
    for x in (-118, -58, 14, 82, 150, 206):
        g.place("bunker_pillbox", x + rng.range(-3, 3), -282.5, FACE_N, check=("solid",), margin=0.5)
        for s in (-1, 1):
            g.place("sandbag_corner", x + s * 9, -279, FACE_N if s > 0 else FACE_W, check=("solid",))
    # landing craft beached at the waterline, ramps toward land
    for x in (-96, 34, 158):
        g.place("landing_craft", x, -352.0, FACE_S, check=("solid",), on_land=False, y=g.y_at(x, -352.0), zone=zn)
    # hedgehogs in staggered rows, wooden ramps near the waterline
    for row, z in enumerate((-334, -321, -308)):
        x = -156 + (7 if row % 2 else 0)
        while x < 228:
            g.place("czech_hedgehog", x + rng.range(-2, 2), z + rng.range(-2, 2), rng.range(0, 2 * PI), check=("solid",), margin=1.0)
            x += 14 + rng.range(-2, 3)
    x = -150
    while x < 225:
        g.place("beach_obstacle", x + rng.range(-3, 3), -340 + rng.range(-2, 2), FACE_S + rng.range(-0.3, 0.3), check=("solid",), margin=1.0)
        x += 19 + rng.range(-3, 4)
    # wire along the bluff foot with gaps
    x = -160
    while x < 228:
        if rng() < 0.7:
            g.place("barbed_wire", x, -293 + rng.range(-1, 1), FACE_S + rng.range(-0.08, 0.08), check=("solid",), margin=0.1)
        x += 3.0 if rng() < 0.85 else 9.0
    for x, z, yaw in ((112, -322, 0.4), (-30, -316, 2.4)):
        g.place("tank_wreck" if x > 0 else "truck_wreck", x, z, yaw, check=("solid",), margin=1.0)
    for _ in range(10):
        g.place(rng.pick(["crate_small", "crate_small", "crate_large", "ammo_box", "fuel_barrel"]), rng.range(-150, 220),
                rng.range(-330, -298), rng.range(0, 2 * PI), check=("solid",), margin=0.6, zone=zn)


def headland(g, rng):
    zn = zone_by_id("headland")
    for x, z, yaw in ((-366, -252, FACE_W), (-258, -364, FACE_N), (-362, -322, -3 * PI / 4), (-205, -350, FACE_N)):
        g.place("bunker_pillbox", x, z, yaw, check=("solid",), margin=0.5)
    for _ in range(14):
        g.place(rng.pick(["sandbag_wall", "sandbag_corner", "crate_small", "crate_large", "ammo_box", "fuel_barrel"]),
                rng.range(-370, -220), rng.range(-370, -235), rng.range(0, 2 * PI), check=("solid",), margin=0.8, zone=zn)
    for _ in range(10):
        g.place("barbed_wire", rng.range(-390, -230), rng.range(-385, -240), rng.range(0, PI), check=("solid",), margin=0.2)
    g.place("truck_wreck", -282, -236, 1.9, check=("solid",), margin=1.0)
    g.place("signpost", -300, -286, 0.8, check=("solid",))


def village(g, rng):
    zn = zone_by_id("village")
    # the square: tank wreck, barricades, signpost, crates
    g.place("tank_wreck", 33, -193, 0.55, check=("solid",), margin=0.5)
    g.place("signpost", 55, -179, 2.2, check=("solid",))
    for x, z, yaw in ((26, -180, 0.0), (54, -205, PI), (40, -158, 0.0), (40, -268, PI)):
        g.place("sandbag_wall", x, z, yaw, check=("solid",), margin=0.2)
    for x, z, yaw in ((-55, -196, FACE_E), (136, -175, FACE_W)):
        g.place("sandbag_corner", x, z, yaw, check=("solid",))
    g.place("truck_wreck", 104, -184.5, FACE_E + 0.12, check=("solid",), margin=0.5)
    g.place("truck_wreck", -30, -191, FACE_W - 0.1, check=("solid",), margin=0.5)
    for _ in range(9):
        g.place("rubble_pile", rng.range(-50, 140), rng.range(-255, -110), rng.range(0, 2 * PI), check=("solid",), margin=0.5, avoid_roads=1.0)
    # garden walls and fences behind the street houses
    for _ in range(26):
        x, z = rng.range(-55, 145), rng.range(-258, -108)
        g.place(rng.pick(["stone_wall", "stone_wall", "wood_fence"]), x, z, rng.pick([0.0, PI / 2]), check=("solid",), margin=0.6, avoid_roads=1.5)
    # loot containers and props
    for _ in range(34):
        g.place(rng.pick(["crate_small", "crate_small", "crate_large", "ammo_box", "fuel_barrel"]),
                rng.range(-55, 145), rng.range(-258, -108), rng.range(0, 2 * PI), check=("solid",), margin=0.5, zone=zn)
    # poplars along the main road, bushes in gardens
    for z in range(-292, -110, 13):
        for side in (-1, 1):
            if rng() < 0.75:
                g.place("tree_poplar", 40 + side * 6.5, z + rng.range(-2, 2), 0.0, check=("solid",), layer="soft", margin=0.6)


def bridges(g, rng):
    zn = zone_by_id("bridge")
    g.place("sandbag_corner", 186, -157, FACE_E, check=("solid",))
    g.place("sandbag_corner", 216, -143, FACE_W, check=("solid",))
    g.place("sandbag_wall", 214, -158, FACE_E, check=("solid",))
    g.place("tank_wreck", 232, -142, 2.6, check=("solid",), margin=0.5)
    for _ in range(6):
        g.place(rng.pick(["crate_small", "ammo_box", "fuel_barrel"]), rng.range(172, 232), rng.range(-180, -118),
                rng.range(0, 2 * PI), check=("solid",), margin=0.5, zone=zn)
    g.place("sandbag_wall", 180, 112, FACE_E, check=("solid",))
    g.place("truck_wreck", 172, 126, 1.2, check=("solid",), margin=0.5)


def ridge_defenses(g, rng):
    zn = zone_by_id("ridge")
    for x, z in ((262, -64), (258, 34), (262, 124)):
        g.place("bunker_pillbox", x, z, FACE_W, check=("solid",), margin=0.5)
    for z in range(-100, 170, 10):
        if rng() < 0.6:
            g.place("barbed_wire", 246 + rng.range(-3, 3), z, FACE_E + rng.range(-0.2, 0.2), check=("solid",), margin=0.1)
    for _ in range(10):
        g.place(rng.pick(["sandbag_corner", "sandbag_wall"]), rng.range(268, 300), rng.range(-95, 160), rng.pick([0, PI / 2, PI, -PI / 2]),
                check=("solid",), margin=0.4)
    # supply dump on the reverse slope
    for _ in range(14):
        g.place(rng.pick(["crate_large", "crate_small", "ammo_box", "fuel_barrel", "fuel_barrel"]), rng.range(300, 320),
                rng.range(0, 40), rng.range(0, 2 * PI), check=("solid",), margin=0.3, zone=zn)
    g.place("truck_wreck", 314, 52, 0.2, check=("solid",), margin=0.5)
    for _ in range(10):
        g.place(rng.pick(["crate_small", "ammo_box"]), rng.range(270, 300), rng.range(-95, 160), rng.range(0, 2 * PI),
                check=("solid",), margin=0.4, zone=zn)


def farm(g, rng):
    zn = zone_by_id("farm")
    # courtyard walls with a gate gap toward the road
    for x in range(-156, -132, 4):
        if not -146 <= x <= -142:
            g.place("stone_wall", x + 2, 12.5, 0.0, check=("solid",), margin=0.0)
    for z in range(14, 64, 4):
        g.place("stone_wall", -112.5, z + 2, PI / 2, check=("solid",), margin=0.0)
    for _ in range(10):
        g.place(rng.pick(["crate_small", "crate_large", "fuel_barrel", "ammo_box"]), rng.range(-158, -134), rng.range(22, 66),
                rng.range(0, 2 * PI), check=("solid",), margin=0.5, zone=zn)
    # small apple orchard west of the yard
    for i in range(5):
        for j in range(7):
            g.place("tree_apple", -205 + i * 8 + rng.range(-1, 1), 10 + j * 9 + rng.range(-1, 1), rng.range(0, 2 * PI),
                    check=("solid",), layer="soft", margin=0.4, avoid_roads=1.0)
    for _ in range(8):
        g.place("wood_fence", rng.range(-215, -105), rng.range(-5, 98), rng.pick([0.0, PI / 2]), check=("solid",), margin=0.5, avoid_roads=1.0)


def crossroads(g, rng):
    zn = zone_by_id("crossroads")
    convoy = [("truck_wreck", -22, 52.5, FACE_E + 0.18), ("truck_wreck", -6, 56.5, FACE_E + 0.25), ("tank_wreck", 36, 73, 1.1),
              ("truck_wreck", 27, 98, 0.15), ("tank_wreck", 68, 77, FACE_W + 0.4), ("truck_wreck", 29, 22, PI + 0.2)]
    for prop, x, z, yaw in convoy:
        g.place(prop, x, z, yaw, check=("solid",), margin=0.3)
    g.place("signpost", 27, 52, 0.7, check=("solid",))
    for x, z, yaw in ((8, 48, FACE_E), (33, 47, FACE_S), (8, 72, 0.0), (35, 70, FACE_W)):
        g.place("sandbag_corner", x, z, yaw, check=("solid",))
    for _ in range(20):
        g.place(rng.pick(["crate_small", "crate_small", "crate_large", "ammo_box", "fuel_barrel"]), rng.range(-35, 75),
                rng.range(20, 104), rng.range(0, 2 * PI), check=("solid",), margin=0.5, zone=zn)


def hamlet_and_orchard(g, rng):
    zo = zone_by_id("orchard")
    for i in range(14):
        for j in range(11):
            x, z = -20 + i * 9 + rng.range(-1.2, 1.2), 196 + j * 9.5 + rng.range(-1.2, 1.2)
            if rng() < 0.85:
                g.place("tree_apple", x, z, rng.range(0, 2 * PI), check=("solid",), layer="soft", margin=0.3, avoid_roads=1.5)
    zh = zone_by_id("hamlet")
    for _ in range(8):
        g.place(rng.pick(["crate_small", "crate_large", "fuel_barrel", "ammo_box", "stone_wall", "wood_fence"]),
                rng.range(205, 275), rng.range(240, 310), rng.range(0, 2 * PI), check=("solid",), margin=0.5, zone=zh, avoid_roads=1.0)
    for _ in range(4):
        g.place(rng.pick(["crate_small", "crate_large"]), rng.range(70, 108), rng.range(215, 270), rng.range(0, 2 * PI),
                check=("solid",), margin=0.5, zone=zo)
    for _ in range(6):
        g.place(rng.pick(["crate_small", "crate_small", "ammo_box"]), rng.range(-300, -170), rng.range(150, 320),
                rng.range(0, 2 * PI), check=("solid",), margin=0.5, zone=zone_by_id("forest"))


def bocage(g, rng):
    """Hedgerow field grid in the open countryside and around the farms. Returns field quads for ground paint."""
    S, J = 54.0, 9.0
    x0, z0 = -400.0, -400.0
    n = int(800 / S) + 2
    V = [[(x0 + i * S + rng.range(-J, J), z0 + j * S + rng.range(-J, J)) for j in range(n)] for i in range(n)]
    allowed = {"countryside", "farm", "orchard", "hamlet"}
    fields = []
    for i in range(n - 1):
        for j in range(n - 1):
            quad = [V[i][j], V[i + 1][j], V[i + 1][j + 1], V[i][j + 1]]
            cx = sum(p[0] for p in quad) / 4
            cz = sum(p[1] for p in quad) / 4
            if zone_at(cx, cz)["id"] in allowed and g.sd_at(cx, cz) > 20:
                crop = ("wheat", "green_crop", "plowed", "grass", "green_crop", "wheat")[int(rng() * 6)]
                fields.append({"quad": quad, "crop": crop})

    def edge(a, b):
        mx, mz = (a[0] + b[0]) / 2, (a[1] + b[1]) / 2
        if zone_at(mx, mz)["id"] not in allowed or g.sd_at(mx, mz) < 16 or rng() > 0.72:
            return
        L = math.hypot(b[0] - a[0], b[1] - a[1])
        yaw = math.atan2(b[0] - a[0], b[1] - a[1]) + PI / 2       # hedge local X runs along the edge
        pieces = int(L // 8)
        gate = int(rng() * pieces) if pieces >= 3 else -1
        for k in range(pieces):
            if k == gate:
                continue
            t = (k + 0.5 + (L - pieces * 8) / 16) * 8 / L
            x, z = a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t
            if road_dist(x, z) < 4.0 or T.river_info(x, z)[0] < 13 or zone_at(x, z)["id"] not in allowed:
                continue
            if rng() < 0.1:
                g.place(rng.pick(["tree_oak", "tree_poplar"]), x, z, rng.range(0, 2 * PI), check=("solid",), layer="soft", margin=0.5)
            else:
                g.place("hedgerow", x, z, yaw, check=("solid",), margin=-0.6, loot=False)

    for i in range(n):
        for j in range(n):
            if i < n - 1:
                edge(V[i][j], V[i + 1][j])
            if j < n - 1:
                edge(V[i][j], V[i][j + 1])
    return fields


def nature(g, rng):
    forest = zone_by_id("forest")
    # Bois des Plumes: dense trees with clearings
    count = 0
    for _ in range(4200):
        if count >= 330:
            break
        x, z = rng.range(-366, -118), rng.range(118, 345)
        if not T.point_in_poly(x, z, forest["poly"]) or g.sd_at(x, z) < 6 or road_dist(x, z) < 3:
            continue
        if math.hypot(x + 230, z - 190) < 22 or math.hypot(x + 300, z - 290) < 16:
            continue                                             # two clearings
        prop = "tree_oak" if rng() < 0.78 else "tree_poplar"
        s = rng.range(0.85, 1.2)
        if g.place(prop, x, z, rng.range(0, 2 * PI), scale=s, check=("solid", "soft"), layer="soft", margin=2.6):
            count += 1
    for _ in range(170):
        x, z = rng.range(-366, -118), rng.range(118, 345)
        if T.point_in_poly(x, z, forest["poly"]):
            g.place(rng.pick(["bush_round", "bush_wide"]), x, z, rng.range(0, 2 * PI), check=("solid", "soft"), layer="soft", margin=0.3)
    for _ in range(40):
        x, z = rng.range(-366, -118), rng.range(118, 345)
        if T.point_in_poly(x, z, forest["poly"]):
            g.place(rng.pick(["rock_boulder", "rock_slab", "rock_spire"]), x, z, rng.range(0, 2 * PI), scale=rng.range(0.8, 1.6),
                    check=("solid", "soft"), margin=0.5, sink=0.2)
    # lone trees, bushes and rocks everywhere on land
    for _ in range(1500):
        x, z = rng.range(-400, 400), rng.range(-400, 400)
        zn = zone_at(x, z)
        if zn["id"] in ("beach", "forest") or g.sd_at(x, z) < 8 or T.river_info(x, z)[0] < 11:
            continue
        r = rng()
        if r < 0.18:
            g.place(rng.pick(["tree_oak", "tree_oak", "tree_poplar"]), x, z, rng.range(0, 2 * PI), scale=rng.range(0.85, 1.15),
                    check=("solid", "soft"), layer="soft", margin=1.5, avoid_roads=2.0)
        elif r < 0.45:
            g.place(rng.pick(["bush_round", "bush_wide"]), x, z, rng.range(0, 2 * PI), check=("solid", "soft"), layer="soft", margin=0.4, avoid_roads=1.0)
        elif r < 0.55:
            g.place(rng.pick(["rock_boulder", "rock_slab"]), x, z, rng.range(0, 2 * PI), scale=rng.range(0.7, 1.4),
                    check=("solid", "soft"), margin=0.4, avoid_roads=1.0, sink=0.2)
    # rocks along the cliffs and the shore
    for _ in range(500):
        x, z = rng.range(-410, 410), rng.range(-410, 410)
        sd = g.sd_at(x, z)
        if 1.5 < sd < 12 and zone_at(x, z)["id"] != "beach":
            g.place(rng.pick(["rock_boulder", "rock_spire", "rock_slab"]), x, z, rng.range(0, 2 * PI), scale=rng.range(0.9, 2.0),
                    check=("solid",), margin=0.3, sink=0.3)


def countryside_loot(g, rng):
    zn = COUNTRYSIDE
    got = 0
    for _ in range(600):
        if got >= 70:
            break
        x, z = rng.range(-390, 390), rng.range(-390, 390)
        if zone_at(x, z) is not zn or g.sd_at(x, z) < 10:
            continue
        if g.place(rng.pick(["crate_small", "crate_small", "ammo_box"]), x, z, rng.range(0, 2 * PI), check=("solid", "soft"), margin=0.5, zone=zn):
            got += 1


# ---------------------------------------------------------------- ground paint
def paint_ground(g, fields):
    w = T.CELLS + 1
    H = g.heights
    out = bytearray(w * w)
    beach_poly = zone_by_id("beach")["poly"]
    forest_poly = zone_by_id("forest")["poly"]
    orchard_poly = zone_by_id("orchard")["poly"]
    village_poly = zone_by_id("village")["poly"]
    cell_of = {}
    for f in fields:
        cell_of.setdefault((int((sum(p[0] for p in f["quad"]) / 4 + 400) // 54), int((sum(p[1] for p in f["quad"]) / 4 + 400) // 54)), []).append(f)
    for r in range(w):
        z = -T.HALF + r * T.CELL
        for c in range(w):
            x = -T.HALF + c * T.CELL
            h = H[r * w + c]
            sd = g.sds[r * w + c]
            hx = H[r * w + min(c + 1, w - 1)] - H[r * w + max(c - 1, 0)]
            hz = H[min(r + 1, w - 1) * w + c] - H[max(r - 1, 0) * w + c]
            slope = math.degrees(math.atan(math.hypot(hx, hz) / (2 * T.CELL)))
            dr, _ = T.river_info(x, z)
            rd = road_dist(x, z)
            if h < -0.5:
                v = G["seabed"]
            elif dr < T.RIVER_HALF_WIDTH + 3.5:
                v = G["river_mud"]
            elif slope > 33:
                v = G["rock"]
            elif (T.point_in_poly(x, z, beach_poly) and sd < 50) or (sd < 9 and h < 1.6):
                v = G["sand"]
            elif PLAZA[0] <= x <= PLAZA[2] and PLAZA[1] <= z <= PLAZA[3]:
                v = G["cobble"]
            elif rd < 1.0:
                v = G["cobble"] if T.point_in_poly(x, z, village_poly) else G["dirt_road"]
            elif T.point_in_poly(x, z, forest_poly):
                v = G["forest_floor"]
            elif T.point_in_poly(x, z, orchard_poly):
                v = G["orchard_grass"]
            else:
                v = G["grass"] if T.fbm(x * 0.03, z * 0.03, 99, 2) < 0.55 else G["grass_dark"]
                key = (int((x + 400) // 54), int((z + 400) // 54)) if zone_at(x, z)["id"] in ("countryside", "farm", "hamlet") else (-99, -99)
                for di in (-1, 0, 1):
                    for dj in (-1, 0, 1):
                        for f in cell_of.get((key[0] + di, key[1] + dj), ()):
                            if T.point_in_poly(x, z, f["quad"]):
                                if f["crop"] != "grass":
                                    v = G[f["crop"]]
                                break
            out[r * w + c] = v
    return out


# ---------------------------------------------------------------- output
def flight_paths():
    paths = []
    for k in range(8):
        a = math.radians(k * 45 + 22.5)
        d = (math.sin(a), math.cos(a))
        perp = (d[1], -d[0])
        off = ((k % 3) - 1) * 90.0
        cx, cz = perp[0] * off, perp[1] * off
        paths.append({"from": [round(cx - d[0] * 470, 1), round(cz - d[1] * 470, 1)],
                      "to": [round(cx + d[0] * 470, 1), round(cz + d[1] * 470, 1)]})
    return paths


CHUNK_GRID = 4
CHUNK_SIZE = T.SIZE / CHUNK_GRID          # 210 m
HEADER = "<4sHHhhHH"                      # magic, version, samples per side, origin x, origin z, cell size cm, extra


def chunk_of(x, z):
    cx = min(CHUNK_GRID - 1, max(0, int((x + T.HALF) // CHUNK_SIZE)))
    cz = min(CHUNK_GRID - 1, max(0, int((z + T.HALF) // CHUNK_SIZE)))
    return cz * CHUNK_GRID + cx


CIRCLE_PHASES = [
    {"phase": 0, "waitS": 90, "shrinkS": 0, "radius": 380, "dps": 0},
    {"phase": 1, "waitS": 90, "shrinkS": 60, "radius": 260, "dps": 1},
    {"phase": 2, "waitS": 60, "shrinkS": 45, "radius": 170, "dps": 2},
    {"phase": 3, "waitS": 50, "shrinkS": 40, "radius": 105, "dps": 4},
    {"phase": 4, "waitS": 40, "shrinkS": 30, "radius": 60, "dps": 7},
    {"phase": 5, "waitS": 30, "shrinkS": 25, "radius": 30, "dps": 11},
    {"phase": 6, "waitS": 20, "shrinkS": 20, "radius": 0, "dps": 18},
]


def write(g, fields, ground):
    os.makedirs(OUT, exist_ok=True)
    w = T.CELLS + 1
    with open(os.path.join(OUT, "map_v1_heights.bin"), "wb") as f:
        f.write(struct.pack(HEADER, b"QWHF", 1, w, int(-T.HALF), int(-T.HALF), int(T.CELL * 100), 100))
        f.write(struct.pack("<%dh" % (w * w), *[int(round(h * 100)) for h in g.heights]))
    with open(os.path.join(OUT, "map_v1_ground.bin"), "wb") as f:
        f.write(struct.pack(HEADER, b"QWGP", 1, w, int(-T.HALF), int(-T.HALF), int(T.CELL * 100), len(GROUND)))
        f.write(bytes(ground))
    # props sorted by type, then chunk, keeping placement order inside a chunk; plus an index
    order = {}
    for i, p in enumerate(g.props):
        p["chunk"] = chunk_of(p["x"], p["z"])
        order[id(p)] = i
    props = sorted(g.props, key=lambda p: (p["prop"], p["chunk"], order[id(p)]))
    index = {}
    for i, p in enumerate(props):
        e = index.setdefault(p["prop"], {"start": i, "count": 0, "chunks": {}})
        e["count"] += 1
        c = e["chunks"].setdefault(str(p["chunk"]), [i, 0])
        c[1] += 1
    loot = []
    for i, lp in enumerate(sorted(g.loot, key=lambda l: (chunk_of(l["x"], l["z"]), l["z"], l["x"]))):
        rec = {"id": i, "x": lp["x"], "y": lp["y"], "z": lp["z"], "tier": lp["tier"], "kind": lp["kind"], "zone": lp["zone"],
               "chunk": chunk_of(lp["x"], lp["z"])}
        if "container" in lp:
            rec["container"] = lp["container"]
        loot.append(rec)
    counts = {k: v["count"] for k, v in sorted(index.items())}
    river = [{"x": x, "z": z, "bed": round(b, 2), "water": round(b + T.WATER_DEPTH, 2)} for x, z, b in T.RIVER]
    doc = {
        "version": 2,
        "name": "Sainte-Canard",
        "seed": SEED,
        "size": T.SIZE,
        "seaLevel": 0,
        "coords": "x east, y up, z south (north is -z), meters, island centered at the origin. rotY: three.js yaw, "
                  "rotY 0 means the prop front (+Z in its GLB) faces +z (south). y is the prop origin height, already on the terrain.",
        "propsSource": "apps/client/public/models/props/<prop>.glb (LOD0..LOD2 child nodes), colliders in colliders.json, LOD distances and loot points in manifest.json",
        "terrain": {
            "cells": T.CELLS, "cellSize": T.CELL, "origin": [-T.HALF, -T.HALF],
            "heights": "map_v1_heights.bin",
            "heightsEncoding": "16-byte header <4sHHhhHH: 'QWHF', version 1, samples per side 211, origin x -420, origin z -420, cell size 400 cm, 100 units per meter; "
                               "then 211 x 211 int16 little endian centimeters, row-major, row along z (north to south), col along x (west to east)",
            "ground": "map_v1_ground.bin",
            "groundEncoding": "16-byte header <4sHHhhHH: 'QWGP', version 1, samples per side 211, origin x, origin z, cell size cm, legend length; then 211 x 211 uint8, same order as the heights",
            "headerBytes": 16,
            "groundLegend": GROUND,
            "min": round(min(g.heights), 2), "max": round(max(g.heights), 2),
            "coast": [[x, z, tag] for x, z, tag in T.COAST],
        },
        "chunks": {"grid": CHUNK_GRID, "size": CHUNK_SIZE, "origin": [-T.HALF, -T.HALF],
                   "id": "chunk = cz * 4 + cx, cx = floor((x + 420) / 210), cz = floor((z + 420) / 210), clamped to 0..3"},
        "water": {"sea": 0.0, "river": river, "riverHalfWidth": T.RIVER_HALF_WIDTH + 0.6, "note": "river water surface is bed + 0.6 m (wading)"},
        "roads": [{"id": r["id"], "width": r["width"], "pts": [list(p) for p in r["pts"]]} for r in ROADS],
        "plaza": list(PLAZA),
        "zones": [{"id": z["id"], "name": z["name"], "tier": z["tier"], "drop": z["drop"], "poly": [list(p) for p in z["poly"]]} for z in ZONES]
                 + [{"id": "countryside", "name": "Bocage", "tier": 1, "drop": "quiet", "poly": None}],
        "fields": [{"crop": f["crop"], "quad": [[round(a, 1), round(b, 1)] for a, b in f["quad"]]} for f in fields],
        "drop": {
            "plane": {"prop": "transport_plane", "altitude": 180, "speed": 55, "spinNodes": ["PropLeft", "PropRight"], "paths": flight_paths()},
            "pathRule": "pick one of the paths with the match seed (index = seed mod 8), or any straight line through the 300 m center disc",
            "jump": {"allowedOver": "land (terrain height above 1 m)", "autoJumpAtPathEnd": True},
            "glide": {"ratio": 3.0, "note": "about 500 m sideways from 180 m; tune in constants.ts"},
        },
        "groundSpawns": [list(s) for s in g.spawns],
        "groundSpawnsNote": "fallback spawn points on open land, at least 70 m apart: late joins, bot fill, tests without the plane",
        "circle": {"finalCandidates": FINAL_CIRCLES, "phases": CIRCLE_PHASES,
                   "rule": "pick the final circle from the weighted candidates first, then grow outward so every circle contains the next; keep at least 70 percent land inside each circle"},
        "lootKinds": {"building": "floor or furniture top inside a building", "container": "top of a crate or ammo box prop (open to spawn)",
                      "bunker": "inside a pillbox", "vehicle": "inside a landing craft", "trench": "trench floor", "ground": "open ground"},
        "loot": loot,
        "propIndex": index,
        "props": props,
        "stats": {"props": len(props), "byProp": counts, "loot": len(loot), "groundSpawns": len(g.spawns)},
    }
    path = os.path.join(OUT, "map_v1.json")
    with open(path, "w") as f:
        json.dump(doc, f, separators=(",", ":"))
    return path, doc


def main():
    g, fields, ground = generate()
    path, doc = write(g, fields, ground)
    st = doc["stats"]
    tiers = {}
    for lp in g.loot:
        tiers[lp["tier"]] = tiers.get(lp["tier"], 0) + 1
    zones = {}
    kinds = {}
    for lp in g.loot:
        zones[lp["zone"]] = zones.get(lp["zone"], 0) + 1
        kinds[lp["kind"]] = kinds.get(lp["kind"], 0) + 1
    print("LOOT_KINDS", dict(sorted(kinds.items())), "SPAWNS", len(g.spawns))
    print("MAP", path, os.path.getsize(path) // 1024, "KB")
    print("PROPS", st["props"], st["byProp"])
    print("LOOT", st["loot"], "by tier", dict(sorted(tiers.items())), "by zone", dict(sorted(zones.items())))
    print("HEIGHT", doc["terrain"]["min"], doc["terrain"]["max"])


if __name__ == "__main__":
    main()
