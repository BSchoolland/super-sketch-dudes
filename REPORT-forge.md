# The forge: report

Branch `draw-forge`. Commit: see the bottom of this file.

## What exists

| file | what it does |
|---|---|
| `forge/worker.ts` | polls `/api/forge/jobs/next` every 2s, runs up to 4 jobs at once (`FORGE_CONCURRENCY`), posts `/complete` or `/fail { error }`, one log line per step, total time and cost per character |
| `forge/pipeline.ts` | concept → sheet → cells → facing → module → checks, with up to 2 retries that resume the pass-2 session with the failure list; posts every README progress string, including `fixing: <first failure>` |
| `forge/agent.ts` | `claude -p` wrapper: opus-5-5, json output, `--tools Read,Write`, acceptEdits, 4-min SIGKILL timeout, records tokens and `total_cost_usd` |
| `forge/sheet.ts` | `gpt-image-2.5-sunburst` images.edit call, quality high, 1024². Cost is an **estimate** at gpt-image-1 list rates (sunburst doesn't publish its rates) |
| `forge/checks.ts` | the headless gate (runs as a subprocess with a 120s kill): lint/build/validate, stats.height match, uspecial helpless+ledgeOk, 4-player 2400-frame determinism resim, ladder vs the 4 stock fighters (2 matches each, CPU 9, 3-min cap), a **move sweep** (below), recovery 6/10, KO under 300%, hookErrors from all of it |
| `forge/cli.ts` | `npx tsx forge/cli.ts <drawing.png> <outdir> [--name P] [--url /base]`: the whole pipeline with no server; writes bundle.json, cells/, sheet.png, report.json, concept.json, module.json, prompts.log |
| `forge/env.ts` | loads `forge/.env`, then `~/.config/sketch-forge/env`; variables already set win |
| `forge/forge.service` | systemd --user unit, `Restart=always`, `EnvironmentFile=%h/.config/sketch-forge/env`. It points at `~/Projects/sketch-battle` (the checkout it will run from after merge). **Not installed or enabled.** |
| `scripts/draw-e2e.mjs` | drives a 2-player, 1-round draw battle against a running server and waits for both characters |
| `test/forge.test.ts` | the gate passes the exemplar and fails a broken one with specific messages (height, recovery, throwing special hook, lint) |

Every job's artefacts are in `forge/runs/<jobId>/`. The sample runs below are copied in as `forge/runs/cli-*`; that directory is gitignored.

## Real runs (final code)

| run | name | wall | concept | sheet | facing | module (all tries) | tries | cost (agent + sheet est.) |
|---|---|---|---|---|---|---|---|---|
| cli grub | STALKY | **186s** | 42.4s | 34.0s | 8.0s | 100.7s | 1 | **$0.76** ($0.68 + $0.09) |
| cli tank | SIX WHEELS | **240s** | 43.4s | 32.8s | 8.4s | 153.6s | 2 | **$1.41** ($1.32 + $0.09) |
| cli tank (after the recovery prompt line) | TANK | 230s | 37.0s | 33.4s | 10.1s | 148.2s | 2 | $1.50 |
| e2e grub (Bob) | SWIRLOP | 207s | 42.1s | 34.0s | 14.9s | 115.3s | 1 | $0.87 |
| e2e tank (Ann) | TANK | 259s | 44.6s | 34.7s | 12.6s | 165.8s | 2 | $1.56 |

Checks take about 0.6s per try, and cells about 0.5s.

- A fighter that passes on the first try costs about $0.8 and takes about 3m10s. One retry adds about 60s and $0.6.
- **The 3-minute target is not met.** Pass 2 alone is 90–115s even at low effort.
- Agent cost is `claude -p`'s `total_cost_usd`: the list-price equivalent, billed to your subscription through the router.

End to end: local server on 3011 + worker + `scripts/draw-e2e.mjs`. Both characters reached `ready`, and each bundle.json and all 9 cells were served with HTTP 200. The failure path was run too: the worker with no `claude` on PATH posted `/fail`, and both characters showed `failed` with "forge error: spawn claude ENOENT".

`npm run check` passes: typecheck (now including `forge/`), determinism lint, 34 tests.

## What broke and what I changed

1. **Pass 2 timed out on both samples (240s kill, nothing written).** At the default effort Opus thinks for about 30k tokens before it writes the module. I measured it untimed: 5m40s and $1.24. `--effort medium` behaved the same, and so did `MAX_THINKING_TOKENS`.
   - `--effort low` takes 94–115s and about $0.48, and its modules pass the gate as often (the retry loop covers the rest). The module and facing calls use `low`; the concept call keeps the default.
   - It also tried Bash to syntax-check its output. `--tools Read,Write` now removes the other tools; `--allowedTools` only pre-approves them.
2. **Sheets keep the drawing's facing and ignore "always faces RIGHT".** The first grub sheet faced left, so every hitbox would have landed behind the drawing.
   - New **facing** step: it resumes the pass-1 session (cheap, cached) with a short prompt to Read idle/atk-fwd and write `{"faces": ...}`. If it says left, `normalize.py --mirror 1` flips the cells before pass 2. It adds 8–15s.
   - The grub is genuinely ambiguous: the mouth is on the left but the spring attacks right. The check said "right", which matches its attacks.
3. **`normalize.py` clipped wide drawings.** It scaled so the idle cell was 300px tall, which made the tank about 790px wide on a 512 canvas. Every cell is now fitted inside the canvas, and `cells.json heightPx` is the idle height actually used.
4. **Wide fighters were huge.** `provisionalHeight` only used archetype and stats_note, so the tank stood 136 tall and 370 wide on stage. It now divides by √(aspect/0.8) for wide idle silhouettes.
5. **`shared/hits.ts` bug, which I fixed in shared code.**
   - What: `hurtbox()` builds a vertical capsule of radius width/2. When width > height, the capsule inverts: the tank's poked 70 units under the floor and reached twice its height above it.
   - Fix: when wider than tall, the capsule now lies flat (radius height/2, spanning the width).
   - Why it's safe: no stock fighter has width > height, standing or crouched, so this changes nothing for them. Screenshot below.
6. **The CPU never uses some moves.** At level 9 it never played Lampjack's nspecial/sspecial/dspecial, so a throwing hook there would slip past the ladder. The new **move sweep** starts every move directly (except throws and pummel), once with no input and once holding special+attack+forward, so every hook runs.
7. **Determinism resim with a disabled hook.** A throwing hook is disabled mid-run, so the resim could never match and would report a false desync. The resim is now skipped when a hook threw (the hook failure is reported instead). The old comment claimed a fresh def that the code didn't make.
8. **Recovery failures now say how far off they were:** whether uspecial was used, how high it rose, and how close to the ledge it got.
   - Example: "uspecial rose at most 44 units; at ledge height it got no closer than 60 units outside the ledge…".
   - With that message the tank's retry fixed recovery (0/10 → 10/10) every time.

## What the checks caught (real runs)

- **Recovery 0/10**: every tank on its first try (4 of 4 runs), and 3 of 4 default-effort tank modules during the timeout investigation. The tank is heavy with little air speed, and its uspecial goes mostly up. The retry fixed it every time.
- **Nothing else failed on generated modules.** Determinism, lint, hooks, KO (fsmash kills at 55–100%) and cell names were clean in all passing runs.

## Prompt changes

- `PROMPT-module.md`: two clarifying bullets.
  - `stats.width`/`height` are the hurtbox capsule, so size the width from the idle box.
  - The recovery check pushes the fighter about 200 units out, so uspecial must also bring it back sideways. This did **not** stop the tank failing first time in its one verification run; the retry still fixes it.
- `prompts.ts`: new `facingPrompt`.
- `PROMPT-concept.md` and `SHEET-PROMPT.md`: unchanged.

## Screenshots (`shots/` is gitignored)

- `shots/forge-tank/`: tank vs brick, CPU 9. `sheet-0..2.png` show hitboxes on the barrel.
  - `02-play.png`/`05-boxes.png` were taken **before** the hurtbox fix and still show the inverted capsule.
- `shots/forge-tank-hurtbox/03-play.png`: after the fix, the capsule wraps the tank.
- `shots/forge-grub/`: STALKY vs brick. `sheet-0.png` shows jab hitboxes at the mouth and fsmash on the sprung coil.

## Unfinished / watch

- **Every generated fighter loses 0–8 on the ladder, and so does the exemplar Lampjack.** Matches average 60–140s, so the soft "loses in under 25s" flag never fires. The level-9 CPU has per-fighter logic for the stock ids (`shared/cpu.ts`), so it probably plays generated fighters worse. The ladder is therefore a weak balance signal right now.
- **Server reclaim vs worst case.** The server requeues a job still running after 6 min. A job with two retries can exceed that: concept + sheet + facing + 3× module is about 5–6 min, and up to 12 min in theory. When that happens:
  - the next progress POST gets 409;
  - the worker aborts and logs it (its `/fail` also gets 409);
  - the requeued copy runs from scratch.

  That wastes one run but doesn't lose the character. Raising the server timeout to about 10 min would avoid it.
- **The facing check is a judgment call on ambiguous drawings.**
- **Sheet cost is estimated**, not billed.
- **`forge.service` is not installed or enabled.** It assumes node from mise at `~/.local/share/mise/installs/node/26`.
