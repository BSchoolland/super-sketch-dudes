# SUPER SKETCH DUDES — Architecture

TypeScript, Vite, Canvas 2D on the client; Express + `ws` on the server; a shared deterministic
sim used by both. Same shape as Kessler so it deploys the same way (pm2 process behind Apache
at supersketchdudes.com).

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
    index.html, vite.config.ts (base "/")
    src/main.ts      boot, screen router
    src/render/      canvas renderer: camera, rigs, effects, particles, stages, hud
    src/input/       keyboard + gamepad -> input records per slot; device assignment
    src/screens/     title, character select, stage select, versus, online lobby, training, settings, maps + map editor
    src/net/         rollback session (predict / snapshot / resimulate), peer-to-peer links + the relay connection
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

## Guests and accounts

A browser with no session gets a guest (`server/guests.ts`): a real player, id `guest-…`, with a two-word name the
server picks, so the library, forge, lobbies and telemetry need nothing special. Signing in to Discord, Google or an
email account carries the guest's session; the server moves the guest's characters, saves, maps, open forge jobs and
reputation to the account (a save the account already has is kept once) and ends the guest. A guest's characters are
never listed (`isListed` in library.ts) until they belong to an account. Idle guests are swept every 6 hours: 7 days
after their last visit if they made or saved nothing, 60 if they did. Email signup asks a birth year first, in the
browser only (`client/src/age.ts`); an under-13 answer is remembered in localStorage and nothing reaches the server.
The Activity never makes guests: Discord signs everyone in. Inside CrazyGames the only account is a CrazyGames one
(`crazygames-…`, see CrazyGames). `<base>privacy` and `<base>terms` are static pages.

### Player names

A name a player types (SETTINGS > CHANGE NAME, or the NAME on an email signup) is a request: they keep the name they
have (made up, or approved earlier) until the auto moderator passes the new one (`server/name-requests.ts`). The
word filter (`server/name-filter.ts`: whole words and unambiguous stems, through leetspeak, spacing and stretching)
refuses obvious ones on the spot. The rest wait, one per player and five a day, for the forge worker to claim
(`GET /api/forge/names/next`, its own loop, never behind forge jobs and never counted against the forge budget) and
judge with both judges (`moderateName` in forge/moderate.ts). `POST /forge/names/:id/verdict` applies the drawings'
decision rule and reputation (moderation.ts, logged to moderation.jsonl with `name` instead of `fighterId`): passed,
`applyName` (auth.ts) puts it everywhere; blocked, the player is told why for a day. Judges that can't run release it
to wait; nothing is approved without them. `/forge/names/take-down {player}` gives a player a made-up name; `/forge/names/set {player, name}` gives them that one, unjudged. The relay
shows a room member by their session's name (`{ t: "name", session }`), never one the page claims.
`node scripts/namecheck.mjs` walks it in real pages against `scripts/fake-name-judge.mjs`.
## The front page

https://supersketchdudes.com/ is the game, and search engines and link previews read it too: `server/home.ts` renders
index.html with the title, description, canonical, sharing tags and JSON-LD in its head and the about sections after
the canvas, on each request, with a strip of COMMUNITY's BEST (one per creator, listed characters only, their idle
cells served at `fighters/<id>.png`). Every word of it is in `server/home-copy.ts`; Vite's dev server renders the same
page with no strip. Its pictures are `client/public/` (`screenshots/`, `clip.mp4`, `og.jpg`, icons, `robots.txt`,
`sitemap.xml`; `node scripts/homeshots.mjs` remakes them).

The sections are `display: none` and the page can't scroll (an iPhone's browser aside: "The browser's bars") until the title screen's tab (bottom edge) opens them
(`client/src/about.ts`): the page scrolls down to them and the game leaves the keys to the page. PLAY scrolls back up,
and the page closes them when it's back at the top; any screen but the title closes them at once. Nothing of them
loads before they open, so the game boots as it did without them. The Activity never shows the tab.
`node scripts/frontcheck.mjs` checks all of it on the built server.

## Character pages and sharing

Every shareable character has a page at `<base>c/<id>` (`server/share.ts`): ready, public, not held, not deleted (a
taken-down one isn't on file), a guest's included (`isShareable`, library.ts). It is the game's index.html with the
about sections, its head the character's: title "<NAME> · Super Sketch Dudes", its tagline as the description,
canonical, og/twitter tags and a CreativeWork JSON-LD. Its og:image is `<base>c/<id>/card.png?v=<version>`, a 1200x630
card (`server/share-card.ts`, sharp, Patrick Hand from the built client's fonts/) made once per version (name and
bundle) into `<data>/cards/`. Anything else is a plain 404 page with no card; both are decided on every request and
sent no-cache with no validators, so a hold or a take-down stops them at once. Every word is in `shared/share.ts`.

The game opens on the character a page is for (app.ts `home`, CommunityScreen with it open, through
`GET /api/characters/shared/:id`): FIGHT IT is VS BOTS against it at once (you play your newest own character, or a
random house fighter), SAVE only when COMMUNITY lists it, SHARE (client/src/share.ts) the device's share sheet or the
clipboard, with `?ref=share` (the website's address inside the Activity too; no SHARE in the CrazyGames build).
MY CHARACTERS has SHARE and, for an account's own, "OK to feature in our videos" (`feature` on the entry, PATCH
/library/:id). `GET /api/characters/videos` (forge token or a staff account) lists the opted-in shareable characters
for the video pipeline. A SHARE goes on the session's `shares`; `npm run funnel` counts shares and newcomers (a first
arrival through a share link) per character, and those arrivals are the funnel's `share` source.
`node scripts/sharecheck.mjs` walks it in real pages.

## Community characters

A player file (`server/library.ts`) holds the player's own characters and `saved`: ids of other
players' characters, references like the starters, never copies. GET /api/library is own + saved
(flagged `saved`) + starters, so a saved character is a battle choice like any other. COMMUNITY
(/api/characters/community) lists ready characters that are `public` (missing means public), not
starters and not deleted. BEST leads with the ids in best.json (an admin's PUT IN BEST on a character,
newest pick first), then orders the rest by `bestScore` (shared/account.ts): how many player files save it,
counted when the files are scanned and kept current on save and unsave, moved by its looks grade in
looks.json (1 to 10, set with the forge token through POST /api/looks); NEWEST is by creation time. A creator deleting a character somebody saved only
marks it `deleted`: it leaves their library and COMMUNITY, its bundle stays, and the entry is
removed for real when the last saver unsaves it.

## The forge budget

Every forge is an Opus agent session paid out of a weekly subscription limit, so `server/budget.ts` holds the
forge to a budget from `<data>/forge-budget.json` (its shape and default are documented there; a malformed file
stops the server; a change takes a restart, which hands off like a deploy):

```json
{ "perWeek": 100, "weekStartsAt": "2026-11-06T19:00:00Z", "paused": null,
  "perPlayerPerDay": 3, "waitingPerPlayer": 1, "guest": { "lifetime": 1, "perIpPerDay": 3 } }
```

- A forge counts against the week when the worker claims it (`claims` on the job in forge-jobs.json: the count
  is derived from the jobs, so it survives restarts and handoffs). Failed, moderator-blocked and retried forges
  count. Weeks are 7-day windows from `weekStartsAt`, in both directions, so moving the anchor moves every window.
- A player's allowance is charged when they send a drawing: `perPlayerPerDay` in any 24 hours for a signed-in
  player; a guest (`guest-…` id) gets `lifetime` ever, and guests from one address (`clientIp`, kept only as a
  hash, `ipKey`) get `perIpPerDay` between them. Staff (`<data>/staff.json`) have no per-player limit.
- Resting: `paused` (the kill switch, with the reason players read) or the week spent. Nothing is claimed; drawings
  are still taken, `waitingPerPlayer` each, and forged when it reopens. `nextFairJob` puts players with nothing
  forging first, then whoever has had fewer forges this week, then the queue order, so a backlog is taken a
  player at a time.
- TRY AGAIN on a failed forge (`retryable`, not one the moderator blocked) requeues the same job once without
  charging the player; its claim still counts toward the week.
- GET /library carries the player's `ForgeStanding` (shared/account.ts): left, the wall and when it lifts,
  resting. The title, the creator, the describe page, MY CHARACTERS and the forging screen word it
  (`forgeWords` in client/src/screens/character.ts). `npm run forge-budget` prints the week from the live data;
  `node scripts/budgetcheck.mjs` walks every state in a browser.

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
   A stage's `gravity` (the Moon's 0.7) scales every fighter's gravity, and its fall caps by the square root.
   A platform's `grip` (Snow Day's pond, 0.25) scales the traction of whoever stands on it; a `bounce` platform
   (Gym Class's trampoline) springs a fighter falling onto it back up that high.
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
(`onFrame`, `onHit`, `onHurt`, `onLand`) implement the mechanic. `onProjectileEnd(ctx, p, why)` is called once when one of
the fighter's projectiles ends (`why`: hit, landed, wall, expired, offstage, or removed by the fighter's own code); explosions and
splashes belong there, so they also happen on a direct hit (the engine takes a projectile out the frame it hits someone).

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

### Touch

`input/touchpad.ts` is the on-screen controls as a device, DOM-free and unit-tested against the sim
(`test/touch.test.ts`); `input/touch.ts` feeds it pointer events and decides when it is keyboard 1: while the last
thing pressed was the screen (a key, mouse button or gamepad hands keyboard 1 back). Its frames carry `B.DIGITAL`, so
the sim plays them by the keyboard's rules (tap ATTACK: tilt, hold: smash), with an analog stick. A thumb crosses the
middle of a stick over several frames, so a fast push is sent as one frame at rest then the push, which the sim reads
as a flick (dash from a walk, roll, spot dodge, platform drop); ATTACK within 8 frames of a flick adds a 2-frame
right-stick pulse, the keyboard SMASH key's, for the smash. JUMP with ATTACK within 3 frames drops JUMP before the jump
squat ends: a short hop. A match screen arms the controls every tick (`VersusScreen.armControls`, from app.ts) and
they are live only while it runs; the HUD keeps to the space between them (`Renderer.hudBand`), drawn up to a
readable size on a small screen (`Renderer.hudScale`). A match played on them counts on the session's
`touch.matches`, which the funnel's "on touch" column reads.

A match that shows the controls draws to the screen's edges, not just the 16:9 view: `Camera.bleed` is the letterbox a
wider (or taller) screen leaves (`viewBleed`, input/pointer.ts), app.ts clips to it, and the backdrop, stage art and
flashes fill it; the camera still frames the fight for the view, so a wider phone just sees more stage around it. The
controls sit at the screen's real edges (`touchLayout`'s `edges`), inside the safe-area insets (`stageInsets`, turn.ts,
turned with the stage), so the thumbs rest where they naturally do and the right thumb's buttons cover less of the
fight. On touch the pause menu and the result screen are finger-sized with no keys written on them; REMATCH and MENU
sit under ATTACK and the stick and take a tap only 2 s after the result is up, so a thumb still mashing ATTACK as the
last stock goes doesn't rematch. Practice has no practice key on touch: its reset and dummy toggle are in the pause
menu.

### Held upright

The game is always landscape. On the website's own page on a phone or tablet (the gate bars.ts uses below), a
viewport taller than wide turns the stage (`#stage` in index.html: the canvas and `#overlay`, where the text fields
are) a quarter clockwise at the screen's full size (`client/src/turn.ts`, `html.turned`), so the player just turns the
phone; with the phone's rotation lock on, the game reads right held sideways. Menus and matches alike, mid-match too:
a turn is a resize. Pointer events arrive in screen coordinates and `toView` (input/pointer.ts) turns them back, so
taps, the controls, the draw pad and the text fields need nothing of their own. While the about sections are open
nothing is turned: they are a web page, read upright, and PLAY brings the turned game back.
`node scripts/turncheck.mjs` checks it in emulation.

### The browser's bars

`client/src/bars.ts` keeps a phone's browser bars out of the game, on the website's own page only (not the Activity,
not the shell, not inside any iframe) and only where the primary pointer is coarse; a desktop gets none of it, not
even the manifest link. Opened from the home screen (`manifest.webmanifest`, display fullscreen, added at run time;
`apple-mobile-web-app-capable` in index.html) there are no bars. Otherwise:

- Android and iPads: a touch on the canvas goes fullscreen and locks landscape, except while a match screen is up or
  the about sections are open. Opening the sections leaves fullscreen: in it, Chrome won't let a reader zoom them.
- iPhones (every iPhone browser is WebKit, with no Fullscreen API; the bars collapse only when a finger scrolls the
  page): `html.swipe` makes the page scrollable and 300vh tall, and a "SWIPE UP TO PLAY" card covers the game until
  the viewport has grown to the screen's height (upright, to within 110px of it, the status bar staying) or by 40px,
  for a browser whose bars tuck to a strip. Turned, the card's box stays upright, so its swipe scrolls the page, and
  its words turn with the game: "SWIPE LEFT", the arrow pointing up the screen.
  After 6 s it offers "tap to play anyway", for the rest of the page's life. Once the bars are tucked nothing may
  scroll the page or they come back: the canvas is `touch-action: none`, and a document listener cancels every
  touchmove and pinch except on the card, in the open about sections, or in a text box with more to show. The card
  stays down while the sections are open or a text field has the keyboard, and never comes up over a match: bars that
  came back mid-match (a turn of the phone) get the card once the match screen is gone.

What happened is on the session's `bars` list (mode, the card shown and why it went, with the viewport and screen).
`node scripts/barscheck.mjs` checks it in emulation (WebKit iPhone, Chromium Android, a desktop, an iframe): the bars
are a viewport shorter than the screen there, so a real phone is still the only test of the swipe itself.

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

Pencil stages draw their platforms as boxes plus scenery (`render/stagedecor.ts`, plain strokes). The art stages
(`render/stageart.ts`, `ART_THEMES`; Settings > EXTRA STAGES) draw WebP layers from `public/stages/<theme>/`, with
one stage's full art in memory at a time, and stand each fighter on a paper cut-out of its drawing.

## Audio

Everything is synthesised in WebAudio (Kessler's approach): hits are noise bursts filtered by
damage, tippers ring a sine, KOs are a sub thump plus a rising sweep, footsteps and dashes are
short filtered noise, each fighter has a voice timbre for specials. Music is a generative
loop per stage with an intensity input tied to the highest percent on screen.

## Online

Every input travels two ways at once. Each pair of players in a room has a WebRTC data channel
(`client/src/net/mesh.ts`: one RTCPeerConnection per pair, unordered with no retransmits, signaled over the relay
WebSocket; ICE tries a direct route through STUN first and the TURN server second). Each tick the client sends every
linked player the run of its inputs that player hasn't acknowledged, run-length encoded (`net/wire.ts`), so a lost
packet is covered by the next one. Every input also goes to the relay once, in order (`net/link.ts`), and the relay
forwards it to everyone. That copy is reliable, so a pair without a link (blocked UDP, ICE failure, a dead link, an
older bundle) still plays, and a mixed room needs nothing special. Whichever copy arrives first counts.
docs/webrtc-deploy.md has the coturn setup.

`client/src/net/rollback.ts`: the match clock ticks with real time, and every tick it takes the local input for
clock + input delay (default 2) and sends it, whatever the sim is doing, so a client frozen on one player keeps
feeding the others. The sim follows the clock, predicting missing remote inputs (repeat last), and rolls back and
re-simulates when real ones arrive. It runs at most a prediction window past the newest frame it has every input
for: 30 frames, less on a machine where re-simulating that many would cost more than 10 ms (step cost is measured).
Past the window it freezes (WAITING, with the name of who it waits on). It catches up to the clock afterwards at up
to 8 frames a tick, and the clock runs at most a second ahead of a frozen sim. A state hash goes out every 30
frames for desync detection (a desync is fatal and loud).

The relay decides one thing: a player whose inputs stop reaching it (a dead uplink) is played away once they are 18
frames behind the second most advanced other player. It sends `fill` to everyone, and those frames play as
`B.AWAY`: no input, can't be hit, drawn faded with RECONNECTING. The others play on, and the late inputs are
dropped. Inputs that came over a link are provisional until the relay's copy or its fill confirms them, so every
client plays the same frames. Hashes, bundle handoffs and snapshot pruning stand on final frames, and a fill rolls
back as far as it must. Fills need every member to say it understands them (`loaded` with `fills`), and stop once
a bundle swap is scheduled.

Time sync is GGPO's frame advantage, on the clocks. Every client measures how far ahead of each remote it looks
(its clock minus the remote's clock as of the remote's newest input, averaged over 12 ticks) and sends that with
its inputs as `ahead`. A remote not heard from for 20 ticks drops out of it. Both measures include the one-way
latency, so half their difference is the real clock lead: equal clocks over any latency give zero, and only a client
that is genuinely ahead gives up ticks, in proportion (gain 1/12, dead zone 1.5 frames, at most every other tick).
The slower client never skips.

Server: `/ws` upgrade. Messages: `hello`, `queue` (quick match), `room create/join <code>`, `pick` (a member's
token onto a fighter, or `fighter: ""` back in hand: having a fighter is being ready; the host's `bots` carry the
bots' picks the same way), `fight` (anyone's FIGHT!: once every slot, bots included, has a fighter and nobody is on the
stage screen yet, the relay asks the host, who answers with `picking`; anything else is dropped, so two presses at
once or a token lifted on the way do nothing; the rule is `shared/lobby.ts`), `picking` (the host on the stage
screen), `start` (host sets rules; the server picks the seed and slot order), `loaded` (a client's match screen is up) and `go` (everyone's is:
the countdowns start together), `inputs` (frame, run of inputs, `ahead`, `acks`), `fill` and `final` (the relay's
decisions, and how far it has each player's own inputs), `hash`, `rtc` (signaling, between members of one room),
`ice` (STUN/TURN servers, with TURN credentials minted per connection: server/ice.ts), `peers` (each client's link
round trips, which auto input delay uses for linked pairs), `leave`. The server never simulates; it relays, keeps
the lobby and makes the away call. A mid-match leave carries the relay's last frame for the leaver; a leaver is out
of stocks (the sim ignores an eliminated fighter's input) or the match is over (hashes stop at the end), so clients
needn't agree on it exactly. Rooms die when empty. Quick match pairs the two oldest queued clients. The host's `end`
reopens the room and takes everyone back to it; a guest quitting mid-match closes their connection, so the others
see them leave rather than wait on them. The relay drops a player it has not heard inputs from for 20 s after the
go, or who hasn't loaded 20 s after the start.

Deploys don't end anything (`server/handoff.ts`). On SIGINT/SIGTERM the relay writes every client, room and running
match (with the inputs it forwarded) to `server-data/handoff.json`; the next process loads it and treats every
socket as just broken, so clients resume the way they do after a wifi dropout, in a match or out of one (a lobby, a
VS BOTS game). Their wide events carry on under the same ids. Until every player of a handed-over match has sent
inputs again (3 s at most) nobody is played away. `HANDOFF_VERSION` goes up when the saved shape or the relay
protocol changes in a way the next process can't take; a file from another version is dropped. Checks:
`test/handoff.test.ts`, `scripts/handoffcheck.mjs` (VS BOTS and a lobby in real pages), `netlab/run.mjs --at
"40:restart"`.

## Discord Activity

The same page runs inside Discord as an Activity (`client/src/activity.ts`), in Discord's iframe on
`<app id>.discordsays.com`, where every request goes through Discord's proxy. It switches on only when the page has
Discord's launch parameters (`frame_id`, `instance_id`, `platform`) on that domain; the Embedded App SDK is loaded
then and never on the website. Sign-in has no screen: on every launch the SDK's `authorize` (scope `identify`) gives a
one-time code and `POST /api/auth/discord/activity` trades it with the app's client secret (`DISCORD_CLIENT_SECRET`;
no `redirect_uri`, as the authorize had none) for the same Discord player the website's sign-in makes. Everyone who
opens the game in one launch lands in its room ("call" in lobby.ts), keyed by a digest of the SDK's `instanceId`
(the id itself names the server and channel, so it never leaves the page): the first one hosts, a mid-match arrival
waits and joins when the room reopens, past six people (waiting counts) the rest get VS BOTS of their own. The rest
of the game is reached through MENU. Discord's proxy carries no WebRTC, so no peer link is tried: every input goes
by the relay. The session's `source` ref is `discord-activity`, and `activity` holds the launch digest and platform.

URL mapping (Developer Portal, Activities > URL Mappings):

```
/               ->  supersketchdudes.com                   the page Discord loads, the API, the relay, fighters, assets
```

`node scripts/activitycheck.mjs` plays it end to end with Discord stubbed: `?activity=stub&instance=<launch>&as=<name>`
on a dev build, against a DEV_LOGIN server whose `DISCORD_API` is `scripts/fake-discord.mjs`.

## CrazyGames

The same page runs inside CrazyGames (`client/src/crazygames.ts`), framed from our own URL,
`https://supersketchdudes.com/crazygames` (the server sends index.html for `/crazygames`). It is not uploaded
as a zip: a copy on CrazyGames' CDN would lag every push to master, and a stale sim in a room with the website's is a
desync; framed, it is always the build the website runs, with the API and relay on its own origin (no CORS, no
WebSocket origin rules). Only that path loads CrazyGames' HTML5 SDK v3; after `init` the SDK says where it is:
`crazygames`, `local` (its own mode on localhost or with `?useLocalSdk=true`) or `disabled` (the URL opened anywhere
else, which plays the website with a warning on the session event).

- Players: guests as on the website, or a CrazyGames user. On every launch the SDK's user token
  (`getUserToken({ signingKeyType: "IN_GAME_AUTH" })`, an RS256 JWT) goes to `POST /api/auth/crazygames`, which checks it
  against CrazyGames' published keys (`server/crazygames.ts`, `https://userportal.crazygames.com/.well-known/jwks.json`)
  and our game id (`CRAZYGAMES_GAME_ID`, from their Developer Portal; unset, that sign-in is a loud 500), and signs in
  `crazygames-<user id>`, named by their CrazyGames username (a changed username renames them). A guest who logs in
  to CrazyGames (their SIGN IN, which opens CrazyGames' login prompt, or CrazyGames' own login) moves to that player
  like any guest signing in. The session is kept under its own localStorage key, so the page never carries a
  website account; no Discord, Google or email, no CHANGE NAME, no SIGN OUT (CrazyGames reloads the page on logout).
- Events: `loadingStart` at init and `loadingStop` with the first screen; `gameplayStart`/`Stop` around a match that
  is running (not paused, not over) and the drawing pad; `happytime` when someone on this computer wins, and when a
  character is done on the forging screen. CrazyGames' `muteAudio` mutes over the player's volumes.
- Rooms: the room a player is in (one that shows its code) goes to CrazyGames with `updateRoom` (their invite UI uses
  it); INVITE in the lobby copies `inviteLink({ room })`. A page opened from an invite lands in that room, instant
  multiplayer opens a new private room, and an invite accepted while playing opens once no match is on.
- Privacy and terms open in a new tab with `?from=crazygames`, which hides their link to the website's game. The
  title has no about tab: the about sections are the website's landing page.
- None of the phone handling (`bars.ts`: the swipe card, fullscreen, the turned stage, the mobile note): CrazyGames'
  page owns the screen. Touch controls still work. It is submitted as desktop-only.
- No ads: Basic Launch has them off.
- The session's `source` ref is `crazygames`, and `crazygames` holds the SDK's environment and how the player arrived.

`node scripts/crazygamescheck.mjs` plays it end to end with CrazyGames stubbed: `?crazygames=stub&cgapi=<fake>` on a
dev build (`&user=`, `&login=`, `&instantJoin=true`, an invite's `&czy_invite=true&czy_invite_params=room%3D<code>`),
against a DEV_LOGIN server whose `CRAZYGAMES_JWKS` is `scripts/fake-crazygames.mjs`. The real SDK's local mode works
too: a dev server with `CRAZYGAMES_GAME_ID=yourGameId` (its demo tokens are signed with CrazyGames' real key for that
id) and `http://localhost:5175/crazygames` signs in as its User1 (`?token_response=user2|logged_out`).
`node scripts/crazygames-preflight.mjs` checks the live URL before submitting it.

## Wide events

`shared/wide.ts` is the model: one record per unit of work with typed tiers (`client`: session,
build, bundle, viewport, player; `server`; `request`), a level that only escalates, issues (code +
message, repeats counted), an open `business` payload, and a headline (first error, else first
warning, else a business value with a `message`). No clock or randomness in it: both are passed in.

Client (`client/src/telemetry/`): `startTelemetry` in `mount` opens the session (device, source, view
history, screens visited, hidden time, matches) and catches uncaught errors, rejections,
`console.error` and canvas context loss onto every open event. `MatchTelemetry` opens when an
online `start` arrives (bundle load outcomes), attaches to the rollback session and renderer
(frames, confirmation, WAITING stalls, RTT, rollback counters, frame-time histogram, camera and
canvas-scale sanity every draw, sprite draws with no image, a readback of the world layer every
10 s that flags plain paper), and finishes with the exit. `DrawSession` keeps one for its room.
The source (`shared/source.ts`) is this tab's arrival, kept in sessionStorage so a page back
from Discord or Google keeps it, and the browser's first-ever arrival from localStorage. Open
events are sent every 10 s while they change and by `sendBeacon` on `pagehide` or when the tab hides; a bundle swap ends the session and the next bundle continues its trace.

Server: the relay opens a `room` event per room, a `connection` event per socket (under the page's
session trace from `?trace=`), and a `match` event per start with per-slot input/hash counts, input
gaps, leaves and a hash comparison of its own. Forge jobs get an event from queued to done.
API requests carry the caller's `x-trace-id`; writes and failures are kept, successful reads only
when slow. Open server events are rewritten every 30 s and closed with the process.

The store is JSONL rather than sqlite: production runs Node 20 (no `node:sqlite`) and there is no
sqlite dependency to lean on; `server/eventlog.ts` reads it back, newest snapshot per id.

## Tooling

- `npm run dev`: Vite on 5175 + server on 3008 with the /api, /gen, /games and /ws proxies.
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
- `scripts/stagecheck.ts`: CPU matches per stage, with the share of KOs that were self-destructs.
- `scripts/deploy.sh`: build, rsync to personal-server as user `ssd` (`ssd-server` in ~/.ssh/config: /home/ssd/sketch-battle), its own pm2 `sketch-battle` on 3008.
  `.github/workflows/deploy.yml` runs it on every push to master, over SSH with the `DEPLOY_SSH_KEY` secret.

## Deploy

Apache on personal-server, supersketchdudes.com vhost (`/etc/httpd/conf.d/supersketchdudes-le-ssl.conf`):

```
ProxyPass /ws ws://localhost:3008/ws
ProxyPassReverse /ws ws://localhost:3008/ws
ProxyPass / http://localhost:3008/
ProxyPassReverse / http://localhost:3008/
```

The server serves the client at `/` and, if `SKETCHBATTLE_BASE` is set, under it too, so it works proxied with or
without the base. The game was at /play/ for an afternoon: a page there gets a 301 to the same path without /play,
and the API, the relay, /play/gen and /play/games still answer there for tabs opened then.

The game used to live at bschoolland.dev/sketch-battle/. That vhost still proxies `/sketch-battle/` here, and a
page asked for with `X-Forwarded-Host: bschoolland.dev` is server/oldhost.ts's: it sends the browser to
https://supersketchdudes.com/ with its game storage carried in the URL fragment (client/src/move.ts takes it in).
Fighter URLs in the data carry the build base (`/gen/…`); `scripts/migrate-base.mjs` rewrote `/play/gen/` and
`/sketch-battle/gen/` when the base moved.
