"""Qwakk duck proportions and look. Every shape in duck.py and every bone in rig.py reads from here.

Units are meters. Blender is Z-up and the duck faces -Y (glTF export turns this into Y-up, facing +Z).
The duck's left side is +X. Rest pose is a T-pose so Mixamo and Quaternius clips retarget cleanly.
"""

# ---------------------------------------------------------------- palette
# Flat colors (sRGB hex). Each one becomes a 16 px cell in a 256 px palette texture.
# A skin is just a different palette image with the same layout.
PALETTE = {
    "yellow": "#ffd43b",       # brand duck yellow: head, body, wings
    "yellow_deep": "#f6b928",  # feather tips, tail, tuft accents
    "belly": "#ffe680",        # lighter belly patch
    "orange": "#ff8a3d",       # brand beak orange: bill, legs, feet
    "orange_deep": "#e9692b",  # lower bill, foot soles
    "eye": "#151619",          # brand dark: pupils
    "shine": "#fffaf0",        # eye catchlights
    "mouth": "#7a2c25",        # mouth interior, visible when the bill opens
    "blush": "#ffa34d",        # cheek blush
    "beanie": "#1d1d21",       # doomer beanie (from marketing/reel/src/parts.tsx)
    "beanie_cuff": "#34343b",
    "beanie_edge": "#4a4a54",
}
PALETTE_SIZE = 256
PALETTE_CELL = 16

# ---------------------------------------------------------------- head
HEAD_CENTER = (0.0, -0.02, 1.30)
HEAD_RADII = (0.345, 0.325, 0.315)    # x (width), y (depth), z (height): a slightly squashed ball
HEAD_SEGMENTS = 36
HEAD_RINGS = 18

# Eyes: big dark ovals like the pupil inside the brand mark's Q ring.
EYE_YAW_DEG = 27          # how far from the face center each eye sits
EYE_PITCH_DEG = 9         # how far above the head center
EYE_RADII = (0.072, 0.024, 0.096)   # width, bulge, height
EYE_SINK = 0.010          # how deep the eye sits into the head surface
EYE_TOE_IN_DEG = 10       # turn the eyes toward the front a bit so they read from the side too
SHINE_BIG = (0.024, 0.008, 0.029)
SHINE_SMALL = (0.011, 0.006, 0.011)

# Cheek blush ovals under the eyes.
BLUSH_YAW_DEG = 47
BLUSH_PITCH_DEG = -10
BLUSH_RADII = (0.050, 0.010, 0.030)

# Bill: a wide flat duck bill with a separate lower jaw.
BILL_BASE = (0.0, -0.215, 1.215)      # back of the upper bill (buried in the head)
BILL_LENGTH = 0.225
BILL_WIDTH = 0.142                    # half width at the widest point
BILL_THICK = 0.058                    # half thickness at the base
BILL_TIP_LIFT = 0.022                 # the tip curls up a little: a happy bill
BILL_SMILE = 0.022                    # bill corners rise at the sides
JAW_PIVOT = (0.0, -0.215, 1.185)      # jaw bone head (hinge)
JAW_LENGTH = 0.165
JAW_WIDTH = 0.098
JAW_THICK = 0.034
JAW_DROP = 0.0                        # rest opening in degrees

# Tuft: the curl from the brand mark, on top of the head and curling back.
TUFT_POINTS = [
    (0.0, 0.03, 1.56), (0.0, 0.01, 1.66), (0.0, 0.05, 1.74),
    (0.0, 0.12, 1.765), (0.0, 0.165, 1.725), (0.0, 0.15, 1.68),
]
TUFT_RADII = [0.042, 0.038, 0.032, 0.026, 0.020, 0.013]
TUFT2_OFFSET = (0.05, 0.035, -0.02)   # small second feather, to the side and behind
TUFT2_SCALE = 0.62

# ---------------------------------------------------------------- body
# Pear body: profile points (radius, z) from bottom pole to top pole, then scaled per axis.
BODY_PROFILE = [
    (0.000, 0.405), (0.160, 0.425), (0.258, 0.485), (0.300, 0.585), (0.305, 0.690),
    (0.292, 0.790), (0.258, 0.890), (0.212, 0.980), (0.170, 1.060), (0.140, 1.130), (0.000, 1.165),
]
BODY_SCALE_XY = (1.0, 0.90)
BODY_BELLY_PUSH = 0.03                # belly sits a bit forward
BODY_SEGMENTS = 30
BODY_RINGS = 16

# Tail feathers sticking up at the back.
TAIL_ROOT = (0.0, 0.215, 0.60)
TAIL_FEATHERS = [  # (side offset, yaw spread deg, length scale)
    (0.0, 0.0, 1.0), (0.075, 30.0, 0.7), (-0.075, -30.0, 0.7),
]

# ---------------------------------------------------------------- skeleton anchors (T-pose)
HIPS_Z = 0.66
SPINE_Z = (0.76, 0.86, 0.96)
NECK_Z = 1.06
HEAD_BONE_Z = 1.13
HEAD_TOP_Z = 1.62

SHOULDER_ROOT_X = 0.05
SHOULDER_Z = 1.00
ARM_JOINT_X = 0.200                   # shoulder ball center
ELBOW_X = 0.445
WRIST_X = 0.675
HAND_END_X = 0.775

UPPER_ARM_R = (0.080, 0.072)          # radius at shoulder, at elbow
FOREARM_R = (0.070, 0.086)            # radius at elbow, at wrist cuff (wing flares out)
PALM_HALF = (0.080, 0.046)            # palm half width (Y), half thickness (Z)

# Fingers: (name, root offset from wrist (x, y, z), direction (x, y, z), length, half width, half thickness)
FINGERS = [
    ("Thumb", (0.035, -0.060, -0.006), (0.55, -0.80, -0.20), 0.105, 0.036, 0.027),
    ("Index", (0.075, -0.033, 0.000), (1.0, -0.14, -0.02), 0.135, 0.040, 0.026),
    ("Middle", (0.072, 0.038, 0.000), (1.0, 0.20, -0.02), 0.125, 0.040, 0.026),
]
FINGER_SEGMENTS = 8
FINGER_RINGS = 7

HIP_X = 0.125
KNEE_Z = 0.355
ANKLE_Z = 0.085
THIGH_R = (0.100, 0.080)              # top, above the knee cuff
CUFF_R = 0.090                        # feather cuff at the bottom of the thigh
SHIN_R = (0.058, 0.052)
LEG_SEGMENTS = 18

# Webbed feet.
FOOT_CENTER_Y = -0.065
FOOT_FRONT = 0.21                    # reach from the center to the toe tips
FOOT_BACK = 0.085
FOOT_SIDE = 0.11
FOOT_THICK = 0.058
FOOT_TOE_SPREAD_DEG = 29
FOOT_TURN_OUT_DEG = 9
TOE_BASE_Y = -0.115                   # ball of the foot (ToeBase bone head)
TOE_END_Y = -0.255

# ---------------------------------------------------------------- outline and toon (renders)
OUTLINE_WIDTH = 0.0075
OUTLINE_COLOR = "#151619"
TOON_SHADOW_TINT = "#d9a6a0"          # multiplied into the base color on the shadow side
TOON_THRESHOLD = 0.08
LIGHT_DIR = (-0.55, -0.75, 0.85)      # world space, from the light toward the duck is the negative of this
BACKGROUND = "#151619"

# ---------------------------------------------------------------- accessory
BEANIE_SCALE = 1.075                  # shell size relative to the head
BEANIE_BOTTOM_Z = 0.08                # bottom edge height above the head center
BEANIE_TILT_DEG = -12                 # tipped back, doomer style
BEANIE_DOME = 1.06                    # dome height relative to the head top

# ---------------------------------------------------------------- skinning
BODY_WEIGHTS = "auto"                 # "auto": bone heat on the torso, "procedural": height falloff only
