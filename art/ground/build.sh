#!/bin/sh
# Rebuild the stylized ground textures (grass, forest floor, dirt, sand, rock, cobble,
# plowed field, wheat, green crop) into apps/client/public/textures/ground/.
# Usage: sh qwakk-game/art/ground/build.sh [--quick] [--only NAME]
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
BLENDER="${BLENDER:-/Applications/Blender.app/Contents/MacOS/Blender}"
"$BLENDER" -b --factory-startup -P "$HERE/blender/build_ground.py" -- "$@"
