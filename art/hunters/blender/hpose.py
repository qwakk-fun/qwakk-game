"""Pose engine for clips authored as code (a generalization of art/blender/posing.py for any skeleton).

Rotations are given in character axes (X = the character's left, Y = back, Z = up, the rest frame),
relative to the parent, composed Ry, then Rx, then Rz. On the left side: rx > 0 leans the spine or head
forward, swings a leg back, bends a knee, points the toes down and swings a hanging arm back; ry > 0 leans
the spine to the left and lowers LeftArm from the T-pose; rz > 0 turns the face toward the left (+X).
`side()` mirrors ry and rz for the right side.

Extra controls beyond the duck engine:
  pose.ik[end]      = (world matrix, pole, kind) or a callable(M) -> (world matrix, pole, kind), evaluated after
                      the chain's parent is solved (a hand that follows a gun held in chest space)
  pose.world[bone]  = world matrix or callable(M) overriding a bone (the hat flying off, the stars ring)
  pose.loc[bone]    = translation offset in character axes (Hips bob, any bone)
  pose.scale[bone]  = uniform scale for the hidden effect bones (FxStars, FxPoof, LeftHandProp)
Two-bone IK is analytic, so baking is deterministic.
"""

import math

from mathutils import Matrix, Quaternion, Vector

DEG = math.pi / 180.0


def E(rx=0.0, ry=0.0, rz=0.0):
    return Quaternion((0, 0, 1), rz * DEG) @ Quaternion((1, 0, 0), rx * DEG) @ Quaternion((0, 1, 0), ry * DEG)


class Pose:
    def __init__(self):
        self.rot = {}
        self.local = {}
        self.loc = {}
        self.scale = {}
        self.world = {}
        self.ik = {}

    @property
    def hips(self):
        return self.loc.get("Hips", Vector())

    @hips.setter
    def hips(self, v):
        self.loc["Hips"] = Vector(v)

    def add(self, bone, rx=0.0, ry=0.0, rz=0.0):
        self.rot[bone] = E(rx, ry, rz) @ self.rot.get(bone, Quaternion())
        return self

    def side(self, side, base, rx=0.0, ry=0.0, rz=0.0):
        if side == "Right":
            ry, rz = -ry, -rz
        return self.add(side + base, rx, ry, rz)

    def both(self, base, rx=0.0, ry=0.0, rz=0.0):
        self.side("Left", base, rx, ry, rz)
        self.side("Right", base, rx, ry, rz)
        return self

    def curl(self, bone, degrees):
        self.local[bone] = Quaternion((1, 0, 0), degrees * DEG) @ self.local.get(bone, Quaternion())
        return self


class Skeleton:
    """Rest data of an armature. `chains` maps an end bone to (root, mid, end, rest bend direction)."""

    def __init__(self, arm_obj, chains):
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
        self.chain_member = {}
        for end, (a, b, c, bend) in chains.items():
            self.chain_end[c] = (a, b, c, Vector(bend))
            self.chain_member[a] = self.chain_member[b] = c

    def subtree(self, root):
        out = []

        def visit(n):
            out.append(n)
            for c in self.order:
                if self.parent[c] == n:
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
    """Armature-space 4x4 for every bone (scale excluded), plus IK reach errors."""
    M = {}
    errors = {}
    for name in sk.order:
        if name in M:
            continue
        p = sk.parent[name]
        if name in sk.chain_member and sk.chain_member[name] in pose.ik:
            end = sk.chain_member[name]
            a_name, b_name, c_name, rest_bend = sk.chain_end[end]
            if name != a_name:
                continue
            spec = pose.ik[end]
            if callable(spec):
                spec = spec(M)
            target_m, pole, _ = spec
            root_m = (M[p] @ sk.rel[a_name]) if p else sk.rel[a_name]
            root = root_m.to_translation()
            l1 = (sk.head[b_name] - sk.head[a_name]).length
            l2 = (sk.head[c_name] - sk.head[b_name]).length
            mid, tip, bend, err = two_bone(root, l1, l2, target_m.to_translation(), Vector(pole))
            errors[end] = err
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
        if name in pose.world:
            w = pose.world[name]
            M[name] = (w(M) if callable(w) else w).copy()
            continue
        rest_rot = sk.rest_q[name]
        q = pose.rot.get(name)
        basis_q = (rest_rot.inverted() @ q @ rest_rot) if q is not None else Quaternion()
        if name in pose.local:
            basis_q = basis_q @ pose.local[name]
        basis = basis_q.to_matrix().to_4x4()
        if name in pose.loc:
            basis.translation = rest_rot.inverted() @ pose.loc[name]
        M[name] = (M[p] @ sk.rel[name] @ basis) if p else (sk.rest[name] @ basis)
    return M, errors


def to_basis(sk, M):
    out = {}
    for name in sk.order:
        p = sk.parent[name]
        out[name] = (sk.rel[name].inverted() @ M[p].inverted() @ M[name]) if p else (sk.rest[name].inverted() @ M[name])
    return out


def frame(pos, fwd, up=(0, 0, 1)):
    """World matrix whose Y axis is `fwd` and Z axis is as close to `up` as possible (a socket frame)."""
    y = Vector(fwd).normalized()
    z = Vector(up)
    z = (z - y * z.dot(y)).normalized()
    x = y.cross(z)
    m = Matrix((x, y, z)).transposed().to_4x4()
    m.translation = Vector(pos)
    return m


def foot_matrix(sk, bone, ankle, pitch=0.0, yaw=0.0, roll=0.0):
    rest = sk.rest[bone]
    q = Quaternion((0, 0, 1), yaw * DEG) @ Quaternion((1, 0, 0), pitch * DEG) @ Quaternion((0, 1, 0), roll * DEG)
    m = (q.to_matrix() @ rest.to_3x3()).to_4x4()
    m.translation = Vector(ankle)
    return m
