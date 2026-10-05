# netlab

Recreates real online matches on this machine: a relay running this checkout plus 2-4 headless Chromes, each in its
own Docker container behind its own shaped connection (Linux `tc netem`: delay, jitter, burst loss, timed wifi
spikes and blackouts, each direction separately). Bots fight through the real client, and the client's own
telemetry lands in the run's event log. The lab's numbers are therefore the same numbers production logs, and
`stats.mjs` reads both.

```sh
node netlab/prod.mjs events                     # cache production's event log (once, and to refresh)
node netlab/run.mjs ben-adrean-kirill           # 3 min recreation of a real session, report vs production
node netlab/run.mjs alpha-bravo --minutes 2 --video Alpha --post <discord thread id>
node netlab/run.mjs school-3p --net Charlie=spiky-wifi --seed 7    # swap one player's connection, another dice roll
node netlab/stats.mjs --prod --since 2026-10-05 # production match quality, same table as the lab's
node netlab/stats.mjs netlab/runs/<run>/data/events.jsonl
```

Each run writes `netlab/runs/<stamp>-<scenario>/`:
- `report.md`: the lab match next to the production matches it recreates
- `report.json`: everything, including the episode schedule and the 100 ms per-player timeline
- `timeline.png`: per player, round trip, frozen moments and the episodes on that player's link
- `<player>.mp4` with `--video <player>`: that client's screen, popups and all
- `data/`: the relay's data dir (`events.jsonl` has every client's and the relay's wide events)

## Pieces
- `scenarios.mjs`: a production match to replay (stage, fighters, players), the production matches to compare
  against, and each player's network profile. Fighters come from production (`prod.mjs fighter`, on demand).
- `profiles.mjs`: network profiles calibrated against production telemetry. `name@ms` sets the base one-way delay
  (players sit at different distances from the relay). Episodes are seeded, so `--seed` reproduces a run exactly.
- `shape.mjs`: netem on each player's game interface, with egress as the uplink and ingress through ifb0 as the
  downlink. A pfifo child keeps jittered packets in order, like a real link.
- `bot.js`: injected into each page. A human-paced bot plus a 100 ms probe (WAITING, missing input, round trip, frame).
- `run.mjs`: the orchestrator. `timeline.mjs`: the chart. `browser-server.mjs`: Playwright's server inside a player
  container.

## Reading the numbers
- "Waiting on X" / "missing input from X" means X's input hadn't arrived. The cause is either X's uplink or the
  waiting player's own downlink. The per-link episodes on the timeline tell which.
- The relay is plain `ws` on a local network, while production runs `wss` behind Apache. Bots press buttons about as
  often as people, but they aren't people, so compare rollback counts loosely.
- Headless Chrome renders on the CPU. Keep an eye on "slow frames" in the report: a lab client that can't hold 60 fps
  stalls everyone, and that's the lab's fault, not the network's. The `*-lan` scenarios measure that floor.
