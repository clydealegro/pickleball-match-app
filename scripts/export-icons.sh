#!/usr/bin/env bash
# Exports the PWA icons from public/brand/icon.svg (macOS only: uses Quick Look to rasterize).
# The SVGs in public/brand are the source of truth. Edit those, then run `npm run icons`.
set -euo pipefail
cd "$(dirname "$0")/.."
out="$(mktemp -d)"
for size in 192 512; do
  qlmanage -t -s "$size" -o "$out" public/brand/icon.svg >/dev/null 2>&1
  mv "$out/icon.svg.png" "public/icons/icon-$size.png"
done
rmdir "$out"
echo "Wrote public/icons/icon-192.png and icon-512.png"
