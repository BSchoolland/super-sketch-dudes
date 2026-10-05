#!/usr/bin/env bash
# The peer-to-peer failure cases, one lab run each (about 25 min). Read each run's report.md (links, away, errors)
# and the lines the runs log: links settled, leaves, back in the room, bundles after a swap.
set -euo pipefail
cd "$(dirname "$0")/.."
run() { echo "=== $*"; node netlab/run.mjs "$@" --no-build 2>&1 | grep -E "links:|leaves|back in the room|swap|bundles:|block|cut|ERROR|Error|frozen .* s/min|^/" ; }
npm run build >/dev/null
# TURN: Kirill's network refuses UDP to the other players
run ben-adrean-kirill-turn --minutes 2
# no WebRTC at all for Kirill: a mixed match, his pairs on the relay
run ben-adrean-kirill-mixed --minutes 2
# links die mid-match and come back (ICE failure, retries, reconnection), the match carrying on over the relay
run ben-adrean-kirill --minutes 3 --at "40:block Kirill webrtc" --at "80:unblock Kirill"
# a player still in the fight closes the tab: the others go back to the room
run school-3p --minutes 2 --at "60:leave Charlie"
# players out of stocks leave: the rest play on in step
run school-3p --minutes 3 --stocks 2 --leave-out
# a player's connection vanishes without a word: played away, then dropped after 20 s, the others back to the room
run school-3p --minutes 2 --at "40:cut Charlie"
# the room switches game bundles mid-match through the swappable page, links and all
run ben-adrean-kirill --minutes 2 --shell --at "50:swap"
