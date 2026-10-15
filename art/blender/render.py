"""Toon look for review renders: 2-band ramp, inverted-hull outline, dark brand background.
The same recipe (palette texture, fixed light, back-face hull) maps directly onto a Three.js toon shader."""

import math

import bpy
from mathutils import Vector

import geo
import params as P


def setup_scene(samples=32, size=1024):
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = size
    scene.render.resolution_y = size
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = False
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGB"
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "None"
    scene.eevee.taa_render_samples = samples
    world = scene.world or bpy.data.worlds.new("World")
    scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes.get("Background")
    bg.inputs["Color"].default_value = (*geo.hex_to_linear(P.BACKGROUND), 1.0)
    bg.inputs["Strength"].default_value = 1.0


def toon_material(palette_img, name="DuckToon"):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = palette_img
    tex.interpolation = "Closest"
    geom = nt.nodes.new("ShaderNodeNewGeometry")
    light = nt.nodes.new("ShaderNodeCombineXYZ")
    lv = Vector(P.LIGHT_DIR).normalized()
    light.inputs[0].default_value, light.inputs[1].default_value, light.inputs[2].default_value = lv
    dot = nt.nodes.new("ShaderNodeVectorMath")
    dot.operation = "DOT_PRODUCT"
    nt.links.new(geom.outputs["Normal"], dot.inputs[0])
    nt.links.new(light.outputs[0], dot.inputs[1])
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.interpolation = "CONSTANT"
    ramp.color_ramp.elements[0].position = 0.0
    ramp.color_ramp.elements[0].color = (0, 0, 0, 1)
    ramp.color_ramp.elements[1].position = 0.5 + P.TOON_THRESHOLD / 2   # dot in [-1, 1] mapped to [0, 1]
    ramp.color_ramp.elements[1].color = (1, 1, 1, 1)
    remap = nt.nodes.new("ShaderNodeMapRange")
    remap.inputs["From Min"].default_value = -1.0
    remap.inputs["From Max"].default_value = 1.0
    nt.links.new(dot.outputs["Value"], remap.inputs["Value"])
    nt.links.new(remap.outputs["Result"], ramp.inputs["Fac"])
    shade = nt.nodes.new("ShaderNodeMix")
    shade.data_type = "RGBA"
    shade.blend_type = "MULTIPLY"
    shade.inputs["Factor"].default_value = 1.0
    nt.links.new(tex.outputs["Color"], shade.inputs[6])
    shade.inputs[7].default_value = (*geo.hex_to_linear(P.TOON_SHADOW_TINT), 1.0)
    mix = nt.nodes.new("ShaderNodeMix")
    mix.data_type = "RGBA"
    nt.links.new(ramp.outputs["Color"], mix.inputs["Factor"])
    nt.links.new(shade.outputs[2], mix.inputs[6])
    nt.links.new(tex.outputs["Color"], mix.inputs[7])
    emit = nt.nodes.new("ShaderNodeEmission")
    nt.links.new(mix.outputs[2], emit.inputs["Color"])
    nt.links.new(emit.outputs[0], out.inputs["Surface"])
    return mat


def flat_material(name, hex_color, alpha_radial=False):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    emit = nt.nodes.new("ShaderNodeEmission")
    emit.inputs["Color"].default_value = (*geo.hex_to_linear(hex_color), 1.0)
    if not alpha_radial:
        nt.links.new(emit.outputs[0], out.inputs["Surface"])
        return mat
    # soft disc: alpha falls off with distance from the object center
    coord = nt.nodes.new("ShaderNodeTexCoord")
    length = nt.nodes.new("ShaderNodeVectorMath")
    length.operation = "LENGTH"
    nt.links.new(coord.outputs["Object"], length.inputs[0])
    ramp = nt.nodes.new("ShaderNodeMapRange")
    ramp.inputs["From Min"].default_value = 0.35
    ramp.inputs["From Max"].default_value = 1.0
    ramp.inputs["To Min"].default_value = 1.0
    ramp.inputs["To Max"].default_value = 0.0
    ramp.interpolation_type = "SMOOTHSTEP"
    nt.links.new(length.outputs["Value"], ramp.inputs["Value"])
    transp = nt.nodes.new("ShaderNodeBsdfTransparent")
    mix = nt.nodes.new("ShaderNodeMixShader")
    nt.links.new(ramp.outputs["Result"], mix.inputs["Fac"])
    nt.links.new(transp.outputs[0], mix.inputs[1])
    nt.links.new(emit.outputs[0], mix.inputs[2])
    nt.links.new(mix.outputs[0], out.inputs["Surface"])
    mat.surface_render_method = "BLENDED"
    return mat


def outline_node_group(outline_mat):
    """Geometry nodes inverted hull: push along normals by width * 'outline' weight, flip faces."""
    ng = bpy.data.node_groups.new("InvertedHull", "GeometryNodeTree")
    ng.interface.new_socket("Geometry", in_out="INPUT", socket_type="NodeSocketGeometry")
    ng.interface.new_socket("Geometry", in_out="OUTPUT", socket_type="NodeSocketGeometry")
    n = ng.nodes
    gin = n.new("NodeGroupInput")
    gout = n.new("NodeGroupOutput")
    normal = n.new("GeometryNodeInputNormal")
    weight = n.new("GeometryNodeInputNamedAttribute")
    weight.data_type = "FLOAT"
    weight.inputs["Name"].default_value = "outline"
    scale = n.new("ShaderNodeMath")
    scale.operation = "MULTIPLY"
    scale.inputs[1].default_value = P.OUTLINE_WIDTH
    ng.links.new(weight.outputs["Attribute"], scale.inputs[0])
    offset = n.new("ShaderNodeVectorMath")
    offset.operation = "SCALE"
    ng.links.new(normal.outputs["Normal"], offset.inputs[0])
    ng.links.new(scale.outputs[0], offset.inputs["Scale"])
    setpos = n.new("GeometryNodeSetPosition")
    ng.links.new(gin.outputs[0], setpos.inputs["Geometry"])
    ng.links.new(offset.outputs[0], setpos.inputs["Offset"])
    flip = n.new("GeometryNodeFlipFaces")
    ng.links.new(setpos.outputs[0], flip.inputs["Mesh"])
    setmat = n.new("GeometryNodeSetMaterial")
    setmat.inputs["Material"].default_value = outline_mat
    ng.links.new(flip.outputs[0], setmat.inputs["Geometry"])
    ng.links.new(setmat.outputs[0], gout.inputs[0])
    return ng


def outline_material():
    mat = flat_material("Outline", P.OUTLINE_COLOR)
    mat.use_backface_culling = True
    return mat


def add_outline(obj, rig_obj, ng):
    """A second object sharing the mesh, deformed by the same rig, drawn as the inverted hull."""
    hull = bpy.data.objects.new(obj.name + "_Outline", obj.data)
    bpy.context.scene.collection.objects.link(hull)
    hull.parent = obj.parent
    hull.parent_type = obj.parent_type
    hull.parent_bone = obj.parent_bone
    hull.matrix_world = obj.matrix_world.copy()
    if rig_obj is not None and obj.parent_type != "BONE":
        arm = hull.modifiers.new("Armature", "ARMATURE")
        arm.object = rig_obj
    if "outline" not in obj.vertex_groups:
        g = obj.vertex_groups.new(name="outline")
        g.add(list(range(len(obj.data.vertices))), 1.0, "REPLACE")
    mod = hull.modifiers.new("Hull", "NODES")
    mod.node_group = ng
    return hull


def ground_disc(radius=1.0, color="#1f2128"):
    bpy.ops.mesh.primitive_circle_add(vertices=64, radius=radius, fill_type="NGON", location=(0, 0, -0.002))
    disc = bpy.context.active_object
    disc.name = "GroundGlow"
    disc.data.materials.append(flat_material("Ground", color, alpha_radial=True))
    return disc


def camera(name, location, target, lens=80):
    cam_data = bpy.data.cameras.new(name)
    cam_data.lens = lens
    cam_data.clip_start = 0.05
    cam = bpy.data.objects.new(name, cam_data)
    bpy.context.scene.collection.objects.link(cam)
    cam.location = location
    direction = Vector(target) - Vector(location)
    cam.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    return cam


def frame_camera(name, target, height, yaw_deg=0.0, pitch_deg=6.0, lens=80):
    """Camera looking at `target` so that `height` meters fill the square frame."""
    fov = 2 * math.atan(18.0 / lens)
    dist = (height / 2) / math.tan(fov / 2)
    yaw, pitch = math.radians(yaw_deg), math.radians(pitch_deg)
    t = Vector(target)
    loc = t + Vector((math.sin(yaw) * math.cos(pitch), -math.cos(yaw) * math.cos(pitch), math.sin(pitch))) * dist
    return camera(name, loc, t, lens)


def render(cam, path):
    scene = bpy.context.scene
    scene.camera = cam
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
