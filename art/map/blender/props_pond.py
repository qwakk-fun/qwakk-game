"""Props around Pond Keep (art/map/layout/gen_pond.py): the reed beds that keep ducks out of the moat, the hunters'
raft lanes across it and their beached rafts, the trench dugouts, the hunters' watchtowers, hay bales and a hay cart.

Blender space: meters, Z up, the front faces -Y, origin on the ground. See kit.py for the builder.
"""

import math

from castle import flight
from furniture import hay_bale
from kit import Prop, Rng
from props_military import sandbag_run


# ---------------------------------------------------------------- reed bed (the moat barrier)
REED_LEN = 4.0
REED_TOP = 1.9          # collider top above the bank: no duck jumps it (jump 1.09 m)


def moat_reeds(lod=0):
    """A 4 m strip of reeds and cattails along X on the moat bank. One `fence` box (4.4 m long, 0.7 m deep,
    1.9 m tall): it stops ducks and hunters, bullets and sight pass. Placed edge to edge along both banks, so no
    duck can walk or jump into the water except over the drawbridge and the raft lanes."""
    p = Prop("moat_reeds", "foliage")
    rng = Rng(131)
    p.col_boxmm("fence", (-REED_LEN / 2 - 0.2, -0.35, -0.45), (REED_LEN / 2 + 0.2, 0.35, REED_TOP))
    if lod > 0:
        for k in range(3):
            x = -1.35 + k * 1.35
            p.cyl(0.55, 1.7 + 0.15 * (k % 2), (x, 0, 0.85), "leaf" if k % 2 else "poplar", segs=5, r2=0.12)
        return p
    greens = ("leaf", "poplar", "leaf_dark", "hedge", "leaf_light")
    n_clumps = 13
    for c in range(n_clumps):
        cx = -REED_LEN / 2 + 0.15 + (REED_LEN - 0.3) * (c + rng.range(0.1, 0.9)) / n_clumps
        cy = rng.range(-0.25, 0.25)
        for b in range(5):
            a = rng.range(0, 2 * math.pi)
            h = rng.range(1.25, 2.05)
            lean = (math.cos(a) * rng.range(0.1, 0.35), math.sin(a) * rng.range(0.1, 0.35))
            w = rng.range(0.07, 0.12)
            bx, by = cx + math.cos(a) * 0.06, cy + math.sin(a) * 0.06
            ux, uy = -math.sin(a) * w, math.cos(a) * w
            p.quad([(bx - ux, by - uy, -0.05), (bx + ux, by + uy, -0.05), (bx + lean[0] + ux * 0.15, by + lean[1] + uy * 0.15, h),
                    (bx + lean[0] - ux * 0.15, by + lean[1] - uy * 0.15, h)], greens[(c + b) % len(greens)])
        if c % 2 == 0:
            h = rng.range(1.4, 1.9)
            tx, ty = cx + rng.range(-0.1, 0.1), cy + rng.range(-0.1, 0.1)
            p.tube((cx, cy, 0.0), (tx, ty, h), 0.018, "leaf_dark", segs=4)
            p.cyl(0.05, 0.28, (tx, ty, h - 0.2), "trunk_dark", segs=5, r2=0.045)
    # a low tussock base so the stems do not float
    for k in range(4):
        p.sphere((0.6, 0.35, 0.18), (-1.5 + k, rng.range(-0.1, 0.1), 0.02), "grass_dark", segs=6, rings=3, smooth=True)
    p.meta["note"] = "moat bank reeds: fence collider 4.4 x 0.7 x 1.9 m (blocks movement only), placed edge to edge"
    return p


# ---------------------------------------------------------------- raft lane
LANE_HALF = 1.5         # walkable half width
DECK = 0.45             # deck top over the water
BANK = 1.0              # bank height over the water
DECK_END = 5.6          # the floating deck runs |y| <= 5.6, gangplanks climb to the banks at |y| = 7.4
RAMP_END = 7.4


def raft_lane():
    """Three log rafts lashed end to end across the 14 m moat, gangplanks up to both banks, rope lines on tall
    poles along both sides. Origin: the middle of the crossing at the water surface (place it at y = 0 when the
    water is at 0); the lane runs along Y. Colliders: the deck (`floor`), the gangplanks (`ramp`, 18 degrees),
    the rope lines (`fence`, 2.4 m: nobody steps off into the water)."""
    p = Prop("raft_lane", "landmark")
    rng = Rng(151)
    for k, yc in enumerate((-3.75, 0.0, 3.75)):
        n = 7
        for i in range(n):
            x = -LANE_HALF + 0.21 + i * (2 * LANE_HALF - 0.42) / (n - 1)
            p.tube((x, yc - 1.8 + rng.range(-0.08, 0.08), 0.23), (x, yc + 1.8 + rng.range(-0.08, 0.08), 0.23), 0.22,
                   "trunk" if (i + k) % 3 else "wood", segs=6, smooth=True)
        for y in (yc - 1.4, yc + 1.4):
            p.boxmm((-LANE_HALF - 0.05, y - 0.08, 0.3), (LANE_HALF + 0.05, y + 0.08, 0.47), "hay_dark", bottom=True)
    p.col_boxmm("floor", (-LANE_HALF, -DECK_END, -0.5), (LANE_HALF, DECK_END, DECK))
    for s in (-1, 1):
        y0, y1 = s * DECK_END, s * RAMP_END
        pts = []
        for x in (-LANE_HALF, LANE_HALF):
            pts += [(x, y0, DECK), (x, y1, BANK + 0.05), (x, y0, -0.5), (x, y1 + s * 0.6, -0.5), (x, y1 + s * 0.6, BANK + 0.05)]
        p.col_hull("ramp", pts)
        # gangplank boards (mesh)
        n = 7
        for i in range(n):
            t0, t1 = i / n, (i + 1) / n
            ya, yb = y0 + (y1 - y0) * t0, y0 + (y1 - y0) * t1
            za, zb = DECK + (BANK + 0.05 - DECK) * t0, DECK + (BANK + 0.05 - DECK) * t1
            ang = math.degrees(math.atan2(zb - za, abs(yb - ya))) * (1 if s > 0 else -1)
            p.box((2 * LANE_HALF - 0.1, abs(yb - ya) - 0.03, 0.08), (0, (ya + yb) / 2, (za + zb) / 2 - 0.04), "wood_light" if i % 2 else "plank_grey",
                  rot=(ang, 0, 0), bottom=True)
        p.box((2 * LANE_HALF + 0.2, 0.6, 0.3), (0, y1 + s * 0.3, BANK - 0.1), "wood_dark", bottom=True)
    # rope lines on poles
    for s in (-1, 1):
        x0, x1 = sorted((s * LANE_HALF, s * (LANE_HALF + 0.2)))
        p.col_boxmm("fence", (x0, -RAMP_END - 0.8, 0.0), (x1, RAMP_END + 0.8, 2.4))
        ys = [-RAMP_END - 0.7 + k * (2 * RAMP_END + 1.4) / 8 for k in range(9)]
        for y in ys:
            z0 = -0.6 if abs(y) < DECK_END else BANK - 0.5
            p.cyl(0.08, 2.4 - z0, (s * (LANE_HALF + 0.1), y, (2.4 + z0) / 2), "timber", segs=6)
            p.sphere(0.1, (s * (LANE_HALF + 0.1), y, 2.42), "wood_dark", segs=6, rings=3, smooth=False)
        for z in (1.05, 1.75, 2.3):
            for ya, yb in zip(ys, ys[1:]):
                za = z if abs(ya) < DECK_END else z + 0.3
                zb = z if abs(yb) < DECK_END else z + 0.3
                p.tube((s * (LANE_HALF + 0.1), ya, za), (s * (LANE_HALF + 0.1), yb, zb - 0.05), 0.022, "hay_dark", segs=4)
    # a hunter's pennant on the outer end pole (orange, the hunters' color)
    p.add([(LANE_HALF + 0.1, -RAMP_END - 0.7, 2.4), (LANE_HALF + 0.1, -RAMP_END - 0.7 + 0.9, 2.15), (LANE_HALF + 0.1, -RAMP_END - 0.7, 1.9)],
          [(0, 1, 2), (2, 1, 0)], "orange", closed=False)
    p.meta["anchors"] = {"from": (0.0, -RAMP_END - 1.2, BANK), "to": (0.0, RAMP_END + 1.2, BANK)}
    p.meta["walk"] = [[(0.0, -RAMP_END - 1.4, BANK), (0.0, -RAMP_END + 0.4, BANK), (0.0, 0.0, DECK), (0.0, RAMP_END - 0.4, BANK),
                       (0.0, RAMP_END + 1.4, BANK)]]
    p.meta["note"] = "hunters' raft lane over the moat: 3 m deck at 0.45 m, gangplanks to the banks, 2.4 m rope fences; origin at the water"
    return p


def raft():
    """A beached log raft with a pole and a paddle, decoration and low cover on the outer bank."""
    p = Prop("raft", "cover")
    rng = Rng(157)
    for i in range(6):
        x = -1.25 + i * 0.5
        p.tube((x, -1.75 + rng.range(-0.1, 0.1), 0.2), (x, 1.75 + rng.range(-0.1, 0.1), 0.2), 0.2, "trunk" if i % 2 else "wood", segs=6, smooth=True)
    for y in (-1.3, 1.3):
        p.boxmm((-1.5, y - 0.07, 0.3), (1.5, y + 0.07, 0.43), "hay_dark", bottom=True)
    p.tube((-0.9, -1.6, 0.45), (1.0, 1.9, 0.5), 0.05, "wood_light", segs=5)
    p.box((0.32, 0.6, 0.05), (1.05, 2.05, 0.5), "wood_light", rot=(0, 0, 30), bottom=True)
    p.col_boxmm("cover", (-1.45, -1.85, 0.0), (1.45, 1.85, 0.42))
    p.meta["note"] = "beached raft, low cover"
    return p


# ---------------------------------------------------------------- trench dugout
def trench_dugout():
    """A WWI dugout: a low earth mound behind a sandbagged front, a timber-framed doorway into the dark (a facade:
    the hunters 'come out' of it), a log roof edge, a lantern and an ammo box. The front (-Y) faces the castle."""
    p = Prop("trench_dugout", "cover")
    rng = Rng(163)
    W, D, Hh = 3.4, 2.8, 1.85
    p.hull([(-W, -D + 0.6, 0), (W, -D + 0.6, 0), (-W, D, 0), (W, D, 0), (-W + 1.6, -D + 0.6, Hh), (W - 1.6, -D + 0.6, Hh),
            (-W + 1.6, D - 1.6, Hh), (W - 1.6, D - 1.6, Hh)], "earth", col="block",
           cells_fn=lambda c, n: "grass_dark" if n.z > 0.85 else ("earth_dark" if n.y > 0.3 else "earth"))
    # the sandbagged front wall with the doorway
    with p.frame((-W + 0.1, -D + 0.6, 0)):
        sandbag_run(p, W - 0.9 - 0.1, 7, rng)
    with p.frame((0.8, -D + 0.6, 0)):
        sandbag_run(p, W - 0.9, 7, rng)
    p.col_boxmm("cover", (-W + 0.1, -D + 0.39, 0), (-0.8, -D + 0.81, 1.65))
    p.col_boxmm("cover", (0.8, -D + 0.39, 0), (W, -D + 0.81, 1.65))
    p.boxmm((-0.8, -D + 0.75, 0.0), (0.8, -D + 1.1, 1.75), "dark", col="wall")
    for s in (-1, 1):
        p.box((0.22, 0.22, 1.95), (s * 0.85, -D + 0.6, 0.97), "timber", bottom=True)
    p.box((2.3, 0.26, 0.26), (0, -D + 0.6, 1.95), "timber", bottom=True)
    # log roof edge and corrugated iron
    for k in range(6):
        y = -D + 0.85 + k * 0.42
        p.tube((-W + 1.2, y, Hh + 0.12), (W - 1.2, y, Hh + 0.12), 0.13, "trunk" if k % 2 else "wood_dark", segs=6)
    p.box((2.6, 1.6, 0.05), (0.4, 0.2, Hh + 0.3), "rust", rot=(4, 0, 6), bottom=True)
    # props at the door (mesh only, small)
    p.boxmm((-1.45, -D - 0.1, 0.0), (-0.95, -D + 0.25, 0.32), "olive", bottom=True)
    p.boxmm((1.0, -D - 0.2, 0.0), (1.45, -D + 0.25, 0.85), "wood_dark", bottom=True)
    p.boxmm((0.95, -D - 0.25, 0.85), (1.5, -D + 0.3, 0.9), "wood", bottom=True)
    p.box((0.16, 0.16, 0.24), (1.2, -D - 0.0, 1.02), "lamp_glass", bottom=True)
    p.box((0.95, 0.06, 0.4), (-1.6, -D + 0.32, 1.25), "plank_grey", rot=(0, 6, 0), bottom=True)
    for k in range(4):
        p.tube((W - 0.6 + k * 0.12, -D + 0.8, 0.0), (W - 0.75 + k * 0.15, -D + 0.6, 1.2), 0.04, "wood_light", segs=4)
    p.meta["anchors"] = {"exit": (0.0, -D - 1.8, 0.0)}
    p.meta["note"] = "WWI dugout facade with a sandbagged front; hunters spawn at the anchor 'exit' in front of the doorway"
    return p


# ---------------------------------------------------------------- hunters' watchtower
WT = 2.2                # platform half size
WT_Z = 5.0              # platform top


def hunter_watchtower():
    """A hunters' wooden watchtower: a 4.4 m platform 5 m up on log legs, plank walls (cover, 1 m) with branches
    for camouflage, a roof on posts, and two flights of wooden stairs (back, then right side) that ducks and the
    navmesh can climb. The front (-Y) faces the castle; the sniper perch is the platform middle."""
    p = Prop("hunter_watchtower", "landmark")
    rng = Rng(167)
    for sx in (-1, 1):
        for sy in (-1, 1):
            p.cyl(0.18, WT_Z, (sx * (WT - 0.2), sy * (WT - 0.2), WT_Z / 2), "trunk", segs=7, col="block")
            p.cyl(0.11, 2.25, (sx * (WT - 0.15), sy * (WT - 0.15), WT_Z + 1.125), "trunk", segs=6, col="block")
    for sx in (-1, 1):
        p.tube((sx * (WT - 0.2), -WT + 0.2, 0.4), (sx * (WT - 0.2), WT - 0.2, WT_Z - 0.6), 0.07, "wood_dark", segs=5)
    for sy in (-1, 1):
        p.tube((-WT + 0.2, sy * (WT - 0.2), 0.4), (WT - 0.2, sy * (WT - 0.2), WT_Z - 0.6), 0.07, "wood_dark", segs=5)
    p.boxmm((-WT, -WT, WT_Z - 0.25), (WT, WT, WT_Z), "wood_dark", col="floor", top="wood")
    # stairs: back flight (along +X), landing, right flight (along -Y) to a top landing beside the platform
    flight(p, "x", (WT + 0.2, WT + 1.5), -2.0, 1, 0.0, 2.5, 12, 0.3, riser="wood_dark", tread="wood_light", floating=True)
    p.boxmm((1.6, WT + 0.2, 0.0), (WT + 1.5, WT + 1.5, 2.5), "wood_dark", col="floor", top="wood_light")
    flight(p, "y", (WT + 0.2, WT + 1.5), WT + 0.2, -1, 2.5, WT_Z - 2.5, 12, 0.3, riser="wood_dark", tread="wood_light", floating=True)
    p.boxmm((WT, -WT, WT_Z - 0.25), (WT + 1.5, -1.2, WT_Z), "wood_dark", col="floor", top="wood")
    # posts under the floating flights and the top landing
    for x in (-0.6, 0.9):
        h = (x + 2.0) / 3.6 * 2.5
        p.cyl(0.1, h, (x, WT + 1.4, h / 2), "trunk", segs=6, col="block")
    for y in (1.4, 0.0, -1.1, -2.1):
        h = min(WT_Z, 2.5 + (WT + 0.2 - y) / 3.6 * 2.5)
        p.cyl(0.1, h, (WT + 1.4, y, h / 2), "trunk", segs=6, col="block")
    # plank walls: cover on the front, the left, the back; on the right a gap where the stairs arrive
    walls = [((-WT, -WT), (WT + 1.5, -WT)), ((-WT, -WT), (-WT, WT)), ((-WT, WT), (WT, WT)), ((WT, -1.2), (WT, WT)), ((WT + 1.5, -WT), (WT + 1.5, -1.2))]
    for a, b in walls:
        x0, x1 = sorted((a[0], b[0]))
        y0, y1 = sorted((a[1], b[1]))
        if x1 - x0 < 1e-3:
            x0, x1 = x0 - 0.06, x0 + 0.06
        else:
            y0, y1 = y0 - 0.06, y0 + 0.06
        p.boxmm((x0, y0, WT_Z), (x1, y1, WT_Z + 1.0), "wood", col="cover", top="wood_dark", bottom=True)
        # camouflage branches on the outside
        for _ in range(3):
            t = rng.range(0.1, 0.9)
            bx, by = a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t
            p.sphere((0.45, 0.45, 0.3), (bx, by, WT_Z + rng.range(0.4, 0.9)), "leaf" if rng() < 0.5 else "leaf_dark", segs=6, rings=4,
                     smooth=True, jitter=0.15, rng=rng)
    # roof
    for s in (-1, 1):
        p.box((2 * WT + 1.0, WT + 0.75, 0.12), (0, s * (WT + 0.5) / 2, WT_Z + 2.65), "plank_grey", rot=(-s * 22, 0, 0), col="roof", bottom=True)
    p.box((2 * WT + 1.1, 0.3, 0.2), (0, 0, WT_Z + 3.12), "wood_dark", bottom=True)
    for _ in range(6):
        p.sphere((0.6, 0.6, 0.25), (rng.range(-WT, WT), rng.range(-WT, WT) * 0.8, WT_Z + 3.0), "leaf_dark" if rng() < 0.5 else "leaf",
                 segs=6, rings=4, smooth=True)
    # an orange hunters' flag
    p.tube((-WT + 0.1, -WT + 0.1, WT_Z + 2.4), (-WT + 0.1, -WT + 0.1, WT_Z + 4.4), 0.05, "wood_dark", segs=5)
    p.add([(-WT + 0.1, -WT + 0.1, WT_Z + 4.35), (-WT + 1.2, -WT + 0.1, WT_Z + 4.0), (-WT + 0.1, -WT + 0.1, WT_Z + 3.7)], [(0, 1, 2), (2, 1, 0)],
          "orange", closed=False)
    p.meta["anchors"] = {"perch": (0.0, -0.6, WT_Z), "foot": (-3.4, WT + 0.85, 0.0)}
    p.meta["walk"] = [[(-3.4, WT + 0.85, 0.0), (-2.5, WT + 0.85, 0.0), (WT + 0.85, WT + 0.85, 2.5), (WT + 0.85, -1.7, WT_Z), (1.0, -1.7, WT_Z),
                       (0.0, -0.4, WT_Z)]]
    p.meta["note"] = "hunters' watchtower: platform 5 m up (4.4 x 4.4 m, 1 m plank walls), two wooden flights; sniper perch at the anchor 'perch'"
    return p


# ---------------------------------------------------------------- hay
def hay_bales():
    """Three square bales, two side by side and one on top: cover."""
    p = Prop("hay_bales", "cover")
    hay_bale(p, 0.0, -0.33, 0.0)
    hay_bale(p, 0.0, 0.33, 0.0)
    hay_bale(p, 0.15, 0.0, 0.52, yaw=8.0)
    p.meta["note"] = "stacked hay bales, cover"
    return p


def hay_cart():
    """A two-wheeled hay cart, tipped forward onto its shafts, heaped with hay: one block collider."""
    p = Prop("hay_cart", "cover")
    rng = Rng(173)
    p.boxmm((-1.0, -1.2, 0.55), (1.0, 1.2, 0.7), "wood", bottom=True)
    for s in (-1, 1):
        p.boxmm((s * 1.0 - 0.08 * (s > 0), -1.2, 0.7), (s * 1.0 + 0.08 * (s < 0), 1.2, 1.15), "wood_dark", bottom=True)
        p.cyl(0.62, 0.12, (s * 1.12, 0.1, 0.62), "wood_dark", segs=10, rot=(0, 90, 0), cap_cell="wood")
        p.cyl(0.14, 0.2, (s * 1.12, 0.1, 0.62), "iron", segs=6, rot=(0, 90, 0))
        p.tube((s * 0.55, -1.2, 0.62), (s * 0.45, -3.0, 0.08), 0.06, "wood", segs=5)
    p.hull([(-0.95, -1.15, 0.7), (0.95, -1.15, 0.7), (-0.95, 1.15, 0.7), (0.95, 1.15, 0.7), (-0.7, -0.9, 1.75), (0.7, -0.9, 1.6),
            (-0.6, 0.9, 1.8), (0.65, 0.8, 1.9), (0.0, 0.0, 2.05)], "hay", cells_fn=lambda c, n: "hay_dark" if n.y > 0.4 or n.x > 0.6 else "hay")
    for _ in range(5):
        p.box((0.6, 0.04, 0.03), (rng.range(-0.8, 0.8), rng.range(-1.0, 1.0), rng.range(1.5, 1.9)), "hay_dark",
              rot=(rng.range(-20, 20), 0, rng.range(0, 180)), bottom=True)
    p.col_boxmm("block", (-1.25, -1.25, 0.0), (1.25, 1.25, 1.95))
    p.col_boxmm("block", (-0.65, -3.0, 0.0), (0.65, -1.25, 0.6))
    p.meta["note"] = "hay cart, cover"
    return p


BUILDERS = [moat_reeds, raft_lane, raft, trench_dugout, hunter_watchtower, hay_bales, hay_cart]
