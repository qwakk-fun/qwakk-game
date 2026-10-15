"""A tiny pose engine for authoring clips in code.

Rotations are given in *character axes* (X = duck's left, Y = back, Z = up, the rest T-pose frame),
relative to the parent, so `E(rx=20)` on `LeftUpLeg` swings the thigh back 20 degrees no matter how
the bone is rolled. Composition order is Ry first, then Rx, then Rz.
Signs (left side; the right side mirrors ry and rz):
  rx > 0: spine/head lean forward, legs swing back, knee (Leg) bends, foot toes down, hanging arm swings back,
          jaw opens, tail lifts
  ry > 0: spine/hips lean to the duck's left, LeftArm goes down from the T-pose
  rz > 0: hips/spine turn the face toward the duck's left (+X), LeftForeArm bends backward (use rz < 0 to bend it forward)
Two-bone IK places feet and hands exactly; the solver is analytic, so baking is deterministic.
"""

import math

from mathutils import Matrix, Quaternion, Vector

DEG = math.pi / 180.0

ARM_CHAINS = {"Left": ("LeftArm", "LeftForeArm", "LeftHand"), "Right": ("RightArm", "RightForeArm", "RightHand")}
LEG_CHAINS = {"Left": ("LeftUpLeg", "LeftLeg", "LeftFoot"), "Right": ("RightUpLeg", "RightLeg", "RightFoot")}
REST_BEND = {"leg": Vector((0, -1, 0)), "arm": Vector((0, 1, 0))}   # where the knee / elbow points when bent


def E(rx=0.0, ry=0.0, rz=0.0):
    """Delta rotation in character axes (degrees)."""
    return (Quaternion((0, 0, 1), rz * DEG) @ Quaternion((1, 0, 0), rx * DEG) @ Quaternion((0, 1, 0), ry * DEG))


def mirror_side(side, rx, ry, rz):
    return (rx, ry, rz) if side == "Left" else (rx, -ry, -rz)


class Pose:
    def __init__(self):
        self.rot = {}       # bone -> Quaternion delta in character axes, parent-relative
        self.local = {}     # bone -> Quaternion applied in the bone's own axes (finger curls)
        self.hips = Vector((0, 0, 0))
        self.ik = {}        # chain end bone -> (4x4 world matrix of the end bone, pole vector, kind)

    def add(self, bone, rx=0.0, ry=0.0, rz=0.0):
        q = E(rx, ry, rz)
        self.rot[bone] = q @ self.rot.get(bone, Quaternion())
        return self

    def side(self, side, base, rx=0.0, ry=0.0, rz=0.0):
        """Add to Left<base> or Right<base>, mirroring ry and rz for the right side."""
        return self.add(side + base, *mirror_side(side, rx, ry, rz))

    def both(self, base, rx=0.0, ry=0.0, rz=0.0):
        self.side("Left", base, rx, ry, rz)
        self.side("Right", base, rx, ry, rz)
        return self

    def curl(self, bone, degrees):
        self.local[bone] = Quaternion((1, 0, 0), degrees * DEG) @ self.local.get(bone, Quaternion())
        return self

    def fingers(self, side, index, middle=None, thumb=None):
        """Curl a whole hand: per-joint degrees (negative curls toward the palm)."""
        middle = index if middle is None else middle
        for k in (1, 2, 3):
            self.curl(f"{side}HandIndex{k}", index)
            self.curl(f"{side}HandMiddle{k}", middle)
            if thumb is not None:
                self.curl(f"{side}HandThumb{k}", thumb)
        return self


class Skeleton:
    """Rest data of the armature, read once."""

    def __init__(self, arm_obj):
        bones = arm_obj.data.bones
        self.order = []

        def visit(b):
            self.order.append(b.name)
            for c in b.children:
                visit(c)

        for b in bones:
            if b.parent is None:
                visit(b)
        self.rest = {b.name: b.matrix_local.copy() for b in bones}
        self.parent = {b.name: (b.parent.name if b.parent else None) for b in bones}
        self.rel = {}
        for name in self.order:
            p = self.parent[name]
            self.rel[name] = (self.rest[p].inverted() @ self.rest[name]) if p else self.rest[name].copy()
        self.rest_q = {n: m.to_quaternion() for n, m in self.rest.items()}
        self.head = {n: m.to_translation() for n, m in self.rest.items()}
        self.chain_end = {}
        for chains, kind in ((ARM_CHAINS, "arm"), (LEG_CHAINS, "leg")):
            for a, b, c in chains.values():
                self.chain_end[c] = (a, b, c, kind)
        self.chain_member = {}
        for a, b, c, kind in self.chain_end.values():
            self.chain_member[a] = self.chain_member[b] = c

    def subtree(self, root):
        out = []

        def visit(n):
            out.append(n)
            for c, p in self.parent.items():
                if p == n:
                    visit(c)

        visit(root)
        return out


def _frame(y, b):
    y = y.normalized()
    b = (b - y * b.dot(y)).normalized()
    return Matrix((y, b, y.cross(b))).transposed()


def two_bone(a, l1, l2, target, pole):
    d = target - a
    dist = max(abs(l1 - l2) + 1e-4, min(d.length, (l1 + l2) * 0.9995))
    dn = d.normalized()
    cos_a = max(-1.0, min(1.0, (l1 * l1 + dist * dist - l2 * l2) / (2 * l1 * dist)))
    b = pole - dn * pole.dot(dn)
    if b.length < 1e-6:
        b = dn.orthogonal()
    b.normalize()
    mid = a + dn * (l1 * cos_a) + b * (l1 * math.sqrt(1 - cos_a * cos_a))
    return mid, a + dn * dist, b, d.length - dist


def solve(sk, pose):
    """World (armature space) 4x4 matrix for every bone, plus the IK reach errors."""
    M = {}
    errors = {}
    for name in sk.order:
        if name in M:
            continue
        p = sk.parent[name]
        if name in sk.chain_member and sk.chain_member[name] in pose.ik:
            end = sk.chain_member[name]
            a_name, b_name, c_name, kind = sk.chain_end[end]
            if name != a_name:
                continue
            target_m, pole, _ = pose.ik[end]
            root_m = (M[p] @ sk.rel[a_name]) if p else sk.rel[a_name]
            root = root_m.to_translation()
            l1 = (sk.head[b_name] - sk.head[a_name]).length
            l2 = (sk.head[c_name] - sk.head[b_name]).length
            mid, tip, bend, err = two_bone(root, l1, l2, target_m.to_translation(), Vector(pole))
            errors[end] = err
            rest_bend = REST_BEND[kind]
            for bone, head, toward in ((a_name, root, mid), (b_name, mid, tip)):
                rest_m = sk.rest[bone]
                y_r = rest_m.to_3x3().col[1]
                q = _frame(toward - head, bend) @ _frame(y_r, rest_bend).transposed()
                m = (q @ rest_m.to_3x3()).to_4x4()
                m.translation = head
                M[bone] = m
            m = target_m.to_3x3().normalized().to_4x4()
            m.translation = tip
            M[c_name] = m
            continue
        rest_rot = sk.rest_q[name]
        q = pose.rot.get(name)
        basis_q = (rest_rot.inverted() @ q @ rest_rot) if q is not None else Quaternion()
        if name in pose.local:
            basis_q = basis_q @ pose.local[name]
        basis = basis_q.to_matrix().to_4x4()
        if p is None:
            basis.translation = rest_rot.inverted() @ pose.hips
            M[name] = sk.rest[name] @ basis
        else:
            M[name] = M[p] @ sk.rel[name] @ basis
    return M, errors


def to_basis(sk, M):
    out = {}
    for name in sk.order:
        p = sk.parent[name]
        out[name] = (sk.rel[name].inverted() @ M[p].inverted() @ M[name]) if p else (sk.rest[name].inverted() @ M[name])
    return out


def foot_matrix(sk, side, ankle, pitch=0.0, yaw=0.0, roll=0.0):
    """World matrix for a foot at `ankle`, pitched (heel up > 0) about X, yawed about Z."""
    rest = sk.rest[side + "Foot"]
    q = Quaternion((0, 0, 1), yaw * DEG) @ Quaternion((1, 0, 0), pitch * DEG) @ Quaternion((0, 1, 0), roll * DEG)
    m = (q.to_matrix() @ rest.to_3x3()).to_4x4()
    m.translation = ankle
    return m
