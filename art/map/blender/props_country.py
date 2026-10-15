"""Countryside and nature: bocage hedgerow, stone wall, fence, signpost, trees, bushes, rocks, crater, rubble.

Blender space: meters, Z up, front faces -Y, origin on the ground. Organic pieces use smooth shading
(soft toon terminator), man-made pieces stay flat shaded.
"""

import math

from mathutils import Vector

from kit import Prop, Rng


def blob(p, at, r, cell, rng, squash=1.0, segs=9, rings=6, jitter=0.12):
    p.sphere((r, r * rng.range(0.85, 1.1), r * squash), at, cell, segs=segs, rings=rings, smooth=True, jitter=jitter, rng=rng,
             rot=(0, 0, rng.range(0, 360)))


# ---------------------------------------------------------------- field boundaries
def hedgerow(lod=0):
    """8 m bocage block: earth bank with a dense hedge on top. 2.9 m tall, blocks sight and movement.
    LOD1: four coarse blobs. LOD2: one long blob on the bank."""
    p = Prop("hedgerow", "country")
    L = 8.0
    rng = Rng(41)
    p.hull([(-L / 2, -1.3, 0), (L / 2, -1.3, 0), (-L / 2, 1.3, 0), (L / 2, 1.3, 0),
            (-L / 2, -0.8, 0.85), (L / 2, -0.8, 0.85), (-L / 2, 0.8, 0.85), (L / 2, 0.8, 0.85)],
           "earth", col="berm", cells_fn=lambda c, n: "grass_dark" if n.z > 0.9 else "earth")
    if lod == 0:
        n = 6
        for i in range(n):
            x = -L / 2 + L * (i + 0.5) / n + rng.range(-0.25, 0.25)
            r = rng.range(1.05, 1.3)
            blob(p, (x, rng.range(-0.2, 0.2), 0.85 + r * 0.8), r, "hedge" if i % 2 else "hedge_dark", rng, squash=1.05)
        for i in range(4):
            x = -L / 2 + L * (i + 0.5) / 4 + rng.range(-0.4, 0.4)
            blob(p, (x, rng.range(-0.3, 0.3), 2.2 + rng.range(0, 0.3)), rng.range(0.75, 0.95), "leaf", rng)
    elif lod == 1:
        for i in range(4):
            x = -L / 2 + L * (i + 0.5) / 4
            blob(p, (x, 0.0, 1.85), 1.3, "hedge" if i % 2 else "hedge_dark", rng, squash=0.95, segs=6, rings=4, jitter=0.08)
    else:
        prof = [(0.95, 0.85), (1.12, 1.6), (0.95, 2.45), (0.45, 2.85)]
        pts = []
        for x, k in ((-L / 2 + 0.1, 1.0), (L / 2 - 0.1, 1.0), (-L / 2 - 0.25, 0.75), (L / 2 + 0.25, 0.75)):
            for y, z in prof:
                for s in (-1, 1):
                    pts.append((x, s * y * k, 0.85 + (z - 0.85) * k))
        p.hull(pts, "hedge", cells_fn=lambda c, n: "hedge" if n.z > 0.5 else "hedge_dark")
    p.col_boxmm("hedge", (-L / 2, -0.95, 0.85), (L / 2, 0.95, 2.9))
    p.meta["note"] = "tile end to end every 8 m along a field edge; leave 4 to 6 m gaps for gates"
    return p


def stone_wall(lod=0):
    """4 m dry stone field wall, 1.0 m tall: low cover you can vault with a jump."""
    p = Prop("stone_wall", "country")
    rng = Rng(42)
    L, T = 4.0, 0.62
    if lod > 0:
        p.boxmm((-L / 2, -T / 2, 0), (L / 2, T / 2, 0.82), "stone", top="stone_dark")
        if lod == 1:
            p.boxmm((-L / 2, -T / 2 - 0.04, 0.82), (L / 2, T / 2 + 0.04, 1.0), "rock_light", bottom=True)
        p.col_boxmm("cover", (-L / 2, -T / 2, 0), (L / 2, T / 2, 1.0))
        return p
    rows = [0.0, 0.3, 0.58, 0.82]
    for r, (z0, z1) in enumerate(zip(rows, rows[1:])):
        x = -L / 2 + (0.0 if r % 2 == 0 else 0.3)
        if r % 2:
            p.box((0.3, T, z1 - z0 - 0.02), (-L / 2 + 0.15, 0, (z0 + z1) / 2), "stone", bevel=0.04, bottom=z0 > 0)
        while x < L / 2 - 0.05:
            w = min(rng.range(0.5, 0.8), L / 2 - x)
            cell = ("stone", "rock_light", "stone_dark", "stone")[int(rng() * 4)]
            p.box((w - 0.03, T - rng.range(0, 0.06), z1 - z0 - 0.02), (x + w / 2, rng.range(-0.02, 0.02), (z0 + z1) / 2), cell,
                  rot=(0, 0, rng.range(-2, 2)), bevel=0.05, bottom=z0 > 0)
            x += w
    x = -L / 2
    while x < L / 2 - 0.1:
        w = min(rng.range(0.4, 0.6), L / 2 - x)
        p.box((w - 0.04, T + 0.08, rng.range(0.16, 0.22)), (x + w / 2, rng.range(-0.03, 0.03), 0.9), "rock_light",
              rot=(rng.range(-5, 5), rng.range(-5, 5), rng.range(-5, 5)), bevel=0.05, bottom=True)
        x += w
    p.col_boxmm("cover", (-L / 2, -T / 2, 0), (L / 2, T / 2, 1.0))
    return p


def wood_fence():
    """3 m post and rail fence, 1.0 m tall. Blocks movement (jumpable), not bullets."""
    p = Prop("wood_fence", "country")
    rng = Rng(43)
    for x in (-1.5, 0.0, 1.5):
        p.box((0.13, 0.13, 1.1), (x, 0, 0.55), "wood_dark", bevel=0.02, rot=(rng.range(-3, 3), rng.range(-3, 3), 0), bottom=True)
    for z in (0.45, 0.85):
        p.box((3.1, 0.07, 0.13), (0, -0.09, z + rng.range(-0.03, 0.03)), "wood", rot=(0, rng.range(-1.5, 1.5), 0), bevel=0.015)
    p.tube((-1.45, -0.1, 0.5), (-0.05, -0.1, 0.85), 0.045, "wood", segs=4)
    p.col_boxmm("fence", (-1.55, -0.15, 0), (1.55, 0.1, 1.0))
    return p


def signpost():
    """Crossroads finger post with three blank painted boards (no real-world text)."""
    p = Prop("signpost", "country")
    p.box((0.16, 0.16, 2.9), (0, 0, 1.45), "wood_dark", bevel=0.02)
    p.box((0.26, 0.26, 0.12), (0, 0, 2.95), "wood", bevel=0.03, bottom=True)
    boards = [(2.45, 20, "white", "yellow"), (2.1, 140, "white", "orange"), (1.75, 255, "khaki", "olive")]
    for z, yaw, face, stripe in boards:
        with p.frame((0, 0, z), rot_z=yaw):
            p.box((1.1, 0.06, 0.26), (0.62, 0, 0), face, bottom=True)
            p.prism([(1.17, -0.13), (1.17, 0.13), (1.36, 0.0)], 0.06, (0, 0, 0), face, axis="Y")
            p.box((0.85, 0.075, 0.06), (0.62, 0, 0.0), stripe, bottom=True)
    p.col_capsule("trunk", (0, 0, 0.1), (0, 0, 2.9), 0.12)
    return p


# ---------------------------------------------------------------- trees and bushes
def tree_oak(lod=0):
    p = Prop("tree_oak", "nature")
    rng = Rng(51)
    if lod == 0:
        p.tube((0, 0, -0.2), (0.1, 0.05, 3.2), 0.42, "trunk", r2=0.28, segs=8, smooth=True)
        p.tube((0.05, 0, 2.6), (1.4, 0.4, 4.2), 0.2, "trunk", r2=0.1, segs=6, smooth=True)
        p.tube((0.05, 0, 2.4), (-1.3, -0.5, 4.0), 0.2, "trunk", r2=0.1, segs=6, smooth=True)
        canopy = [((0.0, 0.0, 5.6), 2.4, "leaf"), ((1.6, 0.5, 4.9), 1.7, "leaf_dark"), ((-1.6, -0.4, 4.8), 1.8, "leaf_dark"),
                  ((0.4, -1.4, 5.0), 1.6, "leaf"), ((-0.3, 1.5, 5.2), 1.7, "leaf_dark"), ((0.3, 0.2, 7.0), 1.6, "leaf_light")]
        for at, r, cell in canopy:
            blob(p, at, r, cell, rng, squash=0.85, segs=10, rings=7)
    elif lod == 1:
        p.tube((0, 0, -0.2), (0.1, 0.05, 3.4), 0.4, "trunk", r2=0.26, segs=5, smooth=True, caps=False)
        for at, r, cell in (((0.0, 0.0, 5.7), 2.6, "leaf"), ((1.4, 0.4, 4.8), 1.9, "leaf_dark"), ((-1.4, -0.3, 4.8), 2.0, "leaf_dark")):
            blob(p, at, r, cell, rng, squash=0.85, segs=6, rings=4, jitter=0.08)
    else:
        p.tube((0, 0, -0.2), (0.1, 0.05, 3.4), 0.4, "trunk", r2=0.26, segs=3, caps=False)
        p.sphere((3.0, 2.9, 2.4), (0.0, 0.0, 5.4), "leaf", segs=5, rings=3, smooth=True)
    p.col_capsule("trunk", (0, 0, 0.3), (0, 0, 3.0), 0.4)
    return p


def tree_poplar(lod=0):
    """Tall columnar poplar, the classic Normandy roadside tree."""
    p = Prop("tree_poplar", "nature")
    rng = Rng(52)
    if lod == 0:
        p.tube((0, 0, -0.2), (0, 0, 4.0), 0.3, "trunk", r2=0.2, segs=7, smooth=True)
        for at, r, sq, cell in (((0, 0, 6.6), 1.55, 2.0, "poplar"), ((0.15, 0.1, 10.0), 1.25, 1.8, "leaf"), ((0, 0, 12.6), 0.75, 1.6, "leaf_light")):
            blob(p, at, r, cell, rng, squash=sq, segs=9, rings=8, jitter=0.08)
    elif lod == 1:
        p.tube((0, 0, -0.2), (0, 0, 4.2), 0.3, "trunk", r2=0.2, segs=4, smooth=True, caps=False)
        blob(p, (0, 0, 6.8), 1.55, "poplar", rng, squash=2.0, segs=6, rings=4, jitter=0.05)
        blob(p, (0.1, 0.05, 10.6), 1.15, "leaf", rng, squash=2.0, segs=6, rings=4, jitter=0.05)
    else:
        p.tube((0, 0, -0.2), (0, 0, 4.2), 0.3, "trunk", r2=0.2, segs=3, caps=False)
        p.sphere((1.5, 1.5, 4.6), (0, 0, 8.6), "poplar", segs=5, rings=3, smooth=True)
    p.col_capsule("trunk", (0, 0, 0.3), (0, 0, 4.0), 0.3)
    return p


def tree_apple(lod=0):
    """Small orchard apple tree with red fruit dots."""
    p = Prop("tree_apple", "nature")
    rng = Rng(53)
    if lod == 0:
        p.tube((0, 0, -0.1), (0.25, 0.1, 1.5), 0.22, "trunk_dark", r2=0.16, segs=7, smooth=True)
        p.tube((0.2, 0.08, 1.3), (1.0, 0.3, 2.3), 0.1, "trunk_dark", segs=5, smooth=True)
        p.tube((0.2, 0.08, 1.3), (-0.8, -0.2, 2.2), 0.1, "trunk_dark", segs=5, smooth=True)
        for at, r, cell in (((0.2, 0.1, 2.9), 1.7, "leaf"), ((1.1, 0.3, 2.6), 1.1, "leaf_dark"), ((-0.8, -0.3, 2.6), 1.15, "leaf_dark"), ((0.1, 0.0, 3.6), 1.0, "leaf_light")):
            blob(p, at, r, cell, rng, squash=0.75, segs=9, rings=6)
        for i in range(11):
            a = rng.range(0, 2 * math.pi)
            z = rng.range(2.2, 3.4)
            r = 1.65 - abs(z - 2.9) * 0.6
            p.box((0.17, 0.17, 0.17), (0.2 + math.cos(a) * r, 0.1 + math.sin(a) * r, z), "apple", bevel=0.04, rot=(0, 0, rng.range(0, 90)))
    elif lod == 1:
        p.tube((0, 0, -0.1), (0.25, 0.1, 1.7), 0.22, "trunk_dark", r2=0.16, segs=4, smooth=True, caps=False)
        blob(p, (0.2, 0.1, 2.9), 1.85, "leaf", rng, squash=0.72, segs=7, rings=4, jitter=0.08)
        blob(p, (0.3, 0.1, 3.5), 1.05, "leaf_light", rng, squash=0.8, segs=5, rings=3, jitter=0.05)
        for k in range(3):
            a = 2.1 * k + 0.4
            p.box((0.24, 0.24, 0.24), (0.2 + math.cos(a) * 1.75, 0.1 + math.sin(a) * 1.75, 2.75), "apple")
    else:
        p.tube((0, 0, -0.1), (0.25, 0.1, 1.7), 0.22, "trunk_dark", r2=0.16, segs=3, caps=False)
        p.sphere((2.0, 1.9, 1.4), (0.2, 0.1, 2.95), "leaf", segs=5, rings=3, smooth=True)
    p.col_capsule("trunk", (0, 0, 0.2), (0.2, 0.08, 1.6), 0.22)
    return p


def bush_round(lod=0):
    p = Prop("bush_round", "nature")
    rng = Rng(54)
    if lod == 0:
        for at, r, cell in (((0, 0, 0.55), 0.85, "leaf"), ((0.55, 0.2, 0.45), 0.6, "leaf_dark"), ((-0.5, -0.15, 0.42), 0.62, "leaf_dark"), ((0.1, -0.1, 1.0), 0.5, "leaf_light")):
            blob(p, at, r, cell, rng, squash=0.85)
    elif lod == 1:
        blob(p, (0, 0, 0.55), 0.95, "leaf", rng, squash=0.85, segs=6, rings=4)
        blob(p, (0.45, 0.15, 0.45), 0.6, "leaf_dark", rng, squash=0.85, segs=5, rings=3)
    else:
        p.sphere((1.0, 0.8, 0.7), (0, 0, 0.5), "leaf", segs=5, rings=3, smooth=True)
    p.col_boxmm("foliage", (-1.0, -0.8, 0), (1.0, 0.8, 1.35))
    return p


def bush_wide(lod=0):
    p = Prop("bush_wide", "nature")
    rng = Rng(55)
    if lod == 0:
        for i in range(5):
            x = -1.6 + i * 0.8 + rng.range(-0.2, 0.2)
            r = rng.range(0.6, 0.85)
            blob(p, (x, rng.range(-0.2, 0.2), r * 0.7), r, "leaf" if i % 2 else "hedge", rng, squash=0.8)
    elif lod == 1:
        for i in range(3):
            blob(p, (-1.3 + i * 1.3, 0.0, 0.55), 0.85, "leaf" if i % 2 else "hedge", rng, squash=0.75, segs=6, rings=4)
    else:
        p.sphere((2.2, 0.8, 0.65), (0, 0, 0.45), "hedge", segs=5, rings=3, smooth=True)
    p.col_boxmm("foliage", (-2.3, -0.8, 0), (2.3, 0.8, 1.2))
    return p


# ---------------------------------------------------------------- rocks
def rock(name, seed, radii, n=34, flat=0.0, sink=0.25):
    p = Prop(name, "nature")
    rng = Rng(seed)
    rx, ry, rz = radii
    pts = []
    for i in range(n):
        u = rng.range(-1, 1)
        a = rng.range(0, 2 * math.pi)
        s = math.sqrt(1 - u * u)
        k = rng.range(0.85, 1.12)
        z = u * rz * k
        if flat and z > rz * flat:
            z = rz * flat + (z - rz * flat) * 0.3
        pts.append((math.cos(a) * s * rx * k, math.sin(a) * s * ry * k, z + rz * (1 - sink)))
    # a flat-ish base ring so the rock sits in the ground
    for i in range(6):
        a = 2 * math.pi * i / 6 + 0.2
        pts.append((math.cos(a) * rx * 0.9, math.sin(a) * ry * 0.9, -0.15))
    p.hull(pts, "rock", col="block", cells_fn=lambda c, n: "rock_light" if n.z > 0.7 else ("rock_dark" if n.z < -0.1 else "rock"))
    return p


def rock_boulder():
    return rock("rock_boulder", 61, (1.1, 0.95, 0.85), n=60, flat=0.6)


def rock_slab():
    return rock("rock_slab", 62, (1.6, 1.1, 0.42), n=56, flat=0.4, sink=0.35)


def rock_spire():
    return rock("rock_spire", 63, (0.9, 0.8, 1.9), n=56, flat=0.85, sink=0.15)


# ---------------------------------------------------------------- battle damage
def crater():
    """Shell crater decal mesh: a raised rim around a dark bowl that sits on the terrain.
    No collider: the terrain heightfield gets a matching dip (see map-design.md)."""
    p = Prop("crater", "country")
    rng = Rng(71)
    prof = [(0.0, 0.03), (1.0, 0.04), (1.8, 0.16), (2.4, 0.38), (2.9, 0.12), (3.4, 0.0)]
    segs = 14
    verts, faces, cells = [], [], []
    for r, z in prof:
        for j in range(segs):
            a = 2 * math.pi * j / segs
            k = 1.0 + (rng.range(-0.08, 0.08) if r > 0 else 0)
            verts.append(Vector((math.cos(a) * r * k, math.sin(a) * r * k, z)))
    for i in range(len(prof) - 1):
        for j in range(segs):
            a0 = i * segs + j
            a1 = i * segs + (j + 1) % segs
            faces.append((a0, a1, a1 + segs, a0 + segs))
            cells.append("earth_dark" if i < 2 else ("earth" if i < 4 else "grass_dark"))
    p.add(verts, faces, "earth", smooth=True, cells=cells, closed=False)
    for i in range(5):
        a = rng.range(0, 2 * math.pi)
        r = rng.range(2.0, 3.0)
        p.box((0.3, 0.22, 0.14), (math.cos(a) * r, math.sin(a) * r, 0.3), "earth_dark", bevel=0.05, rot=(rng.range(-20, 20), 0, rng.range(0, 90)))
    return p


def rubble_pile():
    p = Prop("rubble_pile", "country")
    rng = Rng(72)
    pts = []
    for k in range(10):
        a = 2 * math.pi * k / 10
        r = rng.range(1.7, 2.2)
        pts.append((math.cos(a) * r, math.sin(a) * r * 0.75, 0.0))
    for k in range(5):
        a = 2 * math.pi * k / 5 + 0.4
        r = rng.range(0.3, 0.8)
        pts.append((math.cos(a) * r, math.sin(a) * r, rng.range(0.8, 1.1)))
    p.hull(pts, "rubble", col="berm", cells_fn=lambda c, n: "rubble" if n.z > 0.5 else "stone_dark")
    for k in range(9):
        a = rng.range(0, 2 * math.pi)
        r = rng.range(0.4, 1.7)
        s = rng.range(0.25, 0.5)
        cell = ("stone", "brick", "stone_dark", "plaster")[k % 4]
        p.box((s * 1.5, s, s * 0.6), (math.cos(a) * r, math.sin(a) * r * 0.75, max(0.15, 0.9 - r * 0.45)), cell,
              rot=(rng.range(-30, 30), rng.range(-30, 30), rng.range(0, 180)), bevel=0.04, bottom=True)
    p.tube((-1.4, 0.3, 0.2), (0.9, -0.4, 1.1), 0.1, "char", segs=5)
    return p


BUILDERS = [hedgerow, stone_wall, wood_fence, signpost, tree_oak, tree_poplar, tree_apple, bush_round, bush_wide,
            rock_boulder, rock_slab, rock_spire, crater, rubble_pile]
