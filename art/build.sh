#!/bin/sh
# Rebuild the Qwakk duck: mesh, rig, GLB exports and review renders.
# Usage: sh qwakk-game/art/build.sh [--no-render] [--quick] [--only NAME]
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
BLENDER="${BLENDER:-/Applications/Blender.app/Contents/MacOS/Blender}"
"$BLENDER" -b --factory-startup -P "$HERE/blender/build_all.py" -- "$@"
