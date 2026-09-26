# lib-engine: every fighter is a forged drawing

Branch `lib-engine`, from 3a38de6. Commits:

1. `298164e` The house roster replaces the stock four
2. `6985099` The bone rig renderer goes: every fighter is a sprite
3. `12e062e` The CPU plays any fighter: decisions come from stats and a probe of each special, never from ids
4. `43c4771` Local matches build the CPU profiles up front; the forge prompt names the KO check's dummy
5. (this report)

`npm run check` is green: typecheck, lint-determinism, 47/47 vitest.

## Deleted

- `shared/fighters/{sable,brick,wick,pilot}/`, `shared/fighters/humanoid.ts`, `STOCK_IDS`, and the
  "cannot remove stock fighter" guard in `unregisterFighter`. `roster` and `rosterList` start empty.
  `registerFighter`, `unregisterFighter` and `onRosterChange` are unchanged.
- `shared/fighters/helpers.ts` moved to `shared/gen/helpers.ts`, since only the generated-fighter API
  uses it now. `shared/fighters/` holds just `index.ts`, because the screens and server import that path.
- `test/fixtures/gearshift/`: its source, sprite metrics and cells matched the house bundle.
  `test/gearshift.test.ts` now loads the house GEARSHIFT.
- Bone rendering: `drawRig`'s implementation, the forward kinematics in `resolvePose`, `Seg`,
  `ResolvedPose`, the `Bone`/`BoneShape` types, `Rig.bones`, `Pose.a` (joint angles) and
  `Palette.accent`. `FighterDef.rig` is now `{ anims, loops }` (pose tracks for the sprite), and
  `FighterDef.sprite` is required.
- Stock-only looks in `client/src/render`: strike accent colours chosen by fighter id (now one
  colour, the cyan every generated fighter already got) and the `chunk`/`ember`/`shock` projectile
  kinds.
- Every fighter-id branch in `shared/cpu.ts`, including the mirror-match special case.
- The exemplar and `forge/PROMPT-module.md` no longer write `a: {}`, `bones: []` or `accent`. Bundles
  that already have them still load; the extra fields are simply ignored.

**Kept: `?sheet=`.** `SheetScreen` draws sprites, so the pose sheet works without bones. It only
shows fighters that are registered on the client. It also falls back to `roster.sable`, which is now
undefined (see leftovers).

**Behaviour fixes made along the way:**
- `poseAt` never eased `rot` between keys. Leans and spins only showed on key frames and snapped
  upright in between. It eases now, so walk leans, tumble spins and strike leans look different.
- `Renderer.drawFighter` used the base def instead of `defOf(f)`, so GEARSHIFT's car form drew mech
  cells. It follows the current form now. Sprite scale still comes from the base height, as before.

## The house roster in tests and tools

`test/house.ts` provides:
- `loadHouse(id)`: build the bundle from `client/public/house/<id>/bundle.json` and register it
- `loadAllHouse()`
- `houseBundle(id)`
- `houseId(arg)`, which validates script arguments

Everything uses it: the tests, `forge/checks.ts` and `scripts/*.ts` (ladder, botcheck, hitstats,
killpercents, trace, diag, diag2). Script defaults are now house ids: LAMPJACK as the dummy or victim,
TANK vs DIZZY for hitstats.

Tests adapted to the new roster:
- **sim / mechanics:** `two()` is LAMPJACK vs LAMPJACK.
  - The double-jump assertion reads `stats.jumps`.
  - The tech test launches at 20% so LAMPJACK (weight 78) lands on stage.
  - The ledge-trump test hangs without holding toward the stage.
  - The scripted recovery test (tuned to the stock rigs) became "the CPU recovers every house fighter
    from below the ledge" from the same start point.
- **roster:** one 4-player determinism match per stage, rotating so all eight house fighters play,
  with no hook errors allowed. Each house fighter must pass `validateGenerated` and have poses on
  every core move. This replaces the bones-parent-first check.
- **generated / gearshift / rollback / forge:** house opponents.

## Forge checks

- The balance ladder is `LADDER = [lampjack, tank, sirsticks, dizzy]` (exported), loaded from
  `client/public/house`. `test/forge.test.ts` expects those keys.
- The 4-player determinism match is the candidate plus the first three ladder fighters.
- LAMPJACK is the dummy for the move sweep, the recovery check and the KO check. The KO failure
  message now states the dummy's weight (78; SABLE was 100). The prompt says the same.
- **Recovery check:** the old bot drifted *away* from the stage during tumble, and the check
  depended on that to throw fighters out to about ±760. The new bot DIs toward the stage when its
  recovery is poor, so the deliberately broken fixture drifted home. The check now holds away from
  the stage (x ±85, up) until the launch's hitstun ends, then hands over to the CPU. The bar is where
  it was, and it measures the recovery rather than the DI.
- The candidate's id may not be a house id it is checked against. If it is, the check throws.
- Every house fighter, run through `runChecks` as a candidate, passes: recovery 10/10, no failures,
  17 to 21 moves used.

## How the CPU decides now

`shared/cpu-profile.ts` builds a `Profile` per `FighterDef`, cached in a WeakMap so each form def
gets its own. It is a pure function of the def, so every client derives the same profile. It holds:

- **`reach`:** hitbox extents, active frames and the strongest hit of every move. This was the old
  reach table, which was keyed by id and so ignored forms.
- **`specials`:** each of nspecial, sspecial, uspecial and dspecial, run in a private proving-ground
  match: grounded with special held, airborne with special held, and grounded tapped. The stick is
  held forward (and up for uspecial). A drift-only run is the airborne baseline. Recorded:
  - `groundDx`, and `airDx` net of free drift
  - `airRise` / `airDrop`
  - `shotRange`: how far ahead of the fighter any projectile it spawned got
  - `held`: holding special lengthens the move by more than 8 frames

  Forms reuse the base probes for specials they don't override. An overridden special gets no probe,
  because entering a form needs the fighter's own state. It costs about 12 ms per fighter, once.
  `LocalMatch` builds the profiles for its CPU slots when it is created.
- **Derived values:** `airJumpHeight = doubleJump² / 2·gravity`;
  `recoveryHeight = (jumps − 1)·airJumpHeight + uspecial airRise`;
  `cautious = weight ≥ 110 || recoveryHeight < 320 || airSpeed < 3`.

How the bot uses the profile:

| Situation | Was (by id) | Now (from stats and move data) |
|---|---|---|
| DI near the edge | BRICK and SABLE DI toward the stage | `cautious` fighters DI toward the stage |
| Chasing offstage | Everyone except BRICK | Everyone except `cautious` fighters |
| When to jump while recovering | BRICK jumps early | Jumps early when `airJumpHeight < 120` or `fallSpeed ≥ 8.5` |
| During an up special | PILOT holds special | Any `held` special that carries the fighter (uspecial, or `airDx > 0`) keeps special held until it is over the stage |
| Crossing a gap sideways | WICK and SABLE use sspecial | Uses the special with the largest `airDx > 120` that isn't helpless and loses at most half that distance in height. LIFTOFF's missile qualifies; SLUGBERT's surge doesn't, because it sinks |
| When to up special | Separate rules for BRICK and PILOT | One rule for everyone (the old default) |
| Charging a special | BRICK and SABLE charge nspecial | Any `held` special that doesn't travel charges while the target is far or in hitstun. It lets go at a random frame (about 4–6% a frame) or when the target gets close |
| A travelling `held` special | none | Keeps going while the target is still ahead |
| Neutral specials | A table per stock fighter | For nspecial, sspecial and dspecial: **counter** (`mv.counter`) when an attack is about to land; **hitbox specials** when they reach; **projectiles** between 140 and 0.9 × `shotRange` when roughly level and it has no projectile out; **dash specials** (`groundDx > 150` with hitboxes) inside their travel. Anything whose travel would leave the stage is skipped, so TANK's recoil shot never fires it off the edge. **Inert** specials (no hit, shot or movement, e.g. GEARSHIFT's transformation) now and then from more than 380 units away |
| Threatened while holding an armoured smash | BRICK uses fsmash | Any smash whose `armour` starts by frame 3 with threshold ≥ 8 |
| Aerial choice | BRICK prefers nair | One order for everyone |

**Checks on the new bot:**
- 56 house matches at level 9: no self-destructs, no timeouts, and every fighter uses all four
  specials.
- `scripts/botcheck.ts` passes:
  - recovery 10/10 for all eight
  - techs 12/12
  - 0 second-up-special violations
  - every fighter KOs an idle LAMPJACK, in 4.6 s (TANK) to 22.4 s (SIR STICKS)

## Ladder (house roster, CPU 9, Proving Ground)

`tsx scripts/ladder.ts 6`, 6 matches per pair, average match 132 s, 1 timeout:

```
           lampjack   gearshift  tank       woodstove  slugbert   liftoff    dizzy      sirsticks
lampjack   -          0-6        1-5        6-0        4-2        0-6        5-1        3-3          dealt/match 334%
gearshift  6-0        -          0-6        6-0        6-0        5-1        6-0        5-1          dealt/match 392%
tank       5-1        6-0        -          6-0        6-0        4-2        6-0        6-0          dealt/match 361%
woodstove  0-6        0-6        0-6        -          6-0        0-6        1-5        3-2          dealt/match 257%
slugbert   2-4        0-6        0-6        0-6        -          0-6        3-3        5-1          dealt/match 253%
liftoff    6-0        1-5        2-4        6-0        6-0        -          6-0        6-0          dealt/match 400%
dizzy      1-5        0-6        0-6        5-1        3-3        0-6        -          2-4          dealt/match 289%
sirsticks  3-3        1-5        0-6        2-3        1-5        0-6        4-2        -            dealt/match 377%
worst matchup skew: 100/0
```

The same ladder with the old bot, which already took its generic path for all of these (4 per
pair), averaged 118 s. LIFTOFF won almost everything and TANK lost almost everything. Damage dealt
per match was 190–345%; it is 250–400% now that specials get used. TANK goes from last to first
because it now fires its shells. The skew is in the fighters' tuning, not in the bot.

The forge ladder for each house fighter as a candidate (2 matches per opponent, W-L):

```
candidate  vs lampjack  tank  sirsticks  dizzy
lampjack      1-1       0-2     1-1       1-0
gearshift     2-0       1-1     2-0       2-0
tank          2-0       0-1     2-0       2-0
woodstove     0-2       0-2     0-1       0-2
slugbert      1-0       0-2     0-1       0-1
liftoff       2-0       2-0     2-0       2-0
dizzy         0-2       0-2     1-0       1-1
sirsticks     2-0       0-2     1-0       2-0
```

## Thin compatibility exports left for the screens

- `client/src/render/rig.ts`:
  - `resolvePose` returns the pose unchanged, because `portrait.ts` calls it on its live path.
  - `drawRig` and `tintColors` throw. They are only reached in the screens' `else` (no sprite)
    branches, which can't run now.
  - All three are marked `@deprecated`. Delete them once title, sheet and portrait stop importing them.
- `FighterDef.palette` stays as `{ colors, outline }`. Nothing in the engine or renderer reads it;
  only the screens' dead bone branches do. The validator still requires it and the exemplar still
  writes it. When the screens drop those branches, remove it from `types.ts`, the validator
  (`shared/gen/load.ts`) and the exemplar together.
- `shared/fighters/index.ts` keeps its path, because screens, `client/src/gen.ts` and `server/lobby.ts`
  import it.

## Stock ids left outside my files (for the merge)

- `server/lobby.ts:93`: a new client's default fighter is `"sable"`.
- `client/src/app.ts:93,105`: the `?quick=1` default and fallback is `sable,sable`.
- `client/src/screens/sheet.ts:27`: falls back to `roster.sable`, now undefined.
- `client/src/screens/title.ts`: the roster parade is empty until the client registers fighters.
- `scripts/*.mjs` use stock ids in URLs: `posesheets.mjs`, `fightershots.mjs`, `padcheck.mjs`,
  `trainshot.mjs`, `record-gearshift.mjs`.
- Docs I didn't touch: `ARCHITECTURE.md` (the fighters folder layout, humanoid rig conventions,
  `?sheet=sable`, `f=brick,wick`) and `CHARACTERS.md` (the stock four).

## Unfinished / caveats

- **Balance is lopsided** (worst skew 100/0). TANK, GEARSHIFT and LIFTOFF dominate; WOODSTOVE and
  SLUGBERT lose most matchups. That is fighter tuning; the bot plays all of them.
- **The bot can't see a fighter's resources.** SIR STICKS keeps pressing its sword throw after the
  sword is gone (the hook does nothing). TANK fires during cooldown (a small shove). It avoids
  stacking projectiles, but it doesn't read meters.
- **The probe runs a fighter's hooks in a private match.** That is safe only because hooks keep all
  state in `f.special`, which the forge's determinism check enforces. A hook with closure state would
  be touched by the probe.
- **Online rollback matches with CPU slots build profiles lazily**, on the first `cpuInput`. That is
  about 12 ms per fighter in the first frame. `client/src/net` isn't mine to warm.
- **`package.json` has `npm run frames`, but `scripts/frames.ts` doesn't exist.** That predates this
  branch.
