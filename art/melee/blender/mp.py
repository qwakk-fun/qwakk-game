"""Melee art parameters: the katana's proportions, its palette, where the scabbard rides, and budgets.

Units are meters. Blender is Z-up and the duck faces -Y (glTF export turns this into Y-up, facing +Z).
The duck's left side is +X.

Katana space (Blender, before export): origin at the right fist's grip center, the blade runs along +Z,
the cutting edge faces -Y, the flats face +X and -X. After the glTF export that is: blade along +Y, edge
toward -Z, flats along X. The scabbard has its own space: origin at its mouth, blade channel along -Z
(the scabbard hangs down from its mouth), the edge side toward -Y.
"""

# ---------------------------------------------------------------- palette (own 256 px texture, 16 px cells)
PALETTE = {
    "steel": "#d3dce8",        # blade flats
    "steel_deep": "#9ba8bb",   # blade spine and back bevel
    "edge": "#f7fbff",         # the bright hamon band along the edge (reads as a highlight)
    "yellow": "#ffd43b",       # brand yellow: handle wrap, tsuba rim, scabbard bands
    "yellow_deep": "#f6b928",  # wrap diamonds, habaki
    "orange": "#ff8a3d",       # beak orange: tassel, scabbard cord
    "orange_deep": "#e9692b",
    "dark": "#151619",         # brand dark: scabbard, tsuba
    "dark_light": "#2c2f37",   # scabbard sheen strip, pommel
    "ray": "#f3eee0",          # ray skin under the wrap
    "feather": "#ffe680",      # XP feather pickup
    "feather_deep": "#ffd43b",
    "quill": "#ff8a3d",
    "white": "#ffffff",
}
PALETTE_SIZE = 256
PALETTE_CELL = 16

# ---------------------------------------------------------------- katana (katana space, see above)
GRIP_Z = 0.0                 # the fist's grip center (origin)
POMMEL_Z = -0.165            # bottom of the pommel cap
HANDLE_TOP_Z = 0.090         # top of the wrapped handle, under the guard
HANDLE_R = (0.0215, 0.0185)  # half width across the flats (X), half depth edge to spine (Y): a slightly oval grip
TSUBA_Z = 0.098              # guard center
TSUBA_R = 0.058
TSUBA_T = 0.013
HABAKI_Z = (0.105, 0.140)    # blade collar
BLADE_Z = (0.106, 0.915)     # blade base and tip
BLADE_W = (0.076, 0.064)     # edge-to-spine width at the base and at the start of the tip
BLADE_T = 0.017              # thickness at the ridge
SORI = 0.030                 # curvature: the tip sits this far toward the spine (+Y)
KISSAKI = 0.095              # length of the angled tip
SEGMENTS_ALONG = 16          # blade sections

TRAIL = {"TrailStart": 0.19, "TrailEnd": 0.89}   # along the blade (Z) on the edge line: the swing trail ribbon
TIP_Z = BLADE_Z[1]

# Tassel (sageo knot) hanging from the pommel ring: rigid, it is part of the katana mesh.
TASSEL_DROP = 0.10

# ---------------------------------------------------------------- scabbard (scabbard space: mouth at origin, along -Z)
SAYA_LEN = 0.86
SAYA_R = (0.026, 0.044)      # half width across (X), half depth edge to spine (Y)
SAYA_SEAT_Z = -0.008         # the guard rests this far down from the mouth's lip... in fact just above it

# Where the scabbard rides when the katana is sheathed: diagonally across the duck's back, the handle up
# behind the right shoulder (clear of the big head), the tip low on the left above the tail.
# Armature space at the rest pose (Blender axes, the duck faces -Y): mouth point and the direction from
# the mouth toward the scabbard's tip, plus the side the edge faces.
SAYA_MOUTH = (-0.255, 0.300, 1.070)
SAYA_TIP_DIR = (0.62, 0.11, -0.775)      # normalized in code
SAYA_EDGE = (0.0, 1.0, 0.25)             # the edge faces away from the back (normalized, made perpendicular)
SAYA_BONE = "Spine1"

# ---------------------------------------------------------------- effects (melee_fx.glb)
ARC_RADIUS = 1.0             # unit crescent: scale it to the swing's reach
ARC_DEGREES = 200.0
SHOCK_RADIUS = 1.0
ELITE_RADIUS = 0.6

# ---------------------------------------------------------------- budgets
BUDGET = dict(katana=2500, scabbard=1200, fx_each=900)

# ---------------------------------------------------------------- toon (renders)
OUTLINE_WIDTH = 0.0075
