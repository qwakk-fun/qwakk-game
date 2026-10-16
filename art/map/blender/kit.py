"""Qwakk WWII prop kit core: palette, a tiny mesh accumulator with palette UVs, and collider records.

Authoring space is Blender: meters, Z up, the prop front faces -Y, origin on the ground.
The glTF export turns that into Y up with the front facing +Z. Colliders are written in glTF space.
Every primitive can also emit a matching collider (`col="wall"` etc.), so the mesh and the
physics shapes come from the same numbers and cannot drift apart.
"""

import math
from contextlib import contextmanager

import bmesh
import bpy
from mathutils import Euler, Matrix, Quaternion, Vector

# ---------------------------------------------------------------- palette
# Muted WWII and countryside tones, plus the two brand accents used sparingly.
PALETTE = {
    # nature
    "grass": "#8fae55", "grass_dark": "#6f9244", "leaf": "#6f9a3e", "leaf_dark": "#4f7a32",
    "leaf_light": "#9cbf55", "poplar": "#5e8a3a", "hedge": "#5d8a3a", "hedge_dark": "#456f2e",
    "apple": "#c8483a", "trunk": "#6b4a33", "trunk_dark": "#4e3626", "earth": "#8a6a48",
    "earth_dark": "#6d5238", "sand": "#e8d39a", "sand_dark": "#cdb57c", "rock": "#9a9488",
    "rock_dark": "#77726a", "rock_light": "#b8b2a4", "hay": "#e2c46a", "hay_dark": "#c4a54f",
    # buildings
    "stone": "#cfc4aa", "stone_dark": "#ab9f86", "plaster": "#ebe1c8", "plaster_dark": "#d3c6a7",
    "timber": "#5a3f2d", "wood": "#9a7350", "wood_light": "#b89068", "wood_dark": "#6b4f38",
    "plank_grey": "#8f8778", "slate": "#5a6472", "slate_dark": "#444c58", "tile": "#a5523c",
    "tile_dark": "#84402f", "brick": "#a65a42", "shutter_green": "#5f7f5c", "shutter_blue": "#5b7486",
    "window": "#2b2e33", "glass": "#8fb3c2", "concrete": "#b6b2a5", "concrete_dark": "#8e8a7f",
    "rubble": "#a39985", "bronze": "#9a7434", "char": "#3a3633", "white": "#ece6d6",
    "lamp_red": "#b5483a", "lamp_glass": "#f4e7a8", "water": "#4aa3c4",
    # military
    "olive": "#6b6c3c", "olive_dark": "#50522d", "khaki": "#b9a878", "canvas": "#a39a6c",
    "field_grey": "#727a6b", "field_grey_dark": "#575e52", "rust": "#9b5a33", "rust_dark": "#6e3f25",
    "steel": "#5d6168", "steel_dark": "#3e4147", "sandbag": "#c4af7e", "sandbag_dark": "#a38f62",
    "wire": "#4a4a48", "tire": "#2c2c2e", "plane": "#66714b", "plane_belly": "#9aa292",
    # brand accents (sparingly: loot readability, faction marks, the drop plane)
    "yellow": "#ffd43b", "orange": "#ff8a3d", "dark": "#151619",
    # house interiors and details (appended, so the cells above keep their UVs)
    "flagstone": "#c2b69c", "plaster_warm": "#f0dfbd", "wallpaper_green": "#b9c79c", "wallpaper_rose": "#e8c7b2",
    "fabric_red": "#b4493e", "fabric_green": "#6e8f5c", "fabric_blue": "#5d7a9c", "cream": "#f4ecd6",
    "book_red": "#9e3c34", "book_blue": "#40618a", "book_green": "#4f6f3e", "bread": "#d49a55",
    "awning_red": "#c9503d", "rug_red": "#a5463a", "rug_gold": "#d2a44e", "flower_pink": "#e58fa8",
    "shop_green": "#3f6b58", "iron": "#303338", "copper": "#b8713f", "paper": "#f2ebd6",
}
CELL_NAMES = list(PALETTE)
PALETTE_SIZE = 256
PALETTE_CELL = 16
PER_ROW = PALETTE_SIZE // PALETTE_CELL

# Toon recipe, same numbers as the duck (art/blender/params.py).
TOON_SHADOW_TINT = "#d9a6a0"          # characters (the duck)
ENV_SHADOW_TINT = "#b4bccf"           # environment props and terrain: cooler, so stone and plaster do not turn pink
TOON_THRESHOLD = 0.08
LIGHT_DIR = (-0.55, -0.75, 0.85)
OUTLINE_WIDTH = 0.0075
OUTLINE_COLOR = "#151619"


def hex_to_srgb(value):
    value = value.lstrip("#")
    return tuple(int(value[i:i + 2], 16) / 255.0 for i in (0, 2, 4))


def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hex_to_linear(value):
    return tuple(srgb_to_linear(c) for c in hex_to_srgb(value))


def cell_uv(name):
    i = CELL_NAMES.index(name)
    col, row = i % PER_ROW, i // PER_ROW
    return ((col + 0.5) / PER_ROW, 1.0 - (row + 0.5) / PER_ROW)


def build_palette(path):
    size, cell = PALETTE_SIZE, PALETTE_CELL
    img = bpy.data.images.new("props_palette", size, size, alpha=False)
    px = [0.0] * (size * size * 4)
    for i in range(PER_ROW * PER_ROW):
        name = CELL_NAMES[i] if i < len(CELL_NAMES) else None
        r, g, b = hex_to_srgb(PALETTE[name]) if name else (1.0, 0.0, 1.0)
        col, row = i % PER_ROW, i // PER_ROW
        for y in range(size - (row + 1) * cell, size - row * cell):
            for x in range(col * cell, (col + 1) * cell):
                k = (y * size + x) * 4
                px[k:k + 4] = [r, g, b, 1.0]
    img.pixels = px
    img.filepath_raw = path
    img.file_format = "PNG"
    img.save()
    return img


# ---------------------------------------------------------------- small math helpers
def rot_matrix(rot):
    """rot: (rx, ry, rz) degrees, XYZ Euler."""
    return Euler(tuple(math.radians(a) for a in rot), "XYZ").to_matrix().to_4x4()


class Rng:
    """Deterministic xorshift32, so a rebuild gives identical meshes."""

    def __init__(self, seed):
        self.s = (seed * 2654435761) & 0xFFFFFFFF or 1

    def __call__(self):
        s = self.s
        s ^= (s << 13) & 0xFFFFFFFF
        s ^= s >> 17
        s ^= (s << 5) & 0xFFFFFFFF
        self.s = s & 0xFFFFFFFF
        return self.s / 4294967296.0

    def range(self, a, b):
        return a + (b - a) * self()


def _signed_volume(verts, faces):
    vol = 0.0
    for f in faces:
        a = verts[f[0]]
        for i in range(1, len(f) - 1):
            vol += a.dot(verts[f[i]].cross(verts[f[i + 1]]))
    return vol / 6.0


# ---------------------------------------------------------------- the prop builder
class Prop:
    """Accumulates geometry (one palette cell per face) and colliders for one exported prop."""

    def __init__(self, name, category):
        self.name = name
        self.category = category
        self.verts = []
        self.faces = []
        self.cells = []
        self.smooth = []
        self.colliders = []
        self.loot = []          # local loot spawn points (Blender space)
        self.meta = {}
        self.outline = False    # inverted-hull outline in game (loot containers only)
        self._stack = [Matrix.Identity(4)]

    # -- transform stack
    @property
    def m(self):
        return self._stack[-1]

    @contextmanager
    def frame(self, loc=(0, 0, 0), rot_z=0.0, rot=None, scale=None):
        mat = Matrix.Translation(Vector(loc)) @ (rot_matrix(rot) if rot else Matrix.Rotation(math.radians(rot_z), 4, "Z"))
        if scale is not None:
            mat = mat @ Matrix.Diagonal((*scale, 1.0))
        self._stack.append(self.m @ mat)
        try:
            yield
        finally:
            self._stack.pop()

    # -- raw geometry
    def add(self, verts, faces, cell, smooth=False, matrix=None, cells=None, closed=True, drop=None):
        """Append a piece. `matrix` is the piece's local transform (applied before the frame stack).
        Closed pieces get their winding fixed from the signed volume. `drop(face_center, normal)` removes faces."""
        mat = self.m @ (matrix or Matrix.Identity(4))
        vs = [mat @ Vector(v) for v in verts]
        faces = [tuple(f) for f in faces]
        if closed and _signed_volume(vs, faces) < 0:
            faces = [tuple(reversed(f)) for f in faces]
        if drop:
            kept, kept_cells = [], []
            for fi, f in enumerate(faces):
                c = sum((vs[i] for i in f), Vector()) / len(f)
                n = (vs[f[1]] - vs[f[0]]).cross(vs[f[2]] - vs[f[0]]).normalized()
                if not drop(c, n):
                    kept.append(f)
                    kept_cells.append(cells[fi] if cells else cell)
            faces = kept
            cells = kept_cells
        off = len(self.verts)
        self.verts.extend(vs)
        for fi, f in enumerate(faces):
            self.faces.append(tuple(i + off for i in f))
            self.cells.append(cells[fi] if cells else cell)
            self.smooth.append(smooth)

    # -- primitives
    def box(self, size, at, cell, rot=None, bevel=0.0, col=None, top=None, bottom=False, smooth=False, rot_z=0.0):
        """Box of `size` (x, y, z) centered at `at`. `top` recolors the +Z face. `bottom=False` drops the
        -Z face (hidden on the ground). `bevel` chamfers every edge (one segment)."""
        sx, sy, sz = size
        bm = bmesh.new()
        bmesh.ops.create_cube(bm, size=1.0)
        bmesh.ops.scale(bm, vec=(sx, sy, sz), verts=bm.verts)
        if bevel > 0:
            bmesh.ops.bevel(bm, geom=list(bm.edges), offset=min(bevel, min(size) * 0.45), segments=1,
                            affect="EDGES", profile=0.5)
        verts = [v.co.copy() for v in bm.verts]
        faces = [[v.index for v in f.verts] for f in bm.faces]
        normals = [f.normal.copy() for f in bm.faces]
        bm.free()
        cells = []
        for n in normals:
            cells.append(top if (top and n.z > 0.9) else cell)
        local = Matrix.Translation(Vector(at)) @ (rot_matrix(rot) if rot else Matrix.Rotation(math.radians(rot_z), 4, "Z"))
        drop = None
        if not bottom:
            mat = self.m @ local
            zmin = min((mat @ v).z for v in verts)

            def drop(c, n, zmin=zmin):
                return n.z < -0.99 and c.z < zmin + 1e-3
        self.add(verts, faces, cell, smooth=smooth, matrix=local, cells=cells, drop=drop)
        if col:
            self.col_box(col, at, size, rot=rot, rot_z=rot_z)

    def boxmm(self, mn, mx, cell, **kw):
        size = tuple(b - a for a, b in zip(mn, mx))
        at = tuple((a + b) / 2 for a, b in zip(mn, mx))
        self.box(size, at, cell, **kw)

    def cyl(self, r, h, at, cell, segs=8, r2=None, rot=None, caps=True, col=None, smooth=False, cap_cell=None, phase=0.0):
        """Cylinder (or frustum with r2) along local Z from at.z - h/2 to at.z + h/2."""
        r2 = r if r2 is None else r2
        verts, faces = [], []
        for k, (rr, z) in enumerate(((r, -h / 2), (r2, h / 2))):
            for j in range(segs):
                a = 2 * math.pi * j / segs + phase
                verts.append(Vector((math.cos(a) * rr, math.sin(a) * rr, z)))
        for j in range(segs):
            faces.append((j, (j + 1) % segs, segs + (j + 1) % segs, segs + j))
        cells = [cell] * segs
        if caps:
            faces.append(tuple(range(segs - 1, -1, -1)))
            cells.append(cap_cell or cell)
            if r2 > 1e-6:
                faces.append(tuple(range(segs, 2 * segs)))
                cells.append(cap_cell or cell)
        local = Matrix.Translation(Vector(at)) @ (rot_matrix(rot) if rot else Matrix.Identity(4))
        self.add(verts, faces, cell, smooth=smooth, matrix=local, cells=cells, closed=caps)
        if col:
            self.col_cyl(col, at, max(r, r2), h, rot=rot)

    def tube(self, a, b, r, cell, segs=6, r2=None, col=None, smooth=False, caps=True):
        """Cylinder between two points (beams, logs, posts, barrels lying down)."""
        a, b = Vector(a), Vector(b)
        d = b - a
        q = Vector((0, 0, 1)).rotation_difference(d.normalized())
        local = Matrix.Translation((a + b) / 2) @ q.to_matrix().to_4x4()
        verts, faces = [], []
        r2 = r if r2 is None else r2
        h = d.length
        for k, (rr, z) in enumerate(((r, -h / 2), (r2, h / 2))):
            for j in range(segs):
                ang = 2 * math.pi * j / segs + math.pi / segs
                verts.append(Vector((math.cos(ang) * rr, math.sin(ang) * rr, z)))
        for j in range(segs):
            faces.append((j, (j + 1) % segs, segs + (j + 1) % segs, segs + j))
        if caps:
            faces.append(tuple(range(segs - 1, -1, -1)))
            faces.append(tuple(range(segs, 2 * segs)))
        self.add(verts, faces, cell, smooth=smooth, matrix=local, closed=caps)
        if col:
            self.col_capsule(col, a, b, max(r, r2))

    def sphere(self, radii, at, cell, segs=8, rings=5, smooth=True, rot=None, jitter=0.0, rng=None, col=None, flat_bottom=None):
        """Low-poly UV ellipsoid. `jitter` pushes vertices in and out for organic blobs."""
        rx, ry, rz = radii if isinstance(radii, (tuple, list)) else (radii, radii, radii)
        verts, faces = [], []
        for i in range(1, rings):
            phi = math.pi * i / rings
            for j in range(segs):
                a = 2 * math.pi * j / segs + (math.pi / segs if i % 2 else 0)
                k = 1.0 + (rng.range(-jitter, jitter) if (rng and jitter) else 0.0)
                z = -math.cos(phi) * rz * k
                if flat_bottom is not None:
                    z = max(z, flat_bottom)
                verts.append(Vector((math.sin(phi) * math.cos(a) * rx * k, math.sin(phi) * math.sin(a) * ry * k, z)))
        bot = len(verts)
        verts.append(Vector((0, 0, -rz if flat_bottom is None else max(-rz, flat_bottom))))
        top = len(verts)
        verts.append(Vector((0, 0, rz)))
        for i in range(rings - 2):
            for j in range(segs):
                a0 = i * segs + j
                a1 = i * segs + (j + 1) % segs
                b0 = (i + 1) * segs + j
                b1 = (i + 1) * segs + (j + 1) % segs
                if i % 2 == 0:
                    faces.append((a0, a1, b1))
                    faces.append((a0, b1, b0))
                else:
                    faces.append((a0, a1, b0))
                    faces.append((a1, b1, b0))
        for j in range(segs):
            faces.append((bot, (j + 1) % segs, j))
            last = (rings - 2) * segs
            faces.append((top, last + j, last + (j + 1) % segs))
        local = Matrix.Translation(Vector(at)) @ (rot_matrix(rot) if rot else Matrix.Identity(4))
        self.add(verts, faces, cell, smooth=smooth, matrix=local)

    def hull(self, points, cell, col=None, smooth=False, cells_fn=None):
        """Convex hull of points (rocks, berms, wedges). `cells_fn(center, normal)` may pick per-face cells."""
        bm = bmesh.new()
        for p in points:
            bm.verts.new(self.m @ Vector(p))
        res = bmesh.ops.convex_hull(bm, input=list(bm.verts))
        junk = list({*res["geom_interior"], *res["geom_unused"]})
        bmesh.ops.delete(bm, geom=[g for g in junk if isinstance(g, bmesh.types.BMVert)], context="VERTS")
        bmesh.ops.dissolve_limit(bm, angle_limit=math.radians(1.0), verts=list(bm.verts), edges=list(bm.edges))
        bm.verts.index_update()
        bm.normal_update()
        verts = [v.co.copy() for v in bm.verts]
        faces = [[v.index for v in f.verts] for f in bm.faces]
        cells = [cells_fn(f.calc_center_median(), f.normal) if cells_fn else cell for f in bm.faces]
        bm.free()
        # already in frame space: add with an identity frame
        self._stack.append(Matrix.Identity(4))
        try:
            self.add(verts, faces, cell, smooth=smooth, cells=cells)
        finally:
            self._stack.pop()
        if col:
            self.col_hull(col, points)

    def prism(self, poly, length, at, cell, axis="Y", col=None, side_cell=None, rot_z=0.0):
        """Extrude a convex 2D polygon. axis 'Y': poly is (x, z) pairs extruded along Y; 'X': (y, z) along X."""
        n = len(poly)
        verts = []
        for s in (-0.5, 0.5):
            for u, w in poly:
                if axis == "Y":
                    verts.append(Vector((u, s * length, w)))
                else:
                    verts.append(Vector((s * length, u, w)))
        faces = [tuple(range(n)), tuple(range(2 * n - 1, n - 1, -1))]
        cells = [side_cell or cell, side_cell or cell]
        for j in range(n):
            faces.append((j, (j + 1) % n, n + (j + 1) % n, n + j))
            cells.append(cell)
        local = Matrix.Translation(Vector(at)) @ Matrix.Rotation(math.radians(rot_z), 4, "Z")
        self.add(verts, faces, cell, matrix=local, cells=cells)
        if col:
            self.col_hull(col, [tuple(local @ v) for v in verts])

    def patch(self, center, normal, w, h, cell, offset=0.025):
        """One-sided rectangle (window or door decal on a LOD shell) facing `normal`, Z up."""
        n = Vector(normal).normalized()
        u = Vector((0, 0, 1))
        r = u.cross(n)
        c = Vector(center) + n * offset
        pts = [c - r * w / 2 - u * h / 2, c + r * w / 2 - u * h / 2, c + r * w / 2 + u * h / 2, c - r * w / 2 + u * h / 2]
        self.add(pts, [(0, 1, 2, 3)], cell, closed=False)

    def quad(self, pts, cell):
        """A single double-sided card (thin wire strands, torn canvas)."""
        self.add([Vector(p) for p in pts], [(0, 1, 2, 3), (3, 2, 1, 0)], cell, closed=False)

    # -- colliders (recorded in Blender space, converted on write)
    def _xf_point(self, p):
        return self.m @ Vector(p)

    def _xf_rot(self, q):
        return self.m.to_quaternion() @ q

    def col_box(self, kind, at, size, rot=None, rot_z=0.0):
        q = (rot_matrix(rot) if rot else Matrix.Rotation(math.radians(rot_z), 4, "Z")).to_quaternion()
        self.colliders.append({"type": "box", "kind": kind, "c": self._xf_point(at),
                               "h": Vector(size) / 2, "q": self._xf_rot(q)})

    def col_boxmm(self, kind, mn, mx):
        self.col_box(kind, tuple((a + b) / 2 for a, b in zip(mn, mx)), tuple(b - a for a, b in zip(mn, mx)))

    def col_cyl(self, kind, at, r, h, rot=None):
        q = (rot_matrix(rot) if rot else Matrix.Identity(4)).to_quaternion()
        self.colliders.append({"type": "cylinder", "kind": kind, "c": self._xf_point(at), "r": r,
                               "halfHeight": h / 2, "q": self._xf_rot(q)})

    def col_capsule(self, kind, a, b, r):
        a, b = self._xf_point(a), self._xf_point(b)
        d = b - a
        q = Vector((0, 0, 1)).rotation_difference(d.normalized())
        self.colliders.append({"type": "capsule", "kind": kind, "c": (a + b) / 2, "r": r,
                               "halfHeight": max(0.0, d.length / 2), "q": q})

    def col_hull(self, kind, points):
        self.colliders.append({"type": "hull", "kind": kind, "points": [self._xf_point(p) for p in points]})

    def loot_at(self, p, tier_bonus=0):
        self.loot.append((self._xf_point(p), tier_bonus))

    # -- output
    def triangles(self):
        return sum(len(f) - 2 for f in self.faces)

    def to_object(self, material, collection=None):
        mesh = bpy.data.meshes.new(self.name)
        mesh.from_pydata([tuple(v) for v in self.verts], [], self.faces)
        uv = mesh.uv_layers.new(name="UVMap")
        for poly, cell, sm in zip(mesh.polygons, self.cells, self.smooth):
            u, v = cell_uv(cell)
            for li in poly.loop_indices:
                uv.data[li].uv = (u, v)
            poly.use_smooth = sm
        mesh.validate(clean_customdata=False)
        mesh.materials.append(material)
        obj = bpy.data.objects.new(self.name, mesh)
        (collection or bpy.context.scene.collection).objects.link(obj)
        return obj


# ---------------------------------------------------------------- glTF space conversion
def to_gltf_vec(v):
    return (v.x, v.z, -v.y)


def to_gltf_quat(q):
    """Blender quaternion (w, x, y, z) to glTF [x, y, z, w] for the axis change (x, y, z) -> (x, z, -y)."""
    q = q.normalized()
    return (q.x, q.z, -q.y, q.w)


def r4(x):
    return round(float(x), 4) + 0.0


def collider_json(c):
    out = {"type": c["type"], "kind": c["kind"]}
    if c["type"] == "hull":
        out["points"] = [[r4(a) for a in to_gltf_vec(p)] for p in c["points"]]
        return out
    out["c"] = [r4(a) for a in to_gltf_vec(c["c"])]
    q = [r4(a) for a in to_gltf_quat(c["q"])]
    if c["type"] == "box":
        h = c["h"]
        out["h"] = [r4(h.x), r4(h.z), r4(h.y)]
    else:
        # capsules and cylinders run along local glTF Y. Blender authors them along local Z,
        # which the axis change maps to glTF local Y, so the radius and length carry over.
        out["r"] = r4(c["r"])
        out["halfHeight"] = r4(c["halfHeight"])
    if q != [0.0, 0.0, 0.0, 1.0]:
        out["q"] = q
    return out


# ---------------------------------------------------------------- walls with openings
def solid_pieces(length, height, openings):
    """Split a wall (local u from -length/2 to length/2, z from 0 to height) into solid rectangles around
    openings (at, width, bottom, top), with `at` measured from the wall start. Openings may be stacked
    (a door under a window). Returns (u0, u1, z0, z1) pieces; neighbors with the same z profile merge."""
    rects = [(at - length / 2 - w / 2, at - length / 2 + w / 2, bot, tp) for at, w, bot, tp in openings]
    cuts = sorted({-length / 2, length / 2, *[max(-length / 2, min(length / 2, r[0])) for r in rects],
                   *[max(-length / 2, min(length / 2, r[1])) for r in rects]})
    columns = []
    for u0, u1 in zip(cuts, cuts[1:]):
        if u1 - u0 < 1e-4:
            continue
        um = (u0 + u1) / 2
        holes = sorted((r[2], r[3]) for r in rects if r[0] < um < r[1])
        spans, z = [], 0.0
        for hb, ht in holes:
            if hb > z + 1e-4:
                spans.append((z, min(hb, height)))
            z = max(z, ht)
        if z < height - 1e-4:
            spans.append((z, height))
        columns.append([u0, u1, tuple(spans)])
    merged = []
    for col in columns:
        if merged and merged[-1][2] == col[2] and abs(merged[-1][1] - col[0]) < 1e-6:
            merged[-1][1] = col[1]
        else:
            merged.append(col)
    out = []
    for u0, u1, spans in merged:
        for z0, z1 in spans:
            out.append((u0, u1, z0, z1))
    return out


def wall(p, a, b, height, thick, cell, openings=(), z0=0.0, col="wall", top=None, trim=None, bevel=0.0):
    """Straight wall from 2D point a to b (Blender XY, wall centered on the line) with rectangular openings.
    openings: (at, width, bottom, top) with `at` measured from a along the wall. Emits mesh and colliders."""
    a, b = Vector((a[0], a[1])), Vector((b[0], b[1]))
    d = b - a
    length = d.length
    yaw = math.degrees(math.atan2(d.y, d.x))
    mid = (a + b) / 2
    with p.frame((mid.x, mid.y, z0), rot_z=yaw):
        for u0, u1, zb, zt in solid_pieces(length, height, openings):
            p.boxmm((u0, -thick / 2, zb), (u1, thick / 2, zt), cell, col=col, top=top, bevel=bevel, bottom=zb > 1e-4)
    return yaw, mid, length


def opening_frame(p, a, b, opening, thick, cell, z0=0.0, depth=0.06, size=0.12, sill_cell=None, shutters=None):
    """Wood trim around an opening on both faces of a wall from a to b, plus optional open shutters."""
    a, b = Vector(a), Vector(b)
    d = b - a
    length = d.length
    yaw = math.degrees(math.atan2(d.y, d.x))
    mid = (a + b) / 2
    at, w, bot, tp = opening
    x0 = at - length / 2 - w / 2
    x1 = at - length / 2 + w / 2
    with p.frame((mid.x, mid.y, z0), rot_z=yaw):
        for side in (-1, 1):
            y = side * (thick / 2 + depth / 2)
            p.boxmm((x0 - size, y - depth / 2, bot), (x0, y + depth / 2, tp + size), cell)
            p.boxmm((x1, y - depth / 2, bot), (x1 + size, y + depth / 2, tp + size), cell)
            p.boxmm((x0 - size, y - depth / 2, tp), (x1 + size, y + depth / 2, tp + size), cell)
            if bot > 0.05:
                p.boxmm((x0 - size * 1.4, y - depth, bot - size * 0.8), (x1 + size * 1.4, y + depth, bot), sill_cell or cell)
        if shutters:
            # open shutters hinged on the outside face (local -Y is outside by convention)
            sw = w / 2
            y = -(thick / 2 + 0.05)
            p.boxmm((x0 - size - sw, y - 0.05, bot + 0.02), (x0 - size, y + 0.0, tp - 0.02), shutters)
            p.boxmm((x1 + size, y - 0.05, bot + 0.02), (x1 + size + sw, y + 0.0, tp - 0.02), shutters)


def stairs(p, x0, x1, y_start, y_dir, z_start, rise_total, steps, run, cell, col="stairs", thick=None, side_cell=None):
    """Straight run along Y (direction y_dir = +1 or -1), between x0 and x1. Each step is a box from
    the floor (or `thick` below its top) up to its tread. Returns the y where the run ends."""
    rise = rise_total / steps
    for i in range(steps):
        ya = y_start + y_dir * i * run
        yb = ya + y_dir * run
        ztop = z_start + (i + 1) * rise
        zbot = z_start if thick is None else max(z_start, ztop - thick)
        p.boxmm((x0, min(ya, yb), zbot), (x1, max(ya, yb), ztop), cell, col=col, bottom=thick is not None)
    return y_start + y_dir * steps * run


def stairs_x(p, y0, y1, x_start, x_dir, z_start, rise_total, steps, run, cell, col="stairs", thick=None):
    rise = rise_total / steps
    for i in range(steps):
        xa = x_start + x_dir * i * run
        xb = xa + x_dir * run
        ztop = z_start + (i + 1) * rise
        zbot = z_start if thick is None else max(z_start, ztop - thick)
        p.boxmm((min(xa, xb), y0, zbot), (max(xa, xb), y1, ztop), cell, col=col, bottom=thick is not None)
    return x_start + x_dir * steps * run


def gable_roof(p, w, d, eave_z, pitch_deg, overhang, thick, cell, ridge_cell=None, along="X", col="roof", gable_cell=None, wall_t=0.0):
    """Two sloped roof slabs meeting at a ridge. along='X': ridge runs along X, slopes face -Y/+Y.
    Also fills the gable triangles (wall_t thick) with `gable_cell`. Returns the ridge height."""
    span = (d if along == "X" else w) / 2
    run = span + overhang
    rise = math.tan(math.radians(pitch_deg)) * span
    ridge = eave_z + rise
    length = (w if along == "X" else d) + 2 * overhang
    slope_len = run / math.cos(math.radians(pitch_deg))
    t = math.radians(pitch_deg)
    for side in (-1, 1):
        # underside rests on the wall tops; slab center = underside midpoint + normal * thick / 2
        off = run / 2 + math.sin(t) * thick / 2
        cz = ridge - math.tan(t) * run / 2 + math.cos(t) * thick / 2
        if along == "X":
            p.box((length, slope_len, thick), (0, side * off, cz), cell, rot=(-side * pitch_deg, 0, 0), col=col, bottom=True)
        else:
            p.box((slope_len, length, thick), (side * off, 0, cz), cell, rot=(0, side * pitch_deg, 0), col=col, bottom=True)
    # ridge cap
    if ridge_cell:
        if along == "X":
            p.box((length + 0.1, 0.36, 0.22), (0, 0, ridge + thick * 0.55), ridge_cell, rot=(45, 0, 0), bottom=True)
        else:
            p.box((0.36, length + 0.1, 0.22), (0, 0, ridge + thick * 0.55), ridge_cell, rot=(0, 45, 0), bottom=True)
    if gable_cell and wall_t > 0:
        for side in (-1, 1):
            if along == "X":
                x = side * (w / 2 - wall_t / 2)
                tri = [(-span, eave_z), (span, eave_z), (0, ridge)]
                p.prism(tri, wall_t, (x, 0, 0), gable_cell, axis="X", col="wall")
            else:
                y = side * (d / 2 - wall_t / 2)
                tri = [(-span, eave_z), (span, eave_z), (0, ridge)]
                p.prism(tri, wall_t, (0, y, 0), gable_cell, axis="Y", col="wall")
    return ridge
