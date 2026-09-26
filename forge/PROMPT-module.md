You are writing a fighter for SKETCH BATTLE, a deterministic 2D platform fighter with rollback
netcode, from a player's drawing. The design is done (below). The nine drawn cells exist (below).
Your job is the fighter module: stats, all moves with frame data and hitboxes, hooks for the
gimmick, and the pose tracks that make the drawn cells move.

Read every cell image with the Read tool before you write anything: {{CELLS_DIR}}/idle.png,
walk.png, jump.png, atk-fwd.png, atk-up.png, atk-down.png, hit.png, launched.png, block.png.
Hitboxes must sit on the drawn attacking part. The cells are 512x512 with the feet on row 448; in
fighter units (+x facing, +y DOWN, origin at the feet) a cell pixel (px, py) is
x = (px - 256) * U, y = (py - 448) * U with U = {{U}} (stats.height {{HEIGHT}} / heightPx {{HEIGHT_PX}}).
Content boxes of each cell, already in fighter units [x1, y1, x2, y2]:
{{BOXES}}

## The design (pass 1)
{{CONCEPT}}

## The exemplar: LAMPJACK, a complete drawn fighter
Match its structure exactly. It is the only example that exists; everything it uses is available.
```js
{{EXEMPLAR}}
```

## The api object
Your module is `export default function make(api) { ... return def }`, a plain ES module with NO
imports and nothing async. `api` has exactly: hb, cap, key, mv, throwMove, setAction, startMove,
releaseGrab, throwVictim, spawnProjectile, knockback, approach, clamp, lerp, sign, sinDeg, cosDeg,
atan2Deg, B (button bits: JUMP ATTACK SPECIAL SHIELD GRAB TAUNT SMASH PAUSE), STICK_DEAD,
STICK_RUN, STICK_WALK, C (engine constants), spriteAnims(), spriteLoops, SPRITE_CELLS.

Determinism is non-negotiable (every client re-runs your code and must get identical bits):
- No Math.sin/cos/atan2/pow/exp/log/random/hypot, no Date, no toFixed/parseFloat. Use api.sinDeg,
  api.cosDeg, api.atan2Deg, Math.sqrt/floor/abs/min/max and arithmetic.
- No fetch, timers, DOM, globals, imports, async. A source lint rejects them.
- `special()` must return an object whose EVERY key exists from the start, all numbers. Never add a
  key later. The state hash walks these keys.
- Hooks get `{ state, f, input, prev }`. `f` is the fighter (x, y, vx, vy, facing, moveFacing,
  frame, grounded, special, chargeMul, grabbing, …), `state.fighters` the others, `input.b` the
  button bits, `input.x/y` the stick in -100..100. Mutate `f` freely; that's the point.

## Required
- Every core move: jab1 ftilt utilt dtilt dashAttack fsmash usmash dsmash nair fair bair uair dair
  grab fthrow bthrow uthrow dthrow nspecial sspecial uspecial dspecial, plus pummel, dashGrab,
  ledgeAttack, getupAttack, taunt. Extra moves for hooks to chain into are welcome.
- Every move's `cell` is one of the nine (defaults: up-moves atk-up, down-moves atk-down, the rest
  atk-fwd; bair usually `cell: "atk-fwd", cellFlip: true`). Poses are squash/stretch/lean/offset
  keys on the whole cell: key(frame, { a: {}, sx, sy, rot, dx, dy }). Lean into every strike.
- uspecial must actually recover: it must gain height (set f.vy negative in a hook or use
  `motion`), and it must be `helpless: true, ledgeOk: true`. The check knocks the fighter out to
  about 200 units past the ledge at ledge height; uspecial (plus its jumps) must bring it back
  that far sideways, not just up, so let f.vx follow input.x strongly during the rise.
- Some move must be able to KO a weight-100 opponent from centre stage under 150%.
- Hitbox `angle`: 0 launches away from you, 90 up, 270 down (spike), 180 pulls toward you.
  `base` 20-70, `growth` 40-110 are the normal range; smashes and specials at the top.
- `stats.width` and `stats.height` are the hurtbox: a capsule that wide and that tall standing on
  the feet (lying flat when wider than tall). Size width from the idle box above.
- Respect the design's stats_note and archetype. A roller has no jumpSquat bounce; a floater
  has low gravity and 3+ jumps; a blob squashes more than it leans.

## Balance
The stock fighters average 8-14% per hit on tilts, 15-22% on smashes. The gimmick is allowed to
be absurd if it costs something (charge time, cooldown via `special`, self-damage, commitment).
A character that wins every neutral with a frame-3 disjointed 20% move is not funny after the
first game; a character that can nuke the stage once per stock, telegraphed for 60 frames, is.

## Output
Write ONE JSON file to {{OUT}} with the Write tool, nothing else:
{ "source": "<the whole module as a string>", "anims": { <optional state -> cell overrides, e.g. "crouch": "block"> }, "notes": "<two lines on the gimmick and what to watch in playtest>" }

{{FEEDBACK}}
