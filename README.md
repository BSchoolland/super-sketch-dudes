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

The house roster (`client/public/house/`, ids in `shared/house.ts`) is four forged characters that
ship with the game and stand in as CPU opponents and the forge's balance ladder: **WOODSTOVE**,
**SLUGBERT**, **ROCKET** and **WIZARD**. Everything else a player fights is drawn and forged.

## Development

```
npm install
npm run dev          # Vite on :5175 + server on :3008, open http://localhost:5175/sketch-battle/
npm run check        # typecheck + determinism lint + tests
npm run ladder       # CPU vs CPU win-rate matrix
npm run events       # read the wide events (see Wide events below)
npx tsx scripts/killpercents.ts   # kill percent per move, centre and ledge
node scripts/posesheets.mjs       # pose contact sheets into shots/sheets/
node scripts/menushots.mjs        # walk the menus and screenshot them
node scripts/padcheck.mjs         # gamepad smoke test with a fake pad
scripts/deploy.sh    # build, ship to personal-server, restart pm2 "sketch-battle"
```

## Wide events

Every unit of work leaves one structured record, built up over its life: a page session, each
client's view of an online match, a forge job, an API write, a relay connection,
a room, the relay's view of a match, the server process. They land in `server-data/events.jsonl`,
one snapshot per line; long-lived events are rewritten while they run, so a crash still leaves a
partial record. The same match is on one trace for every participant and the relay:
`m-<room code>-<seed>`. A page session's trace (`s-…`) also carries its API requests and its relay
connection.

```
npm run events -- --since 2h                      # the last two hours, one line each
npm run events -- --trace m-UR49-51853b98         # one match: every client and the relay, in full
npm run events -- --trace s-8d51f9a50963          # one page session and everything filed under it
npm run events -- --level error --since 1d        # what went wrong today
npm run events -- --kind match --grep Kirill -v   # any match Kirill was in
npm run events -- --json --since 30m | jq …       # raw records
ssh personal-server 'cd ~/sketch-battle && node dist/events.mjs --since 2h'   # on the server
```

`--data <dir>` reads another data dir; `--legacy` also prints the old one-line `client-log.jsonl`
that builds from before wide events still post to. `node scripts/wide-events-check.mjs` plays a
three-browser match against a scratch server and checks the store (usage at the top of the file).

Testing URLs: `?quick=1&p2=cpu&cpu=9&f=brick,wick&stage=rooftops` skips the menus
(`&p1=pad0` uses the first gamepad, `&training=1` starts training, `&boxes=1` shows hitboxes);
`?sheet=sable` opens the pose sheet.
