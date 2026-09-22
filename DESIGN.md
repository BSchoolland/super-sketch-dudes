# SKETCH BATTLE — Design

A platform fighter in the browser. Two to four fighters, percent damage, knockback, blast zones,
stocks. Keyboard or controller. Local couch play and online play. Four fighters at launch, a
roster format built for thirty.

## Pillars

1. **Feel first.** Every input answers on the next frame. Movement is the game: dash-dance,
   short hop, fast fall, wavedash-free but crisp. If a move feels mushy, the number is wrong;
   change the number, not the plan.
2. **Distinct silhouettes, distinct plans.** You can tell who's who at 20% zoom by shape alone,
   and each fighter wins in a different way. No two fighters share a special.
3. **Readable violence.** Windups are visible, hitboxes match the drawing, and the big hits
   land with hitlag, shake, a flash and a sound you feel in your teeth. Kills are events.
4. **Alive, not polished.** Saturated colour, trails, smoke, sparks, squash-and-stretch. The
   arena is lit like a stage show. Nothing muted, nothing grey.

## The name

Sketch Battle: a fight drawn on paper. It started life as RINGOUT (ring out: you don't win by
emptying a health bar, you win by throwing them out of the ring); the win condition stayed, the
look became pencil and ink, and the name followed.

## Art direction: paper-cut stage show

- Flat saturated fills with thick ink outlines, no gradients on bodies. Glow and additive
  blending are reserved for effects (hits, specials, KOs), so effects pop against bodies.
- Fighters are procedural rigs: a small skeleton (root, torso, head, two arms, two legs, plus
  a weapon bone where it applies), each bone drawn as a capsule or polygon in the fighter's
  palette. Poses are keyframes per move; the renderer tweens between them. This is how we get
  thirty fighters without a sprite artist: shape, proportion, palette, weapon, and pose sets.
- Squash on landing, stretch on jump, lean into runs, afterimages during dashes and specials.
- Each fighter has a two-colour palette plus an accent; player slots tint the accent
  (P1 red, P2 blue, P3 yellow, P4 green) so mirror matches read.
- Stages are layered parallax: a far backdrop (sky, gradient, big shapes), mid decorations,
  and the platform layer drawn with the same ink-outline language as the fighters.
- Camera frames all live fighters with padding and zooms smoothly; it never cuts. Hitlag
  freezes fighters but not particles. KO: 12 frames of freeze, a white flash, a directional
  slash line across the screen, 20 frames at quarter speed, then the blast-zone burst.

## Rules of the ring

- **Damage** is a percent starting at 0. Knockback grows with percent.
- **Knockback** uses the proven formula:
  `kb = (((p/10 + p*d/20) * 200/(w+100) * 1.4) + 18) * s + b`
  where p is the victim's percent after the hit, d the hit's damage, w the victim's weight,
  s the hit's knockback growth (scaling /100), b its base knockback. Launch speed is kb * 0.03
  units per frame, decaying 0.051 per frame. Hitstun frames = kb * 0.4.
- **Hitlag** on both fighters = damage * 0.65 + 4 frames (electric hits x1.5). Victim can DI
  (directional influence, up to 18 degrees) during hitlag.
- **Tumble** when kb >= 80: the victim can't act until hitstun ends, can tech a ground or wall
  hit (press shield within 20 frames before impact) and can be footstooled.
- **Shield**: 50 HP, drains 0.15/frame held, hits drain damage * 1.19, regenerates 0.08/frame
  when down. Shield stun = damage * 0.8 + 2. Shield break: 5 seconds of stun, launched slightly.
  Parry: shield pressed within 3 frames before a hit; no stun, 8 frames of advantage.
- **Grab** beats shield. 6 frames of startup, 30 of whiff recovery. Throws: forward, back, up,
  down. Pummel 3 damage. Mash out faster at low percent.
- **Dodges**: spot dodge (2f startup, 20 invulnerable, 26 total), roll (4/26/32), air dodge
  (3/29/38, directional, one per airtime, 10 frames of landing lag).
- **Ledge**: grab when falling past the ledge box (facing it or not), 40 invulnerable frames,
  ledge options: neutral get-up, roll, jump, attack, drop. Ledge trumping: grabbing an occupied
  ledge pushes the occupant off.
- **Blast zones**: beyond the stage bounds by ~1.3 stage widths sideways, ~1.1 heights up,
  ~0.6 heights down. Cross one, lose a stock.
- **Match**: stocks (default 3) or time (default 3 min). Stocks-and-time: leftover stocks then
  percent decide. Sudden death at 300% if tied.
- **Ground moves**: jab (3-hit rapid), forward/up/down tilt, forward/up/down smash (chargeable
  up to 60 frames for 1.4x), dash attack. **Aerials**: neutral, forward, back, up, down.
  **Specials**: neutral, side, up, down. **Grab and 4 throws.** 22 moves per fighter.
- **Movement**: walk, run (initial dash 12 frames, dash-dance by reversing), jump squat 3
  frames, short hop (release jump within squat), full hop, double jump, fast fall (hold down at
  apex or after), crouch, wall jump for the fighters marked for it, footstool.
- **Smash charge armour**: none by default; BRICK's smashes have it.
- **Universal juice**: hit sparks scaled by damage, hitlag shake on the victim, camera trauma
  for hits over 12 damage, dust on dash start and landing, a jump puff, a tumble smoke trail,
  a percent counter that scales and shakes as it climbs.

## Fighters at launch

Four archetypes, four silhouettes, four colours. Full sheets in CHARACTERS.md.

| Fighter | Archetype | Silhouette | Palette | Weight | Wins by |
|---|---|---|---|---|---|
| BRICK | Heavy / grappler | Wide stack of slabs, tiny head | brick orange, tar black | 125 | One or two reads; armour through your stuff |
| WICK | Rushdown / glass cannon | Small teardrop flame with a face, no legs | yellow-white, ember red | 72 | Never letting you breathe; twenty hits a stock |
| PILOT | Zoner / spacer (the Kessler homage) | Angular ship-suit with thrusters, visor | cyan, white, hazard orange | 95 | Controlling space with slugs and the wave, rocket recovery |
| SABLE | All-rounder / sword | Tall, thin, long rapier | violet, black, white | 100 | Tipper spacing and the counter; honest neutral |

## Stages at launch

- **Proving Ground**: flat, one wide platform, no hazards. The tournament stage.
- **Rooftops**: three platforms (two low, one high), a slightly narrower main stage, night sky
  with a moving neon skyline. The default.
- **Kessler Field**: a small planet-ish main stage with two orbiting debris platforms that
  circle slowly; a homage to the other game. Off-stage gravity is normal (this is a fighter).
- (later) hazard stage, walk-off stage.

## Modes

- **Versus**: 2 to 4 fighters, any mix of humans and CPUs, stocks or time, local.
- **Online**: quick match (1v1) or a room code (2 to 4). Rollback netcode.
- **Training**: one fighter plus a dummy (stand / CPU / repeat DI), hitbox display, frame data
  readout, percent set, slow motion.
- **Settings**: controls remap per player slot, controller assignment, rumble on/off, screen
  shake amount, colourblind accent set.

## Controls

Both keyboard layouts and any gamepad. Every player slot can be assigned a device on the
character select screen by pressing a button on it.

| Action | Keyboard P1 | Keyboard P2 | Gamepad |
|---|---|---|---|
| Move | WASD | Arrows | Left stick / d-pad |
| Jump | W / Space | Up / Numpad 0 | X, Y (or stick up, toggle) |
| Attack | J | Numpad 1 | A |
| Special | K | Numpad 2 | B |
| Shield | L / Shift | Numpad 3 / Right Shift | LB, RB, LT |
| Grab | I | Numpad 4 | RT, or Shield+Attack |
| Smash (c-stick) | — | — | Right stick |
| Taunt | T | Numpad 5 | d-pad down |
| Pause | Esc | Esc | Start |

Tilts are attack with a direction held; smashes are a direction tapped (flicked) within 4 frames
of attack, or the c-stick. Keyboard players get a smash modifier too (hold Shift+direction+attack,
since flicks on keys are unreliable): P1 uses U, P2 uses Numpad 6.

## Online

Rollback netcode: every client runs the full deterministic sim, predicts remote inputs (repeat
last), and rolls back to re-simulate when real inputs arrive. Inputs are relayed through the
game server over a websocket (one transport, works behind every NAT, nothing to configure).
Input delay 2 frames by default, adjustable; a connection indicator shows ping and rollback
frames. The server also runs the lobby: quick match queue and 4-character room codes.
Peer-to-peer WebRTC is a later upgrade for lower latency; the netcode layer is built so the
transport is swappable.

## Not in v1

Items, Final Smashes, custom rulesets beyond stocks/time, spectating, replays (though the
deterministic sim and input log make them cheap later), accounts, ranked.
