#!/usr/bin/env bash
# Render the 1200×630 share card to public/og/floodwall.png.
# Needs the dev server running (npm run dev) and the agent-browser CLI. Pass the dev server's URL.
#   scripts/generate-og-image.sh http://127.0.0.1:5173
set -euo pipefail
cd "$(dirname "$0")/.."
base=${1:?usage: generate-og-image.sh <dev-server-url>}
base=${base%/}
still=artwork/og/.diagram.png
# Always hand the shared agent-browser session back with normal motion and the default viewport.
cleanup() {
  rm -f "$still"
  agent-browser set media light >/dev/null 2>&1 || true
  agent-browser set viewport 1280 720 1 >/dev/null 2>&1 || true
}
trap cleanup EXIT
mkdir -p public/og

# The card states the crate's own facts; reading them fails the run if Cargo.toml can't be parsed.
query=$(node --input-type=module -e '
  import { readCrateFacts } from "./crate-stats.mjs";
  const f = readCrateFacts("..");
  process.stdout.write(new URLSearchParams({ license: f.license, version: f.version, dependencies: f.dependencies, tests: f.tests }).toString());
')

# A still of the hero diagram (reduced motion holds one frame), drawn at 2× without its callouts,
# which would be unreadable at share-card size.
agent-browser set media light reduced-motion >/dev/null
agent-browser set viewport 1440 900 2 >/dev/null
agent-browser open "$base/" >/dev/null
agent-browser wait '[data-ledger-records]' >/dev/null
agent-browser eval 'const s = document.createElement("style"); s.textContent = ".diagram-scene .callout { display: none !important; }"; document.head.append(s);' >/dev/null
agent-browser screenshot ".diagram-scene svg" "$still" >/dev/null

agent-browser set viewport 1200 630 1 >/dev/null
agent-browser open "$base/artwork/og/card.html?$query&diagram=/$still" >/dev/null
agent-browser wait 'body[data-ready="true"]' >/dev/null
agent-browser screenshot public/og/floodwall.png >/dev/null
sips -g pixelWidth -g pixelHeight public/og/floodwall.png | tail -2
