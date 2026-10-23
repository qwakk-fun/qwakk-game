#!/bin/sh
# Rebuild the duck hunters (raid enemies): meshes, rig, clips, dog, props, GLB exports, manifest and renders.
# Usage: sh qwakk-game/art/hunters/build.sh [--no-render] [--quick] [--only NAME]
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
BLENDER="${BLENDER:-/Applications/Blender.app/Contents/MacOS/Blender}"
"$BLENDER" -b --factory-startup --python-exit-code 1 -P "$HERE/blender/build_hunters.py" -- "$@"
python3 "$HERE/validate.py"
