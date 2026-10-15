"""Heightfield intent for the Sainte-Canard island, as code.

Coordinates match the game (packages/shared/src/map.ts): x east, y up, z south, meters, island centered
at the origin, sea surface y = 0. North is -z. The grid is 211 x 211 samples, 4 m apart, from -420 to 420.

The coastline is a hand-drawn polygon. Each coast edge has a profile tag:
  shore: gentle sand or grass shore, beach: the landing beach (long shallow water, sand flat, bluff),
  cliff: sheer drop from the plateau straight into deep water.
Inland height is rolling bocage country (about 8 m) plus designed features: the Pointe du Bec headland
plateau (19 m), Feather Ridge (crest about 24 m), the south-west forest hills, and the river valley.
"""

import math

SIZE = 840
CELLS = 210
CELL = 4.0
HALF = SIZE / 2
SEA_FLOOR = -4.0

# (x, z, tag of the edge that starts at this point)
COAST = [
    (-160, -345, "beach"), (230, -345, "shore"), (262, -352, "shore"), (300, -330, "shore"),
    (342, -282, "cliff"), (372, -200, "cliff"), (384, -100, "cliff"), (388, 0, "cliff"), (382, 120, "shore"),
    (366, 222, "shore"), (330, 302, "shore"), (268, 356, "shore"), (190, 382, "shore"), (90, 388, "shore"),
    (0, 382, "shore"), (-92, 388, "shore"), (-192, 376, "shore"), (-282, 346, "shore"), (-346, 290, "shore"),
    (-376, 200, "shore"), (-386, 100, "shore"), (-382, 0, "shore"), (-382, -100, "cliff"), (-398, -200, "cliff"),
    (-406, -300, "cliff"), (-372, -366, "cliff"), (-300, -400, "cliff"), (-220, -388, "cliff"), (-176, -360, "shore"),
]

# River La Mare: (x, z, bed height). Flows north into the sea east of the beach.
RIVER = [(142, 318, 6.0), (158, 252, 5.2), (184, 160, 4.4), (204, 62, 3.8), (210, -40, 3.2), (198, -132, 2.4),
         (214, -230, 1.2), (244, -322, -0.6), (258, -372, -2.5)]
RIVER_HALF_WIDTH = 6.0      # flat bed half width
RIVER_BANK = 3.0            # bank top above the bed at RIVER_HALF_WIDTH + 3 m
WATER_DEPTH = 0.6           # water surface above the bed (wading)


# ---------------------------------------------------------------- noise
def _hash(ix, iz, seed):
    h = (ix * 374761393 + iz * 668265263 + seed * 2246822519) & 0xFFFFFFFF
    h = ((h ^ (h >> 13)) * 1274126177) & 0xFFFFFFFF
    h ^= h >> 16
    return (h & 0xFFFFFF) / 16777216.0


def value_noise(x, z, seed):
    ix, iz = math.floor(x), math.floor(z)
    fx, fz = x - ix, z - iz
    ux, uz = fx * fx * (3 - 2 * fx), fz * fz * (3 - 2 * fz)
    a = _hash(ix, iz, seed)
    b = _hash(ix + 1, iz, seed)
    c = _hash(ix, iz + 1, seed)
    d = _hash(ix + 1, iz + 1, seed)
    return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz


def fbm(x, z, seed, octaves=4):
    s, amp, norm = 0.0, 1.0, 0.0
    for o in range(octaves):
        s += value_noise(x, z, seed + o * 31) * amp
        norm += amp
        x, z, amp = x * 2.03, z * 2.03, amp * 0.5
    return s / norm


def smoothstep(e0, e1, x):
    if e0 == e1:
        return 0.0 if x < e0 else 1.0
    t = max(0.0, min(1.0, (x - e0) / (e1 - e0)))
    return t * t * (3 - 2 * t)


def lerp(a, b, t):
    return a + (b - a) * t


# ---------------------------------------------------------------- geometry helpers
def seg_dist(px, pz, ax, az, bx, bz):
    """Distance from p to segment ab and the segment parameter t."""
    dx, dz = bx - ax, bz - az
    L2 = dx * dx + dz * dz
    t = 0.0 if L2 == 0 else max(0.0, min(1.0, ((px - ax) * dx + (pz - az) * dz) / L2))
    qx, qz = ax + dx * t, az + dz * t
    return math.hypot(px - qx, pz - qz), t


def point_in_poly(px, pz, poly):
    inside = False
    n = len(poly)
    for i in range(n):
        ax, az = poly[i][0], poly[i][1]
        bx, bz = poly[(i + 1) % n][0], poly[(i + 1) % n][1]
        if (az > pz) != (bz > pz):
            x = ax + (pz - az) * (bx - ax) / (bz - az)
            if px < x:
                inside = not inside
    return inside


def coast_info(x, z):
    """Signed distance to the coast (positive on land) and per-tag nearest edge distances."""
    best = {"shore": 1e9, "beach": 1e9, "cliff": 1e9}
    dmin = 1e9
    n = len(COAST)
    for i in range(n):
        ax, az, tag = COAST[i]
        bx, bz, _ = COAST[(i + 1) % n]
        d, _ = seg_dist(x, z, ax, az, bx, bz)
        dmin = min(dmin, d)
        best[tag] = min(best[tag], d)
    inside = point_in_poly(x, z, COAST)
    return (dmin if inside else -dmin), best


def river_info(x, z):
    """Distance to the river centerline and the bed height at the nearest point."""
    best, bed = 1e9, 0.0
    for (ax, az, ha), (bx, bz, hb) in zip(RIVER, RIVER[1:]):
        d, t = seg_dist(x, z, ax, az, bx, bz)
        if d < best:
            best, bed = d, ha + (hb - ha) * t
    return best, bed


# ---------------------------------------------------------------- the height function
def inland_height(x, z, seed):
    h = 8.0 + 4.4 * (fbm(x * 0.007 + 13.1, z * 0.007 - 7.7, seed) - 0.5)
    # Pointe du Bec headland plateau (north-west)
    w = smoothstep(-150, -235, x) * smoothstep(-150, -230, z)
    h = lerp(h, 19.0 + 1.5 * (fbm(x * 0.02, z * 0.02, seed + 5) - 0.5), w)
    # Feather Ridge (east): north-south crest at x = 282
    ridge = 16.0 * math.exp(-((x - 282.0) / 44.0) ** 2) * smoothstep(-175, -105, z) * smoothstep(215, 150, z)
    h += ridge
    # south-west forest hills
    h += 6.5 * math.exp(-((x + 255.0) ** 2 + (z - 235.0) ** 2) / (115.0 ** 2))
    # a gentle swell under the orchard so it reads from the crossroads
    h += 2.5 * math.exp(-((x - 30.0) ** 2 + (z - 235.0) ** 2) / (90.0 ** 2))
    return h


def raw_height(x, z, seed):
    sd, near = coast_info(x, z)
    # coast noise: wobble the signed distance except along the beach
    beach_w = 1.0 / (1.0 + (near["beach"] / 40.0) ** 3)
    sd += (1.0 - beach_w) * 9.0 * (fbm(x * 0.02 + 3.0, z * 0.02 - 4.0, seed + 11, 3) - 0.5)
    H = inland_height(x, z, seed)

    def shore(sd):
        if sd < 0:
            return -0.3 - 3.7 * smoothstep(0, 28, -sd)
        return lerp(0.5, H, smoothstep(0, 48, sd))

    def beach(sd):
        if sd < 0:
            return -0.25 - 3.75 * smoothstep(0, 75, -sd)
        if sd < 45:
            return sd * 0.05
        return lerp(2.25, H, smoothstep(45, 64, sd))

    def cliff(sd):
        if sd < 0:
            return SEA_FLOOR - 2.0 * smoothstep(0, 20, -sd)
        return H

    ws = {k: 1.0 / (max(d, 0.5) ** 3) for k, d in near.items()}
    tot = sum(ws.values())
    h = (ws["shore"] * shore(sd) + ws["beach"] * beach(sd) + ws["cliff"] * cliff(sd)) / tot
    # river valley and channel
    d, bed = river_info(x, z)
    if d < 60:
        if d <= RIVER_HALF_WIDTH:
            carved = bed
        elif d <= RIVER_HALF_WIDTH + 3.0:
            carved = bed + (d - RIVER_HALF_WIDTH) / 3.0 * RIVER_BANK
        else:
            carved = bed + RIVER_BANK + (d - RIVER_HALF_WIDTH - 3.0) * 0.32
        h = min(h, carved)
    return h, sd


def sample_grid(seed):
    w = CELLS + 1
    heights = [0.0] * (w * w)
    sds = [0.0] * (w * w)
    for r in range(w):
        z = -HALF + r * CELL
        for c in range(w):
            x = -HALF + c * CELL
            h, sd = raw_height(x, z, seed)
            heights[r * w + c] = h
            sds[r * w + c] = sd
    return heights, sds


def height_at(heights, x, z):
    """Same bilinear-triangle lookup as terrainHeightAt in packages/shared/src/map.ts."""
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
