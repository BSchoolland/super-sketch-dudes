# SKETCH BATTLE — Fighters

Every fighter is a folder in `shared/fighters/<id>/` (stats, moves, rig, palette) and nothing
else has to know it exists: the roster is the list in `shared/fighters/index.ts`. Adding a fighter
means adding a folder and a line. See ARCHITECTURE.md for the file shape and the tuning tools.

Frame data below is the opening bid; the fighter data files are the truth once tuning starts, and
`npx tsx scripts/killpercents.ts` (kill percent per move from centre and ledge, no DI) plus
`npm run ladder` are the reference readouts. Calibration target: a tipper/strong smash kills a
mid-weight from centre stage around 55-70%, from the ledge around 35-45%; tilts around 120-150%;
kill throws around 160-190%. The rule for tuning: every fighter must be able to win a
best-of-five against every other fighter at CPU tier 5 (UNFAIR), and no matchup may fall outside 40/60 in
the automated ladder (`npm run ladder`). Numbers are frames unless stated. Angles are degrees
from the victim's facing (0 = straight away from the attacker, 90 = straight up). Knockback is
`base / growth`. Damage is percent.

Shared stat vocabulary (units per frame, 60 fps, 1 unit = 1 world pixel at zoom 1; fighters are
~120 tall):

| stat | meaning |
|---|---|
| weight | knockback resistance (100 = middle) |
| walk / run / dashInit | top speeds |
| airSpeed / airAccel | horizontal control in the air |
| fallSpeed / fastFall | terminal speeds |
| gravity | per frame |
| shortHop / fullHop / doubleJump | initial vertical speeds |
| jumps | 2 for everyone at launch |
| wallJump | boolean |
| traction | ground friction |
| height / width | hurtbox capsule |

---

## BRICK — the wall

**Fantasy:** a construction golem made of stacked slabs that decided to keep building. Slow,
enormous, hits like a falling building, and armours through your pokes if you get greedy.
Wins by making you commit, then punishing once. Terrifying at the ledge, helpless if you get
under it.

**Silhouette:** wide and squat. Torso is three stacked slabs that shift when it moves; tiny
head slab on top; arms are two thick pistons with square fists; legs are short and blocky.
Weapon bone: none (fists). Rebar sticks out of a shoulder.

**Palette:** brick orange `#e8642c`, tar black `#1a1412`, mortar cream accent.

**Stats:** weight 125, walk 3.2, run 6.0, dashInit 6.8, airSpeed 3.4, airAccel 0.14, fallSpeed
9.5, fastFall 14, gravity 0.58, shortHop 9, fullHop 15, doubleJump 14, wallJump no, height 130,
width 78.

**Mechanic: Slab armour.** Every smash attack has super armour (no flinch below 12 damage)
from the first charge frame through the last active frame. Forward tilt and dash attack have
light armour (below 6). Grabs and throws ignore armour entirely.

| Move | Startup / Active / Total | Damage | Angle | KB | Notes |
|---|---|---|---|---|---|
| Jab | 7 / 3 / 26 then 8 / 3 / 30 | 5, 8 | 60, 45 | 30/60, 40/90 | Two hits, no rapid jab. Second hit launches |
| F-tilt | 12 / 4 / 38 | 13 | 40 | 45/85 | Piston punch. Light armour |
| U-tilt | 9 / 5 / 34 | 11 | 88 | 40/95 | Overhead slab shrug, big disjoint above |
| D-tilt | 8 / 3 / 28 | 9 | 25 | 35/70 | Low sweep with the fist along the floor, trips at low % |
| Dash attack | 14 / 8 / 46 | 14 | 55 | 60/70 | Shoulder charge. Light armour |
| F-smash | 22 / 5 / 62 | 22 (30 full) | 38 | 50/95 | Both fists down like a pile driver. Armour |
| U-smash | 18 / 6 / 58 | 20 | 90 | 45/100 | Stack jumps a slab; hits above and both sides |
| D-smash | 20 / 4+4 / 60 | 17 | 30 | 50/85 | Stomp both sides; slow, ridiculous |
| N-air | 8 / 20 / 44 | 12 early, 8 late | 60 | 35/70 | Slabs spin; lingering |
| F-air | 16 / 4 / 50 | 17 | 45 | 40/95 | Hammer fist. 22 landing lag |
| B-air | 12 / 4 / 42 | 16 | 35 | 45/90 | Rebar swing behind. Good |
| U-air | 10 / 5 / 40 | 13 | 85 | 40/85 | Head slab pops up |
| D-air | 18 / 6 / 56 | 18 | 270 (spike) | 30/95 | The elevator. Spike on hit frames 1-3, then 60 degrees |
| Grab | 8 / 3 / 40 | | | | Slightly longer reach than average |
| F-throw | | 11 | 45 | 60/75 | Throws the victim like a sack |
| B-throw | | 12 | 40 | 65/80 | Turns and heaves. Kill throw at ledge ~140% |
| U-throw | | 10 | 90 | 70/80 | Slab-launch straight up |
| D-throw | | 8 | 70 | 50/40 | Buries the victim for a combo starter |
| **N-special: Demolition** | 24 / 6 / 70 (charge to 90) | 18-34 | 42 | 40/110 | Rears back and slams both fists into the ground. Charge with hold, release or auto at max. Shockwave along the ground on full charge (12 damage, 8 units tall). Armour throughout |
| **S-special: Concrete Hug** | 14 / 6 / 50 | 14 | 50 | 70/75 | Command grab. On hit, lumbers three steps in the held direction (can walk off the ledge: suicide KO at 150%+ of either) and slams. Whiff is very punishable |
| **U-special: Piston Jump** | 6 / 4 / 60 | 12 on rise | 80 | 50/70 | One huge vertical burst (fullHop x2.2), tiny drift, hits on the way up. No horizontal recovery; helpless after |
| **D-special: Foundation** | 4 / — / until released | | | | Plants. Cannot move, full armour to anything under 20 damage, reflects projectiles as slower slabs. Holding longer than 90 frames makes the release stagger (20 frames). Release with any button |
| Taunt | | | | | Adjusts the head slab, it clunks |

---

## WICK — the little flame

**Fantasy:** a candle flame that ran away from its candle. Small, everywhere, hits twenty
times a stock and dies to a stiff breeze. Playing WICK is about never stopping; playing
against WICK is about one clean read.

**Silhouette:** a teardrop of flame about 70 tall with two dot eyes and a mouth, two stubby
arm-flames, no legs (hovers just off the ground, bobbing). Flame tip trails when moving. Gets
smaller when low on "heat" (see mechanic). Weapon bone: none.

**Palette:** yellow-white core `#fff1a8`, flame yellow `#ffc43a`, ember red `#ff4d2e` outline.

**Stats:** weight 72, walk 4.5, run 9.4, dashInit 10.5, airSpeed 5.8, airAccel 0.3, fallSpeed
6.5, fastFall 10.5, gravity 0.34, shortHop 7.5, fullHop 12.5, doubleJump 12, wallJump yes,
height 74, width 46.

**Mechanic: Heat.** A meter, 0-100, shown as the flame's size. Landing hits adds heat (+damage
dealt); taking hits and using Snuff burns heat. Above 60 heat, WICK's attacks leave a lingering
ember (small hitbox, 2 damage, 12 frames) on the spot they hit, and its run leaves a fire trail.
At 100, the next special is empowered (see specials). Heat drains 0.05/frame idle.

| Move | Startup / Active / Total | Damage | Angle | KB | Notes |
|---|---|---|---|---|---|
| Jab | 3 / 2 / 14, 3 / 2 / 16, then rapid 1 dmg / 4f, finisher 4 | 2, 2, 1..., 4 | 70, 70, 0, 50 | 10/30..., 40/100 | Fastest jab in the game |
| F-tilt | 5 / 3 / 22 | 7 | 40 | 30/70 | A slap of flame |
| U-tilt | 4 / 4 / 20 | 6 | 95 | 25/80 | Flicks up; combo bread |
| D-tilt | 4 / 2 / 18 | 5 | 80 | 20/60 | Pokes low, pops up |
| Dash attack | 6 / 10 / 32 | 9 | 60 | 40/60 | Flare-dash, multi-hit 3x3 |
| F-smash | 12 / 4 / 42 | 14 (19.6) | 42 | 40/95 | Whole body lunges as a spear of flame |
| U-smash | 8 / 8 / 40 | 12 | 90 | 30/100 | Column of flame overhead |
| D-smash | 10 / 3+3 / 38 | 11 | 35 | 35/85 | Puffs both sides |
| N-air | 4 / 14 / 30 | 8 then 5 | 50 | 25/65 | Spin; sex kick |
| F-air | 7 / 3+3+3 / 34 | 3, 3, 6 | 45 | 30/85 | Three fast slaps, last launches |
| B-air | 6 / 3 / 28 | 10 | 40 | 35/90 | Tail whip; the kill aerial |
| U-air | 5 / 4 / 24 | 7 | 85 | 25/80 | Juggle tool |
| D-air | 9 / 4 / 40 | 9 | 270 | 20/80 | Stomp of flame; weak spike |
| Grab | 6 / 2 / 30 | | | | Short reach |
| F-throw | | 7 | 50 | 50/60 | |
| B-throw | | 8 | 45 | 55/70 | |
| U-throw | | 6 | 90 | 50/50 | Combo throw |
| D-throw | | 5 | 60 | 40/55 | Bounces, follow-ups |
| **N-special: Flare** | 8 / 3 / 30 | 9 | 60 | 40/85 | Short burst in front. At 100 heat: Nova, 360 degrees, 16 damage, resets heat |
| **S-special: Flicker** | 6 / — / 34 | 8 on exit | 45 | 30/80 | Blinks 220 units in the held direction (or facing), invulnerable frames 6-14, hits where it reappears. Once per airtime. At 100 heat: passes through and ignites everyone along the path |
| **U-special: Flashfire** | 5 / 20 / 50 | 2 x 7 then 6 | 80 | 30/90 | Spiral rise, multi-hit, decent height and drift. Helpless after |
| **D-special: Snuff** | 2 / — / 40 | | | | Goes out: 24 invulnerable frames, cannot act, then reignites with a 6-damage puff and a 30 heat cost. Cannot use below 30 heat. Risky reset |
| Taunt | | | | | Flickers and winks |

---

## PILOT — the Kessler homage

**Fantasy:** the sword-and-gun pilot from Kessler in a ship-suit. Fights with a kinetic
crescent up close and a homing slug at range, and recovers by rocket burn with a fuel tank.
Controls space; hates being rushed.

**Silhouette:** angular. A humanoid in a suit with a ship's nose for a helmet, thruster
nacelles on the back that flare on jumps, a visor. Arms end in gauntlets; the crescent is
drawn as a light blade on the leading arm. Weapon bone: crescent (front arm) and gun (rear
arm).

**Palette:** cyan `#35e0ff`, hull white `#eef7ff`, hazard orange `#ff8c1a` accents, visor black.

**Stats:** weight 95, walk 3.9, run 7.2, dashInit 8.0, airSpeed 4.6, airAccel 0.2, fallSpeed
8.0, fastFall 12.5, gravity 0.46, shortHop 8.5, fullHop 14, doubleJump 13, wallJump no, height
118, width 56.

**Mechanic: Rounds and Fuel.** Six rounds; a round reloads every 90 frames while grounded.
Fuel 100; drains during Launch, refills 1/frame grounded. Both meters sit under the percent.

| Move | Startup / Active / Total | Damage | Angle | KB | Notes |
|---|---|---|---|---|---|
| Jab | 5 / 2 / 20, 6 / 2 / 24, 8 / 3 / 34 | 3, 3, 6 | 60, 60, 45 | 20/40, 20/40, 40/90 | Crescent taps |
| F-tilt | 9 / 3 / 30 | 10 | 40 | 35/80 | Crescent thrust, disjoint |
| U-tilt | 7 / 5 / 28 | 8 | 90 | 30/85 | Overhead arc |
| D-tilt | 6 / 3 / 24 | 7 | 30 | 30/65 | Low sweep |
| Dash attack | 10 / 6 / 38 | 11 | 50 | 50/65 | Thruster-assisted slide |
| F-smash | 16 / 4 / 50 | 17 (23.8) | 40 | 45/95 | Big crescent |
| U-smash | 12 / 6 / 46 | 15 | 92 | 40/100 | Thrusters fire, blade up |
| D-smash | 14 / 3+3 / 48 | 14 | 30 | 40/90 | Sweep both sides |
| N-air | 6 / 12 / 34 | 9 then 6 | 50 | 30/70 | Spin with crescent |
| F-air | 11 / 4 / 42 | 13 | 45 | 40/90 | Crescent slash, 14 landing lag |
| B-air | 9 / 3 / 36 | 12 | 35 | 40/95 | Rear thruster kick |
| U-air | 8 / 4 / 32 | 10 | 85 | 30/85 | |
| D-air | 13 / 3 / 46 | 12 | 270 | 25/85 | Thruster stomp spike |
| Grab | 7 / 2 / 34 | | | | |
| F-throw | | 8 | 45 | 55/65 | |
| B-throw | | 9 | 40 | 60/75 | |
| U-throw | | 7 | 90 | 60/60 | |
| D-throw | | 6 | 65 | 45/50 | |
| **N-special: Slug** | 12 / — / 32 | 8 | 40 | 35/60 | Fires one round: a heavy slug at 9 units/frame that homes 1.2 rad/s toward the nearest opponent for 60 frames, then drops with gravity. Clicks empty. Reload only on the ground |
| **S-special: Crescent Wave** | 10 / 24 / 44 | 10 | 30 | 50/55 | Wall of light two heights tall runs along the ground ahead at 8 units/frame for 24 frames, shoving opponents along and reflecting projectiles. In the air it's shorter and drops |
| **U-special: Launch** | 4 / — / until fuel or release | 6 on ignition | 70 | 40/50 | Rocket burn in the held direction (default up), 1.6 units/frame^2 of thrust while fuel lasts (~50 frames from full), steerable. Invulnerable frames 4-7. Not helpless after: can act, but cannot Launch again until grounded |
| **D-special: Debris** | 14 / — / 40 | 7 | 60 | 30/60 | Drops a chunk that bounces twice on the stage and lingers 120 frames as a hazard both fighters can hit to send flying (a hit chunk is a 9-damage projectile). Max one chunk out |
| Taunt | | | | | Thrusters flare, visor glints |

---

## SABLE — the fencer

**Fantasy:** a duellist in a long coat with a rapier. Honest neutral, best range in the game,
a counter that punishes impatience, and a tipper that rewards spacing at the exact right
distance. The "learn the game" character and the one that scales furthest.

**Silhouette:** tall and thin. Long coat drawn as a swept trapezoid, high collar, a hat brim.
The rapier is a long thin line with a bell guard; the tip carries a spark. Weapon bone: rapier.

**Palette:** violet `#8a3ffc`, black `#12101a`, white `#f4f0ff` accents, silver blade.

**Stats:** weight 100, walk 4.2, run 7.8, dashInit 8.6, airSpeed 4.4, airAccel 0.18, fallSpeed
8.4, fastFall 13, gravity 0.48, shortHop 8.6, fullHop 14.2, doubleJump 13, wallJump yes, height
126, width 50.

**Mechanic: Tipper.** Every rapier move has a sweetspot at the last 20% of the blade: +40%
damage, +30% knockback, a distinct high "ting" and a white spark. Sourspots are the rest of
the blade.

| Move | Startup / Active / Total | Damage | Angle | KB | Notes |
|---|---|---|---|---|---|
| Jab | 4 / 2 / 18, 5 / 2 / 20, 6 / 3 / 30 | 3, 3, 5 | 60, 60, 50 | 20/40, 20/40, 40/85 | Three quick pokes |
| F-tilt | 8 / 3 / 30 | 11 | 38 | 35/85 | The long poke; tipper |
| U-tilt | 6 / 5 / 26 | 8 | 92 | 30/85 | Upward flick |
| D-tilt | 6 / 3 / 24 | 8 | 28 | 30/70 | Low thrust; trips |
| Dash attack | 9 / 5 / 36 | 10 | 55 | 45/65 | Sliding lunge |
| F-smash | 14 / 3 / 50 | 16 (22.4) | 40 | 45/100 | Full extension lunge; the tipper kill move |
| U-smash | 10 / 6 / 44 | 14 | 90 | 40/100 | Rising flourish |
| D-smash | 12 / 2+2 / 44 | 13 | 32 | 40/90 | Front then back sweep |
| N-air | 5 / 10 / 32 | 8 | 45 | 30/70 | Circle parry, hits both sides |
| F-air | 9 / 3 / 40 | 12 | 42 | 35/90 | Forward thrust, 12 landing lag |
| B-air | 8 / 3 / 34 | 13 | 35 | 40/95 | Back thrust; kill aerial |
| U-air | 7 / 4 / 30 | 9 | 88 | 30/85 | |
| D-air | 12 / 3 / 44 | 12 | 270 on tip, 60 on sour | 30/85 | The stall-and-fall is not this; plain downward thrust |
| Grab | 6 / 2 / 32 | | | | |
| F-throw | | 8 | 45 | 55/65 | |
| B-throw | | 9 | 40 | 60/75 | |
| U-throw | | 7 | 90 | 55/60 | |
| D-throw | | 6 | 60 | 45/50 | |
| **N-special: Lunge** | 12 / 4 / 46, charge to 60 | 12-24 | 38 | 40/95 | Chargeable stab; at full charge it's a screen-length flash-step (invulnerable 6 frames) |
| **S-special: Passata** | 8 / 6 / 30 | 9 | 40 | 35/75 | Quick dash-slash 180 units; cancel into any tilt or aerial on hit |
| **U-special: Rising Flourish** | 6 / 12 / 46 | 3 x 3 then 8 | 80 | 30/95 | Spiral up with drift. Helpless after |
| **D-special: Riposte** | 3 / 24 / 50 | 1.5x the countered hit (min 8) | 40 | 50/90 | Counter stance; on being hit during frames 3-27 the hit is nulled and SABLE strikes back. 30 frames of lag on whiff. Doesn't counter grabs |
| Taunt | | | | | Salutes with the blade |

---

## Roster growth

The next ten sketched, so the rig and data formats get stressed before anyone commits to
them: a grappler with a chain, a puppeteer who fights with a second body, a zoner with a
bow that draws over time, a stance-switcher (sword/spear), a heavy that is literally two
small fighters stacked, a spider that walls and ceilings, a bell whose attacks ring and
stun, a wind fighter that moves opponents without damage, a clockwork character with a
wind-up meter, a shadow that mirrors the opponent's moveset with different frame data.
