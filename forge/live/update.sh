#!/bin/bash
# Keeps the forge worker on exactly what the live site runs. The worker runs from its own worktree,
# ~/Projects/sketch-battle-forge-live, never the shared dev checkout (sessions switch branches there).
# Every few minutes (forge/live/sketch-forge-live-update.timer): if the site's build (GET /api/health) differs from the
# worktree's commit and no forge job is running or queued, move the worktree there, reinstall packages if the lockfile
# changed, and restart sketch-forge. Busy: it tries again next tick.
set -euo pipefail
# all in one function: bash has read the whole of it before the checkout below rewrites this file
main() {
  LIVE="$HOME/Projects/sketch-battle-forge-live"
  SITE="${SITE:-https://supersketchdudes.com}"
  cd "$LIVE"
  build=$(curl -fsS --max-time 20 "$SITE/api/health" | python3 -c 'import json,sys; print(json.load(sys.stdin)["build"])')
  [ -n "$build" ] || { echo "no build from $SITE/api/health" >&2; exit 1; }
  here=$(git rev-parse --short=7 HEAD)
  [ "$here" = "${build:0:7}" ] && return 0
  git fetch -q origin
  target=$(git rev-parse --verify "$build^{commit}")
  busy=$(ssh ssd-server 'cd ~/sketch-battle/server-data && python3 -c "
import json; j=json.load(open(\"forge-jobs.json\")); j=j if isinstance(j,list) else list(j.values())
print(sum(1 for x in j if x[\"status\"] in (\"running\",\"queued\")))"')
  if [ "$busy" != "0" ]; then echo "site is on $build, worker on $here, $busy forge job(s) in flight: next tick"; exit 0; fi
  lock_changed=$(git diff --name-only HEAD "$target" -- package-lock.json)
  git checkout -q --detach "$target"
  [ -n "$lock_changed" ] && npm ci --silent
  systemctl --user restart sketch-forge
  echo "worker moved $here -> ${build:0:7} and restarted"
}
main "$@"
