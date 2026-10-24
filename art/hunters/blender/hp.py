"""Duck hunter proportions, skeleton anchors, palette and budgets. Every shape and bone reads from here.

Units are meters. Blender is Z-up and every character faces -Y (the glTF export turns this into Y-up,
facing +Z, exactly like the duck GLBs). The character's left side is +X. Rest pose is a T-pose.
"""

# ---------------------------------------------------------------- palette
# 256 px texture. Rows 0..7 (top half) hold 16 px flat cells, 16 per row, in this order.
# The bottom half holds two 128 px camo tiles (green woodland on the left, brown on the right),
# projected onto camo clothing in world space (mesh.py).
PALETTE = {
    # skin, three cartoon tones
    "skin_a": "#f6bf98", "skin_a_deep": "#e8977a",
    "skin_b": "#d29a6c", "skin_b_deep": "#b97a55",
    "skin_c": "#9a6544", "skin_c_deep": "#7f4c30",
    "cheek": "#f08e7c",
    "nose_red": "#e9786a",
    # face
    "eye_white": "#fbf7ee", "pupil": "#151619", "shine": "#ffffff", "mouth": "#6e2a22",
    "brow": "#3b2a1e", "hair_brown": "#5a3b24", "hair_ginger": "#c0622e",
    "beard": "#c2602c", "beard_deep": "#93421d",
    "glass_frame": "#2a2a30", "glass": "#bfe6ff",
    # blaze orange and brand accents
    "blaze": "#ff6a13", "blaze_deep": "#d9530b",
    "yellow": "#ffd43b", "yellow_deep": "#f6b928", "orange": "#ff8a3d", "dark": "#151619",
    # clothes
    "jacket_olive": "#5b6b3a", "jacket_deep": "#465430",
    "coat_brown": "#7a5230", "coat_deep": "#5e3d22",
    "fur": "#e2cfa8", "fur_deep": "#bfa77c",
    "pants": "#8d7d55", "pants_deep": "#6d5f3e",
    "boot": "#4a3324", "sole": "#2a1f18",
    "glove": "#5c3d26",
    "wader": "#4d5a35", "wader_deep": "#3a4527",
    "felt": "#3f5233", "felt_deep": "#2f3f26",
    "leather": "#6a4527", "buckle": "#d4a640",
    "shirt": "#a33b2e",           # red flannel peeking out of the boss coat
    # gear
    "wood": "#9a6232", "wood_deep": "#74461f",
    "gunmetal": "#2c2f36", "gun_light": "#5d6370", "brass": "#d4a640", "shell_red": "#d6453a",
    "net": "#d9c79a", "net_deep": "#a8915f", "rope": "#c2a56e", "bag": "#7d6a45", "bag_deep": "#5f4f30",
    "steel": "#8d939e", "whistle": "#d7dce4",
    # wooden decoy duck
    "decoy_body": "#8a5a33", "decoy_head": "#2f7d4f", "decoy_bill": "#ffb02e", "decoy_breast": "#6e3b22",
    "decoy_white": "#efe6d2", "decoy_wing": "#5e3c22",
    # dog
    "dog": "#c98a3e", "dog_deep": "#a86c2c", "dog_light": "#ecc890", "dog_nose": "#2a1d17", "tongue": "#ff7a8a",
    # effects
    "star": "#ffd43b", "star_deep": "#f6b928", "poof": "#f1ece2", "poof_deep": "#cfc8ba",
    # trap
    "trap_flag": "#ff6a13", "stake": "#8a5a33",
    # minions (appended: every cell above keeps its place)
    "smock": "#6f93c4", "smock_deep": "#557aa9", "patch": "#c9a24a", "straw": "#f0c968", "straw_deep": "#c99a3c",
    "pot": "#aab3bf", "pot_deep": "#7d8794",
}
CAMO = {
    # 4 colors each, from base to the darkest blotch
    0: ("#6f7f45", "#8e9a58", "#4a5a2f", "#6a5034"),     # green woodland (jackets, shirts, bucket hat)
    1: ("#7d5a36", "#9c7a4c", "#553a22", "#3f4a2a"),     # brown (trapper coat)
}
PALETTE_SIZE = 256
PALETTE_CELL = 16
CAMO_METERS = 2.0          # one camo tile spans 2 m of world space (blotches about 25 cm: chunky and readable)

# ---------------------------------------------------------------- skeleton anchors (T-pose, regular hunter 1.8 m)
HIPS_Z = 0.95
SPINE_Z = (1.05, 1.16, 1.27)
NECK_Z = 1.38
HEAD_BONE_Z = 1.44
HEAD_TOP_Z = 1.765           # top of the skull
HEAD_CENTER = (0.0, -0.01, 1.58)
HEAD_RADII = (0.185, 0.178, 0.19)

SHOULDER_ROOT_X = 0.05
SHOULDER_Z = 1.33
ARM_JOINT_X = 0.215
ELBOW_X = 0.49
WRIST_X = 0.75
HAND_END_X = 0.835
FINGERS_END_X = 0.935
FIST_X = 0.835                # fist center along the arm, 3 cm under the palm (weapon socket)
FIST_DROP = 0.03

HIP_X = 0.11
HIP_JOINT_Z = 0.88
KNEE_Z = 0.48
ANKLE_Z = 0.10
TOE_BASE_Y = -0.12
TOE_END_Y = -0.23

HAT_PIVOT = (0.0, -0.01, 1.70)      # Hat bone head: every hat sits on it (same for every look)
HEADTOP_Z = 2.00                     # HeadTop point (name tag / health bar), above every hat crown (the boss feather excepted)
STARS_Z = 0.20                       # stars ring height above the head top in the defeat
WHISTLE_REST = (0.0, -0.29, 1.18)    # Whistle bone (the boss lanyard whistle, on the chest under the beard)
SUPPORT_Y = 0.30                     # left fist on the forend, meters in front of the right fist (socket +Y)

BOSS_SCALE = 1.24                    # the boss's Root node scale: hat crown at 2.4 m, skull top 2.19 m

# ---------------------------------------------------------------- dog (Blender axes, faces -Y)
DOG = dict(
    hips=(0.0, 0.34, 0.60), chest=(0.0, -0.16, 0.64), neck_end=(0.0, -0.36, 0.78),
    head=(0.0, -0.44, 0.84), head_top=0.98,
    front_x=0.13, back_x=0.13, front_y=-0.22, back_y=0.36,
    shoulder_z=0.56, elbow_z=0.33, front_ankle_z=0.07,
    hip_z=0.58, stifle_z=0.38, back_ankle_z=0.09,
    tail_root=(0.0, 0.48, 0.66),
)

# ---------------------------------------------------------------- level of detail
# Segment counts per LOD: every builder asks seg(n, lod). Small details have a max LOD.
LOD_FACTORS = (1.0, 0.62, 0.42)
LOD_DISTANCES = (18.0, 40.0, 120.0)   # draw LOD k while camera distance <= this (desktop; about 0.6x on phones)
BUDGET = dict(hunter_lod0=4000, hunter_lod2=1500, dog_lod0=3000, prop_lod0=800, minion_lod0=2000)

# ---------------------------------------------------------------- toon (renders, the same recipe as the ducks)
OUTLINE_WIDTH = 0.0075
