"""Pond Keep: the storybook duck castle of the Hunt Season raid map (art/map/layout/gen_pond.py).

Static pieces (placed in map_v1 `props`): the corner tower, the curtain wall (long, with a courtyard stair, and
short), the gatehouse, the drawbridge quays (`castle_bridge`, which also carries the bridge deck collider), the
QoreChain core on its plinth, and the courtyard well.
Animated pieces (separate GLBs the game places from the map's `raid.props` and moves in code, never in `props`):
`castle_drawbridge` (a `Hinge` node), `castle_gate` (`Intact`, `Damaged`, `Broken` state nodes and a `Planks`
barricade), `bread_cannon` (`Yaw`, `Pitch`, `Muzzle`) and `bread_loaf` (the cannon's shot).

Gameplay numbers (Blender space, meters, the prop origin on the ground):
- Courtyard floors 0.15 (GF). The wall walk is 5.2 up (WALK), the tower top 9.8 (TOP).
- Parapets: a 1.0 m sill (a standing duck shoots over it, a crouched one ducks behind it) and 2.2 m merlons.
  Merlons and sills are `wall` (they stop bullets and sight); every crenel gap holds a `fence` box up to the
  merlon top, so bullets and sight pass but no duck can climb out through it.
- Stairs are smooth ramp colliders (`stairs`, 28 to 34 degrees) under stone steps, like the houses.
- The inner kerb of a wall walk is 0.35 m: a duck steps or drops into the courtyard.

Blender space: Z up, the outside of every piece faces -Y (the GLB front, +Z). Each tower is authored as the
south-east tower: the courtyard lies toward -X/+Y, the curtain walls meet its west face (the south wall) and
its north face (the east wall).
"""

import math

import emblem
import kit
from furniture import barrel, crate, loaf
from house_kit import rail, slab_with_hole, stair_ramp
from kit import Prop, Rng

GF = 0.15
WALK = 5.2
TOP = 9.8
SILL = 1.0
MERLON = 2.2
WALL_T = 3.0            # curtain wall thickness: outer face y = -1.5, inner face y = +1.5
PAR_T = 0.6
KERB = 0.35
TOWER = 4.5             # tower half size (9 x 9 m)
TW = 1.0                # tower wall thickness
STONE, DARK, LIGHT, CAP = "stone", "stone_dark", "rock_light", "stone_dark"


# ---------------------------------------------------------------- helpers
def seg_frame(a, b):
    dx, dy = b[0] - a[0], b[1] - a[1]
    return math.hypot(dx, dy), math.degrees(math.atan2(dy, dx)), ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)


def crenels(p, a, b, z0, t=PAR_T, sill=SILL, top=MERLON, mw=1.4, cw=1.2, cell=STONE, cap=CAP, ends=True):
    """Crenellated parapet centered on the line a -> b: a `wall` sill, `wall` merlons, a `fence` box in every
    crenel (stops ducks, not bullets or sight). `ends`: merlons at both ends."""
    L, yaw, mid = seg_frame(a, b)
    if L < 2 * mw + cw:
        spans = [(-L / 2, L / 2, True)]
    elif ends:
        n = max(1, round((L - mw) / (mw + cw)))
        m = (L - n * cw) / (n + 1)
        spans = []
        u = -L / 2
        for i in range(n + 1):
            spans.append((u, u + m, True))
            u += m
            if i < n:
                spans.append((u, u + cw, False))
                u += cw
    else:
        n = max(1, round(L / (mw + cw)))
        c = (L - n * mw) / n
        spans = []
        u = -L / 2
        for i in range(n):
            spans.append((u, u + c / 2, False))
            spans.append((u + c / 2, u + c / 2 + mw, True))
            spans.append((u + c / 2 + mw, u + c + mw, False))
            u += c + mw
    with p.frame((mid[0], mid[1], 0), rot_z=yaw):
        p.boxmm((-L / 2, -t / 2, z0), (L / 2, t / 2, z0 + sill), cell, col="wall", top=cap, bottom=False)
        for u0, u1, solid in spans:
            if solid:
                p.boxmm((u0, -t / 2, z0 + sill), (u1, t / 2, z0 + top - 0.12), cell, col="wall", bottom=True)
                p.boxmm((u0 - 0.05, -t / 2 - 0.05, z0 + top - 0.12), (u1 + 0.05, t / 2 + 0.05, z0 + top), cap, bottom=True)
                p.col_boxmm("wall", (u0, -t / 2, z0 + top - 0.12), (u1, t / 2, z0 + top))
            else:
                p.col_boxmm("fence", (u0, -t / 2, z0 + sill), (u1, t / 2, z0 + top))
        # a cap line on the sill, a hair proud on both faces
        p.boxmm((-L / 2, -t / 2 - 0.04, z0 + sill - 0.1), (L / 2, t / 2 + 0.04, z0 + sill), cap, bottom=True)


def face_stones(p, a, b, side, t, z0, z1, rng, count, skip=(), cells=(LIGHT, DARK, STONE)):
    """Proud stones scattered on one face of a wall a -> b (side -1: the local -Y face). Mesh only."""
    L, yaw, mid = seg_frame(a, b)
    with p.frame((mid[0], mid[1], 0), rot_z=yaw):
        placed = 0
        for _ in range(count * 4):
            if placed >= count:
                break
            w, h = rng.range(0.45, 0.95), rng.range(0.28, 0.45)
            u = rng.range(-L / 2 + w / 2 + 0.1, L / 2 - w / 2 - 0.1)
            z = rng.range(z0 + h / 2 + 0.1, z1 - h / 2 - 0.1)
            if any(u0 - w / 2 < u < u1 + w / 2 and q0 - h / 2 < z < q1 + h / 2 for u0, u1, q0, q1 in skip):
                continue
            y = side * (t / 2 + 0.02)
            p.boxmm((u - w / 2, y - 0.04, z - h / 2), (u + w / 2, y + 0.04, z + h / 2), cells[placed % len(cells)], bottom=True)
            placed += 1


def slit(p, a, b, side, t, u, z, h=1.3):
    """Arrow slit decal (mesh only): a dark slot in a lighter stone surround on one face."""
    L, yaw, mid = seg_frame(a, b)
    with p.frame((mid[0], mid[1], 0), rot_z=yaw):
        y = side * (t / 2 + 0.03)
        p.boxmm((u - 0.32, y - 0.03, z - h / 2 - 0.18), (u + 0.32, y + 0.03, z + h / 2 + 0.18), LIGHT, bottom=True)
        y2 = side * (t / 2 + 0.065)
        p.boxmm((u - 0.09, y2 - 0.01, z - h / 2), (u + 0.09, y2 + 0.01, z + h / 2), "window", bottom=True)
        p.boxmm((u - 0.24, y2 - 0.01, z - 0.07), (u + 0.24, y2 + 0.01, z + 0.07), "window", bottom=True)


def ivy(p, at, normal_deg, w, h, rng):
    """Flat ivy patch hugging a wall (mesh only, 0.12 proud)."""
    with p.frame(at, rot_z=normal_deg):
        for _ in range(5):
            dx, dz = rng.range(-w / 2, w / 2), rng.range(-h / 2, h / 2)
            p.sphere((rng.range(0.4, 0.75), 0.1, rng.range(0.35, 0.6)), (dx, -0.04, dz), "leaf" if rng() < 0.6 else "leaf_dark",
                     segs=7, rings=4, smooth=True)


def hanging_banner(p, at, yaw, w=1.6, h=3.2, mark_size=1.5):
    """Duck banner hanging flat on a wall face (mesh only): dark cloth, yellow edges, the duck mark, a
    swallowtail bottom. `at` is the top center on the wall face, the cloth hangs down facing local -Y."""
    with p.frame(at, rot_z=yaw):
        p.boxmm((-w / 2 - 0.15, -0.16, -0.1), (w / 2 + 0.15, -0.02, 0.05), "wood_dark", bottom=True)
        p.boxmm((-w / 2, -0.07, -h + 0.5), (w / 2, -0.03, 0.0), "dark", bottom=True)
        tail = [([(-w / 2, 0.5), (-w / 2, 0.0), (0.0, 0.42), (w / 2, 0.0), (w / 2, 0.5)], "dark", 0)]
        emblem.draw(p, tail, (0.0, -h), -0.05, side=-1, step=0.0)
        for s in (-1, 1):
            p.boxmm((s * w / 2 - 0.09 * (s > 0), -0.085, -h + 0.5), (s * w / 2 + 0.09 * (s < 0), -0.03, 0.0), "yellow", bottom=True)
        p.boxmm((-w / 2, -0.085, -0.25), (w / 2, -0.03, -0.12), "yellow", bottom=True)
        emblem.draw(p, emblem.mark(mark_size), (0.05, -h * 0.42), -0.07, side=-1)


def barbette(p, a, b, z0, t=PAR_T, sill=SILL, top=MERLON, cell=STONE, cap=CAP):
    """A merlon-free stretch of parapet: the `wall` sill with its cap, and a `fence` box above it to the merlon
    height (shots and sight pass over the sill, no duck climbs out)."""
    L, yaw, mid = seg_frame(a, b)
    with p.frame((mid[0], mid[1], 0), rot_z=yaw):
        p.boxmm((-L / 2, -t / 2, z0), (L / 2, t / 2, z0 + sill), cell, col="wall", top=cap)
        p.boxmm((-L / 2, -t / 2 - 0.04, z0 + sill - 0.1), (L / 2, t / 2 + 0.04, z0 + sill), cap, bottom=True)
        p.col_boxmm("fence", (-L / 2, -t / 2, z0 + sill), (L / 2, t / 2, z0 + top))
        # iron hoops on the sill where the barrel rests (mesh only)
        for u in (-L / 4 - 0.25, -L / 4 + 0.25, L / 4 - 0.25, L / 4 + 0.25):
            p.boxmm((u - 0.05, -t / 2 - 0.03, z0 + sill - 0.12), (u + 0.05, t / 2 + 0.03, z0 + sill + 0.03), "iron", bottom=True)


def flag(p, at, w=1.9, h=1.25, pole=4.6):
    """Pole with a duck flag flying toward +X (mesh only, the mark on both sides). `at` is the pole foot."""
    x, y, z = at
    p.tube((x, y, z), (x, y, z + pole), 0.07, "wood_dark", segs=6)
    p.sphere(0.14, (x, y, z + pole + 0.1), "yellow", segs=6, rings=4, smooth=False)
    top = z + pole - 0.15
    cloth = [([(0.0, -h), (w, -h), (w - 0.35, -h / 2), (w, 0.0), (0.0, 0.0)], "dark", 0),
             ([(0.0, -0.16), (w - 0.1, -0.16), (w, 0.0), (0.0, 0.0)], "yellow", 1)]
    for side in (-1, 1):
        emblem.draw(p, cloth, (x + 0.06, top), y + side * 0.012, side=side, step=0.004)
        emblem.draw(p, emblem.mark(1.05), (x + 0.06 + w * 0.42, top - h / 2 - 0.04), y + side * 0.022, side=side, step=0.004)


def lantern(p, at, toward_deg=0.0):
    """Wall lantern on a bracket (mesh only); the bracket sticks out along local -Y of `toward_deg`."""
    with p.frame(at, rot_z=toward_deg):
        p.boxmm((-0.05, -0.45, 0.0), (0.05, 0.0, 0.08), "iron", bottom=True)
        p.boxmm((-0.16, -0.6, -0.42), (0.16, -0.28, -0.06), "iron", bottom=True)
        p.boxmm((-0.12, -0.56, -0.38), (0.12, -0.32, -0.1), "lamp_glass", bottom=True)
        p.cyl(0.2, 0.14, (0, -0.44, 0.0), "iron", segs=6, r2=0.04)


def flight(p, axis, band, start, d, z0, rise, steps, run, riser=STONE, tread=LIGHT, floating=False):
    """A straight flight of solid steps (mesh) over one smooth ramp collider (`stairs`). Floating flights hang
    each step 0.45 m deep under its tread instead of standing on z0."""
    step = rise / steps
    b0, b1 = band
    for i in range(steps):
        a0 = start + d * i * run
        a1 = a0 + d * run
        zt = z0 + (i + 1) * step
        zb = max(z0, zt - 0.45) if floating else z0
        lo, hi = min(a0, a1), max(a0, a1)
        mn, mx = ((lo, b0, zb), (hi, b1, zt)) if axis == "x" else ((b0, lo, zb), (b1, hi, zt))
        p.boxmm(mn, mx, riser, top=tread, bottom=floating)
    stair_ramp(p, axis, band, start, d, z0, rise, steps, run)
    return start + d * steps * run


def batter(p, a, b, out, z_top=1.2, reach=0.35, cell=DARK):
    """Sloped plinth along a wall face (a -> b on the face line, `out` the outward normal), with a wall hull."""
    ox, oy = out
    pts = []
    for x, y in (a, b):
        pts += [(x - ox * 0.1, y - oy * 0.1, -0.6), (x + ox * reach, y + oy * reach, -0.6), (x + ox * reach, y + oy * reach, 0.25),
                (x, y, z_top), (x - ox * 0.1, y - oy * 0.1, z_top)]
    p.hull(pts, cell, col="wall")


# ---------------------------------------------------------------- the corner tower
def castle_tower():
    """9 x 9 m corner tower. Ground room with a courtyard door; flights A and B (east and south walls) climb to
    the wall walk level, where doorways open onto both wall walks; flights C and D climb on to the top
    platform (crenellated, a bread cannon pedestal, a duck flag)."""
    p = Prop("castle_tower", "landmark")
    rng = Rng(71)
    H, I = TOWER, TOWER - TW
    # walls (west and east run the full depth, north and south fit between them)
    door_g = (2.7, 1.4, GF, GF + 2.35)          # ground door (center y, width, bottom, top) on the west face
    door_w = (0.2, 2.0, WALK, WALK + 2.45)      # wall walk doorways (west face: center y; north face: center x)
    walls = [
        ((-H + TW / 2, -H), (-H + TW / 2, H), [door_g, door_w]),       # west, a -> b along +y
        ((H - TW / 2, -H), (H - TW / 2, H), []),                       # east
        ((-I, H - TW / 2), (I, H - TW / 2), [(-0.2, 2.0, WALK, WALK + 2.45)]),   # north, a -> b along +x
        ((-I, -H + TW / 2), (I, -H + TW / 2), []),                     # south
    ]
    for a, b, ops in walls:
        L, _, _ = seg_frame(a, b)
        along_y = abs(b[0] - a[0]) < 1e-6
        o = []
        for c, w, z0, z1 in ops:
            at = (c - a[1]) if along_y else (c - a[0])
            o.append((at, w, z0 + 0.6, z1 + 0.6))
        kit.wall(p, a, b, TOP + 0.6, TW, STONE, openings=o, z0=-0.6, top=STONE)
    # door frames (mesh): light stone surrounds and an arched lintel
    for (cy, w, z0, z1) in (door_g, door_w):
        with p.frame((-H - 0.02, cy, 0), rot_z=90):
            for s in (-1, 1):
                p.boxmm((s * w / 2 - 0.16 * (s < 0) + 0.0, 0.0, z0 - 0.05), (s * w / 2 + 0.16 * (s > 0), 0.08, z1), LIGHT, bottom=True)
            p.boxmm((-w / 2 - 0.2, 0.0, z1), (w / 2 + 0.2, 0.08, z1 + 0.3), LIGHT, bottom=True)
    with p.frame((-0.2, H + 0.02, 0)):
        for s in (-1, 1):
            p.boxmm((s * 1.0 - 0.16 * (s < 0), 0.0, WALK - 0.05), (s * 1.0 + 0.16 * (s > 0), 0.08, WALK + 2.45), LIGHT, bottom=True)
        p.boxmm((-1.2, 0.0, WALK + 2.45), (1.2, 0.08, WALK + 2.75), LIGHT, bottom=True)
    # the open courtyard door leaf, swung against the inside wall (mesh only)
    p.boxmm((-I + 0.02, door_g[0] + 0.72, GF), (-I + 1.32, door_g[0] + 0.8, GF + 2.3), "wood", bottom=True)
    for z in (GF + 0.45, GF + 1.85):
        p.boxmm((-I + 0.02, door_g[0] + 0.69, z), (-I + 1.32, door_g[0] + 0.72, z + 0.1), "iron", bottom=True)
    # plinth: batter on the outside faces, never across a door
    batter(p, (H, -H - 0.35), (H, H), (1, 0))
    batter(p, (-H, -H), (H + 0.35, -H), (0, -1))
    batter(p, (-H, -H - 0.35), (-H, -1.5), (-1, 0))
    batter(p, (1.5, H), (H + 0.35, H), (0, 1))
    # ground floor and the four flights
    p.boxmm((-I, -I, -0.3), (I, I, GF), "flagstone", col="floor", top="flagstone")
    flight(p, "y", (2.0, I), 2.0, -1, GF, 2.5, 13, 4.0 / 13)                    # A: east wall, north to south
    p.boxmm((2.0, -I, GF), (I, -2.0, 2.65), STONE, col="floor", top=LIGHT)      # landing A/B
    flight(p, "x", (-I, -2.0), 2.0, -1, 2.65, WALK - 2.65, 13, 4.0 / 13)        # B: south wall, east to west
    slab_with_hole(p, (-I, -I, I, I), (-2.0, -I, 2.0, -2.0), WALK, "wood_dark", top="wood", col="floor")
    rail(p, (-2.0, -2.0), (2.0, -2.0), WALK)
    flight(p, "y", (2.0, I), 2.0, -1, WALK, 2.3, 12, 4.0 / 12)                  # C: east wall again
    p.boxmm((2.0, -I, WALK), (I, -2.0, 7.5), STONE, col="floor", top=LIGHT)     # landing C/D
    flight(p, "x", (-I, -2.0), 2.0, -1, 7.5, TOP - 7.5, 12, 4.0 / 12, floating=True)   # D: over the B stairwell
    slab_with_hole(p, (-I, -I, I, I), (-2.0, -I, 2.0, -2.0), TOP, "stone_dark", top="flagstone", col="floor", thick=0.3)
    rail(p, (-2.0, -2.0), (1.8, -2.0), TOP, cell="iron")
    # the top: corbel course, a projecting crenellated parapet all round
    c0 = H + 0.3
    p.boxmm((-c0, -c0, TOP - 0.35), (c0, c0, TOP - 0.02), DARK, bottom=True)
    for k in range(-4, 5):
        for (x, y, rz) in ((k * 1.05, -H, 0), (k * 1.05, H, 0), (-H, k * 1.05, 90), (H, k * 1.05, 90)):
            p.box((0.42, 0.42, 0.6) if rz == 0 else (0.42, 0.42, 0.6), (x, y, TOP - 0.65), DARK, bottom=True)
    # merlons on the courtyard halves; the outer corner is a barbette for the bread cannon: a 1 m sill the barrel
    # reaches over, a fence collider above it up to the merlon height (no duck climbs out, shots pass)
    crenels(p, (-H - 0.3, H), (H + 0.3, H), TOP)
    crenels(p, (-H, -H + 0.3), (-H, H - 0.3), TOP)
    crenels(p, (-H - 0.3, -H), (-0.2, -H), TOP)
    crenels(p, (H, 0.2), (H, H - 0.3), TOP)
    barbette(p, (-0.2, -H), (H + 0.3, -H), TOP)
    barbette(p, (H, -H + 0.3), (H, 0.2), TOP)
    # string courses and the outside look
    for z in (WALK - 0.25, 1.2):
        p.boxmm((-H - 0.06, -H - 0.06, z), (H + 0.06, H + 0.06, z + 0.16), DARK, bottom=True)
    east = ((H - TW / 2, -H), (H - TW / 2, H))
    south = ((-H, -H + TW / 2), (H, -H + TW / 2))
    face_stones(p, east[0], east[1], -1, TW, 0.3, TOP - 0.5, rng, 26, skip=[(-0.6, 0.6, 2.0, 4.2), (-0.6, 0.6, 6.0, 8.4)])
    face_stones(p, south[0], south[1], -1, TW, 0.3, TOP - 0.5, rng, 26, skip=[(-0.6, 0.6, 2.0, 4.2), (-0.6, 0.6, 6.0, 8.4)])
    # face_stones puts stones on the local -Y face: for the east wall (a -> b along +y) local -Y is +X (outside)
    for a, b in (east, south):
        slit(p, a, b, -1, TW, 0.0, 3.0)
        slit(p, a, b, -1, TW, 0.0, 7.2)
    # banners on the two outside faces, a flag on the courtyard corner
    hanging_banner(p, (H + 0.02, -2.4, TOP - 0.7), 90, w=1.5, h=3.3)
    hanging_banner(p, (2.4, -H - 0.02, TOP - 0.7), 0, w=1.5, h=3.3)
    flag(p, (-H + 0.25, H - 0.25, TOP + MERLON))
    # quoins on the outside corner
    for k in range(9):
        z = 0.4 + k * 1.0
        big = k % 2 == 0
        p.boxmm((H - (0.9 if big else 0.5), -H - 0.05, z), (H + 0.05, -H + (0.5 if big else 0.9), z + 0.45), LIGHT, bottom=True)
    ivy(p, (H + 0.02, 2.6, 2.4), 90, 2.0, 2.6, rng)
    ivy(p, (-2.8, -H - 0.02, 1.8), 0, 2.4, 2.0, rng)
    # inside: a crate of bread by the C foot, a lantern on each floor
    with p.frame((-0.2, 0.3, GF)):
        crate(p, 0.8, col=True)
        for i in range(3):
            loaf(p, -0.2 + i * 0.2, 0.0, 0.8, rot=10 * i)
    with p.frame((-0.6, 0.6, WALK)):
        barrel(p, r=0.32, h=0.9, top="bread")
    lantern(p, (-I + 0.05, -0.9, GF + 2.6), -90)
    lantern(p, (0.5, I - 0.05, WALK + 2.7), 180)
    # the bread cannon on its stone drum at the barbette corner: the barrel (1.85 m over the platform) reaches
    # past the sill, so it fires level, up, or down at the berm (to about 25 degrees) over the outer quarter
    cannon = (3.45, -3.45)
    dais = 0.0
    ped = 0.9
    p.cyl(0.62, ped, (cannon[0], cannon[1], TOP + ped / 2), DARK, segs=10, col="cover", cap_cell=LIGHT, phase=math.pi / 10)
    p.cyl(0.72, 0.12, (cannon[0], cannon[1], TOP + 0.06), STONE, segs=10, phase=math.pi / 10)
    p.cyl(0.66, 0.06, (cannon[0], cannon[1], TOP + ped - 0.12), "yellow", segs=10, caps=False, phase=math.pi / 10)
    # a stack of bread crates by the gunner
    with p.frame((1.2, 0.6, TOP)):
        crate(p, 0.7, col=True)
        for i in range(3):
            loaf(p, -0.18 + i * 0.18, 0.0, 0.7, rot=15 * i)
    face = (1 / math.sqrt(2), -1 / math.sqrt(2))      # default aim: the outside corner
    use = (cannon[0] - face[0] * 1.6, cannon[1] - face[1] * 1.6)
    p.meta["anchors"] = {
        "cannon": (cannon[0], cannon[1], TOP + ped),
        "cannonAim": (cannon[0] + face[0], cannon[1] + face[1], TOP + ped),
        "cannonUse": (use[0], use[1], TOP + dais),
        "top": (-2.6, 2.6, TOP),
        "doorWest": (-H - 0.6, 0.2, WALK),
        "doorNorth": (-0.2, H + 0.6, WALK),
        "courtyardDoor": (-H - 1.2, door_g[0], 0.0),
    }
    # walk paths: courtyard door to the top, and each wall walk doorway to the top
    up_from_mid = [(-2.75, 2.7, WALK), (2.75, 2.7, WALK), (2.75, -2.75, 7.5), (-2.75, -2.75, TOP), (-2.75, 2.2, TOP), (2.6, 0.0, TOP), (use[0], use[1], TOP + dais)]
    ground = [(-H - 1.5, door_g[0], 0.0), (-3.0, door_g[0], GF), (2.75, door_g[0], GF), (2.75, -2.75, 2.65), (-2.75, -2.75, WALK)]
    p.meta["walk"] = [
        ground + up_from_mid,
        [(-H - 1.0, 0.2, WALK), (-2.75, 0.2, WALK), (-2.75, 2.7, WALK)] + up_from_mid[1:],
        [(-0.2, H + 1.0, WALK), (-0.2, 2.7, WALK)] + up_from_mid[1:],
    ]
    p.meta["probes"] = [((-H - 1.0, door_g[0], GF), (-2.6, door_g[0], GF), "courtyard door"),
                        ((-H - 0.8, 0.2, WALK), (-2.4, 0.2, WALK), "west wall walk door"),
                        ((-0.2, H + 0.8, WALK), (-0.2, 2.4, WALK), "north wall walk door")]
    p.meta["note"] = ("Pond Keep corner tower (authored as the south-east one): courtyard door, stairs to the wall walk doors "
                      "(5.2 m) and on to the crenellated top (9.8 m) with a bread cannon pedestal")
    return p


# ---------------------------------------------------------------- curtain walls
def curtain(name, L, stair):
    """Curtain wall of length L along X: outside -Y, the wall walk on top (5.2 m), a crenellated outer parapet,
    a 0.35 m kerb on the courtyard edge, and optionally a stone stair against the courtyard face."""
    p = Prop(name, "landmark")
    rng = Rng(83 if stair else 89)
    h = WALL_T / 2
    p.boxmm((-L / 2, -h, -0.6), (L / 2, h, WALK), STONE, col="wall", top="flagstone")
    batter(p, (-L / 2, -h), (L / 2, -h), (0, -1))
    crenels(p, (-L / 2, -h + PAR_T / 2), (L / 2, -h + PAR_T / 2), WALK, ends=False)
    p.boxmm((-L / 2, -h - 0.06, WALK - 0.35), (L / 2, -h, WALK - 0.15), DARK, bottom=True)
    land = (-4.0, -2.0) if stair else None
    gaps = [land] if land else []
    for x0, x1 in _gaps(-L / 2, L / 2, gaps):
        p.boxmm((x0, h - 0.25, WALK), (x1, h, WALK + KERB), DARK, col="cover", top=LIGHT, bottom=True)
    # walk flagstones (mesh)
    for i in range(int(L / 1.4)):
        if i % 2:
            continue
        x0 = -L / 2 + i * L / int(L / 1.4)
        p.boxmm((x0 + 0.05, -h + PAR_T + 0.05, WALK), (x0 + L / int(L / 1.4) - 0.05, h - 0.3, WALK + 0.015), LIGHT, bottom=True)
    face_stones(p, (-L / 2, 0), (L / 2, 0), -1, WALL_T, 1.3, WALK - 0.5, rng, int(L * 1.1),
                skip=[(-0.9, 0.9, 1.0, 4.5)])
    face_stones(p, (-L / 2, 0), (L / 2, 0), 1, WALL_T, 0.4, WALK - 0.4, rng, int(L * 0.7),
                skip=[(-6.2, 6.2, -1.0, 6.0)] if stair else [])
    if L > 12:
        for u in (-L / 2 + 4.0, L / 2 - 4.0):
            slit(p, (-L / 2, 0), (L / 2, 0), -1, WALL_T, u, 3.0)
        hanging_banner(p, (0.0, -h - 0.02, WALK - 0.3), 0, w=1.6, h=3.4)
        ivy(p, (-L / 2 + 7.0, -h - 0.02, 2.4), 0, 3.0, 2.0, rng)
        ivy(p, (L / 2 - 9.0, -h - 0.02, 3.2), 0, 2.4, 1.6, rng)
    else:
        ivy(p, (1.0, -h - 0.02, 2.6), 0, 2.4, 1.8, rng)
    # lanterns on the courtyard face
    for u in ((-L / 2 + 2.5, L / 2 - 2.5) if L > 12 else (0.0,)):
        lantern(p, (u, h + 0.02, 3.6), 180)
    walks = []
    p.meta["anchors"] = {"walk": [(-L / 2 + 0.3, 0.15, WALK), (L / 2 - 0.3, 0.15, WALK)]}
    if stair:
        bottom = 5.8
        p.boxmm((land[0], h, 0), (land[1], h + 2.0, WALK), STONE, col="wall", top=LIGHT)
        flight(p, "x", (h, h + 2.0), bottom, -1, 0.0, WALK, 26, 0.3)
        # the arch under the landing and the stair side, mesh only
        p.boxmm((land[0] + 0.45, h + 2.0, 0.0), (land[1] - 0.45, h + 2.03, 1.9), "window", bottom=True)
        p.boxmm((land[0] + 0.3, h + 2.0, 1.9), (land[1] - 0.3, h + 2.05, 2.15), LIGHT, bottom=True)
        p.meta["anchors"]["stairFoot"] = (bottom + 1.2, h + 1.0, 0.0)
        walks.append([(bottom + 1.6, h + 1.0, 0.0), (bottom + 0.4, h + 1.0, 0.03), (land[0] + 0.6, h + 1.0, WALK),
                      (land[0] + 0.6, 0.2, WALK), (-L / 2 + 0.8, 0.2, WALK)])
        walks.append([(land[1] - 0.3, h + 1.0, WALK), (land[1] - 0.3, 0.2, WALK), (L / 2 - 0.8, 0.2, WALK)])
    else:
        walks.append([(-L / 2 + 0.8, 0.2, WALK), (L / 2 - 0.8, 0.2, WALK)])
    p.meta["walk"] = walks
    p.meta["note"] = (f"Pond Keep curtain wall, {L:.0f} m: wall walk 5.2 m up between a crenellated outer parapet and a 0.35 m kerb"
                      + ("; stone stair up from the courtyard" if stair else ""))
    return p


def _gaps(lo, hi, gaps):
    out, x = [], lo
    for g0, g1 in sorted(gaps):
        if g0 > x:
            out.append((x, g0))
        x = max(x, g1)
    if x < hi:
        out.append((x, hi))
    return out


def castle_wall():
    return curtain("castle_wall", 28.0, True)


def castle_wall_short():
    return curtain("castle_wall_short", 8.0, False)


# ---------------------------------------------------------------- the gatehouse
GATE_W, GATE_H = 4.0, 4.2
GATE_Y = -4.6            # the gate plane (the castle_gate GLB origin), 0.9 m inside the outer face
GH_FRONT, GH_BACK = -5.5, 1.5


def castle_gatehouse():
    """12 m wide gatehouse on the south wall line: a 4.4 m passage with the gate in its outer end, the top at the
    wall walk level with a projecting machicolation over the gate (its floor is an iron grate: ducks stand on it,
    shots go through), and two round corner turrets with red cone roofs."""
    p = Prop("castle_gatehouse", "landmark")
    rng = Rng(97)
    F, B = GH_FRONT, GH_BACK
    pw = 2.2
    for s in (-1, 1):
        x0, x1 = sorted((s * pw, s * 6.0))
        p.boxmm((x0, F, -0.6), (x1, B, WALK), STONE, col="wall", top="flagstone")
        # jambs narrow the opening to 4.0 m at the outer end
        j0, j1 = sorted((s * GATE_W / 2, s * pw))
        p.boxmm((j0, F, -0.3), (j1, GATE_Y - 0.1, GATE_H + 0.2), LIGHT, col="wall")
    p.boxmm((-pw, F, -0.3), (pw, B, 0.05), "flagstone", col="floor", top="flagstone")
    p.boxmm((-pw, F, 4.4), (pw, B, WALK), DARK, col="floor", top="flagstone")
    p.boxmm((-GATE_W / 2, F, GATE_H), (GATE_W / 2, GATE_Y - 0.1, 4.4), LIGHT, col="wall")
    # passage look: ribs, torches
    for y in (-3.0, -1.0, 1.0):
        p.boxmm((-pw, y - 0.2, 4.1), (pw, y + 0.2, 4.4), DARK, bottom=True)
        for s in (-1, 1):
            p.boxmm((s * pw - 0.15 * (s > 0), y - 0.2, 0.0), (s * pw + 0.15 * (s < 0), y + 0.2, 4.4), DARK, bottom=True)
    for s in (-1, 1):
        lantern(p, (s * (pw - 0.02), -2.0, 3.0), -90 * s)
    # outer face: batter beside the opening, voussoirs over it, the duck crest, lanterns
    for s in (-1, 1):
        batter(p, (s * GATE_W / 2 + s * 0.25, F), (s * 6.0, F), (0, -1))
        batter(p, (s * 6.0, F), (s * 6.0, B), (s, 0))
    for k in range(9):
        u = -2.3 + k * 4.6 / 8
        w = 4.6 / 8 - 0.04
        p.boxmm((u - w / 2, F - 0.08, GATE_H + 0.02), (u + w / 2, F + 0.01, GATE_H + 0.62), LIGHT if k % 2 else DARK, bottom=True)
    p.boxmm((-0.32, F - 0.12, GATE_H - 0.05), (0.32, F + 0.01, GATE_H + 0.75), "yellow", bottom=True)
    for s in (-1, 1):
        lantern(p, (s * 2.75, F - 0.02, 3.4), 0)
    # top: grate over the gate (fence: ducks stand on it, bullets and sight pass), projecting parapet on corbels
    MX = 2.6
    p.col_boxmm("fence", (-MX, F - 0.6, WALK - 0.2), (MX, F, WALK))
    for i in range(14):
        x = -MX + 0.1 + i * (2 * MX - 0.2) / 13
        p.boxmm((x - 0.035, F - 0.6, WALK - 0.08), (x + 0.035, F, WALK - 0.01), "iron", bottom=True)
    for y in (F - 0.5, F - 0.3, F - 0.1):
        p.boxmm((-MX, y - 0.03, WALK - 0.12), (MX, y + 0.03, WALK - 0.06), "iron", bottom=True)
    for k in range(5):
        x = -2.3 + k * 1.15
        p.box((0.45, 1.2, 0.45), (x, F - 0.6, WALK - 0.55), DARK, bottom=True)
        p.box((0.45, 0.8, 0.45), (x, F - 0.4, WALK - 1.0), DARK, bottom=True)
    # the projecting front: its sill hangs below the walk on the corbels
    p.boxmm((-MX - 0.6, F - 1.2, WALK - 0.25), (MX + 0.6, F - 0.6, WALK), STONE, col="wall", bottom=True)
    crenels(p, (-MX - 0.6, F - 0.9), (MX + 0.6, F - 0.9), WALK)
    for s in (-1, 1):
        x0, x1 = sorted((s * MX, s * (MX + 0.6)))
        p.boxmm((x0, F - 0.6, WALK - 0.25), (x1, F, WALK + SILL), STONE, col="wall", top=CAP, bottom=True)
        p.boxmm((x0, F - 0.6, WALK + SILL), (x1, F, WALK + MERLON), STONE, col="wall", top=CAP, bottom=True)
        # the main outer parapet from the machicolation to the turret, and the side parapets
        crenels(p, (s * (MX + 0.6), F + PAR_T / 2), (s * 4.2, F + PAR_T / 2), WALK)
        crenels(p, (s * 5.7, -3.0), (s * 5.7, -1.5 + PAR_T), WALK, t=0.6)
    # the duck crest on the projecting sill: a dark shield with a yellow rim and the mark
    with p.frame((0, F - 1.2, WALK + 0.35)):
        emblem.draw(p, emblem.disc(0.78, "dark") + emblem.ring(0.86, 0.74, "yellow", layer=1), (0.0, 0.0), -0.01, side=-1)
        emblem.draw(p, emblem.mark(1.3), (0.02, -0.02), -0.03, side=-1)
    # courtyard kerb
    p.boxmm((-6.0, B - 0.25, WALK), (6.0, B, WALK + KERB), DARK, col="cover", top=LIGHT, bottom=True)
    # corner turrets with cone roofs and pennants
    for s in (-1, 1):
        cx, cy = s * 5.2, F + 0.8
        p.cyl(1.9, 9.4, (cx, cy, -0.6 + 4.7), STONE, segs=12, col="wall", phase=math.pi / 12, cap_cell=STONE)
        p.cyl(2.15, 0.35, (cx, cy, 8.6), DARK, segs=12, phase=math.pi / 12)
        for k in range(12):
            a = 2 * math.pi * (k + 0.5) / 12
            p.box((0.32, 0.32, 0.5), (cx + math.cos(a) * 1.95, cy + math.sin(a) * 1.95, 8.2), DARK, bottom=True)
        p.cyl(2.35, 4.3, (cx, cy, 8.8 + 2.15), "tile", segs=12, r2=0.05, phase=math.pi / 12, cap_cell="tile_dark")
        p.cyl(2.37, 0.25, (cx, cy, 8.9), "tile_dark", segs=12, r2=2.2, phase=math.pi / 12)
        p.tube((cx, cy, 12.9), (cx, cy, 14.6), 0.05, "iron", segs=5)
        p.sphere(0.16, (cx, cy, 13.05), "yellow", segs=6, rings=4, smooth=False)
        p.add([(cx, cy, 14.5), (cx + s * 1.3, cy, 14.25), (cx, cy, 13.95)], [(0, 1, 2), (2, 1, 0)], "yellow", closed=False)
        for k in range(3):
            a = math.radians(-60 + 60 * k) if s > 0 else math.radians(120 + 60 * k)
            r = 1.84
            slit(p, (cx + math.cos(a) * r - math.sin(a), cy + math.sin(a) * r + math.cos(a)),
                 (cx + math.cos(a) * r + math.sin(a), cy + math.sin(a) * r - math.cos(a)), 1, 0.0, 0.0, 6.4 if k != 1 else 2.8, h=1.0)
    ivy(p, (-6.02, -2.4, 2.2), -90, 2.0, 2.0, rng)
    ivy(p, (6.02, -0.6, 3.0), 90, 1.6, 1.6, rng)
    p.meta["anchors"] = {
        "gate": (0.0, GATE_Y, 0.0),
        "grate": (0.0, F - 0.3, WALK),
        "walk": [(-6.0, 0.15, WALK), (6.0, 0.15, WALK)],
        "front": (0.0, F - 1.0, 0.0),
    }
    p.meta["walk"] = [
        [(0.0, F - 3.0, 0.0), (0.0, F + 0.6, 0.05), (0.0, B + 2.0, 0.0)],
        [(-5.0, 0.2, WALK), (0.0, -1.0, WALK), (0.0, F - 0.3, WALK), (5.0, 0.2, WALK)],
    ]
    p.meta["probes"] = [((0.0, F - 1.0, 0.05), (0.0, B + 0.5, 0.05), "gate passage")]
    p.meta["note"] = ("Pond Keep gatehouse: a 4 m x 4.2 m gate opening (the castle_gate GLB goes at the anchor 'gate'), the top at the "
                      "wall walk level with an iron grate over the gate, two cone-roofed turrets")
    return p


# ---------------------------------------------------------------- the drawbridge quays (static)
SPAN = 8.4              # hinge to the outer quay
DECK_W = 4.4
QUAY_W = 3.6            # quay half width


def castle_bridge():
    """The stone quays on both banks of the moat, the lifting frame and the drawbridge's deck collider.
    Origin: the hinge (at the inner quay tip, ground level); the bridge runs toward -Y over the water.
    The deck itself is drawn by the castle_drawbridge GLB; its `floor` collider and the two `fence` rails
    (1.5 m, the deck sides) are here, so the map's colliders and navmesh always have the crossing."""
    p = Prop("castle_bridge", "landmark")
    inner = (0.0, 4.0)
    outer = (-SPAN - 4.6, -SPAN)
    for y0, y1 in (inner, outer):
        p.boxmm((-QUAY_W, y0, -3.6), (QUAY_W, y1, 0.0), DARK, col="floor", top="flagstone")
        for s in (-1, 1):
            x0, x1 = sorted((s * (QUAY_W - 0.6), s * QUAY_W))
            p.boxmm((x0, y0, 0.0), (x1, y1, 1.3), STONE, col="cover", top=CAP, bottom=True)
            # a post closing the gap between the parapet and the deck rail at the water end
            t0, t1 = (0.0, 0.45) if (y0, y1) == inner else (-SPAN - 0.45, -SPAN)
            a0, a1 = sorted((s * DECK_W / 2, s * (QUAY_W - 0.6)))
            p.boxmm((a0, t0, 0.0), (a1, t1, 1.3), DARK, col="cover", top=LIGHT, bottom=True)
        # stone courses on the water faces (mesh)
        for z in (-1.4, -0.7):
            p.boxmm((-QUAY_W - 0.04, y0 - 0.04, z), (QUAY_W + 0.04, y1 + 0.04, z + 0.12), LIGHT, bottom=True)
    # bollards on the outer quay, the lifting frame on the inner one
    for s in (-1, 1):
        p.cyl(0.3, 1.6, (s * (QUAY_W - 0.3), outer[0] + 0.5, 0.8), DARK, segs=8, col="block", cap_cell=LIGHT)
        p.cyl(0.28, 7.2, (s * 3.3, 1.0, 3.6), "timber", segs=8, col="block")
        p.box((0.34, 0.34, 1.0), (s * 3.3, 1.0, 0.5), "iron", bottom=True)
        p.tube((s * 3.3, 0.6, 6.6), (s * 2.6, 0.6, 6.6), 0.09, "iron", segs=6)
        p.cyl(0.24, 0.12, (s * 2.6, 0.6, 6.4), "iron", segs=8, rot=(0, 90, 0))
    for s in (-1, 1):
        # a bracing strut and a little cap on each post (no crossbeam: it would block the gatehouse's view)
        p.tube((s * 3.3, 1.0, 5.2), (s * 3.3, 2.6, 2.2), 0.1, "timber", segs=5)
        p.cyl(0.36, 0.16, (s * 3.3, 1.0, 7.28), "tile_dark", segs=8, r2=0.1)
    # deck collider and its rails (the drawbridge GLB draws the deck)
    p.col_boxmm("floor", (-DECK_W / 2, -SPAN, -0.3), (DECK_W / 2, 0.0, 0.12))
    for s in (-1, 1):
        x0, x1 = sorted((s * DECK_W / 2, s * (DECK_W / 2 + 0.15)))
        p.col_boxmm("fence", (x0, -SPAN, 0.12), (x1, 0.0, 1.5))
    # hinge pit in the inner quay
    p.boxmm((-DECK_W / 2 - 0.1, 0.0, -0.05), (DECK_W / 2 + 0.1, 0.45, 0.005), "iron", bottom=True)
    p.meta["anchors"] = {"hinge": (0.0, 0.0, 0.0), "far": (0.0, -SPAN, 0.0), "pulleyL": (-2.6, 0.6, 6.4), "pulleyR": (2.6, 0.6, 6.4),
                         "innerQuay": (0.0, 3.0, 0.0), "outerQuay": (0.0, -SPAN - 3.6, 0.0)}
    p.meta["walk"] = [[(0.0, 3.6, 0.0), (0.0, 0.5, 0.05), (0.0, -SPAN / 2, 0.12), (0.0, -SPAN - 0.5, 0.05), (0.0, -SPAN - 4.0, 0.0)]]
    p.meta["note"] = "Pond Keep drawbridge quays: deck collider (floor) and 1.5 m fence rails over the 8.4 m span; the deck is the castle_drawbridge GLB"
    return p


# ---------------------------------------------------------------- the QoreChain core
CORE_R = (3.0, 2.3, 1.5)


def castle_core():
    """The thing the ducks defend: a stepped octagonal plinth (two low steps a duck walks up, a 1.2 m drum it
    cannot), a big yellow crystal floating over it in a halo, and two QORECHAIN banners (text only) on frames
    east and west of it, facing north and south."""
    p = Prop("castle_core", "landmark")
    r1, r2, r3 = CORE_R
    ph = math.pi / 8
    p.cyl(r1, 0.35, (0, 0, 0.175), DARK, segs=8, col="floor", cap_cell=LIGHT, phase=ph)
    p.cyl(r2, 0.35, (0, 0, 0.525), STONE, segs=8, col="floor", cap_cell=LIGHT, phase=ph)
    p.cyl(r3, 1.2, (0, 0, 1.3), DARK, segs=8, col="wall", cap_cell="dark", phase=ph)
    p.cyl(r3 + 0.08, 0.14, (0, 0, 1.0), "yellow", segs=8, phase=ph)
    p.cyl(r3 * 0.7, 0.03, (0, 0, 1.91), "yellow", segs=8, phase=ph)
    for k in range(8):
        a = 2 * math.pi * (k + 0.5) / 8
        p.box((0.16, 0.06, 0.5), (math.cos(a) * (r2 + 0.02), math.sin(a) * (r2 + 0.02), 0.45), "yellow", rot_z=math.degrees(a) + 90, bottom=True)
    # the crystal: a tall octahedron and four orbiting shards, all yellow, cream and white facets
    ring = [(math.cos(2 * math.pi * k / 6) * 0.9, math.sin(2 * math.pi * k / 6) * 0.9, 3.7) for k in range(6)]
    def cells(c, n):
        k = int((math.atan2(n.y, n.x) + math.pi) / (math.pi / 3)) % 2
        if n.z > 0.2:
            return "cream" if k else "yellow"
        return "yellow" if k else "hay"
    p.hull([(0, 0, 2.35)] + ring + [(0, 0, 5.9)], "yellow", col="block", cells_fn=cells)
    for k in range(4):
        a = 2 * math.pi * k / 4 + 0.4
        cx, cy, cz = math.cos(a) * 1.75, math.sin(a) * 1.75, 3.0 + 0.5 * (k % 2)
        p.hull([(cx, cy, cz - 0.38), (cx + 0.16, cy, cz), (cx, cy + 0.16, cz), (cx - 0.16, cy, cz), (cx, cy - 0.16, cz), (cx, cy, cz + 0.38)],
               "yellow", cells_fn=lambda c, n: "cream" if n.z > 0 else "yellow")
    for k in range(16):
        a0, a1 = 2 * math.pi * k / 16, 2 * math.pi * (k + 1) / 16
        p.tube((math.cos(a0) * 1.45, math.sin(a0) * 1.45, 4.25), (math.cos(a1) * 1.45, math.sin(a1) * 1.45, 4.25), 0.05, "yellow", segs=4)
    # the two QORECHAIN banners
    text, width = emblem.word(0.42)
    for s in (-1, 1):
        cx = s * 7.0
        for dx in (-1.7, 1.7):
            p.cyl(0.11, 4.7, (cx + dx, 0, 2.35), "wood_dark", segs=6, col="block")
            p.sphere(0.17, (cx + dx, 0, 4.78), "yellow", segs=6, rings=4, smooth=False)
            p.cyl(0.35, 0.25, (cx + dx, 0, 0.125), DARK, segs=6)
        p.tube((cx - 1.85, 0, 4.42), (cx + 1.85, 0, 4.42), 0.07, "iron", segs=5)
        p.boxmm((cx - 1.55, -0.03, 1.0), (cx + 1.55, 0.03, 4.35), "dark", bottom=True)
        p.col_boxmm("fence", (cx - 1.55, -0.1, 0.0), (cx + 1.55, 0.1, 4.35))
        for sy in (-1, 1):
            emblem.draw(p, text, (cx, 3.55), sy * 0.03, side=sy)
            # yellow edging and a glowing stripe under the word (no logo)
            stripes = [([(-1.55, 0.0), (1.55, 0.0), (1.55, 0.12), (-1.55, 0.12)], "yellow", 0),
                       ([(-1.55, 3.23), (1.55, 3.23), (1.55, 3.35), (-1.55, 3.35)], "yellow", 0),
                       ([(-1.0, 1.55), (1.0, 1.55), (1.0, 1.7), (-1.0, 1.7)], "yellow", 0),
                       ([(-0.6, 1.25), (0.6, 1.25), (0.6, 1.36), (-0.6, 1.36)], "orange", 0),
                       ([(-0.25, 0.5), (0.0, 0.85), (0.25, 0.5), (0.0, 0.15)], "yellow", 0)]
            emblem.draw(p, stripes, (cx, 1.0), sy * 0.03, side=sy)
    assert width < 3.0, width
    p.meta["anchors"] = {"core": (0.0, 0.0, 0.0), "crystal": (0.0, 0.0, 4.1)}
    p.meta["note"] = "QoreChain core: stepped plinth (steps 0.35 m, drum 1.9 m), floating crystal, two QORECHAIN banners (text only)"
    return p


def castle_well():
    p = Prop("castle_well", "cover")
    p.cyl(1.05, 0.85, (0, 0, 0.425), STONE, segs=10, col="cover", cap_cell=DARK, phase=math.pi / 10)
    p.cyl(0.8, 0.02, (0, 0, 0.86), "water", segs=10, phase=math.pi / 10)
    for s in (-1, 1):
        p.box((0.16, 0.16, 2.1), (s * 0.95, 0, 1.05), "timber", bottom=True)
    p.tube((-0.95, 0, 1.6), (0.95, 0, 1.6), 0.08, "wood", segs=6)
    p.box((2.6, 1.4, 0.1), (0, -0.55, 2.25), "tile", rot=(28, 0, 0), bottom=True)
    p.box((2.6, 1.4, 0.1), (0, 0.55, 2.25), "tile", rot=(-28, 0, 0), bottom=True)
    p.box((2.65, 0.2, 0.18), (0, 0, 2.58), "tile_dark", bottom=True)
    p.cyl(0.18, 0.28, (0.25, 0, 1.2), "wood", segs=6)
    p.tube((0.25, 0, 1.6), (0.25, 0, 1.34), 0.015, "iron", segs=4)
    p.meta["note"] = "courtyard well, cover"
    return p


# ---------------------------------------------------------------- animated pieces (placed from raid.props)
class Node(Prop):
    """A child node of an animated GLB: a pivot empty named `name` with this mesh (if any) under it."""

    def __init__(self, name):
        super().__init__(name, "node")
        self.children = []
        self.rot = None             # Euler XYZ (radians) on the pivot
        self.scale = None


def castle_drawbridge():
    """The drawbridge deck on a `Hinge` node at the root origin (the inner quay tip, deck top 0.12 m).
    The deck runs along -Y (the GLB +Z): raise it by turning `Hinge` about its local X, negative angles up
    (three.js: hinge.rotation.x = -angle). `ChainAnchorL/R` (under Hinge) are the chain rings at the deck tip;
    `ChainL/R` hang from the pulleys of the castle_bridge frame and point their local +Z (glTF) at the rings
    with a 1 m long chain mesh: in code, chain.lookAt(anchor world position), chain.scale.z = distance."""
    p = Prop("castle_drawbridge", "animated")
    # static: the hinge axle and its brackets
    p.tube((-DECK_W / 2 - 0.1, 0.05, -0.05), (DECK_W / 2 + 0.1, 0.05, -0.05), 0.14, "iron", segs=8)
    for s in (-1, 1):
        p.box((0.2, 0.5, 0.36), (s * (DECK_W / 2 - 0.3), 0.18, -0.05), "steel_dark", bottom=True)
    deck = Node("Hinge")
    L = SPAN
    for i in range(11):
        x0 = -DECK_W / 2 + i * DECK_W / 11
        deck.boxmm((x0 + 0.015, -L, -0.18), (x0 + DECK_W / 11 - 0.015, 0.0, 0.12), "wood" if i % 2 else "wood_light", bottom=True)
    for y in (-0.6, -L / 2, -L + 0.6):
        deck.boxmm((-DECK_W / 2 - 0.02, y - 0.12, 0.1), (DECK_W / 2 + 0.02, y + 0.12, 0.15), "iron", bottom=True)
    deck.boxmm((-DECK_W / 2, -L, -0.42), (DECK_W / 2, -L + 0.25, -0.18), "wood_dark", bottom=True)
    for s in (-1, 1):
        deck.boxmm((s * DECK_W / 2 - 0.12 * (s > 0), -L, -0.36), (s * DECK_W / 2 + 0.12 * (s < 0), 0.0, 0.18), "wood_dark", bottom=True)
        for k in range(6):
            y = -0.4 - k * (L - 0.8) / 5
            deck.box((0.14, 0.14, 1.3), (s * (DECK_W / 2 + 0.07), y, 0.77), "timber", bottom=True)
        deck.tube((s * (DECK_W / 2 + 0.07), -0.4, 1.38), (s * (DECK_W / 2 + 0.07), -L + 0.4, 1.38), 0.06, "wood", segs=5)
        deck.tube((s * (DECK_W / 2 + 0.07), -0.4, 0.8), (s * (DECK_W / 2 + 0.07), -L + 0.4, 0.8), 0.035, "hay_dark", segs=4)
        deck.cyl(0.16, 0.05, (s * 2.0, -L + 0.2, 0.2), "iron", segs=8, rot=(0, 90, 0))
    anchors = []
    for s, nm in ((-1, "ChainAnchorL"), (1, "ChainAnchorR")):
        a = Node(nm)
        deck.children.append((a, (s * 2.0, -L + 0.2, 0.36)))
        anchors.append((s, (s * 2.0, -L + 0.2, 0.36)))
    p.children = [(deck, (0.0, 0.0, 0.0))]
    for s, at in anchors:
        chain = Node("ChainL" if s < 0 else "ChainR")
        for k in range(10):
            y0 = -(k + 0.05) / 10.0
            chain.box((0.1, 0.085, 0.05) if k % 2 else (0.05, 0.085, 0.1), (0, y0 - 0.045, 0), "steel_dark", bottom=True)
        pul = (s * 2.6, 0.6, 6.4)
        d = (at[0] - pul[0], at[1] - pul[1], at[2] - pul[2])
        dist = math.sqrt(d[0] ** 2 + d[1] ** 2 + d[2] ** 2)
        # point the chain's local -Y (the glTF +Z) along d: tilt about X first, then turn about Z (Euler XYZ)
        tilt = math.asin(-d[2] / dist)
        turn = math.atan2(d[0], -d[1])
        chain.rot = (tilt, 0.0, turn)
        chain.scale = (1.0, dist, 1.0)
        p.children.append((chain, pul))
    p.meta["anchors"] = {"hinge": (0.0, 0.0, 0.0), "tip": (0.0, -L, 0.12)}
    p.meta["note"] = ("animated: Hinge (rotate about local X, negative = up), ChainAnchorL/R under Hinge, ChainL/R at the pulleys "
                      "(lookAt the anchors, scale.z = distance); deck 8.4 m x 4.4 m, top 0.12 m; place at raid.drawbridge")
    return p


def _leaf_planks(n, x0, x1, z0, z1, y0, y1, holes=(), cells=("wood", "wood_light")):
    """Vertical planks between x0 and x1 (as a Node mesh builder): returns boxes [(mn, mx, cell)], skipping holes
    (x0, x1, z0, z1) to show damage."""
    out = []
    for i in range(n):
        a = x0 + (x1 - x0) * i / n
        b = x0 + (x1 - x0) * (i + 1) / n
        spans = [(z0, z1)]
        for hx0, hx1, hz0, hz1 in holes:
            if a < hx1 and b > hx0:
                new = []
                for s0, s1 in spans:
                    if hz1 <= s0 or hz0 >= s1:
                        new.append((s0, s1))
                        continue
                    if hz0 > s0:
                        new.append((s0, hz0))
                    if hz1 < s1:
                        new.append((hz1, s1))
                spans = new
        for s0, s1 in spans:
            out.append(((a + 0.012, y0, s0), (b - 0.012, y1, s1), cells[i % 2]))
    return out


WICKET_HALF, WICKET_H = 0.75, 2.2       # the wicket door ducks pass through (raid/keep.ts KEEP.wicketHalf, wicketHeight)


def _gate_leaves(node, holes=(), wicket=True):
    """Both oak leaves, the wicket door in the middle (cut out, its own little door swung in), iron bands, studs,
    ring handles and the yellow boss."""
    W, Hh = GATE_W + 0.2, GATE_H
    cut = [(-WICKET_HALF, WICKET_HALF, -0.1, WICKET_H)] if wicket else []
    for side in (-1, 1):
        x0, x1 = sorted((0.0, side * W / 2))
        mine = [h for h in holes if x0 <= (h[0] + h[1]) / 2 <= x1] + cut
        for mn, mx, cell in _leaf_planks(6, x0, x1, 0.02, Hh, -0.13, 0.13, holes=mine):
            node.boxmm(mn, mx, cell, bottom=True)
        for z in (0.55, 2.0, Hh - 0.55):
            spans = [(x0 + 0.05, x1 - 0.05)]
            if wicket and z < WICKET_H + 0.1:
                spans = [(x0 + 0.05, -WICKET_HALF - 0.06)] if side < 0 else [(WICKET_HALF + 0.06, x1 - 0.05)]
            for a, b in spans:
                node.boxmm((a, -0.18, z - 0.09), (b, -0.13, z + 0.09), "iron", bottom=True)
                node.boxmm((a, 0.13, z - 0.09), (b, 0.18, z + 0.09), "iron", bottom=True)
                for k in range(3):
                    node.box((0.07, 0.04, 0.07), (a + (b - a) * (k + 0.5) / 3, -0.2, z), "steel_dark", bottom=True)
    node.boxmm((-0.06, -0.16, WICKET_H if wicket else 0.02), (0.06, 0.16, Hh), "wood_dark", bottom=True)
    if wicket:
        # the wicket frame on the outside, and its door swung in against the right leaf
        for s in (-1, 1):
            node.boxmm((s * WICKET_HALF - 0.08 * (s > 0), -0.2, 0.0), (s * WICKET_HALF + 0.08 * (s < 0), 0.16, WICKET_H), "iron", bottom=True)
        node.boxmm((-WICKET_HALF - 0.08, -0.2, WICKET_H), (WICKET_HALF + 0.08, 0.16, WICKET_H + 0.12), "iron", bottom=True)
        node.boxmm((WICKET_HALF - 0.12, 0.16, 0.02), (WICKET_HALF - 0.04, 0.16 + 2 * WICKET_HALF - 0.08, WICKET_H - 0.04), "wood_light", bottom=True)
        node.boxmm((WICKET_HALF - 0.14, 0.4, 0.5), (WICKET_HALF - 0.12, 1.2, 0.62), "iron", bottom=True)
    for s in (-1, 1):
        node.cyl(0.16, 0.04, (s * 1.3, -0.2, 1.5), "iron", segs=8, rot=(90, 0, 0), caps=True)
    node.cyl(0.32, 0.06, (0.0, -0.18, 2.9), "yellow", segs=10, rot=(90, 0, 0))
    node.cyl(0.18, 0.04, (0.0, -0.22, 2.9), "orange", segs=8, rot=(90, 0, 0))


def castle_gate():
    """The main gate: two oak leaves, 4.2 m wide by 4.2 m tall (overlapping the 4.0 m opening), with a 1.5 m by
    2.2 m wicket door in the middle (open: ducks pass through it, raid/keep.ts), origin at the middle of the
    opening on the ground, the outside facing -Y (the GLB +Z). State nodes: `Intact`, `Damaged` (holes, a
    sagging plank), `Broken` (stumps on the hinges, splinters on the ground), and `Planks` (a nailed plank
    barricade for repairs that leaves the wicket clear, shown over Damaged or Broken). Show one state at a time
    plus Planks as needed. The collider records in colliders.json carry a `states` list (the leaves beside and
    above the wicket for Intact, Damaged and Planks); the map does not place them."""
    p = Prop("castle_gate", "animated")
    for s in (-1, 1):
        for z in (0.55, GATE_H / 2, GATE_H - 0.55):
            p.cyl(0.07, 0.3, (s * (GATE_W / 2 + 0.02), -0.05, z), "steel_dark", segs=6)
    intact = Node("Intact")
    _gate_leaves(intact)
    damaged = Node("Damaged")
    holes = [(-1.7, -1.05, 1.2, 2.0), (0.4, 1.0, 3.05, 3.7), (1.35, 1.75, 0.3, 0.9)]
    _gate_leaves(damaged, holes=holes)
    for x0, x1, z0, z1 in holes:
        damaged.boxmm((x0 + 0.02, -0.05, z0 + 0.02), (x1 - 0.02, 0.05, z1 - 0.02), "dark", bottom=True)
        damaged.box((0.06, 0.05, 0.42), ((x0 + x1) / 2, -0.15, z1 + 0.05), "wood_light", rot=(0, 25, 0), bottom=True)
    damaged.box((0.34, 0.08, 1.4), (-1.6, -0.24, 2.9), "wood", rot=(0, 18, 0), bottom=True)
    broken = Node("Broken")
    for s in (-1, 1):
        x0 = s * (GATE_W / 2 + 0.1)
        for k, hgt in enumerate((1.6, 3.2, 0.9)):
            xa = x0 - s * (0.12 + 0.3 * k)
            broken.boxmm((min(xa, xa - s * 0.28), -0.13, 0.02), (max(xa, xa - s * 0.28), 0.13, 0.02 + hgt), "wood_dark" if k % 2 else "wood", bottom=True)
            broken.box((0.28, 0.26, 0.4), (xa - s * 0.14, 0.0, 0.02 + hgt + 0.1), "wood_light", rot=(0, s * 30, 0), bottom=True)
        broken.boxmm((min(x0, x0 - s * 1.0), -0.18, 3.6), (max(x0, x0 - s * 1.0), -0.13, 3.78), "iron", bottom=True)
    rng = Rng(5)
    for k in range(7):
        x, y = rng.range(-1.8, 1.8), rng.range(-1.6, 1.2)
        broken.box((rng.range(0.6, 1.4), 0.24, 0.06), (x, y, 0.03), "wood" if k % 2 else "wood_light", rot_z=rng.range(-60, 60), bottom=True)
    planks = Node("Planks")
    # across the top, then crossed boards on each side of the wicket
    for k, (z, ang) in enumerate(((2.55, 4), (3.3, -6), (3.95, 3))):
        planks.box((GATE_W + 0.5, 0.12, 0.34), (0.0, -0.3, z), "plank_grey" if k % 2 else "wood_light", rot=(0, ang, 0), bottom=True)
    for s in (-1, 1):
        cx = s * (WICKET_HALF + 0.65)
        for ang in (38, -38):
            planks.box((1.9, 0.12, 0.3), (cx, -0.32 - 0.05 * (ang > 0), 1.15), "wood" if ang > 0 else "wood_dark", rot=(0, ang, 0), bottom=True)
        planks.box((0.3, 0.12, 2.2), (s * (WICKET_HALF + 0.2), -0.42, 1.1), "wood_light", bottom=True)
        for z in (0.45, 1.85):
            planks.box((0.07, 0.04, 0.07), (s * (WICKET_HALF + 0.2), -0.5, z), "steel_dark", bottom=True)
    p.children = [(intact, (0, 0, 0)), (damaged, (0, 0, 0)), (broken, (0, 0, 0)), (planks, (0, 0, 0))]
    for s in (-1, 1):
        x0, x1 = sorted((s * WICKET_HALF, s * GATE_W / 2))
        p.col_boxmm("wall", (x0, -0.15, 0.0), (x1, 0.15, GATE_H))
        p.colliders[-1]["states"] = ["Intact", "Damaged", "Planks"]
    p.col_boxmm("wall", (-WICKET_HALF, -0.15, WICKET_H), (WICKET_HALF, 0.15, GATE_H))
    p.colliders[-1]["states"] = ["Intact", "Damaged", "Planks"]
    p.meta["anchors"] = {"opening": (0.0, 0.0, 0.0), "top": (0.0, 0.0, GATE_H), "wicket": (0.0, 0.0, 0.0)}
    p.meta["note"] = "animated: state nodes Intact, Damaged, Broken plus the Planks barricade; colliders carry `states`; place at raid.gate"
    return p


def castle_lever():
    """The drawbridge winch in the courtyard by the gate: a timber frame with a chain drum and a big lever. The
    `Handle` node turns about its local X on the drum axle (0.9 m up): 0 is the bridge down (the handle leans
    back, toward +Y), about +1.4 rad pulls it forward and raises the bridge (three.js: handle.rotation.x)."""
    p = Prop("castle_lever", "animated")
    for s in (-1, 1):
        p.box((0.22, 0.22, 1.25), (s * 0.55, 0.0, 0.62), "timber", bottom=True)
        p.box((0.3, 0.6, 0.12), (s * 0.55, 0.0, 0.06), "wood_dark", bottom=True)
    p.cyl(0.26, 0.9, (0.0, 0.0, 0.9), "wood", segs=8, rot=(0, 90, 0), cap_cell="wood_dark")
    for k in range(5):
        p.cyl(0.29, 0.06, (-0.32 + k * 0.16, 0.0, 0.9), "steel_dark", segs=8, rot=(0, 90, 0), caps=False)
    p.tube((0.0, -0.2, 1.0), (0.0, -0.9, 3.4), 0.04, "steel_dark", segs=4)
    p.box((1.4, 0.25, 0.08), (0.0, 0.0, 1.27), "wood_dark", bottom=True)
    handle = Node("Handle")
    handle.tube((0.5, 0.0, 0.0), (0.5, 0.75, 1.15), 0.07, "wood_dark", segs=6)
    handle.tube((0.5, 0.75, 1.15), (0.5, 0.8, 1.25), 0.09, "yellow", segs=6)
    handle.sphere(0.13, (0.5, 0.82, 1.3), "yellow", segs=8, rings=4, smooth=False)
    handle.box((0.16, 0.16, 0.22), (0.5, 0.0, 0.0), "iron", bottom=True)
    p.children = [(handle, (0.0, 0.0, 0.9))]
    p.meta["anchors"] = {"base": (0.0, 0.0, 0.0), "axle": (0.0, 0.0, 0.9)}
    p.meta["note"] = "animated: Handle (local X on the drum axle, + raises the bridge); place at raid.lever, facing the gate"
    return p


def bread_cannon():
    """The bread cannon on a tower top. Root: the turntable plate (static). `Yaw` (turn about local Y) carries the
    yoke, a bread basket and the handles; `Pitch` (on the trunnions, 0.95 m up; turn about local X, negative =
    muzzle up in three.js) carries the barrel; `Muzzle` marks the mouth (+Z of the GLB is the shot direction)."""
    p = Prop("bread_cannon", "animated")
    p.cyl(0.55, 0.1, (0, 0, 0.05), "wood_dark", segs=10, cap_cell="wood")
    p.cyl(0.58, 0.05, (0, 0, 0.1), "iron", segs=10, caps=False)
    yaw = Node("Yaw")
    yaw.cyl(0.5, 0.12, (0, 0, 0.16), "wood", segs=10, cap_cell="wood_light")
    for s in (-1, 1):
        yaw.hull([(s * 0.3, -0.45, 0.22), (s * 0.42, -0.45, 0.22), (s * 0.3, 0.5, 0.22), (s * 0.42, 0.5, 0.22),
                  (s * 0.3, -0.12, 1.08), (s * 0.42, -0.12, 1.08), (s * 0.3, 0.15, 1.08), (s * 0.42, 0.15, 1.08)], "wood")
        yaw.box((0.14, 0.4, 0.06), (s * 0.36, 0.0, 0.98), "iron", bottom=True)
    # handles at the back for the duck, a basket of loaves on the left
    yaw.tube((-0.36, 0.5, 0.45), (-0.36, 0.95, 0.75), 0.04, "wood_dark", segs=5)
    yaw.tube((0.36, 0.5, 0.45), (0.36, 0.95, 0.75), 0.04, "wood_dark", segs=5)
    yaw.tube((-0.4, 0.95, 0.75), (0.4, 0.95, 0.75), 0.05, "yellow", segs=6)
    yaw.cyl(0.28, 0.3, (-0.72, 0.2, 0.42), "hay_dark", segs=8, r2=0.33, cap_cell="hay")
    for k in range(3):
        yaw.sphere((0.16, 0.08, 0.07), (-0.72 + (k - 1) * 0.12, 0.2 + (k % 2) * 0.06, 0.62), "bread", segs=7, rings=4, rot=(0, 0, 30 * k))
    pitch = Node("Pitch")
    # the barrel along -Y: breech knob, bronze body with yellow bands, flared muzzle, a loaf in the mouth
    pitch.sphere(0.2, (0, 0.78, 0), "bronze", segs=8, rings=5, smooth=True)
    pitch.cyl(0.33, 0.4, (0, 0.5, 0), "bronze", segs=12, rot=(90, 0, 0))
    pitch.cyl(0.3, 1.5, (0, -0.45, 0), "bronze", segs=12, r2=0.26, rot=(90, 0, 0), caps=False, smooth=True)
    pitch.cyl(0.36, 0.28, (0, -1.25, 0), "bronze", segs=12, r2=0.42, rot=(90, 0, 0), caps=False, smooth=True)
    pitch.cyl(0.42, 0.06, (0, -1.4, 0), "yellow", segs=12, rot=(90, 0, 0), caps=False)
    pitch.cyl(0.3, 0.02, (0, -1.41, 0), "dark", segs=12, rot=(90, 0, 0))
    for y in (0.22, -0.2, -0.85):
        pitch.cyl(0.34 if y > 0 else 0.31, 0.08, (0, y, 0), "yellow", segs=12, rot=(90, 0, 0), caps=False)
    pitch.tube((-0.46, 0.0, 0.0), (0.46, 0.0, 0.0), 0.08, "iron", segs=6)
    pitch.sphere((0.2, 0.3, 0.17), (0, -1.38, 0.02), "bread", segs=8, rings=5, smooth=True)
    for k in range(3):
        pitch.box((0.22, 0.03, 0.02), (0, -1.52 + k * 0.1, 0.17), "cream", rot=(0, 0, 70), bottom=True)
    muzzle = Node("Muzzle")
    pitch.children.append((muzzle, (0.0, -1.55, 0.0)))
    yaw.children.append((pitch, (0.0, 0.0, 0.95)))
    p.children = [(yaw, (0.0, 0.0, 0.0))]
    p.meta["anchors"] = {"pivot": (0.0, 0.0, 0.0), "trunnion": (0.0, 0.0, 0.95), "muzzle": (0.0, -1.55, 0.95)}
    p.meta["note"] = ("animated: Yaw (local Y), Pitch at 0.95 m (local X, negative = up), Muzzle at the mouth 1.55 m ahead; the GLB +Z is "
                      "the shot direction; place at raid.cannons (rotY = yaw + PI)")
    return p


def bread_loaf():
    """The bread cannon's shot (mesh only): a plump loaf, 0.5 m long along the GLB +Z."""
    p = Prop("bread_loaf", "animated")
    p.sphere((0.17, 0.27, 0.13), (0, 0, 0.13), "bread", segs=10, rings=6, smooth=True)
    for k in range(3):
        p.box((0.2, 0.035, 0.02), (0, -0.12 + k * 0.12, 0.255), "cream", rot=(0, 0, 65), bottom=True)
    p.meta["note"] = "bread cannon shot, origin at the loaf's bottom center"
    return p


BUILDERS = [castle_tower, castle_wall, castle_wall_short, castle_gatehouse, castle_bridge, castle_core, castle_well,
            castle_drawbridge, castle_gate, castle_lever, bread_cannon, bread_loaf]
