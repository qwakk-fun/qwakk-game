"""Check the published hunter GLBs against the asset contract in art/hunters/README.md.

Plain Python (no Blender):  python3 qwakk-game/art/hunters/validate.py
Exits non-zero on any problem.
"""

import json
import os
import struct
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(os.path.dirname(os.path.dirname(HERE)), "apps", "client", "public", "models", "hunters")

LOOKS = ("rifleman", "trapper", "decoy", "boss", "beater", "recruit")
MINIONS = ("beater", "recruit")
SCALES = {"boss": 1.24, "recruit": 0.72}     # Root node scale per look (1 for the others)
JOINTS = ["Root", "Hips", "Spine", "Spine1", "Spine2", "Neck", "Head", "HeadTop", "Hat", "Whistle", "LeftShoulder",
          "LeftArm", "LeftForeArm", "LeftHand", "LeftHandFingers", "LeftHandProp", "RightShoulder", "RightArm",
          "RightForeArm", "RightHand", "RightHandFingers", "WeaponSocket", "Muzzle", "LeftUpLeg", "LeftLeg",
          "LeftFoot", "LeftToeBase", "RightUpLeg", "RightLeg", "RightFoot", "RightToeBase", "FxStars", "FxPoof"]
HIDDEN = ("FxStars", "FxPoof", "LeftHandProp")
CLIPS = {"Idle": 2.4, "Walk": 0.8, "Run": 0.6, "Aim": 2.0, "Aim_Up": 2.0, "Aim_Down": 2.0, "Fire": 0.3,
         "Reload": 1.8, "Throw": 1.2, "Hit": 0.4, "Defeat": 2.0, "Defeat_Dizzy": 1.2, "Taunt": 1.8, "Whistle": 1.6,
         "Charge": 0.533, "Bonk": 0.7, "Stagger": 0.5, "Launched": 1.1, "Get_Up": 0.9}
UPPER = ("Aim", "Aim_Up", "Aim_Down", "Fire", "Reload", "Throw")
LOOPS = ("Idle", "Walk", "Run", "Aim", "Aim_Up", "Aim_Down", "Defeat_Dizzy", "Charge")
DOG_CLIPS = {"Idle": 2.0, "Run": 0.4, "Bite": 0.6, "Hit": 0.367, "Defeat": 1.5, "Defeat_Dizzy": 1.2}
TRI_LOD0, TRI_LOD2 = 4000, 1500
TRI_MINION_LOD0 = 2000


def read(path):
    with open(path, "rb") as f:
        data = f.read()
    n = struct.unpack("<I", data[12:16])[0]
    doc = json.loads(data[20:20 + n])
    off = 20 + n
    blen = struct.unpack("<I", data[off:off + 4])[0]
    return doc, data[off + 8:off + 8 + blen]


def floats(doc, blob, acc):
    a = doc["accessors"][acc]
    view = doc["bufferViews"][a["bufferView"]]
    width = {"SCALAR": 1, "VEC3": 3, "VEC4": 4, "MAT4": 16}[a["type"]]
    start = view.get("byteOffset", 0) + a.get("byteOffset", 0)
    return struct.unpack_from("<%df" % (a["count"] * width), blob, start)


def by_name(doc):
    return {n.get("name"): n for n in doc["nodes"]}


def tris(doc, node):
    return sum(doc["accessors"][p["indices"]]["count"] // 3 for p in doc["meshes"][node["mesh"]]["primitives"])


def subtree(doc, root):
    nodes = doc["nodes"]
    idx = next(i for i, n in enumerate(nodes) if n.get("name") == root)
    out, stack = set(), [idx]
    while stack:
        i = stack.pop()
        out.add(nodes[i]["name"])
        stack.extend(nodes[i].get("children", []))
    return out


def check_clips(doc, blob, expect, problems, label, upper=(), loops=(), upper_root="Spine", extra_ok=()):
    names = [n.get("name") for n in doc["nodes"]]
    clips = {}
    up = subtree(doc, upper_root) if upper else set()
    for a in doc.get("animations", []):
        dur = max(doc["accessors"][s["input"]]["max"][0] for s in a["samplers"])
        clips[a["name"]] = round(dur, 3)
        for ch in a["channels"]:
            node, path = names[ch["target"]["node"]], ch["target"]["path"]
            if a["name"] in upper and node not in up:
                problems.append(f"{label} {a['name']}: upper clip animates {node}")
            if path == "translation" and node not in ("Hips", "Hat", "Whistle", "FxStars", "FxPoof", "LeftHandProp"):
                problems.append(f"{label} {a['name']}: translation track on {node}")
            if path == "scale" and node not in HIDDEN:
                problems.append(f"{label} {a['name']}: scale track on {node}")
            if a["name"] in loops and path == "rotation":
                out = floats(doc, blob, a["samplers"][ch["sampler"]]["output"])
                first, last = out[:4], out[-4:]
                d = min(max(abs(x - y) for x, y in zip(first, last)), max(abs(x + y) for x, y in zip(first, last)))
                if d > 2e-3 and node not in extra_ok:
                    problems.append(f"{label} {a['name']}: loop does not close on {node} ({d:.4f})")
    for c, secs in expect.items():
        if c not in clips:
            problems.append(f"{label} missing clip {c}")
        elif abs(clips[c] - secs) > 0.02:
            problems.append(f"{label} clip {c} is {clips[c]} s, expected {secs}")
    extra = sorted(set(clips) - set(expect))
    if extra:
        problems.append(f"{label} unexpected clips {extra}")
    return clips


def check_lods(doc, label, problems, budget=True, lod0_budget=TRI_LOD0):
    nodes = by_name(doc)
    out = []
    for k in range(3):
        n = nodes.get(f"LOD{k}")
        if not n or "mesh" not in n or "skin" not in n:
            problems.append(f"{label} missing skinned LOD{k}")
            out.append(0)
            continue
        out.append(tris(doc, n))
    if budget and out[0] > lod0_budget:
        problems.append(f"{label} LOD0 {out[0]} triangles over {lod0_budget}")
    if budget and out[2] > TRI_LOD2:
        problems.append(f"{label} LOD2 {out[2]} triangles over {TRI_LOD2}")
    if not out[0] > out[1] > out[2]:
        problems.append(f"{label} LOD triangle counts do not decrease {out}")
    return out


def main():
    problems = []
    report = {}
    ref_names = ref_ibm = None
    for lid in LOOKS:
        path = os.path.join(OUT, f"hunter_{lid}.glb")
        doc, blob = read(path)
        skin = doc["skins"][0]
        names = [doc["nodes"][i]["name"] for i in skin["joints"]]
        missing = [j for j in JOINTS if j not in names]
        if missing:
            problems.append(f"{lid}: missing joints {missing}")
        ibm = floats(doc, blob, skin["inverseBindMatrices"])
        if ref_names is None:
            ref_names, ref_ibm = names, ibm
        elif names != ref_names:
            problems.append(f"{lid}: joint names or order differ from the rifleman")
        else:
            for k, j in enumerate(names):
                if j == "Muzzle":
                    continue
                if max(abs(a - b) for a, b in zip(ibm[16 * k:16 * k + 16], ref_ibm[16 * k:16 * k + 16])) > 1e-5:
                    problems.append(f"{lid}: bind pose of {j} differs from the rifleman")
        nodes = by_name(doc)
        for h in HIDDEN:
            if nodes[h].get("scale") != [0.0, 0.0, 0.0]:
                problems.append(f"{lid}: {h} node scale should be 0")
        rs = nodes["Root"].get("scale", [1, 1, 1])
        want = SCALES.get(lid, 1.0)
        if max(abs(v - want) for v in rs) > 1e-6:
            problems.append(f"{lid}: Root scale {rs}, expected {want}")
        if [m["name"] for m in doc["materials"]] != ["Hunter"] or len(doc.get("images", [])) != 1:
            problems.append(f"{lid}: expected one material 'Hunter' with one palette image")
        if doc.get("animations"):
            problems.append(f"{lid}: model file should carry no clips (they live in hunter_anims.glb)")
        budget = TRI_MINION_LOD0 if lid in MINIONS else TRI_LOD0
        report[lid] = {"triangles": check_lods(doc, lid, problems, lod0_budget=budget), "bytes": os.path.getsize(path)}

    doc, blob = read(os.path.join(OUT, "hunter_anims.glb"))
    names = {n.get("name") for n in doc["nodes"]}
    if not set(JOINTS) <= names:
        problems.append("hunter_anims.glb: missing joints")
    report["clips"] = check_clips(doc, blob, CLIPS, problems, "hunter_anims", UPPER, LOOPS, extra_ok=("FxStars",))

    doc, blob = read(os.path.join(OUT, "dog.glb"))
    report["dog"] = {"triangles": check_lods(doc, "dog", problems, budget=False),
                     "clips": check_clips(doc, blob, DOG_CLIPS, problems, "dog", loops=("Idle", "Run", "Defeat_Dizzy"),
                                          extra_ok=("FxStars",))}
    for h in ("FxStars", "FxPoof"):
        if by_name(doc)[h].get("scale") != [0.0, 0.0, 0.0]:
            problems.append(f"dog: {h} node scale should be 0")

    for fname, need in (("decoy.glb", ["Decoy", "LOD0", "LOD1"]), ("trap.glb", ["Trap", "Open", "Sprung"]),
                        ("hunter_fx.glb", ["Stars", "Poof"])):
        doc, _ = read(os.path.join(OUT, fname))
        nodes = by_name(doc)
        for n in need:
            if n not in nodes:
                problems.append(f"{fname}: missing node {n}")
        report[fname] = {n: tris(doc, nodes[n]) for n in need if n in nodes and "mesh" in nodes[n]}

    with open(os.path.join(OUT, "hunters.json")) as f:
        man = json.load(f)
    for lid in LOOKS:
        h = man["hunters"].get(lid, {})
        for k in ("file", "hitbox", "height", "scale", "triangles"):
            if k not in h:
                problems.append(f"hunters.json: {lid} missing {k}")
    if set(man["clips"]) != set(CLIPS):
        problems.append("hunters.json: clip list differs from hunter_anims.glb")
    text = json.dumps(man, ensure_ascii=False)
    if chr(0x2014) in text:
        problems.append("hunters.json contains an em dash")

    print(json.dumps(report, indent=1))
    for p in problems:
        print("PROBLEM:", p)
    print("VALIDATION", "FAILED" if problems else "OK")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
