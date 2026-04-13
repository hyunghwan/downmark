#!/usr/bin/env bash

set -euo pipefail

usage() {
  cat <<'EOF'
Usage: repack-unsigned-macos-dmg.sh <path-to-dmg>

Extracts the app bundle from an unsigned DMG, re-signs the bundle ad-hoc so the
code signature is internally consistent, and rebuilds the DMG in place.
EOF
}

if [ "$#" -ne 1 ]; then
  usage >&2
  exit 1
fi

input_dmg="$1"

if [ ! -f "$input_dmg" ]; then
  echo "DMG not found: $input_dmg" >&2
  exit 1
fi

if [ "$(uname -s)" != "Darwin" ]; then
  echo "This script must run on macOS." >&2
  exit 1
fi

work_dir="$(mktemp -d)"
mounted_volume=""

cleanup() {
  if [ -n "$mounted_volume" ] && [ -d "$mounted_volume" ]; then
    hdiutil detach "$mounted_volume" >/dev/null 2>&1 || true
  fi
  rm -rf "$work_dir"
}

trap cleanup EXIT

attach_output="$(hdiutil attach "$input_dmg" -nobrowse -readonly)"
mounted_volume="$(printf '%s\n' "$attach_output" | awk '/\/Volumes\// { print substr($0, index($0, "/Volumes/")); exit }')"

if [ -z "$mounted_volume" ] || [ ! -d "$mounted_volume" ]; then
  echo "Unable to locate mounted DMG volume for: $input_dmg" >&2
  exit 1
fi

app_source="$(find "$mounted_volume" -maxdepth 1 -type d -name '*.app' | head -n 1)"

if [ -z "$app_source" ] || [ ! -d "$app_source" ]; then
  echo "Unable to find an app bundle in mounted DMG: $input_dmg" >&2
  exit 1
fi

app_name="$(basename "$app_source")"
volume_name="${app_name%.app}"
stage_dir="$work_dir/dmg-root"
rebuilt_dmg="$work_dir/$(basename "$input_dmg")"

mkdir -p "$stage_dir"

ditto "$app_source" "$stage_dir/$app_name"
ln -s /Applications "$stage_dir/Applications"

# Clear inherited attributes before replacing the broken bundle signature.
xattr -cr "$stage_dir/$app_name" || true
codesign --force --deep --sign - --timestamp=none "$stage_dir/$app_name"
codesign --verify --deep --strict --verbose=2 "$stage_dir/$app_name"

hdiutil detach "$mounted_volume" >/dev/null
mounted_volume=""

hdiutil create \
  -volname "$volume_name" \
  -srcfolder "$stage_dir" \
  -ov \
  -format UDZO \
  "$rebuilt_dmg" >/dev/null

mv "$rebuilt_dmg" "$input_dmg"

echo "Repacked unsigned macOS DMG with a valid ad-hoc app bundle signature: $input_dmg"
