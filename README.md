# SUPER SKETCH DUDES

A platform fighter in the browser. Two to four fighters, percent damage, knockback, blast zones,
stocks. Keyboard or controller, couch or online.

**Play:** https://bschoolland.dev/sketch-battle/

- `DESIGN.md` is what this is and why.
- `CHARACTERS.md` is the roster: every fighter's fantasy, stats and frame data.
- `ARCHITECTURE.md` is how it is built and how to add a fighter or a stage.

## Controls

| | Keyboard 1 | Keyboard 2 | Gamepad |
|---|---|---|---|
| Move | WASD | Arrows | Left stick / d-pad |
| Jump | W / Space | Up / Numpad 0 | X, Y, or flick the stick up |
| Attack | Left click | Numpad 1 | A |
| Special | Right click | Numpad 2 | B |
| Shield | Shift | Numpad 3 / Right Shift | LB, RB, LT |
| Smash | hold U + direction + click, or flick + click | Numpad 6 + direction | Right stick |
| Taunt | T | Numpad 5 | d-pad down |
| Pause | Esc | Esc | Start |

Tilts: hold a direction, then attack. Smashes: flick a direction with attack, use the modifier, or
the right stick. Shield + a direction rolls; shield + down spot-dodges; shield in the air is an air
dodge; shield just before a hit lands parries.

## Fighters

- **BRICK**, the wall: a golem of stacked slabs. Super armour on smashes, a command grab that walks
  you off the ledge, a piston jump with no horizontal recovery.
- **WICK**, the runaway flame: fastest jab in the game, a heat meter that grows it and leaves embers,
  a blink-dash, a snuff-out reset that costs heat.
- **PILOT**, the Kessler homage: crescent up close, six homing slugs that reload on the ground, the
  wave, a fuel-tank rocket burn and a debris chunk anyone can hit.
- **SABLE**, the fencer: tipper sweetspot on the rapier, a counter, a cancelable dash-slash.

## Development

```
npm install
npm run dev          # Vite on :5175 + server on :3008, open http://localhost:5175/sketch-battle/
npm run check        # typecheck + determinism lint + tests
npm run ladder       # CPU vs CPU win-rate matrix
npx tsx scripts/killpercents.ts   # kill percent per move, centre and ledge
node scripts/posesheets.mjs       # pose contact sheets into shots/sheets/
node scripts/menushots.mjs        # walk the menus and screenshot them
node scripts/padcheck.mjs         # gamepad smoke test with a fake pad
scripts/deploy.sh    # build, ship to personal-server, restart pm2 "sketch-battle"
```

Testing URLs: `?quick=1&p2=cpu&cpu=9&f=brick,wick&stage=rooftops` skips the menus
(`&p1=pad0` uses the first gamepad, `&training=1` starts training, `&boxes=1` shows hitboxes);
`?sheet=sable` opens the pose sheet.
