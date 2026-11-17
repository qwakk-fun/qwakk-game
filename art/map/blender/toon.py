"""Toon look for review renders (same recipe as the duck): 2-band ramp on a fixed world light,
shadow side multiplied by #d9a6a0, optional inverted-hull outline in #151619."""

import math

import bpy
from mathutils import Vector

import kit


def setup_scene(samples=24, size=(1024, 1024), bg="#151619"):
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x, scene.render.resolution_y = size
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = False
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGB"
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "None"
    scene.eevee.taa_render_samples = samples
    set_background(bg)


def set_background(hex_color):
    scene = bpy.context.scene
    world = scene.world or bpy.data.worlds.new("World")
    scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes.get("Background")
    bg.inputs["Color"].default_value = (*kit.hex_to_linear(hex_color), 1.0)
    bg.inputs["Strength"].default_value = 1.0


def toon_material(image, name="PropsToon", color_attr=None, light_dir=kit.LIGHT_DIR, tint=kit.TOON_SHADOW_TINT):
    """Emission toon shader. `image` is the palette; with `color_attr` the base color comes from a
    vertex color attribute instead (terrain)."""
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    if color_attr:
        tex = nt.nodes.new("ShaderNodeAttribute")
        tex.attribute_name = color_attr
        base = tex.outputs["Color"]
    else:
        tex = nt.nodes.new("ShaderNodeTexImage")
        tex.image = image
        tex.interpolation = "Closest"
        base = tex.outputs["Color"]
    geom = nt.nodes.new("ShaderNodeNewGeometry")
    light = nt.nodes.new("ShaderNodeCombineXYZ")
    lv = Vector(light_dir).normalized()
    light.inputs[0].default_value, light.inputs[1].default_value, light.inputs[2].default_value = lv
    dot = nt.nodes.new("ShaderNodeVectorMath")
    dot.operation = "DOT_PRODUCT"
    nt.links.new(geom.outputs["Normal"], dot.inputs[0])
    nt.links.new(light.outputs[0], dot.inputs[1])
    remap = nt.nodes.new("ShaderNodeMapRange")
    remap.inputs["From Min"].default_value = -1.0
    remap.inputs["From Max"].default_value = 1.0
    nt.links.new(dot.outputs["Value"], remap.inputs["Value"])
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.interpolation = "CONSTANT"
    ramp.color_ramp.elements[0].color = (0, 0, 0, 1)
    ramp.color_ramp.elements[1].position = 0.5 + kit.TOON_THRESHOLD / 2
    ramp.color_ramp.elements[1].color = (1, 1, 1, 1)
    nt.links.new(remap.outputs["Result"], ramp.inputs["Fac"])
    shade = nt.nodes.new("ShaderNodeMix")
    shade.data_type = "RGBA"
    shade.blend_type = "MULTIPLY"
    shade.inputs["Factor"].default_value = 1.0
    nt.links.new(base, shade.inputs[6])
    shade.inputs[7].default_value = (*kit.hex_to_linear(tint), 1.0)
    mix = nt.nodes.new("ShaderNodeMix")
    mix.data_type = "RGBA"
    nt.links.new(ramp.outputs["Color"], mix.inputs["Factor"])
    nt.links.new(shade.outputs[2], mix.inputs[6])
    nt.links.new(base, mix.inputs[7])
    emit = nt.nodes.new("ShaderNodeEmission")
    nt.links.new(mix.outputs[2], emit.inputs["Color"])
    nt.links.new(emit.outputs[0], out.inputs["Surface"])
    return mat


def flat_material(name, hex_color, alpha=1.0):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    emit = nt.nodes.new("ShaderNodeEmission")
    emit.inputs["Color"].default_value = (*kit.hex_to_linear(hex_color), 1.0)
    if alpha >= 1.0:
        nt.links.new(emit.outputs[0], out.inputs["Surface"])
        return mat
    transp = nt.nodes.new("ShaderNodeBsdfTransparent")
    mix = nt.nodes.new("ShaderNodeMixShader")
    mix.inputs["Fac"].default_value = alpha
    nt.links.new(transp.outputs[0], mix.inputs[1])
    nt.links.new(emit.outputs[0], mix.inputs[2])
    nt.links.new(mix.outputs[0], out.inputs["Surface"])
    mat.surface_render_method = "BLENDED"
    return mat


_OUTLINE = {}


def add_outline(obj, width=kit.OUTLINE_WIDTH):
    """Inverted hull with a Solidify modifier: shell pushed outward, normals flipped, back faces culled."""
    if "mat" not in _OUTLINE:
        m = flat_material("Outline", kit.OUTLINE_COLOR)
        m.use_backface_culling = True
        _OUTLINE["mat"] = m
    mat = _OUTLINE["mat"]
    if mat.name not in obj.data.materials:
        obj.data.materials.append(mat)
    slot = list(obj.data.materials).index(mat)
    mod = obj.modifiers.new("Outline", "SOLIDIFY")
    mod.thickness = width
    mod.offset = 1.0
    mod.use_flip_normals = True
    mod.use_rim = False
    mod.material_offset = slot
    mod.use_quality_normals = True
    return mod


def camera(name, location, target, lens=50, ortho_scale=None):
    data = bpy.data.cameras.new(name)
    data.lens = lens
    data.clip_start = 0.1
    data.clip_end = 5000
    if ortho_scale:
        data.type = "ORTHO"
        data.ortho_scale = ortho_scale
    cam = bpy.data.objects.new(name, data)
    bpy.context.scene.collection.objects.link(cam)
    cam.location = location
    d = Vector(target) - Vector(location)
    cam.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
    return cam


def orbit_camera(name, target, dist, yaw_deg, pitch_deg, lens=50):
    """yaw 0 looks at the front (camera on -Y), positive yaw swings to the prop's right (+X)."""
    yaw, pitch = math.radians(yaw_deg), math.radians(pitch_deg)
    t = Vector(target)
    loc = t + Vector((math.sin(yaw) * math.cos(pitch), -math.cos(yaw) * math.cos(pitch), math.sin(pitch))) * dist
    return camera(name, loc, t, lens)


def fit_camera(name, objs, yaw_deg=35, pitch_deg=24, lens=50, margin=1.08, aspect=1.0):
    """Frame the bounding sphere of `objs`."""
    pts = []
    for o in objs:
        pts += [o.matrix_world @ Vector(c) for c in o.bound_box]
    mn = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    mx = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    center = (mn + mx) / 2
    radius = (mx - mn).length / 2
    fov = 2 * math.atan(18.0 / lens)
    if aspect < 1.0:
        fov *= aspect
    dist = radius * margin / math.sin(fov / 2)
    return orbit_camera(name, center, dist, yaw_deg, pitch_deg, lens), center, radius


def text(body, loc, size, color="#e8e8ea", rot=(math.radians(90), 0, 0), align="CENTER", parent=None, name=None):
    curve = bpy.data.curves.new(name or ("txt_" + body[:20]), "FONT")
    curve.body = body
    curve.size = size
    curve.align_x = align
    obj = bpy.data.objects.new(name or ("txt_" + body[:20]), curve)
    bpy.context.scene.collection.objects.link(obj)
    obj.location = loc
    obj.rotation_euler = rot
    obj.data.materials.append(flat_material("txt_mat_" + color, color))
    if parent is not None:
        obj.parent = parent
    return obj


def ground_disc(radius, color="#23262d", z=-0.003):
    bpy.ops.mesh.primitive_circle_add(vertices=64, radius=radius, fill_type="NGON", location=(0, 0, z))
    disc = bpy.context.active_object
    disc.name = "GroundDisc"
    disc.data.materials.append(flat_material("Ground_" + color, color))
    return disc


def no_render_metadata(scene):
    """Keep the machine's file path, date and host out of the PNG text chunks."""
    for attr in dir(scene.render):
        if attr.startswith("use_stamp_"):
            setattr(scene.render, attr, False)


def render(cam, path):
    scene = bpy.context.scene
    no_render_metadata(scene)
    scene.camera = cam
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
