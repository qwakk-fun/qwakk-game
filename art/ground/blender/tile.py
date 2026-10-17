"""Ground tile toolkit: a periodic geometry accumulator (every piece that crosses
a tile edge is copied to the other side, so the render tiles), vectorized
generators for blades, leaves, pebbles and stones, the ground sheet under them,
and the top-down Cycles render of the albedo and the height."""

import math

import bmesh
import bpy
import numpy as np

TILE = 4.0  # meters per tile
SIZE = 512  # pixels per tile side
LIGHT = np.array([-0.35, 0.45, 1.0]) / np.linalg.norm([-0.35, 0.45, 1.0])


def srgb_to_linear(c):
    c = np.asarray(c, dtype=np.float64)
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def linear_to_srgb(c):
    c = np.clip(np.asarray(c, dtype=np.float64), 0.0, 1.0)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * c ** (1 / 2.4) - 0.055)


def lin(hex_color):
    """'#rrggbb' to a linear RGB numpy triple."""
    h = hex_color.lstrip("#")
    return srgb_to_linear([int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)])


def palette(hexes):
    return np.array([lin(h) for h in hexes])


def pick(rng, pal, n):
    return pal[rng.integers(0, len(pal), n)]


def vary(rng, cols, amount):
    """Per-instance brightness jitter, +-amount."""
    return cols * (1 + rng.uniform(-amount, amount, (len(cols), 1)))


class Acc:
    """Triangles plus a per-vertex linear color, wrapped around the tile."""

    def __init__(self):
        self.verts = []
        self.tris = []
        self.cols = []
        self.count = 0

    def add(self, verts, tris, cols):
        """verts (B, k, 3), tris (m, 3) template, cols (B, k, 3) or (B, 3). Wraps each instance."""
        verts = np.asarray(verts, dtype=np.float64)
        if verts.ndim == 2:
            verts = verts[None]
        cols = np.asarray(cols, dtype=np.float64)
        if cols.ndim == 2:
            cols = np.repeat(cols[:, None, :], verts.shape[1], axis=1)
        lo = verts[..., :2].min(axis=1)
        hi = verts[..., :2].max(axis=1)
        for dx in (-TILE, 0.0, TILE):
            for dy in (-TILE, 0.0, TILE):
                keep = (lo[:, 0] + dx < TILE) & (hi[:, 0] + dx > 0) & (lo[:, 1] + dy < TILE) & (hi[:, 1] + dy > 0)
                if not keep.any():
                    continue
                v = verts[keep].copy()
                v[..., 0] += dx
                v[..., 1] += dy
                b, k = v.shape[:2]
                base = self.count + np.arange(b)[:, None, None] * k
                self.tris.append((np.asarray(tris)[None] + base).reshape(-1, 3))
                self.verts.append(v.reshape(-1, 3))
                self.cols.append(cols[keep].reshape(-1, 3))
                self.count += b * k

    def to_object(self, name):
        verts = np.concatenate(self.verts)
        tris = np.concatenate(self.tris)
        cols = np.concatenate(self.cols)
        mesh = bpy.data.meshes.new(name)
        mesh.vertices.add(len(verts))
        mesh.vertices.foreach_set("co", verts.astype(np.float32).ravel())
        mesh.loops.add(len(tris) * 3)
        mesh.loops.foreach_set("vertex_index", tris.astype(np.int32).ravel())
        mesh.polygons.add(len(tris))
        mesh.polygons.foreach_set("loop_start", np.arange(0, len(tris) * 3, 3, dtype=np.int32))
        mesh.update(calc_edges=True)
        attr = mesh.color_attributes.new("Col", "FLOAT_COLOR", "POINT")
        rgba = np.ones((len(cols), 4), dtype=np.float32)
        rgba[:, :3] = np.clip(cols, 0, None)
        attr.data.foreach_set("color", rgba.ravel())
        obj = bpy.data.objects.new(name, mesh)
        bpy.context.scene.collection.objects.link(obj)
        return obj


# ---------------------------------------------------------------- generators


def strips(acc, base, azim, lean, length, width, col_base, col_tip, profile=(1.0, 0.7, 0.4), bend=0.65, tilt=None):
    """Blades and leaves: a 3-segment strip from `base` (B, 3) leaning `lean` radians from vertical
    toward `azim`, widening by `profile` and ending in a point. `bend` is how much of the lean is
    reached only at the tip (curl). `tilt` (B,) rolls the strip about its own axis."""
    b = len(base)
    t = np.array([0.0, 1 / 3, 2 / 3, 1.0])
    theta = lean[:, None] * ((1 - bend) + bend * t[None, :])
    seg = (length / 3)[:, None]
    d_h = np.stack([np.cos(azim), np.sin(azim)], axis=1)
    # Centerline: integrate the segment directions.
    step_h = seg * np.sin(theta[:, 1:])
    step_z = seg * np.cos(theta[:, 1:])
    center = np.zeros((b, 4, 3))
    center[:, 0] = base
    for i in range(3):
        center[:, i + 1, 0] = center[:, i, 0] + step_h[:, i] * d_h[:, 0]
        center[:, i + 1, 1] = center[:, i, 1] + step_h[:, i] * d_h[:, 1]
        center[:, i + 1, 2] = center[:, i, 2] + step_z[:, i]
    side = np.stack([-d_h[:, 1], d_h[:, 0], np.zeros(b)], axis=1)
    if tilt is not None:
        side = side * np.cos(tilt)[:, None] + np.array([0, 0, 1.0]) * np.sin(tilt)[:, None]
    verts = np.zeros((b, 7, 3))
    for i in range(3):
        w = (width * profile[i] / 2)[:, None]
        verts[:, 2 * i] = center[:, i] - side * w
        verts[:, 2 * i + 1] = center[:, i] + side * w
    verts[:, 6] = center[:, 3]
    tris = np.array([[0, 1, 3], [0, 3, 2], [2, 3, 5], [2, 5, 4], [4, 5, 6]])
    k = np.array([0, 0, 1, 1, 2, 2, 3]) / 3.0
    cols = col_base[:, None, :] * (1 - k[None, :, None]) + col_tip[:, None, :] * k[None, :, None]
    acc.add(verts, tris, cols)
    return center


def _icosphere(subdiv):
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=subdiv, radius=1.0)
    bm.verts.ensure_lookup_table()
    v = np.array([vv.co[:] for vv in bm.verts])
    f = np.array([[vv.index for vv in face.verts] for face in bm.faces])
    bm.free()
    return v, f


def _rounded_box(bevel=0.22, segments=2):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=2.0)
    bmesh.ops.bevel(bm, geom=list(bm.edges), offset=bevel, segments=segments, affect="EDGES", profile=0.5)
    bmesh.ops.triangulate(bm, faces=list(bm.faces))
    bm.verts.ensure_lookup_table()
    v = np.array([vv.co[:] for vv in bm.verts])
    f = np.array([[vv.index for vv in face.verts] for face in bm.faces])
    bm.free()
    return v, f


_SPHERE = {}
_BOX = {}


def _rot(yaw, pitch=None, roll=None):
    """Rotation matrices (B, 3, 3): yaw about Z, then optional small tilts."""
    b = len(yaw)
    cz, sz = np.cos(yaw), np.sin(yaw)
    rz = np.zeros((b, 3, 3))
    rz[:, 0, 0], rz[:, 0, 1], rz[:, 1, 0], rz[:, 1, 1], rz[:, 2, 2] = cz, -sz, sz, cz, 1
    m = rz
    if pitch is not None:
        cx, sx = np.cos(pitch), np.sin(pitch)
        rx = np.zeros((b, 3, 3))
        rx[:, 0, 0], rx[:, 1, 1], rx[:, 1, 2], rx[:, 2, 1], rx[:, 2, 2] = 1, cx, -sx, sx, cx
        m = m @ rx
    if roll is not None:
        cy, sy = np.cos(roll), np.sin(roll)
        ry = np.zeros((b, 3, 3))
        ry[:, 0, 0], ry[:, 0, 2], ry[:, 1, 1], ry[:, 2, 0], ry[:, 2, 2] = cy, sy, 1, -sy, cy
        m = m @ ry
    return m


def blobs(acc, rng, center, scale, cols, yaw=None, tilt=0.0, jitter=0.15, subdiv=1, shade_bottom=0.25, basis=None):
    """Pebbles, clods, stones and grain heads: jittered icospheres, faceted.
    center (B, 3), scale (B, 3) radii. `basis` (B, 3, 3) overrides the rotation."""
    if subdiv not in _SPHERE:
        _SPHERE[subdiv] = _icosphere(subdiv)
    tv, tf = _SPHERE[subdiv]
    b = len(center)
    v = tv[None] * (1 + rng.uniform(-jitter, jitter, (b, len(tv), 1)))
    v = v * scale[:, None, :]
    if basis is None:
        yaw = rng.uniform(0, 2 * np.pi, b) if yaw is None else yaw
        basis = _rot(yaw, rng.uniform(-tilt, tilt, b), rng.uniform(-tilt, tilt, b))
    v = np.einsum("bij,bkj->bki", basis, v) + center[:, None, :]
    up = (tv[:, 2] + 1) / 2
    c = cols[:, None, :] * ((1 - shade_bottom) + shade_bottom * up[None, :, None])
    acc.add(v, tf, c)


def boxes(acc, rng, center, size, cols, yaw, tilt=0.0, jitter=0.0, bevel=0.22):
    """Rounded boxes (cobbles, setts): half sizes `size` (B, 3)."""
    key = bevel
    if key not in _BOX:
        _BOX[key] = _rounded_box(bevel)
    tv, tf = _BOX[key]
    b = len(center)
    v = tv[None] * size[:, None, :] / 1.0
    v = v + rng.uniform(-jitter, jitter, v.shape) * size[:, None, :]
    basis = _rot(yaw, rng.uniform(-tilt, tilt, b), rng.uniform(-tilt, tilt, b))
    v = np.einsum("bij,bkj->bki", basis, v) + center[:, None, :]
    up = (tv[:, 2] + 1) / 2
    c = cols[:, None, :] * (0.78 + 0.22 * up[None, :, None])
    acc.add(v, tf, c)


def stars(acc, center, radius, cols, points=5, inner=0.45, col_center=None, yaw=None):
    """Tiny flowers and shells: a flat star fan facing up."""
    b = len(center)
    n = points * 2
    yaw = np.zeros(b) if yaw is None else yaw
    ang = np.arange(n)[None, :] * (2 * np.pi / n) + yaw[:, None]
    r = np.where(np.arange(n) % 2 == 0, 1.0, inner)[None, :] * radius[:, None]
    v = np.zeros((b, n + 1, 3))
    v[:, 0] = center + np.array([0, 0, 0.002])
    v[:, 1:, 0] = center[:, 0:1] + np.cos(ang) * r
    v[:, 1:, 1] = center[:, 1:2] + np.sin(ang) * r
    v[:, 1:, 2] = center[:, 2:3]
    tris = np.array([[0, 1 + i, 1 + (i + 1) % n] for i in range(n)])
    c = np.repeat(cols[:, None, :], n + 1, axis=1)
    if col_center is not None:
        c[:, 0] = col_center
    acc.add(v, tris, c)


def ground_sheet(acc, height_fn, color_fn, res=256, margin=0.25):
    """The ground under everything: a grid over the tile plus a margin, z and color from
    periodic functions of (x, y) in tile units."""
    step = TILE / res
    extra = int(math.ceil(margin / step))
    idx = np.arange(-extra, res + extra + 1)
    gx, gy = np.meshgrid(idx * step, idx * step)
    xn, yn = gx / TILE, gy / TILE
    z = height_fn(xn % 1.0, yn % 1.0)
    col = color_fn(xn % 1.0, yn % 1.0)
    n = len(idx)
    verts = np.stack([gx, gy, z], axis=-1).reshape(-1, 3)
    r, c = np.meshgrid(np.arange(n - 1), np.arange(n - 1), indexing="ij")
    a = (r * n + c).ravel()
    tris = np.concatenate([np.stack([a, a + 1, a + n + 1], 1), np.stack([a, a + n + 1, a + n], 1)])
    # Not wrapped: it already covers the tile and the margin.
    acc.verts.append(verts)
    acc.tris.append(tris + acc.count)
    acc.cols.append(col.reshape(-1, 3))
    acc.count += len(verts)


def scatter(rng, n):
    """Uniform points over the tile."""
    return rng.uniform(0, TILE, (n, 2))


# ---------------------------------------------------------------- scene and render


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.use_denoising = False
    scene.cycles.seed = 7
    scene.cycles.max_bounces = 0
    scene.render.resolution_x = SIZE
    scene.render.resolution_y = SIZE
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = False
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_depth = "8"
    world = bpy.data.worlds.new("World")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.0
    scene.world = world
    cam_data = bpy.data.cameras.new("Cam")
    cam_data.type = "ORTHO"
    cam_data.ortho_scale = TILE
    cam_data.clip_start = 0.1
    cam_data.clip_end = 40.0
    cam = bpy.data.objects.new("Cam", cam_data)
    cam.location = (TILE / 2, TILE / 2, 12.0)
    scene.collection.objects.link(cam)
    scene.camera = cam
    return scene


def _albedo_material(light_k, ao_dist, ao_min):
    """Emission only: vertex color x soft light from a fixed direction x ambient occlusion."""
    mat = bpy.data.materials.new("GroundAlbedo")
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    nodes, links = nt.nodes, nt.links
    attr = nodes.new("ShaderNodeAttribute")
    attr.attribute_name = "Col"
    geo = nodes.new("ShaderNodeNewGeometry")
    # Face the normal up (blades are seen from either side).
    sep = nodes.new("ShaderNodeSeparateXYZ")
    links.new(geo.outputs["Normal"], sep.inputs[0])
    sign = nodes.new("ShaderNodeMath")
    sign.operation = "SIGN"
    links.new(sep.outputs["Z"], sign.inputs[0])
    flip = nodes.new("ShaderNodeVectorMath")
    flip.operation = "SCALE"
    links.new(geo.outputs["Normal"], flip.inputs[0])
    links.new(sign.outputs[0], flip.inputs["Scale"])
    light = nodes.new("ShaderNodeCombineXYZ")
    for i in range(3):
        light.inputs[i].default_value = float(LIGHT[i])
    dot = nodes.new("ShaderNodeVectorMath")
    dot.operation = "DOT_PRODUCT"
    links.new(flip.outputs[0], dot.inputs[0])
    links.new(light.outputs[0], dot.inputs[1])
    # shade = 1 + k * (n.L - up.L), clamped
    shade = nodes.new("ShaderNodeMath")
    shade.operation = "MULTIPLY_ADD"
    shade.use_clamp = False
    links.new(dot.outputs["Value"], shade.inputs[0])
    shade.inputs[1].default_value = light_k
    shade.inputs[2].default_value = 1.0 - light_k * float(LIGHT[2])
    clamp = nodes.new("ShaderNodeClamp")
    clamp.inputs["Min"].default_value = 0.35
    clamp.inputs["Max"].default_value = 1.4
    links.new(shade.outputs[0], clamp.inputs["Value"])
    ao = nodes.new("ShaderNodeAmbientOcclusion")
    ao.samples = 16
    ao.inputs["Distance"].default_value = ao_dist
    aomap = nodes.new("ShaderNodeMapRange")
    aomap.inputs["To Min"].default_value = ao_min
    aomap.inputs["To Max"].default_value = 1.0
    links.new(ao.outputs["AO"], aomap.inputs["Value"])
    f = nodes.new("ShaderNodeMath")
    f.operation = "MULTIPLY"
    links.new(clamp.outputs[0], f.inputs[0])
    links.new(aomap.outputs[0], f.inputs[1])
    col = nodes.new("ShaderNodeVectorMath")
    col.operation = "SCALE"
    links.new(attr.outputs["Color"], col.inputs[0])
    links.new(f.outputs[0], col.inputs["Scale"])
    em = nodes.new("ShaderNodeEmission")
    links.new(col.outputs[0], em.inputs["Color"])
    out = nodes.new("ShaderNodeOutputMaterial")
    links.new(em.outputs[0], out.inputs["Surface"])
    return mat


def _height_material(hmax):
    mat = bpy.data.materials.new("GroundHeight")
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    geo = nt.nodes.new("ShaderNodeNewGeometry")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(geo.outputs["Position"], sep.inputs[0])
    rng = nt.nodes.new("ShaderNodeMapRange")
    rng.clamp = True
    rng.inputs["From Min"].default_value = 0.0
    rng.inputs["From Max"].default_value = hmax
    nt.links.new(sep.outputs["Z"], rng.inputs["Value"])
    em = nt.nodes.new("ShaderNodeEmission")
    nt.links.new(rng.outputs[0], em.inputs["Color"])
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    nt.links.new(em.outputs[0], out.inputs["Surface"])
    return mat


def render_tile(obj, albedo_path, height_path, look, samples):
    """Two top-down renders of the tile: albedo (sRGB) and height (linear 0..1 over look['hmax'])."""
    scene = bpy.context.scene
    obj.data.materials.append(_albedo_material(look["light"], look["ao"], look["aoMin"]))
    scene.cycles.samples = samples
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "None"
    scene.render.image_settings.color_mode = "RGB"
    scene.render.filepath = albedo_path
    bpy.ops.render.render(write_still=True)
    scene.view_layers[0].material_override = _height_material(look["hmax"])
    scene.cycles.samples = max(4, samples // 4)
    scene.view_settings.view_transform = "Raw"
    scene.render.image_settings.color_mode = "BW"
    scene.render.filepath = height_path
    bpy.ops.render.render(write_still=True)
    scene.view_layers[0].material_override = None
