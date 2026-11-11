#!/usr/bin/env bash
# Rasterise the Floodwall favicon set from its SVG sources (same size set as erpai.studio).
# macOS only: sips renders the SVGs through CoreSVG; Node packs the ICO.
set -euo pipefail
cd "$(dirname "$0")/.."
icons=public/favicon
tile=artwork/favicon/floodwall-tile.svg
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

render() { sips -s format png -z "$3" "$3" "$1" --out "$2" >/dev/null; }

# Transparent tab icons for browsers that skip SVG favicons, per colour scheme.
for theme in light dark; do
  for size in 16 32 48 64; do
    render "$icons/floodwall-browser-$theme.svg" "$icons/floodwall-browser-$theme-$size.png" "$size"
  done
done

# Opaque tiles: 96/192/256 are linked, 512 is the manifest icon, and 16-256 are the ICO's frames.
for size in 16 24 32 48 64 96 128 192 256 512; do
  render "$tile" "$icons/floodwall-search-icon-$size.png" "$size"
done

# Home-screen icons for iPad (152, 167) and iPhone (180, at the root path iOS also probes); iOS
# applies its own corner mask, so the tile stays square.
for size in 152 167; do
  render "$tile" "$icons/floodwall-apple-touch-icon-$size.png" "$size"
done
render "$tile" public/apple-touch-icon.png 180

# Legacy /favicon.ico for crawlers and old browsers: the tile at seven frame sizes, each stored as
# PNG (read by every current browser and OS) so the file stays small; a 256px bitmap frame alone is 256 KB.
node --input-type=module - "$icons" public/favicon.ico <<'JS'
import fs from "node:fs";
const [icons, out] = process.argv.slice(2);
const sizes = [256, 128, 64, 48, 32, 24, 16];
const frames = sizes.map((size) => fs.readFileSync(`${icons}/floodwall-search-icon-${size}.png`));
const header = Buffer.alloc(6 + 16 * frames.length);
header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(frames.length, 4);
let offset = header.length;
frames.forEach((png, i) => {
  const entry = 6 + 16 * i, size = sizes[i] % 256; // 0 encodes 256
  header.writeUInt8(size, entry); header.writeUInt8(size, entry + 1);
  header.writeUInt16LE(1, entry + 4); header.writeUInt16LE(32, entry + 6);
  header.writeUInt32LE(png.length, entry + 8); header.writeUInt32LE(offset, entry + 12);
  offset += png.length;
});
fs.writeFileSync(out, Buffer.concat([header, ...frames]));
JS
