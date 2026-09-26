# Sketched fighters: the idea and what we know (as of Sep 25, 2026)

Ben's years-old idea, said out loud to Ducktape in a voice thread on Sep 22, 2026 (evergreen server,
thread 1552104146084044892): players draw their own character, AI turns the drawing into a fighter
(look, animation and moveset), and they fight each other with it. Sketch Battle exists to find out
whether AI can build the platform-fighter half; the sketch art direction is what makes the
player-drawn half plausible, because crude paper-cutout motion is a legitimate look on paper.

## Ben's constraints, in his words

- The drawing does not have to be humanoid. "Someone could draw a tank. They could just do that, and
  that's the point of the game." How do you animate the Death Star?
- Balance is a soft goal: a CPU bot for automated balance testing so nothing is completely broken, but
  "what the hell did you just draw, why am I getting one-shot by the Death Star" is part of the fun.
- The hard part is visual: the character has to make sense on screen with attack looks in every
  direction. Cost is acceptable (a character taking three or four minutes to create is fine, even live).
- Prior art he has lived through: the Digital NEST museum project on Meta's Animated Drawings (kids'
  scanned drawings walking and dancing). It worked for humanoid drawings and was "a little cursed".
  And his own paper-game: AI-generated stop-motion sheets, one image call per 4x4 grid of characters
  and states, sliced by script, tuned for cost.

## What Ducktape found (Sep 22, thread above; artifacts in research/fightsheet/)

1. **Meta Animated Drawings is the dead end for this.** Detector + pose estimator (OpenMMLab, fine-tuned
   on 178k amateur drawings) predicts a mask and humanoid joints, retargets human mocap, ARAP-warps the
   drawing. Its README says the pose model assumes a human-like skeleton; non-humanoids are a manual
   config path. The tank problem is one they declined to solve.
2. **Paper-game's trick is the answer to consistency.** Ask for one image containing every pose, not
   separate frames, so the model can't drift between them; pass a reference image through `images.edit`
   for style. For Sketch Battle the reference is the player's drawing.
3. **It works.** A 3x3 sheet (idle, walk, jump, attack forward/up/down, block, hit, launched) from one
   `images.edit` call kept the character across all nine cells for a stick knight and, the hard case,
   a tank: it invented tank-appropriate poses on its own (tilts to jump, raises the barrel to attack up,
   turret knocked crooked when hit). Ducktape sliced the sheets, knocked out the paper, and posted a
   real exchange as a video (`fight.mp4`, `fight-ng.mp4`).
4. **Failure mode: the model regresses to priors on anything you can count.** On deliberately weird
   code-drawn characters (a 3-legged grub, a lamp with unequal props, a square-headed thing with
   mismatched arms), gpt-image-2 kept identity and colour accents but gave the grub 2 legs in all nine
   cells, evened out the mismatched arms, and drifted dot/stripe counts. The one with nothing
   "almost human" (the lamp) did best.
5. **gpt-image-2.5 fixes it, and is cheaper.** `gpt-image-2.5-sunburst` (editing precision) and
   `-flare` (fast) both draw the grub's three legs and keep the mismatched arms, with no prompt change.
   Same price as gpt-image-2 ($8/M image in, $30/M image out) but about 4x fewer output tokens per
   sheet: roughly 1.3 cents per character sheet at `quality: high`, about a minute. Extra quality tiers
   `xhigh` and `max` exist; no Batch API on 2.5. Sunburst is the pick (reference-image editing task).
   Benchmarks (Sep 21, 2026): 2.5-sunburst tops LMArena/Artificial Analysis; GEditBench v2 puts Nano
   Banana Pro (Gemini 3 Pro Image) far ahead on subject consistency specifically, untested by us.
6. **Trade-off: 2.5 is anchored harder on the reference,** so poses came out timid. A "dynamism" clause
   (squash and stretch, lean, follow-through on dangling parts) plus an explicit ban on speed lines and
   impact stars fixed it: the lamp's cord became a physical object, the grub squashed and stretched.
   A count clause ("3 legs, 5 dots") composes with it for the exact-count drift.
7. **Effects are code, the sprite is the character.** Impact FX baked into sprites can't respond to
   game state, can't be frame-timed, wreck the bounding box, can't be tuned, and aren't a pure function
   of state under rollback. What the model should emit is an effect descriptor per move (shape, colour,
   weight, scale) that Sketch Battle's existing strike renderer draws. Exception: anything attached to
   the body (barrel recoil, cape, cord) is pose and belongs in the sprite.
8. **Multiple reference images work:** `images.edit` takes a list. The higher-value second reference is
   probably an existing Sketch Battle fighter's sheet as a pose/style exemplar, not a second view.

## Open questions

- Nano Banana Pro bake-off on the same weird inputs (consistency benchmark leader; untested).
- Normalisation pass: the model picks its own scale and baseline, so sheets need auto-anchoring before
  they go in the game (Ducktape tried dropping the per-cell ground line to help).
- Nine stop-motion poses look choppy without in-betweens: tweening, or a few more cells.
- Moveset generation: a text model writing hitboxes, frame data and effect descriptors into the fighter
  format, judged by `scripts/killpercents.ts` and the CPU ladder.
- How a sprite-sheet fighter plugs into the rig-based renderer (a `sprite` fighter kind alongside the
  bone rigs; hitboxes stay hand-authored data, so the sim is untouched).
