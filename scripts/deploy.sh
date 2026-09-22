#!/usr/bin/env bash
# Build and ship to personal-server; PM2 process "ringout" on :3008 behind Apache's /ringout ProxyPass (bschoolland.dev).
set -euo pipefail
cd "$(dirname "$0")/.."
npm run check
npm run build
ssh personal-server "mkdir -p ~/ringout/dist"
rsync -az --delete dist/ personal-server:~/ringout/dist/
rsync -az package.json package-lock.json personal-server:~/ringout/
ssh personal-server 'cd ~/ringout && npm install --omit=dev --no-audit --no-fund >/dev/null && (pm2 describe ringout >/dev/null 2>&1 && pm2 restart ringout --update-env || PORT=3008 pm2 start dist/server.mjs --name ringout) && pm2 save >/dev/null'
echo "deployed: https://bschoolland.dev/ringout/"
