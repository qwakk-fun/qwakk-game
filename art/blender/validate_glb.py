"""Check the published GLBs against the asset contract the engine codes against.

Plain Python (no Blender needed):  python3 qwakk-game/art/blender/validate_glb.py
Exits non-zero on any problem.
"""

import json
import os
import struct
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
MODELS = os.path.join(os.path.dirname(os.path.dirname(HERE)), "apps", "client", "public", "models")

REQUIRED_CLIPS = [
    "Idle", "Walk_F", "Walk_B", "Walk_L", "Walk_R", "Run_F", "Run_B", "Run_L", "Run_R", "Sprint",
    "Crouch_Idle", "Crouch_Walk", "Jump_Start", "Fall_Loop", "Land", "Death_A", "Death_B", "Hit_React",
    "Rifle_Aim", "Pistol_Aim", "Rifle_Reload", "Pistol_Reload",
]
OPTIONAL_CLIPS = ["Rifle_Fire", "Pistol_Fire", "Quack", "Equip", "Rifle_ADS", "Pistol_ADS"]
RELOAD_SECONDS = {"rifle": 2.3, "pistol": 1.6}   # packages/shared/src/weapons.ts reloadTicks / 30
MIXAMO_CORE = ["Hips", "Spine", "Spine1", "Spine2", "Neck", "Head", "LeftShoulder", "LeftArm", "LeftForeArm",
               "LeftHand", "RightShoulder", "RightArm", "RightForeArm", "RightHand", "LeftUpLeg", "LeftLeg",
               "LeftFoot", "LeftToeBase", "RightUpLeg", "RightLeg", "RightFoot", "RightToeBase", "Jaw"]
EMPTIES = ["Muzzle", "Grip", "Support", "Eject"]


def read(path):
    with open(path, "rb") as f:
        data = f.read()
    n = struct.unpack("<I", data[12:16])[0]
    return json.loads(data[20:20 + n])


def main():
    problems = []
    report = {}
    duck = read(os.path.join(MODELS, "duck.glb"))
    joints = [duck["nodes"][i]["name"] for i in duck["skins"][0]["joints"]]
    report["duck_joints"] = len(joints)
    report["duck_triangles"] = sum(duck["accessors"][p["indices"]]["count"] // 3
                                   for m in duck["meshes"] for p in m["primitives"])
    missing = [b for b in MIXAMO_CORE if b not in joints]
    if missing:
        problems.append(f"duck.glb missing bones {missing}")

    anims = read(os.path.join(MODELS, "duck_anims.glb"))
    names = [n.get("name") for n in anims["nodes"]]
    clips = {}
    for a in anims.get("animations", []):
        dur = max(anims["accessors"][s["input"]]["max"][0] for s in a["samplers"])
        targets = {names[c["target"]["node"]] for c in a["channels"]}
        stray = sorted(t for t in targets if t not in joints)
        if stray:
            problems.append(f"{a['name']} animates nodes not in duck.glb: {stray}")
        clips[a["name"]] = {"seconds": round(dur, 3), "channels": len(a["channels"])}
    for c in REQUIRED_CLIPS:
        if c not in clips:
            problems.append(f"missing clip {c}")
    extra = [c for c in clips if c not in REQUIRED_CLIPS + OPTIONAL_CLIPS]
    if extra:
        problems.append(f"unexpected clips {extra}")
    report["clips"] = clips

    for kind in ("rifle", "pistol"):
        g = read(os.path.join(MODELS, "weapons", kind + ".glb"))
        nodes = g["nodes"]
        # The weapon node: the mesh node with children (the magazine is a child mesh node, `Mag`).
        root = [n for n in nodes if "mesh" in n and n.get("children")]
        if len(root) != 1:
            problems.append(f"{kind}.glb should have one weapon mesh node with children")
            continue
        r = root[0]
        mag = [nodes[i] for i in r.get("children", []) if nodes[i].get("name") == "Mag"]
        if not mag or "mesh" not in mag[0]:
            problems.append(f"{kind}.glb missing the Mag mesh node")
        if any(k in r for k in ("translation", "rotation", "scale", "matrix")):
            problems.append(f"{kind}.glb weapon node has a transform; it must sit at the origin")
        children = [nodes[i]["name"] for i in r.get("children", [])]
        for e in EMPTIES:
            if e not in children:
                problems.append(f"{kind}.glb missing empty {e}")
        tris = sum(g["accessors"][p["indices"]]["count"] // 3 for n in [r] + mag for p in g["meshes"][n["mesh"]]["primitives"])
        report[kind] = {"triangles": tris, "empties": {nodes[i]["name"]: nodes[i].get("translation", [0, 0, 0])
                                                       for i in r.get("children", [])}}
        if not 1500 <= tris <= 4000 and kind == "rifle":
            problems.append(f"rifle triangles {tris} outside 1.5k to 4k")
    with open(os.path.join(MODELS, "weapons", "attach.json")) as f:
        attach = json.load(f)
    for kind in ("rifle", "pistol"):
        if kind not in attach or set(attach[kind]) != {"position", "quaternion"}:
            problems.append(f"attach.json missing {kind}")
    report["attach"] = {k: attach[k] for k in ("rifle", "pistol") if k in attach}
    reload = attach.get("reload", {})
    for kind, secs in RELOAD_SECONDS.items():
        r = reload.get(kind)
        if not r:
            problems.append(f"attach.json missing reload.{kind}")
            continue
        if abs(r["seconds"] - secs) > 1e-6:
            problems.append(f"reload.{kind}.seconds {r['seconds']} != server reload {secs}")
        if not 0 <= r["out"] <= r["drop"] <= r["fresh"] <= r["in"] <= r["seconds"]:
            problems.append(f"reload.{kind} events out of order")
        if set(r.get("magInHand", {})) != {"position", "quaternion"}:
            problems.append(f"reload.{kind}.magInHand missing")
        clip = clips.get(("Rifle" if kind == "rifle" else "Pistol") + "_Reload")
        if clip and abs(clip["seconds"] - secs) > 0.02:
            problems.append(f"{kind} reload clip {clip['seconds']} s != server reload {secs} s")
    print(json.dumps(report, indent=1))
    for p in problems:
        print("PROBLEM:", p)
    print("VALIDATION", "FAILED" if problems else "OK")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
