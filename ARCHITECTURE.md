# SUPER SKETCH DUDES — Architecture

TypeScript, Vite, Canvas 2D on the client; Express + `ws` on the server; a shared deterministic
sim used by both. Same shape as Kessler so it deploys the same way (pm2 process behind Apache
at bschoolland.dev/sketch-battle).

```
sketch-battle/
  shared/            the sim. Pure, deterministic, no DOM, no Date, no Math.random
    sim.ts           step(state, inputs) -> state ; the only entry
    state.ts         the whole match state as one plain object (rollback snapshots clone it)
    fighter.ts       fighter state machine (actions, frames, transitions)
    physics.ts       movement, collision with stage geometry, ledges
    hits.ts          hitbox/hurtbox resolution, knockback, hitlag, shields, grabs
    input.ts         the per-frame input record and derived edges (pressed/released/flick)
    fixed.ts         deterministic math: sin/cos tables by degree, sqrt, a seeded PRNG
    fighters/        one folder per fighter: stats.ts, moves.ts, rig.ts, palette.ts, index.ts
    fighters/index.ts  the roster
    stages/          one file per stage: geometry (platforms, ledges, blast zones); registerStage for player maps
    maps.ts          player-made maps: the editor's document, its validation, and the stage derived from it
    cpu.ts           bot controller: reads state, returns an input record
    rules.ts         stocks, time, KO, sudden death
  client/
    index.html, vite.config.ts (base "/sketch-battle/")
    src/main.ts      boot, screen router
    src/render/      canvas renderer: camera, rigs, effects, particles, stages, hud
    src/input/       keyboard + gamepad -> input records per slot; device assignment
    src/screens/     title, character select, stage select, versus, online lobby, training, settings, maps + map editor
    src/net/         rollback session (predict / snapshot / resimulate) + websocket transport
    src/audio/       procedural WebAudio sfx + music
    src/telemetry/   wide events: the page session, each online match's view, sent to /api/events
  server/index.ts    static files, /api/health, /api/events, lobby + input relay over /ws
  server/maps.ts     /api/maps: player-made maps as files, gated by map-makers.json
  server/events.ts   wide event store writer, request/process events; eventlog.ts reads it back
  scripts/           headless: ladder (CPU vs CPU matchups), frames (dump move data),
                     shots (Playwright screenshots of every screen), smoke, deploy.sh
  test/              vitest: determinism (same inputs => same hash), rollback equivalence,
                     knockback formula, ledge grab, shield math, each fighter's moves have
                     hitboxes on their active frames
```

## Player-made maps

A map (`shared/maps.ts`) is terrain blocks, thin platforms (still, back-and-forth or orbiting) and
four spawns. `stageFromMap` turns it into a `Stage`: the biggest block is platform 0 (the main
stage the camera keeps in frame), every block gets a ledge at each end, and the blast zone, camera
box and respawn point are laid out around the geometry with the shipped stages' proportions.
`createMatch` registers the map named by `config.map` before it looks the stage up, so a config
that carries its map plays the same everywhere: locally, over the relay (the host's stage pick and
start message carry it; the server relays a map only after `checkMap` passes), and across a bundle
swap. Fighters start standing on whatever platform their spawn is on.

## Community characters

A player file (`server/library.ts`) holds the player's own characters and `saved`: ids of other
players' characters, references like the starters, never copies. GET /api/library is own + saved
(flagged `saved`) + starters, so a saved character is a battle choice like any other. COMMUNITY
(/api/characters/community) lists ready characters that are `public` (missing means public), not
starters and not deleted; popularity is how many player files save it, counted when the files are
scanned and kept current on save and unsave. A creator deleting a character somebody saved only
marks it `deleted`: it leaves their library and COMMUNITY, its bundle stays, and the entry is
removed for real when the last saver unsaves it.

## Determinism (non-negotiable; rollback depends on it)

- `shared/` never touches `Math.sin/cos/tan/atan2/pow/exp/log/random`, `Date`, `performance`,
  `Map` iteration order over non-insertion keys, or floats in state that came from the DOM.
  `scripts/lint-determinism.mjs` greps for these and fails the build.
- Angles are integer degrees; `fixed.ts` holds 360-entry sin/cos tables computed once from
  literal constants at module load (the tables are rounded to 1e-6 so every engine agrees).
- The PRNG is xorshift32 seeded from the match seed; it lives in state.
- Positions and velocities are JS numbers but only ever combined with + - * / and `Math.sqrt`,
  `Math.floor`, `Math.abs`, `Math.min/max`, which are IEEE-exact across engines.
- State is a tree of plain objects and arrays with no class instances; `cloneState` is a
  structured deep copy written by hand (no `structuredClone`, it's slow) and `hashState` is a
  32-bit FNV over the numeric fields for desync detection.
- `step` takes the state and the inputs for that frame and mutates in place; the rollback layer
  is responsible for cloning before it steps ahead on predictions.

## The sim step (60 Hz)

1. Apply inputs: derive pressed/released/flick edges per player from this and last frame.
2. Fighter state machines advance one frame: action timers, transitions (jump squat -> jump,
   attack startup -> active -> recovery, hitstun -> tumble -> tech), ledge logic, specials.
3. Physics: velocities, gravity, fast fall, air control, ground friction, then move and collide
   against stage geometry (platforms are one-way from below; main stage is solid; walls).
4. Hits: for each active hitbox of each fighter, test against every other fighter's hurtboxes,
   shields, and projectiles. Resolve one hit per attacker-victim pair per move (hit ids).
   Apply damage, hitlag (both), knockback (victim), shield stun, DI.
5. Projectiles and stage objects advance.
6. Rules: blast zones, KOs, respawn platforms, stock counts, timer, sudden death.
7. Events: the step appends to `state.events` (hit, KO, land, jump, ...) which the renderer and
   audio consume and then clear. Rollback re-simulation discards events from rolled-back frames
   so effects only fire for confirmed frames (renderer dedupes on frame number + event index).

## Fighters as data

`moves.ts` exports a `Record<MoveId, Move>`. A move is: total frames, landing lag, a list of
hitboxes each with `{ frames: [start, end], bone, offset, radius, damage, angle, base, growth,
hitlag multiplier, id, flags (spike, electric, armour-breaking, projectile-reflecting) }`, an
optional list of "windows" (interruptible-as-soon-as, cancel-into) and a pose track: keyframes
`{ frame, pose }` where a pose is joint angles + root offset + scale (squash/stretch). The rig
(`rig.ts`) says what bones exist, their lengths, thickness, draw order, and how each is drawn.
Specials that need state (charge, fuel, heat, counters) keep it in `fighter.special` which
is a fighter-specific plain object whose **every key must exist from `special()` onward** (the state
hash walks its keys in insertion order, so a key that appears mid-match on one client and not the
other is a desync), and `fighter.ts` hooks named in the fighter's `index.ts`
(`onFrame`, `onHit`, `onHurt`, `onLand`) implement the mechanic.

The training mode hitbox view and the pose sheet both read the same data, so what's
documented is what ships.

### Rig conventions (get these right or every pose is wrong)

- Bone angles are degrees relative to the parent bone. World angle 0 points **down**, 90 points
  **forward** (toward the fighter's facing), 180 **up**, 270 **backward**.
- The humanoid rig (`shared/fighters/humanoid.ts`): an invisible `hip` bone runs from the feet up
  to the hip (rest 180). `torso` continues up (rest 0). Arms hang from the torso with rest 188
  (front) and 172 (back), so their world angle at rest is ~8° / ~352° (hanging). Legs hang from
  the hip tip with rest 188 / 172.
- A pose angle is **added** to the rest. For the front arm that means: forward thrust ≈ `armF: 82`,
  straight up ≈ `armF: 172`, straight down ≈ `armF: -8`, backward ≈ `armF: -98` (or 262). For the
  back arm: forward ≈ `armB: 98`, up ≈ `armB: -172`, backward ≈ `armB: -82`. A torso lean adds to
  every child, so subtract it if the arm must end up at an exact world angle.
- Hitboxes are **not** attached to bones. They live in fighter space (+x facing, +y down, feet at
  the origin), so an arm can be posed wrong without changing the game; the pose sheet is how you
  catch it.
- `?sheet=<fighter>&page=<n>` on the client renders every animation and every move at its first
  active frame with hitboxes drawn. `node scripts/posesheets.mjs` screenshots them all into
  `shots/sheets/`. Review the sheet before calling a fighter done.

## Client loop

`requestAnimationFrame` with a fixed 60 Hz accumulator; the renderer interpolates between the
previous and current sim states for smooth motion at any refresh rate. The sim clock is a
worker's 60 Hz timer, not rAF: paint rate and sim rate are separate, so a machine painting 10
frames a second still simulates 60 and keeps up with an online match, a hidden tab (no rAF,
throttled page timers) keeps ticking so nobody else stalls on it, and after a hitch the sim
catches up to a quarter second rather than dropping time. Draws are capped near 60 a second (a
144 Hz screen draws every other frame); a machine that keeps missing frames steps the canvas
down a resolution cap (2 → 1.5 → 1 → 0.75 pixels per CSS pixel) and back up after 16 s of
clean frames. Input is sampled at the
start of every sim frame from the latest device state; keyboard events are recorded as they
arrive so a press between frames is never lost. Gamepads are polled each frame. Each player
slot has a device (keyboard layout 1, keyboard layout 2, or a gamepad index) and a bindings map.

## Rendering

Per-frame cost on a weak machine is fill rate and stroke geometry, in that order: the paper is a
1:1 blit at the canvas's resolution, the parallax backdrop uses plain strokes (its wobble was
invisible at 12 % alpha) culled to what the camera can show, each player's HUD card is a bitmap
rebuilt when the name or stocks change, and sparks are plain polygons. `scripts/perfbench.mjs`
measures it.

Logical canvas 1920x1080 scaled to fit, devicePixelRatio aware. Camera solves a rectangle that
contains all live fighters plus padding, clamps to the stage's camera bounds, and eases toward
it (position lerp 0.12, zoom lerp 0.08). Layers: backdrop, far parallax, mid parallax, stage,
shadows, projectiles, fighters (drawn back-to-front by slot; a hitlag'd fighter jitters),
effects (additive), particles, hud. Effects and particles run in real time even in hitlag.

## Audio

Everything is synthesised in WebAudio (Kessler's approach): hits are noise bursts filtered by
damage, tippers ring a sine, KOs are a sub thump plus a rising sweep, footsteps and dashes are
short filtered noise, each fighter has a voice timbre for specials. Music is a generative
loop per stage with an intensity input tied to the highest percent on screen.

## Online

`client/src/net/rollback.ts` implements: a ring buffer of confirmed frames (state snapshots
every frame, up to 8 frames of rollback), local input delay (default 2), remote input
prediction (repeat last), rollback-and-resimulate on late inputs, and a state hash exchanged
every 30 frames for desync detection (a desync is fatal and loud: the match ends with a
message and both clients log the frame). `transport.ts` is a small interface (`send(frame,
inputs, ahead)`, `onInputs`, `ping`) with one implementation over the websocket relay; a WebRTC one
can be added later without touching the rollback code.

Time sync is GGPO's frame advantage. Every client measures how far ahead of each remote it
looks (its frame minus the remote's frame as of the remote's newest input, averaged over 12
ticks) and sends that with its inputs as `ahead`. Both measures include the one-way latency, so
half their difference is the real clock lead: equal clocks over any latency give zero, and only
a client that is genuinely ahead gives up ticks, in proportion (gain 1/12, dead zone 1.5 frames,
at most every other tick). The slower client never skips. A stall past the rollback window shows
WAITING with the name of who it is waiting on; the relay drops any mid-match player it has not
heard inputs from for 20 s, which the others see as a leave.

Server: `/ws` upgrade. Messages: `hello`, `queue` (quick match), `room create/join <code>`,
`start` (host sets rules; the server picks the seed and slot order), `inputs` (frame, bits),
`hash`, `leave`. The server never simulates; it relays and keeps the lobby. Rooms die when
empty. Quick match pairs the two oldest queued clients. The host's `end` (leaving the result
screen, or quitting) reopens the room and takes everyone back to it; a guest quitting mid-match
closes their connection, so the others see them leave rather than wait on them.

## Wide events

`shared/wide.ts` is the model: one record per unit of work with typed tiers (`client`: session,
build, bundle, viewport, player; `server`; `request`), a level that only escalates, issues (code +
message, repeats counted), an open `business` payload, and a headline (first error, else first
warning, else a business value with a `message`). No clock or randomness in it: both are passed in.

Client (`client/src/telemetry/`): `startTelemetry` in `mount` opens the session (device, view
history, screens visited, hidden time, matches) and catches uncaught errors, rejections,
`console.error` and canvas context loss onto every open event. `MatchTelemetry` opens when an
online `start` arrives (bundle load outcomes), attaches to the rollback session and renderer
(frames, confirmation, WAITING stalls, RTT, rollback counters, frame-time histogram, camera and
canvas-scale sanity every draw, sprite draws with no image, a readback of the world layer every
10 s that flags plain paper), and finishes with the exit. `DrawSession` keeps one for its room.
Open events are sent every 10 s while they change and by `sendBeacon` on `pagehide` or when the
tab hides; a bundle swap ends the session and the next bundle continues its trace.

Server: the relay opens a `room` event per room, a `connection` event per socket (under the page's
session trace from `?trace=`), and a `match` event per start with per-slot input/hash counts, input
gaps, leaves and a hash comparison of its own. Forge jobs get an event from queued to done.
API requests carry the caller's `x-trace-id`; writes and failures are kept, successful reads only
when slow. Open server events are rewritten every 30 s and closed with the process.

The store is JSONL rather than sqlite: production runs Node 20 (no `node:sqlite`) and there is no
sqlite dependency to lean on; `server/eventlog.ts` reads it back, newest snapshot per id.

## Tooling

- `npm run dev`: Vite on 5175 + server on 3008 with the /sketch-battle/api and /sketch-battle/ws proxies.
- `npm run build`, `npm start`: same as Kessler.
- `npm run ladder`: every fighter vs every fighter, CPU tier 5 (UNFAIR), N matches each, prints a
  win-rate matrix and average stock length; fails if any matchup is outside 40/60 (warn only
  until the roster settles).
- `npm run frames <fighter>`: prints the move table from data so it can be diffed against
  CHARACTERS.md.
- `node scripts/perfbench.mjs`: frame-time bench of a quick match in headless Chromium at a CPU
  throttle and pixel ratio (`--throttle 4 --dpr 1.25`); run before and after a renderer change.
- `npm run shots`: Playwright screenshots of a quick match into `shots/`. `scripts/menushots.mjs`
  walks the menu flow, `scripts/fightershots.mjs` takes action shots per fighter and stage,
  `scripts/posesheets.mjs` renders the pose contact sheets. This is how anyone (including agents)
  looks at the game.
- URL params for testing: `?quick=1&p2=cpu&cpu=9&f=brick,wick&stage=rooftops&seed=3&boxes=1`
  skips the menus; `&training=1` starts training mode; `?sheet=sable` opens the pose sheet.
- `npm run check`: typecheck + lint-determinism + vitest.
- `scripts/deploy.sh`: build, rsync to personal-server:~/sketch-battle, pm2 `sketch-battle` on 3008.

## Deploy

Apache on personal-server (bschoolland.dev vhost) gets, before the /kessler rule:

```
RedirectMatch 301 ^/sketch-battle$ /sketch-battle/
ProxyPass /sketch-battle/ws ws://localhost:3008/ws
ProxyPassReverse /sketch-battle/ws ws://localhost:3008/ws
ProxyPass /sketch-battle/ http://localhost:3008/
ProxyPassReverse /sketch-battle/ http://localhost:3008/
```

The server serves the client from `dist/client` at `/` and at `/sketch-battle/` so it works both
proxied and direct.
