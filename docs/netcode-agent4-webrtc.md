# Netcode result: agent 4 (WebRTC), branch `netcode-4-webrtc`

Inputs now go peer to peer over WebRTC data channels, direct or through TURN. They also go through the relay at the
same time, as a reliable copy, so a pair that can't link still plays. Around that, the rollback layer stops
spreading freezes: a frozen client keeps feeding the others. The prediction window is wider, and the relay plays a
player whose inputs have stopped as AWAY, so the others play on instead of waiting for them.

## Result

Full benchmark, 2 seeds × 3 min per scenario, against the baseline (`netlab/bench/2026-10-05-22-50-webrtc-final.md`,
commit 9caaaaf; the earlier full run `2026-10-05-22-06-webrtc.md` at 6737edf gave the same picture):

| tier | freezes/min | frozen s/min | longest freeze | game speed % | input delay | rollbacks past the window/min | away s/min | fast-forward frames/min | load wait s | errors |
|---|---|---|---|---|---|---|---|---|---|---|
| decent | **0** (was 11.7) | **0** (was 0.9) | 0 (was 499 ms) | 91.3 (was 91.2) | 2 (was 2) | 0 | 0 | 0 | 0.2 | none |
| poor | **0.5** (was 68.5: **137× fewer**) | **0.3** (was 15.4: **51× less**) | 0.9 s (was 5.2 s) | 86.3 (was 81.9) | 2.5 (was 2) | 1.2 | 0.3 | 11.7 | 3.2 | none |
| awful | **6.5** (was 60: **9.2× fewer**) | **3.6** (was 51.9: **14× less**) | 5.8 s (was 21.7 s) | 82.9 (was 55.7) | 3 (was 3) | 6.8 | 3.9 | 147.5 | 1.7 | none |

Per scenario, decent tier: alpha-bravo, school-3p and evening-4p all had 0 freezes on both seeds. Was 2.5, 2 and 30.5
a minute.

Who still freezes:
- **Poor tier:** only seed 2, which has Kirill's 0.8-2.5 s blackouts. Kirill froze 1.7 s/min (his own downlink),
  Adrean 0.2 and Ben 0.
- **Awful tier:** Juliet, 7-12.6 s/min, during his own 1-10 s blackouts. Kilo and Lima were at 0-0.8 s/min
  (baseline 40-65).

Inputs arrived first over a peer-to-peer link 64-84 % of the time. That's in the lab, where a link has the same
shaped latency as the relay path (uplink A + downlink B). The links win by having no TCP head-of-line blocking or
retransmit backoff, not by being shorter. Real P2P is often shorter than going via the relay, but I'm not claiming
that from the lab.

Ben's bar: mild success is 3× fewer freezes, success 8×, great success "no freezes on half-decent connections,
*almost* none on connections like Kirill's, almost no downsides". Every tier is past 8× ("success"): decent ∞, poor 137× / 51×, awful 9.2× / 14×.
Half-decent connections had no freezes at all, and Kirill's connection had almost none (his own blackouts only),
which is the "great success" shape. The "almost no downsides" part holds for decent and poor. On the awful tier
the price is visible: the player with the dead link is played AWAY, there's fast-forward after freezes, and there
are more time-sync slowdowns (below).

## What changed and why

**1. Peer-to-peer links** (`client/src/net/mesh.ts`, `wire.ts`, `link.ts`). Each pair in a room gets an
RTCPeerConnection with one data channel: unordered, no retransmits, negotiated, so neither side waits for it to
open. Links are built in the lobby, so they're up before START. Signaling (offers, answers, trickled candidates)
rides the existing relay WebSocket (`rtc` messages, forwarded only between members of one room). ICE tries host and
STUN candidates first and falls back to TURN on its own. TURN credentials come from the relay
(`server/ice.ts`, coturn's REST scheme, valid 24 h), so nothing secret ships in the client. The member with the
lower id offers, times out after 10 s, and retries after 1, 2, 5, 10, 20 and then 30 s. A link that goes
"disconnected" gets 3 s before it's rebuilt. Each tick, every linked player gets the run of our inputs they haven't
acknowledged: binary and run-length encoded, typically 40-60 bytes, so a lost packet is covered by the next one.

**2. The relay stays as the reliable copy** (`link.ts`). Every input also goes to the relay, once and in order, and
the relay forwards it to everyone. Whichever copy arrives first counts. This one decision covers most of the
fallback ladder: a pair whose ICE fails, a network that blocks UDP, a link that dies mid-match, an older bundle in
the room. All of them simply play over the relay, with no switch-over moment to get wrong. It also keeps the
relay's view of the match (timeouts, its wide event, its desync check), and gives a leaver's drop frame a single
source. A relay-only pair whose acks stall gets its missing frames again over the relay, once a second (this is what
heals a bundle swap that lost packets).

**3. Freezes no longer spread** (`rollback.ts`). Before, a client only produced its input for frame N when its sim
stepped to N. One player freezing on a late packet therefore stopped feeding everyone else, and ~170 ms later the
whole room froze: in the baseline timelines everyone's red strips line up. Now a match clock ticks with real time
and takes and sends the local input every tick, whatever the sim is doing. The sim follows the clock and catches up
after a stall, at up to 8 frames a tick. The clock runs at most a second ahead of a frozen sim, so a long blackout
ends in under a second of fast-forward, not the whole blackout replayed.

**4. A wider prediction window, budgeted on CPU** (`rollback.ts`). The sim may run up to 30 frames (500 ms) past the
newest frame it has every input for, up from 8. Each step plus its snapshot is timed. The window is what 10 ms of
re-simulation buys at that cost, with a floor of 12. The heaviest production fighters cost 70-100 µs a step here
and ~200 µs on the 4×-throttled lab Chromebook (Lima), so Lima's window sits at 28-30 and dips to 12-14.

**5. The relay plays a silent player AWAY** (`server/lobby.ts` `checkFills`, `rollback.ts` `fill`). A player whose
uplink dies would otherwise freeze everyone until the 20 s drop. Once a player is 18 frames behind the second most
advanced other player at the relay, the relay decides their frames away up to there, sends `fill` to everyone, and
drops the late inputs for those frames. Frames another player holds over a link count as alive: every relay message
carries the sender's acks, so a stalled connection to the relay alone, while the links still work, doesn't make
anyone away. An AWAY frame plays as no input plus invulnerability, drawn faded with RECONNECTING. The relay is the
one place that sees every player's inputs in one order, so its call is the same everywhere. That makes inputs that
came over a link provisional until the relay's copy, or its fill, confirms them. Hashes, bundle handoffs and
snapshot pruning stand on these final frames, and a fill that overrules a provisional input rolls back as far as it
must. A player whose own frames were filled jumps their clock to where everyone else's is and sits out the frames
in between, so the room doesn't slow down while they catch up. Fills need every member to say it understands them,
and stop once a bundle swap is scheduled (an older bundle would desync on one).

**6. Smaller pieces.** A start barrier: the countdown starts on the relay's `go`, once every member's match screen
is up, so a slow fighter load is a wait on the GET READY screen, not a freeze right after GO. A mid-match leave
carries the relay's last frame for the leaver. The sim ignores an eliminated fighter's input, and hashes stop at the
end of the match, so clients needn't agree on the exact drop frame (P2P has no single delivery order). Time sync
ignores a remote it hasn't heard from in 20 ticks. Auto input delay uses a pair's direct-link round trip when there
is one. The HUD shows "p2p n/m". A handed-off match screen stops ticking: before, the old bundle's screen kept
simulating and sending inputs while the new bundle downloaded.

## Failure tests (`netlab/failures.sh`, all on the final build or the one before; runs in `netlab/runs/`)

| case | how | what happened |
|---|---|---|
| TURN only | `ben-adrean-kirill-turn`: Kirill's container drops UDP to the other players | All of Kirill's links route through the coturn container (`relay` candidates); Ben↔Adrean stay direct. 0 freezes, nobody away. (An earlier build played Kirill away for 3.5 s when his TCP to the relay stalled while TURN was fine. That's why the relay counts frames another player vouches for.) |
| WebRTC blocked (mixed match) | `ben-adrean-kirill-mixed`: Kirill drops all UDP and TURN's TCP port | Kirill has no links; his pairs ride the relay, Ben↔Adrean are direct. 0 freezes; Kirill played away 0.2 s/min when his TCP stalled. |
| Links lost mid-match, then back | `--at 40:block Kirill webrtc --at 80:unblock Kirill` | Inputs keep flowing over the relay: 0 freezes. ICE noticed in ~10 s; the offerer retried with backoff (3 failed attempts while blocked) and the links came back after the unblock (2 opens per pair). |
| A player still fighting closes the tab | `school-3p --at 60:leave Charlie` | The others saw PLAYER DISCONNECTED and were back in the room 3 s later, as before. |
| Players out of stocks leave | `school-3p --stocks 2 --leave-out` | Two eliminated players left one after the other; the rest played on to the end with no desync (the drop frame comes from the relay; the sim ignores an eliminated fighter's input). |
| A connection vanishes silently | `school-3p --at 40:cut Charlie` (all of his traffic dropped) | The others played on against an AWAY Charlie; the relay dropped him after 20 s and they went back to the room. 0 freezes. |
| Bundle swap mid-match | `school-3p --shell --at 30:swap` (the room switched to a second bundle the way `push-game.sh --room` does) | Everyone handed off at the same frame and resumed on the new bundle, 0 freezes, no desync. The same peer links carried on (adopted, not rebuilt). Found and fixed on the way: the old bundle's screen kept simulating and sending inputs while the new bundle downloaded. |

Unit tests (`test/rollback.test.ts`) run the real NetLink and session over a simulated relay (which fills like the
real one) and lossy, reordering links: dead links, deaf and mute players, a stalled relay connection, one on one, a
handoff that lost packets, eliminated fighters, and a fuzz of 24 seeds mixing all of it with hash checks. The fuzz
found a real desync: a deep rollback re-simulated our own pruned inputs as nothing. Fixed, and that state now throws.

## Downsides a player could feel

- **AWAY.** A player whose inputs stop reaching anyone (dead uplink) for more than ~300 ms stands still, untouchable,
  faded with RECONNECTING, while the others play on; whatever they pressed meanwhile is dropped. If they were in the
  air off stage they can still fall. On the awful tier Juliet spent 9-14 s/min that way; on the poor tier
  Kirill 0-1.5 s/min. In the baseline everyone froze instead. On their own screen the cut-off player sees their
  fighter snap back to standing when the fill arrives (a rollback).
- **Fast-forward after a freeze.** A frozen client catches up to the clock at up to 8 frames a tick (≤ 1 s of
  game). It's played on the inputs they gave a frozen screen. Awful tier: 147 frames/min; poor 12; decent 0.
- **Deeper rollbacks.** The window is 30 frames instead of 8, so a late input can rewrite up to half a second
  (remote fighters jump further when it happens). A fill that overrules provisional link inputs, or a recovery,
  can go deeper still: max rollback 64 frames on the poor tier and ~475 (Juliet coming back) on the awful one. Rollbacks
  past the window: 1.2/min poor, 6.8/min awful, 0 decent.
- **Slow motion from time sync.** A client ahead of the others gives up a tick now and then (unchanged mechanism).
  Per minute of play that's ~10 on the decent tier (baseline 11-53), ~90 on the poor one (baseline 88),
  but ~250 on the awful one (baseline 133): when a cut-off player comes back, the room evens out its clocks.
  It shows in game speed %, which also counts KO slow motion and the load wait.
- **Input delay** is still the relay's automatic choice, from round trips measured at START: decent 2, poor 2.5
  (one seed picked 3), awful 3 (baseline 2, 2, 3). Pairs with a link use the link's round trip. It's now a median:
  an average once caught one of Juliet's spikes and picked 6 frames in the first full bench.
- **A wait before the countdown.** Everyone waits on GET READY for the slowest fighter load (poor tier 3.2 s on
  average, mostly Kirill's 5 s load). The baseline froze right after GO instead (and counted it).
- **CPU.** A full-window rollback costs up to 10 ms on a slow machine (the window shrinks beyond that). On the
  4×-throttled lab Chromebook slow frames went from 10-13 % to 22-30 % in the awful tier. It simulates real play
  where it used to sit frozen half the match, and its rollbacks are deeper. Desktops: 1-8 % either way. In the
  first full bench, school-3p seed 1 showed ~40 % slow frames for all three players at once, with no freezes. Its
  step cost read 540 µs against ~70 µs normally, and the host's load average was ~7. A rerun of the same seed gave
  1.2 %, and so did the final bench, so I take it as the host.
- **Bandwidth** (estimated from the packet formats). A link packet is ~40-60 bytes of payload (~125 on the wire) 60 times a second per linked player,
  plus every frame to the relay once (~150 bytes on the wire per tick). A 4-player match sends ~30 kB/s and
  receives ~50 kB/s per player, roughly double the old upload. Players on bad wifi send more packets than before.
- **TURN can win over direct.** ICE picks whichever pair works first; in one lab run two players with working
  direct UDP ended up on a TURN route. In the lab it costs nothing; in production it would add the trip through
  the server. Chrome may move to the direct pair later, but I didn't see it happen.
- **A link that dies is only noticed by ICE after ~10 s.** Nothing waits on it (the relay copy is always there),
  but for those seconds that pair is back to relay latency.

## What production needs that the lab doesn't have

- **coturn** on personal-server for STUN and TURN, with the exact config, firewall rules, env and checks in
  `docs/webrtc-deploy.md`. Without it the game still works, but most pairs won't link: browsers hide local
  addresses behind mDNS names, and two homes behind NAT need STUN to find each other.
- **Apache** doesn't change: signaling rides the existing `/sketch-battle/ws` WebSocket.
- **TLS**: the page is https in production. The lab is plain http with Chrome told to treat it as secure. TURN over
  TLS (5349) is configured but untested; the lab's TURN is plain UDP/TCP.
- **NAT and firewalls.** The lab's players share one Docker bridge, so "direct" there means STUN-reflexive
  candidates on one network, and the tests just drop packets. They don't model real NATs (symmetric NAT needs
  TURN), carrier-grade NAT, or school networks that allow only 443. Those pairs fall back to TURN or the relay,
  which the lab does test.
- **Shell players** run whatever game bundle is current: push one built from master (`scripts/push-game.sh
  --current`) for them to get any of this. A room mixing an older bundle still works: those pairs ride the relay,
  and fills switch off for the match.
- **Browsers.** Only headless Chrome was tested. Safari and Firefox support unordered, unreliable data channels,
  but neither ran here.
- **The bundle is ~27 MB** (its music is inlined). On Kirill's lab wifi it didn't finish downloading in 3 minutes, so
  a mid-match swap would stall such a player for a long time. That's not new, but it's worth knowing before
  swapping bundles in a live match.

## Changes to the lab (all additive; the freeze definition, bot, profiles, existing scenarios and bench scoring are untouched)

- `Dockerfile`: coturn and iptables added; the image is tagged by the Dockerfile's hash, so a changed Dockerfile
  builds a new image instead of reusing a stale one.
- `run.mjs`: a coturn container on the game network beside the relay (unshaped, like the relay), with the relay
  pointed at it. In every player container, UDP on the *control* network is dropped: it joins the players unshaped,
  and ICE would otherwise find it. That's a lab bug fix that only matters with WebRTC. New options: `--block
  Name=p2p|webrtc`, `--at "<sec>:block|unblock|cut|leave|swap ..."`, `--stocks`, `--leave-out`, `--shell` (players
  on the swappable page; the ~27 MB bundle is loaded before the menus), and `NETLAB_CONSOLE=1`. The run records each
  player's selected candidate pairs and checks they're on the game network.
- `scenarios.mjs`: `ben-adrean-kirill-turn` and `ben-adrean-kirill-mixed` (the poor-tier session with Kirill's
  network blocking direct UDP, or WebRTC entirely). Not in the bench suite.
- `stats.mjs` and `bench.mjs`: new columns only (away s/min, fast-forward frames/min, rollbacks past the window,
  load wait, share of inputs first over a link). The existing metrics are computed as before.
- `failures.sh`: the failure cases above.
- I read the other three agents' write-ups after my first version worked. Their diagnosis matched what my
  timelines showed: freezes spread through the room, the 8-frame window was smaller than ordinary spikes, and TCP
  backoff after blackouts. The design here is my own, built around the P2P/relay split.

## Confidence and what's untested

Confident: the fallback ladder (direct, TURN, relay) and mixed matches, determinism under loss, reordering and
fills (unit tests, fuzz, and no desync in any lab run since 65ad082, which restored the hash exchange that an
earlier fill build had silently stopped), the bundle-swap
handoff with links adopted, leaves and drops, and the freeze numbers on these profiles.

Less sure:
- How often real-world pairs link directly. That depends on NAT types the lab doesn't have; telemetry `paths`
  will say.
- How AWAY feels to players. It's a gameplay call (stand still and invulnerable) that Ben should look at in a
  real match.
- The awful tier's slow-motion share and the throttled Chromebook's frame times: both measured, both worse than the
  frozen baseline in their own way.
- Fill timing (18 frames) and the window budget (10 ms) were tuned on these profiles only.

Untested:
- TURN over TLS, real NATs, Safari and Firefox, more than one room under load, and coturn itself on
  personal-server. Nothing here touched production.
- Relay WebSocket reconnection isn't implemented: losing the relay connection still ends your match (CONNECTION
  LOST), as before, even with links up. The relay is the referee for fills and drops, so a client can't play on
  without it.
