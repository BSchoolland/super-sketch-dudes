#!/usr/bin/env bash
# Build the game as a swappable bundle and push it to the site.
# Usage: scripts/push-game.sh [--site URL] [--current] [--room CODE]...
#   --current   make it the bundle shell.html loads by default
#   --room X    switch room X to it now (mid-match if one is running)
# SITE and FORGE_TOKEN come from the env or ~/.config/sketch-forge/env.
set -euo pipefail
cd "$(dirname "$0")/.."
# ~/.config/sketch-forge/env fills in whatever the environment doesn't set
if [ -f ~/.config/sketch-forge/env ]; then
  while IFS='=' read -r k v; do [ -n "$k" ] && [ -z "${!k:-}" ] && export "$k=$v"; done < <(grep -E '^[A-Za-z_]+=' ~/.config/sketch-forge/env)
fi
CURRENT=0; ROOMS=()
while [ $# -gt 0 ]; do case "$1" in
  --site) SITE=$2; shift 2;; --current) CURRENT=1; shift;; --room) ROOMS+=("$2"); shift 2;; *) echo "unknown arg $1" >&2; exit 2;; esac; done
: "${SITE:?SITE not set}"; : "${FORGE_TOKEN:?FORGE_TOKEN not set}"
npx vite build --config client/vite.app.config.ts --logLevel warn
HASH=$(node -e '
const fs=require("fs"),path=require("path");
const dir="dist/game", files={};
(function walk(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){const p=path.join(d,e.name); if(e.isDirectory()) walk(p); else files[path.relative(dir,p).split(path.sep).join("/")]=fs.readFileSync(p).toString("base64");}})(dir);
fetch(process.env.SITE.replace(/\/$/,"")+"/api/games",{method:"POST",headers:{"content-type":"application/json","x-forge-token":process.env.FORGE_TOKEN},body:JSON.stringify({files})})
 .then(async r=>{const j=await r.json(); if(!r.ok) throw new Error(JSON.stringify(j)); console.log(j.hash);});
')
echo "pushed bundle $HASH" >&2
post() { curl -sf -X POST -H "content-type: application/json" -H "x-forge-token: $FORGE_TOKEN" -d "{\"hash\":\"$HASH\"}" "${SITE%/}$1" >/dev/null; }
[ $CURRENT = 1 ] && post /api/games/current && echo "now the default bundle" >&2
for r in "${ROOMS[@]:-}"; do [ -n "$r" ] && post "/api/rooms/$r/game" && echo "room $r switched" >&2; done
echo "$HASH"
