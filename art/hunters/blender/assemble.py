"""Assemble rigged characters in the Blender scene: hunters (every look, every LOD on its own armature)."""

import bpy

import hp
import hrig
import looks
import mesh


def export_material(palette, name):
    """The material that ships in the GLB: palette texture, matte. The game swaps in its toon shader."""
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes.get("Principled BSDF")
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = palette
    tex.interpolation = "Closest"
    nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 1.0
    bsdf.inputs["Metallic"].default_value = 0.0
    return mat


class Character:
    def __init__(self, cid, rig, lods, bones, info, spans):
        self.id, self.rig, self.lods, self.bones, self.info = cid, rig, lods, bones, info
        self.spans = spans      # LOD0 (part, first vertex, end vertex), for measuring hitboxes


def build_hunter(look_id, material):
    lod_parts = [looks.build(look_id, lod) for lod in range(3)]
    muzzle = lod_parts[0][1]
    rig, bones = hrig.build_armature("Rig_" + look_id, hrig.bone_specs(muzzle))
    objs, spans0 = [], None
    for lod, (parts, _) in enumerate(lod_parts):
        obj, spans = mesh.build_object(f"{look_id}_LOD{lod}", parts)
        mesh.skin(obj, rig, spans, bones)
        obj.data.materials.append(material)
        objs.append(obj)
        spans0 = spans0 or spans
    info = {"muzzle_socket": [round(v, 4) for v in muzzle],
            "triangles": [mesh.triangle_count(o) for o in objs],
            "vertices": [len(o.data.vertices) for o in objs]}
    return Character(look_id, rig, objs, bones, info, spans0)


def build_all_hunters(material):
    return {lid: build_hunter(lid, material) for lid in looks.LOOKS}
