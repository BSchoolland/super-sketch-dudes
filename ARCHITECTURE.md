# RINGOUT — Architecture

TypeScript, Vite, Canvas 2D on the client; Express + `ws` on the server; a shared deterministic
sim used by both. Same shape as Kessler so it deploys the same way (pm2 process behind Apache
at bschoolland.dev/ringout).

```
ringout/
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
    stages/          one file per stage: geometry (platforms, ledges, blast zones), decor spec
    cpu.ts           bot controller: reads state, returns an input record
    rules.ts         stocks, time, KO, sudden death
  client/
    index.html, vite.config.ts (base "/ringout/")
    src/main.ts      boot, screen router
    src/render/      canvas renderer: camera, rigs, effects, particles, stages, hud
    src/input/       keyboard + gamepad -> input records per slot; device assignment
    src/screens/     title, character select, stage select, versus, online lobby, training, settings
    src/net/         rollback session (predict / snapshot / resimulate) + websocket transport
    src/audio/       procedural WebAudio sfx + music
    src/telemetry.ts errors and device info to /api/log
  server/index.ts    static files, /api/health, /api/log, lobby + input relay over /ws
  scripts/           headless: ladder (CPU vs CPU matchups), frames (dump move data),
                     shots (Playwright screenshots of every screen), smoke, deploy.sh
  test/              vitest: determinism (same inputs => same hash), rollback equivalence,
                     knockback formula, ledge grab, shield math, each fighter's moves have
                     hitboxes on their active frames
```

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
is a fighter-specific plain object, and `fighter.ts` hooks named in the fighter's `index.ts`
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
previous and current sim states for smooth motion at any refresh rate. Input is sampled at the
start of every sim frame from the latest device state; keyboard events are recorded as they
arrive so a press between frames is never lost. Gamepads are polled each frame. Each player
slot has a device (keyboard layout 1, keyboard layout 2, or a gamepad index) and a bindings map.

## Rendering

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
inputs)`, `onInputs`, `ping`) with one implementation over the websocket relay; a WebRTC one
can be added later without touching the rollback code.

Server: `/ws` upgrade. Messages: `hello`, `queue` (quick match), `room create/join <code>`,
`start` (host sets rules; the server picks the seed and slot order), `inputs` (frame, bits),
`hash`, `leave`. The server never simulates; it relays and keeps the lobby. Rooms die when
empty. Quick match pairs the two oldest queued clients.

## Tooling

- `npm run dev`: Vite on 5175 + server on 3008 with the /ringout/api and /ringout/ws proxies.
- `npm run build`, `npm start`: same as Kessler.
- `npm run ladder`: every fighter vs every fighter, CPU level 9, N matches each, prints a
  win-rate matrix and average stock length; fails if any matchup is outside 40/60 (warn only
  until the roster settles).
- `npm run frames <fighter>`: prints the move table from data so it can be diffed against
  CHARACTERS.md.
- `npm run shots`: Playwright screenshots of a quick match into `shots/`. `scripts/menushots.mjs`
  walks the menu flow, `scripts/fightershots.mjs` takes action shots per fighter and stage,
  `scripts/posesheets.mjs` renders the pose contact sheets. This is how anyone (including agents)
  looks at the game.
- URL params for testing: `?quick=1&p2=cpu&cpu=9&f=brick,wick&stage=rooftops&seed=3&boxes=1`
  skips the menus; `&training=1` starts training mode; `?sheet=sable` opens the pose sheet.
- `npm run check`: typecheck + lint-determinism + vitest.
- `scripts/deploy.sh`: build, rsync to personal-server:~/ringout, pm2 `ringout` on 3008.

## Deploy

Apache on personal-server (bschoolland.dev vhost) gets, before the /kessler rule:

```
RedirectMatch 301 ^/ringout$ /ringout/
ProxyPass /ringout/ws ws://localhost:3008/ws
ProxyPassReverse /ringout/ws ws://localhost:3008/ws
ProxyPass /ringout/ http://localhost:3008/
ProxyPassReverse /ringout/ http://localhost:3008/
```

The server serves the client from `dist/client` at `/` and at `/ringout/` so it works both
proxied and direct.
