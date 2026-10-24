#!/bin/sh
# Rebuild the Hunt Season melee art: katana and scabbard, the duck's katana clips, swing effects,
# melee.json and the review renders. Then check the published files against the contract.
# Usage: sh qwakk-game/art/melee/build.sh [--no-render] [--quick] [--only NAME]
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
BLENDER="${BLENDER:-/Applications/Blender.app/Contents/MacOS/Blender}"
"$BLENDER" -b --factory-startup --python-exit-code 1 -P "$HERE/blender/build_melee.py" -- "$@"
python3 "$HERE/validate.py"
