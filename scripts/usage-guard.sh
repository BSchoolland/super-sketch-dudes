#!/bin/bash
# Stops a batch's systemd unit once Ben's weekly usage reaches a limit, or as soon as usage can't be read.
# Usage: scripts/usage-guard.sh <unit> <stop-at-percent> <dir to write stopped.txt + batch.done into>
# Run it in its own unit next to the batch: systemd-run --user --unit=<unit>-guard bash scripts/usage-guard.sh <unit> 90 <dir>
set -u
UNIT=$1 LIMIT=$2 DIR=$3
CHECK=/home/ben/Projects/benbot/scripts/usage-limits
stop() { systemctl --user stop "$UNIT"; echo "$1" > "$DIR/stopped.txt"; touch "$DIR/batch.done"; echo "$1" >&2; exit 1; }
while systemctl --user is-active -q "$UNIT"; do
  out=$("$CHECK" 2>&1) || stop "stopped: usage-limits failed: ${out: -300}"
  p=$(awk '/weekly all/ {gsub("%","",$3); print $3}' <<<"$out")
  [[ $p =~ ^[0-9]+$ ]] || stop "stopped: no weekly figure in usage-limits output: ${out: -300}"
  [ "$p" -ge "$LIMIT" ] && stop "stopped at ${p}% weekly (limit ${LIMIT}%)"
  sleep 120
done
