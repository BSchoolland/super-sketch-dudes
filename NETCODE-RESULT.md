# Netcode: the combined result (step 5), branch `netcode-5-combined`

Four agents worked independently on the online freezes. This branch takes the best of them: agent 4's WebRTC design
as the base, agent 1's self-healing relay link, and agent 2's on-screen smoothing of corrections, plus two fixes
found while combining them. Each agent's own write-up is on its branch (`netcode-1-open`, `netcode-2-nofreeze`,
`netcode-3-pipe`, `netcode-4-webrtc`). Agent 4's is also kept here as `docs/netcode-agent4-webrtc.md`.

## Result

The official lab benchmark (`netlab/bench/2026-10-06-00-38-combined-final.md`): 5 recreated sessions, 2 seeds × 3 min
each, against the baseline of the current netcode.

| tier | freezes/min | frozen s/min | longest freeze | game speed % | input delay |
|---|---|---|---|---|---|
| decent (Alpha/Bravo, school 3p, evening 4p) | **0** (was 11.7) | **0** (was 0.9) | 0 (was 0.5 s) | 90 (was 91) | 2 |
| poor (Ben/Adrean/Kirill) | **0.5** (was 68.5, 137× fewer) | **0.3** (was 15.4, 51× less) | 0.9 s (was 5.2 s) | 88 (was 82) | 2 |
| awful (Juliet's worst night + a slow Chromebook) | **3** (was 60, 20× fewer) | **2.7** (was 51.9, 19× less) | 3.4 s (was 21.7 s) | 86 (was 56) | 2.5 |

Who still freezes:
- **Poor tier**: Ben and Adrean 0 s/min. Kirill 0-1.8 s/min, and only during his own wifi blackouts.
- **Awful tier**: Kilo and Lima 0-0.2 s/min. Juliet 5-10 s/min, during his own 1-10 s blackouts (his connection
  is simply gone then).

No desyncs or crashes in any run. `npm run check` passes: 138 tests, including a 24-seed fuzz of blackouts, relay
stalls, dead links and loss.

### All five side by side (freezes/min · frozen s/min)

| | decent | poor | awful |
|---|---|---|---|
| baseline | 11.7 · 0.9 | 68.5 · 15.4 | 60 · 51.9 |
| 1, open brief | 0 · 0 | 1 · 0.7 | 6 · 4.7 |
| 2, relax the freeze rule | 0 · 0 | 0.5 · 0.5 | 1.5 · 4.6 |
| 3, better pipe, no WebRTC | 3.8 · 0.1 | 16.5 · 4.2 | 33.5 · 19.9 |
| 4, WebRTC | 0 · 0 | 0.5 · 0.3 | 6.5 · 3.6 |
| **combined** | **0 · 0** | **0.5 · 0.3** | **3 · 2.7** |

Agents 1, 2 and 4 each found the same three root causes on their own:
1. A frozen client stopped sending inputs, so one player's freeze spread to everyone.
2. The 8-frame prediction window was smaller than ordinary wifi spikes.
3. Nobody could play on past a player whose connection had died, and TCP's retry backoff stretched a 2 s wifi
   dropout into a 20 s freeze.

Their designs land close together. Agent 3 kept the old rules and improved only the pipe, which got 2-4×.

## Why this combination

- **Agent 4 as the base.** It has the most complete design and the most failure testing: TURN-only, WebRTC blocked
  entirely, links lost and regained, leaves, silent drops, and a mid-match bundle swap. Every input goes peer to peer
  *and* through the relay, so any pair that can't link still plays, with no switch-over moment to get wrong. With
  WebRTC blocked for everyone it still holds the gains, so most of the win is the rollback/referee redesign, not
  P2P.
- **Agent 1's self-healing relay link** (`client/src/net/transport.ts`, `server/lobby.ts` "resume"). Agent 4 kept
  the relay socket as it was. A relay-only player, and school wifi often blocks UDP, sat out TCP's backoff after
  every blackout. Now, when the relay hasn't confirmed our inputs for 600 ms, fresh sockets open (one more a second)
  and the first to connect resumes the player with a token from `hello`. The relay keeps the slot for 15 s and sends
  `resumed`, then everything missed in order (fills, inputs, leaves). The client resends its own inputs after the
  relay's ack. With WebRTC blocked, the worst player's longest freeze dropped from 14 s to 9 s.
- **Agent 2's correction smoothing** (`render.ts`). When a rollback moves a fighter by up to 300 units, the move is
  eased out over about 0.1 s instead of popping. Render only; the sim is untouched.
- **Not taken**:
  - Agent 2's majority-vote "away" scheme. It needs no server change, which is elegant, but it can't decide anything
    in 1v1 or with two dropouts at once.
  - Agent 3's WebTransport. It needs a glibc-2.38 native module (production is AlmaLinux 8) and a UDP port, for a
    gain P2P already gives.
  - Agent 1's KO slow motion inside the sim. It's a gameplay-adjacent change this design doesn't need.

## Fixed while combining

1. **Resume ordering**: the relay sent the catch-up before `resumed`, and the client ignored it, so a resumed player
   slowly lost the link. Covered by a relay test.
2. **A hole in agent 4's fills: partial mesh.** Juliet was linked to Kilo only, and his relay connection stuck.
   Kilo's acks kept Juliet "alive", while Lima, who gets Juliet's inputs only from the relay, froze for 22 s. A frame
   now counts as vouched for only when *every* other player holds it. A test fails on the old rule and passes on the
   new one. In the lab, Kilo went from 5 to 0 s/min frozen and Lima from 9.3 to 0.5.
3. `docs/webrtc-deploy.md` assumed Ubuntu. personal-server is AlmaLinux 8 with firewalld, and coturn 4.18 is in EPEL.

## Downsides a player could feel

- **AWAY.** A player whose inputs stop reaching anyone for more than about 0.3 s stands still, faded, can't be hit,
  and shows RECONNECTING, while the others play on. Whatever they pressed meanwhile is dropped. On their own screen
  they see a freeze, then a snap back when they return. Juliet spent ~3 s/min like this, Kirill 0.3 s/min. Before,
  everyone froze instead.
- **Deeper corrections.** The game predicts up to 30 frames (0.5 s) instead of freezing, so a late input can rewrite
  more. Positions are smoothed, but a hit can land or vanish late. Max rollback was 10 frames on decent connections
  and 64 on poor; on awful it was deeper, at the moment a dropped player is overruled.
- **Fast-forward** after a player's own freeze: their sim catches up at up to 8 frames a tick (about 140 frames/min
  in the awful tier, 0 on decent).
- **Slow Chromebooks**: on the lab's 4×-throttled client, slow frames went from 10-13% (baseline, frozen half the
  time) to 25-28%. About 19% of that remains with P2P off for that player, so P2P costs it a few points. Profiling
  shows the time goes to canvas rendering, not netcode JS.
- **A short GET READY** before the countdown while everyone's fighters load (0.1-2 s), instead of a freeze right
  after GO.
- **Bandwidth**: roughly double the old upload (P2P packets to each peer plus the relay copy), about 30 kB/s up in a
  4-player match.

## What production needs that the lab doesn't have

- **Deploy client and relay together, between sessions.** Pages open from before the deploy should reload. A room
  mixing an old bundle still plays, but those pairs ride the relay and nobody is played away in that match.
- **coturn on personal-server** for STUN/TURN (`docs/webrtc-deploy.md`, now written for the real box). Without it
  everything still works over the relay, including the self-healing link. With it, most pairs link directly.
- **Untested outside the lab**: Apache + TLS reconnects (resume uses the same `/sketch-battle/ws` URL, so no Apache
  change is needed), real NATs, Safari and Firefox, and how players feel about AWAY. The match telemetry now records
  everything needed to judge it from real sessions: per-player waits and who they waited on, `paths` (link vs relay),
  `relayLink` (resumes), away and fill counts.

## Lab tools added in this step

- `node netlab/run.mjs <scenario> --profile <player>` writes a CPU profile of that client over the fight and lists
  the top self-time functions in the report.
