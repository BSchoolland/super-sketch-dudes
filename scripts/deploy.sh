#!/usr/bin/env bash
# Build and ship to personal-server (user ssd, its own pm2) behind Apache on bschoolland.dev.
# Usage: scripts/deploy.sh [name=sketch-battle] [port=3008] [base=/sketch-battle/]
# Each name is its own pm2 process and Apache path (rules must exist for the base; see ARCHITECTURE.md).
set -euo pipefail
cd "$(dirname "$0")/.."
NAME=${1:-sketch-battle}; PORT=${2:-3008}; BASE=${3:-/sketch-battle/}
npm run check
SKETCHBATTLE_BASE=$BASE npm run build
BUILD=$(git rev-parse --short HEAD)
ssh ssd-server "mkdir -p ~/$NAME/dist"
# a page from the previous build can still be mid-match and fetch its hashed assets (music): those stay a week
rsync -az --delete --exclude /client/assets/ dist/ ssd-server:~/$NAME/dist/
rsync -az dist/client/assets/ ssd-server:~/$NAME/dist/client/assets/
ssh ssd-server "find ~/$NAME/dist/client/assets -type f -mtime +7 -delete"
rsync -az package.json package-lock.json ssd-server:~/$NAME/
ssh ssd-server "cd ~/$NAME && npm install --omit=dev --no-audit --no-fund >/dev/null && set -a && [ -f .env ] && . ./.env; set +a; export PORT=$PORT BUILD=$BUILD SKETCHBATTLE_BASE=$BASE && (pm2 describe $NAME >/dev/null 2>&1 && pm2 restart $NAME --update-env || pm2 start dist/server.mjs --name $NAME) && pm2 save >/dev/null"
echo "deployed: https://bschoolland.dev$BASE"
