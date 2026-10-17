"""The ground layers, one function each. Every layer fills a 4 m tile: the ground
sheet (periodic height and color) plus scattered geometry, and returns its look
(height range for the height map, light strength, ambient occlusion).

Colors here set the pattern and its contrast; the game re-tints every layer to
its ground paint color (`GROUND_COLORS` in apps/client/src/world/sainte/terrain.ts),
so grass, dark grass and orchard grass share the grass layer.

Rows run along X (the image's horizontal) with an even count per tile, so the
game can shift the tile by half a tile across the rows without breaking them."""

import numpy as np

import pnoise as pn
from tile import TILE, blobs, boxes, ground_sheet, lin, palette, pick, scatter, stars, strips, vary


def _mix(a, b, t):
    t = np.asarray(t)[..., None]
    return a * (1 - t) + b * t


# ---------------------------------------------------------------- grass


def grass(acc, rng):
    soil_a, soil_b = lin("#3c6326"), lin("#557e2e")
    ground_sheet(acc, lambda x, y: np.zeros_like(x), lambda x, y: _mix(soil_a, soil_b, pn.fbm(x, y, 4, 11)))
    greens = palette(["#6fae3a", "#7dbb41", "#88c54a", "#5f9d33", "#97cf55", "#76b33e"])
    tip = lin("#c4e27a")
    # Clumps of blades leaning out from their center, plus loose blades between them.
    centers = scatter(rng, 330)
    per = rng.integers(16, 44, len(centers))
    ci = np.repeat(np.arange(len(centers)), per)
    n = len(ci)
    r = 0.11 * np.sqrt(rng.random(n))
    a = rng.uniform(0, 2 * np.pi, n)
    base = np.zeros((n, 3))
    base[:, 0] = centers[ci, 0] + np.cos(a) * r
    base[:, 1] = centers[ci, 1] + np.sin(a) * r
    azim = a + rng.normal(0, 0.55, n)
    clump_col = vary(rng, pick(rng, greens, len(centers)), 0.08)[ci]
    col_base = clump_col * 0.5
    col_tip = clump_col * 0.65 + tip * 0.35
    strips(acc, base, azim, rng.uniform(0.75, 1.3, n), rng.uniform(0.07, 0.17, n), rng.uniform(0.013, 0.024, n), col_base, col_tip)
    m = 2600
    base = np.zeros((m, 3))
    base[:, :2] = scatter(rng, m)
    col = vary(rng, pick(rng, greens, m), 0.1)
    strips(acc, base, rng.uniform(0, 2 * np.pi, m), rng.uniform(0.9, 1.4, m), rng.uniform(0.05, 0.11, m), rng.uniform(0.012, 0.02, m), col * 0.55, col * 0.75 + tip * 0.25)
    # A few small flowers on top.
    k = 26
    c = np.zeros((k, 3))
    c[:, :2] = scatter(rng, k)
    c[:, 2] = rng.uniform(0.06, 0.1, k)
    petals = palette(["#f6f3ea", "#f6f3ea", "#ffe066", "#f7c6d9"])
    stars(acc, c, rng.uniform(0.012, 0.018, k), pick(rng, petals, k), col_center=lin("#f2b630"), yaw=rng.uniform(0, 6.3, k))
    return {"hmax": 0.13, "light": 0.35, "ao": 0.06, "aoMin": 0.4}


# ---------------------------------------------------------------- forest floor


def forest(acc, rng):
    soil, moss_a, moss_b = lin("#4d4230"), lin("#4a6a27"), lin("#5f8231")

    def color(x, y):
        moss = pn.smoothstep(0.3, 0.46, pn.fbm(x, y, 5, 21))
        m = _mix(moss_a, moss_b, pn.fbm(x, y, 16, 22))
        return _mix(soil, m, moss)

    ground_sheet(acc, lambda x, y: 0.004 * pn.fbm(x, y, 8, 23), color)
    # Moss cushions.
    n = 260
    c = np.zeros((n, 3))
    c[:, :2] = scatter(rng, n)
    s = rng.uniform(0.03, 0.08, n)
    blobs(acc, rng, c, np.stack([s, s * rng.uniform(0.7, 1.0, n), s * 0.3], 1), vary(rng, pick(rng, palette(["#557a2c", "#4a6d27", "#648a35"]), n), 0.08), jitter=0.2)
    # Fallen leaves: flat pointed ovals, lying at slightly different heights.
    n = 420
    base = np.zeros((n, 3))
    base[:, :2] = scatter(rng, n)
    base[:, 2] = rng.uniform(0.004, 0.02, n)
    leaf = vary(rng, pick(rng, palette(["#8a6a35", "#a5793a", "#6d5a2e", "#b58a3e", "#7a7a34", "#9c5a2e", "#c0923f"]), n), 0.08)
    strips(acc, base, rng.uniform(0, 2 * np.pi, n), rng.uniform(1.45, 1.62, n), rng.uniform(0.045, 0.085, n), rng.uniform(0.025, 0.045, n), leaf * 0.85, leaf, profile=(0.35, 1.0, 0.75), bend=0.2)
    # Twigs.
    n = 34
    base = np.zeros((n, 3))
    base[:, :2] = scatter(rng, n)
    base[:, 2] = 0.012
    tw = vary(rng, np.repeat(lin("#5a4630")[None], n, 0), 0.12)
    strips(acc, base, rng.uniform(0, 2 * np.pi, n), np.full(n, 1.55), rng.uniform(0.12, 0.32, n), rng.uniform(0.008, 0.012, n), tw, tw * 1.1, profile=(1.0, 0.9, 0.8), bend=0.0)
    # Sparse dark grass tufts.
    centers = scatter(rng, 46)
    per = rng.integers(8, 20, len(centers))
    ci = np.repeat(np.arange(len(centers)), per)
    m = len(ci)
    a = rng.uniform(0, 2 * np.pi, m)
    r = 0.06 * np.sqrt(rng.random(m))
    base = np.zeros((m, 3))
    base[:, 0] = centers[ci, 0] + np.cos(a) * r
    base[:, 1] = centers[ci, 1] + np.sin(a) * r
    g = vary(rng, pick(rng, palette(["#4f7d2c", "#5b8a33", "#466f27"]), m), 0.08)
    strips(acc, base, a + rng.normal(0, 0.5, m), rng.uniform(0.6, 1.1, m), rng.uniform(0.06, 0.12, m), rng.uniform(0.012, 0.02, m), g * 0.55, g * 1.1)
    return {"hmax": 0.09, "light": 0.4, "ao": 0.05, "aoMin": 0.45}


# ---------------------------------------------------------------- dirt


def dirt(acc, rng):
    a, b, damp = lin("#8a6542"), lin("#a98256"), lin("#6f5035")

    def height(x, y):
        return 0.006 * pn.fbm(x, y, 16, 31)

    def color(x, y):
        c = _mix(a, b, pn.fbm(x, y, 4, 32))
        c = _mix(c, damp, 0.6 * pn.smoothstep(0.62, 0.8, pn.fbm(x, y, 6, 33)))
        return c * (0.92 + 0.16 * pn.fbm(x, y, 32, 34))[..., None]

    ground_sheet(acc, height, color)
    stones = palette(["#9b8a74", "#b3a38a", "#7d6c58", "#c2b49b", "#8c7a62", "#a39177"])
    for n, lo, hi in ((900, 0.007, 0.02), (90, 0.025, 0.055)):
        c = np.zeros((n, 3))
        c[:, :2] = scatter(rng, n)
        s = rng.uniform(lo, hi, n)
        c[:, 2] = s * 0.1
        blobs(acc, rng, c, np.stack([s, s * rng.uniform(0.6, 1.0, n), s * 0.55], 1), vary(rng, pick(rng, stones, n), 0.08), tilt=0.3, jitter=0.2)
    n = 1100
    c = np.zeros((n, 3))
    c[:, :2] = scatter(rng, n)
    s = rng.uniform(0.002, 0.0045, n)
    blobs(acc, rng, c, np.stack([s, s, s * 0.5], 1), vary(rng, pick(rng, palette(["#5e4630", "#c9b48f"]), n), 0.1), subdiv=1, jitter=0.1)
    return {"hmax": 0.045, "light": 0.55, "ao": 0.04, "aoMin": 0.45}


# ---------------------------------------------------------------- sand


def sand(acc, rng):
    a, b = lin("#e0cb93"), lin("#f2e3b6")

    def ripple(x, y):
        phase = 2 * np.pi * (y * 14 + 0.9 * pn.fbm(x, y, 3, 41) + 0.25 * np.sin(2 * np.pi * (x * 2 + y)))
        return np.sin(phase + 0.45 * np.sin(phase))

    ground_sheet(acc, lambda x, y: 0.008 * ripple(x, y) + 0.004 * pn.fbm(x, y, 8, 42), lambda x, y: _mix(a, b, pn.fbm(x, y, 4, 43)) * (0.97 + 0.05 * ripple(x, y))[..., None])
    n = 1500
    c = np.zeros((n, 3))
    c[:, :2] = scatter(rng, n)
    c[:, 2] = 0.006
    s = rng.uniform(0.002, 0.004, n)
    blobs(acc, rng, c, np.stack([s, s, s * 0.6], 1), vary(rng, pick(rng, palette(["#a58c5c", "#fff6dc", "#c28d55", "#8e8070"]), n), 0.1))
    k = 14
    c = np.zeros((k, 3))
    c[:, :2] = scatter(rng, k)
    c[:, 2] = 0.01
    stars(acc, c, rng.uniform(0.01, 0.017, k), pick(rng, palette(["#f4e6da", "#f0d2c2", "#fbf3e8"]), k), points=6, inner=0.75, yaw=rng.uniform(0, 6.3, k))
    n = 30
    c = np.zeros((n, 3))
    c[:, :2] = scatter(rng, n)
    s = rng.uniform(0.008, 0.02, n)
    c[:, 2] = 0.004
    blobs(acc, rng, c, np.stack([s, s * 0.8, s * 0.5], 1), vary(rng, pick(rng, palette(["#b9ad99", "#a2968a", "#d0c4ae"]), n), 0.06), tilt=0.3)
    return {"hmax": 0.03, "light": 0.7, "ao": 0.03, "aoMin": 0.6}


# ---------------------------------------------------------------- rock


def rock(acc, rng):
    ground_sheet(acc, lambda x, y: np.zeros_like(x), lambda x, y: _mix(lin("#57534d"), lin("#6b665e"), pn.fbm(x, y, 8, 51)))
    greys = palette(["#a29d92", "#958f84", "#b0aa9e", "#8a857b", "#9d9688", "#aaa294"])
    n = 46
    c = np.zeros((n, 3))
    c[:, :2] = scatter(rng, n)
    s = np.stack([rng.uniform(0.3, 0.62, n), rng.uniform(0.25, 0.5, n), rng.uniform(0.12, 0.22, n)], 1)
    c[:, 2] = -0.25 * s[:, 2]
    blobs(acc, rng, c, s, vary(rng, pick(rng, greys, n), 0.08), tilt=0.15, jitter=0.28, shade_bottom=0.15)
    n = 150
    c = np.zeros((n, 3))
    c[:, :2] = scatter(rng, n)
    s = rng.uniform(0.04, 0.12, n)
    c[:, 2] = -0.1 * s
    blobs(acc, rng, c, np.stack([s, s * rng.uniform(0.6, 1, n), s * 0.5], 1), vary(rng, pick(rng, greys, n), 0.1), tilt=0.3, jitter=0.25)
    n = 600
    c = np.zeros((n, 3))
    c[:, :2] = scatter(rng, n)
    s = rng.uniform(0.008, 0.025, n)
    blobs(acc, rng, c, np.stack([s, s, s * 0.6], 1), vary(rng, pick(rng, greys, n), 0.12), tilt=0.3)
    return {"hmax": 0.32, "light": 0.75, "ao": 0.25, "aoMin": 0.3}


# ---------------------------------------------------------------- cobble


COBBLE_ROWS = 16  # even, and the stones per row too, so a half-tile shift lands on the same grid


def cobble(acc, rng):
    ground_sheet(acc, lambda x, y: np.zeros_like(x), lambda x, y: _mix(lin("#706859"), lin("#857c6c"), pn.fbm(x, y, 8, 61)))
    pitch = TILE / COBBLE_ROWS
    rows, cols = np.meshgrid(np.arange(COBBLE_ROWS), np.arange(COBBLE_ROWS), indexing="ij")
    rows, cols = rows.ravel(), cols.ravel()
    n = len(rows)
    c = np.zeros((n, 3))
    c[:, 0] = (cols + 0.5 + 0.5 * (rows % 2)) * pitch + rng.uniform(-0.008, 0.008, n)
    c[:, 1] = (rows + 0.5) * pitch + rng.uniform(-0.008, 0.008, n)
    half = np.stack([(pitch - 0.034) / 2 + rng.uniform(-0.008, 0.006, n), (pitch - 0.034) / 2 + rng.uniform(-0.008, 0.006, n), rng.uniform(0.032, 0.042, n)], 1)
    stones = palette(["#b9ae9c", "#a99f8e", "#c4baa8", "#9f9585", "#b2a690", "#bdb19a"])
    boxes(acc, rng, c, half, vary(rng, pick(rng, stones, n), 0.05), rng.uniform(-0.09, 0.09, n), tilt=0.04, jitter=0.04, bevel=0.3)
    # Moss in some joints.
    m = 340
    base = np.zeros((m, 3))
    j = rng.integers(0, COBBLE_ROWS, m)
    base[:, 0] = rng.uniform(0, TILE, m)
    base[:, 1] = j * pitch + rng.normal(0, 0.004, m)
    g = vary(rng, pick(rng, palette(["#6f9a3a", "#5d8a30", "#7fa845"]), m), 0.08)
    strips(acc, base, rng.uniform(0, 2 * np.pi, m), rng.uniform(1.0, 1.4, m), rng.uniform(0.018, 0.04, m), rng.uniform(0.008, 0.014, m), g * 0.6, g)
    return {"hmax": 0.09, "light": 0.5, "ao": 0.04, "aoMin": 0.5}


# ---------------------------------------------------------------- plowed field


PLOW_ROWS = 8


def _wobble(x):
    return pn.wave(x, [(1, 0.07, 1.3), (3, 0.035, 0.4), (7, 0.012, 2.1)])


def _row_positions(rng, spacing):
    """Plants along one row: an even spacing that fits the tile, jittered, with a random start."""
    n = int(round(TILE / spacing))
    step = TILE / n
    return ((np.arange(n) + rng.uniform(-0.3, 0.3, n)) * step + rng.uniform(0, step)) % TILE


def _ridge(x, y, rows):
    yl = y * rows + _wobble(x)
    r = 0.5 + 0.5 * np.cos(2 * np.pi * yl)
    return r ** 1.6


def plowed(acc, rng):
    trough, top = lin("#5e4229"), lin("#a07850")

    def height(x, y):
        return 0.09 * _ridge(x, y, PLOW_ROWS) + 0.008 * pn.fbm(x, y, 16, 71)

    def color(x, y):
        c = _mix(trough, top, _ridge(x, y, PLOW_ROWS))
        return c * (0.9 + 0.2 * pn.fbm(x, y, 8, 72))[..., None]

    ground_sheet(acc, height, color)
    # Clods on the ridge tops.
    n = 900
    x = rng.uniform(0, TILE, n)
    k = rng.integers(0, PLOW_ROWS, n)
    y = ((k - _wobble(x / TILE) + rng.normal(0, 0.1, n)) / PLOW_ROWS) % 1.0 * TILE
    s = rng.uniform(0.01, 0.035, n)
    c = np.stack([x, y, height(x / TILE, y / TILE) - 0.2 * s], 1)
    clods = palette(["#8a6644", "#a37a52", "#7a5a3c", "#b08860", "#94704a"])
    blobs(acc, rng, c, np.stack([s, s * rng.uniform(0.7, 1, n), s * 0.7], 1), vary(rng, pick(rng, clods, n), 0.08), tilt=0.4, jitter=0.3)
    # Straw left from the last harvest.
    m = 70
    base = np.zeros((m, 3))
    base[:, :2] = scatter(rng, m)
    base[:, 2] = height(base[:, 0] / TILE, base[:, 1] / TILE) + 0.004
    st = vary(rng, np.repeat(lin("#c9a85a")[None], m, 0), 0.12)
    strips(acc, base, rng.uniform(0, 2 * np.pi, m), np.full(m, 1.5), rng.uniform(0.04, 0.09, m), np.full(m, 0.006), st, st * 1.1, profile=(1, 1, 1), bend=0.0)
    return {"hmax": 0.13, "light": 0.65, "ao": 0.08, "aoMin": 0.45}


# ---------------------------------------------------------------- wheat


WHEAT_ROWS = 20


def wheat(acc, rng):
    ground_sheet(acc, lambda x, y: 0.03 * _ridge(x, y, WHEAT_ROWS), lambda x, y: _mix(lin("#6b5230"), lin("#8d6d3f"), pn.fbm(x, y, 8, 81)))
    pitch = TILE / WHEAT_ROWS
    xs, ys = [], []
    for k in range(WHEAT_ROWS):
        x = _row_positions(rng, 0.036)
        xs.append(x)
        ys.append((k + 0.5) * pitch - _wobble(x / TILE) * pitch + rng.normal(0, 0.018, len(x)))
    x = np.concatenate(xs)
    y = np.concatenate(ys) % TILE
    n = len(x)
    base = np.stack([x, y, np.zeros(n)], 1)
    # Stalks lean with the wind (+X) and a little at random.
    azim = rng.normal(0.35, 0.7, n)
    lean = rng.uniform(0.25, 0.65, n)
    length = rng.uniform(0.5, 0.72, n)
    stalk = vary(rng, np.repeat(lin("#b49a4f")[None], n, 0), 0.08)
    center = strips(acc, base, azim, lean, length, np.full(n, 0.007), stalk * 0.6, stalk, profile=(1, 1, 1), bend=0.5)
    # Leaves low on the stalk.
    m = n // 2
    lb = base[:m].copy()
    lb[:, 2] = rng.uniform(0.1, 0.3, m)
    lb[:, 0] += np.cos(azim[:m]) * lb[:, 2] * np.tan(lean[:m] * 0.4)
    lb[:, 1] += np.sin(azim[:m]) * lb[:, 2] * np.tan(lean[:m] * 0.4)
    leaf = vary(rng, pick(rng, palette(["#b6ae55", "#c5b35a", "#a8a24c"]), m), 0.08)
    strips(acc, lb, rng.uniform(0, 2 * np.pi, m), rng.uniform(0.9, 1.3, m), rng.uniform(0.14, 0.24, m), rng.uniform(0.012, 0.02, m), leaf * 0.7, leaf, profile=(1.0, 0.8, 0.5))
    # Heads at the top of each stalk, along the stalk's last segment.
    d = center[:, 3] - center[:, 2]
    d /= np.linalg.norm(d, axis=1, keepdims=True)
    e1 = d
    e2 = np.cross(np.array([0, 0, 1.0]), e1)
    e2 /= np.maximum(np.linalg.norm(e2, axis=1, keepdims=True), 1e-6)
    e3 = np.cross(e1, e2)
    basis = np.stack([e2, e3, e1], axis=2)
    hl = rng.uniform(0.055, 0.08, n)
    hr = rng.uniform(0.017, 0.021, n)
    hc = center[:, 3] + d * hl[:, None] * 0.8
    heads = vary(rng, pick(rng, palette(["#e9c75c", "#f0d06a", "#dfb94e", "#e6c25a", "#f4da7e", "#d9b04a"]), n), 0.06)
    blobs(acc, rng, hc, np.stack([hr, hr, hl], 1), heads, basis=basis, jitter=0.12, shade_bottom=0.3)
    return {"hmax": 0.8, "light": 0.35, "ao": 0.12, "aoMin": 0.35}


# ---------------------------------------------------------------- green crop


CROP_ROWS = 8


def crop(acc, rng):
    trough, top = lin("#7f5e3c"), lin("#9c7650")
    ground_sheet(acc, lambda x, y: 0.06 * _ridge(x, y, CROP_ROWS), lambda x, y: _mix(trough, top, _ridge(x, y, CROP_ROWS)) * (0.92 + 0.16 * pn.fbm(x, y, 8, 91))[..., None])
    pitch = TILE / CROP_ROWS
    xs, ys = [], []
    for k in range(CROP_ROWS):
        x = _row_positions(rng, 0.235)
        xs.append(x)
        ys.append(k * pitch - _wobble(x / TILE) * pitch + rng.normal(0, 0.015, len(x)))
    px = np.concatenate(xs)
    py = np.concatenate(ys) % TILE
    plants = len(px)
    greens = palette(["#7fb640", "#8cc24a", "#6fa83a", "#99cc55", "#86bd45"])
    pc = vary(rng, pick(rng, greens, plants), 0.06)
    size = rng.uniform(0.8, 1.15, plants)
    for count, lo, hi, ln, wd, dark in ((7, 1.15, 1.5, 0.17, 0.075, 0.6), (4, 0.55, 0.85, 0.1, 0.05, 0.8)):
        pi = np.repeat(np.arange(plants), count)
        k = np.tile(np.arange(count), plants)
        azim = k * (2 * np.pi / count) + rng.uniform(0, 2 * np.pi, plants)[pi] + rng.normal(0, 0.2, len(pi))
        base = np.stack([px[pi], py[pi], np.full(len(pi), 0.05)], 1)
        col = pc[pi] * rng.uniform(0.92, 1.08, (len(pi), 1))
        strips(acc, base, azim, rng.uniform(lo, hi, len(pi)), ln * size[pi] * rng.uniform(0.85, 1.15, len(pi)), wd * size[pi], col * dark, col * 1.12, profile=(0.45, 1.0, 0.85), bend=0.5)
    return {"hmax": 0.26, "light": 0.45, "ao": 0.06, "aoMin": 0.4}


# Order is the texture array layer order the game reads (ground.json lists it too).
# `shift`: anti-tiling by a half-tile shift only (rows, cobbles); otherwise rotate and scale.
LAYERS = [
    ("grass", grass, 1, False),
    ("forest", forest, 2, False),
    ("dirt", dirt, 3, False),
    ("sand", sand, 4, False),
    ("rock", rock, 5, False),
    ("cobble", cobble, 6, True),
    ("plowed", plowed, 7, True),
    ("wheat", wheat, 8, True),
    ("crop", crop, 9, True),
]
