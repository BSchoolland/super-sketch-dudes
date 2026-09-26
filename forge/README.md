# The forge

Turns a player's drawing into a fighter. Runs on Ben's machine as a worker that polls the site;
the site never calls in. One job = one character. Target: under three minutes wall clock.

```
forge/
  worker.ts        poll loop: claim job -> run pipeline -> post bundle (or failure). N jobs in parallel.
  pipeline.ts      the steps below, each reporting progress to /api/forge/jobs/:id/progress
  agent.ts         `claude -p` calls (model claude-opus-5-5): pass 1 concept, pass 2 module, retries
  sheet.ts         gpt-image-2.5-sunburst images.edit call from the drawing + pass-1 cell descriptions
  img/normalize.py sheet -> nine keyed, scaled, aligned cells + cells.json content boxes
  checks.ts        headless gate: lint/build/validate, determinism resim, ladder vs stock, recovery, KO
  exemplar/        LAMPJACK, the hand-written drawn fighter every agent call gets as its example
  PROMPT-*.md      the agent prompts
```

## Pipeline

1. **Claim** `GET /api/forge/jobs/next` (header `x-forge-token`). 204 = nothing to do; poll every 2s.
   Job: `{ id, fighterId, playerName, round, siblings, attempts }`. Download `GET /api/forge/jobs/:id/drawing.png`.
2. **Pass 1 — concept** (`claude -p`, PROMPT-concept.md, Read tool on the drawing). Output JSON:
   name, tagline, description-with-counts, archetype, gimmick, one line per core move, and nine cell
   descriptions written for the image model (what the character is doing in each cell, in the
   character's own terms: "the barrel swings up and fires", not "attack up").
3. **Sheet** (`sheet.ts`): `images.edit` on `gpt-image-2.5-sunburst`, `quality: "high"`, 1024x1024,
   the drawing as the reference, prompt = SHEET-PROMPT.md with the nine cell descriptions and the
   count list from pass 1 substituted in. Save `sheet.png`.
4. **Normalise** `python3 forge/img/normalize.py sheet.png cells/` → `cells/*.png`, `cells/cells.json`.
   Fail the job if any cell keys to empty.
5. **Pass 2 — module** (`claude -p`, PROMPT-module.md, Read tool on the nine cells). Input: pass-1 JSON,
   `cells.json` boxes converted to fighter units (`u = height / heightPx`; x from cell centre, y from
   the feet row, +y down), the exemplar source, the api list. Output: the module source and the
   `sprite.anims` overrides, as one JSON file the agent writes with the Write tool.
6. **Checks** (`checks.ts`, tsx, imports `shared/`): every failure is a message the agent can act on.
   - `lintGeneratedSource`, `buildGenerated`, `validateGenerated` (shared/gen/load.ts)
   - determinism: 4-player CPU match (fighter + three stock), 2400 frames, resim from a snapshot at
     1200 must hash equal; zero `hookError` events
   - ladder: fighter vs each stock fighter, level 9, 2 matches each, 3-minute cap. Hard fails:
     never deals damage; any `hookError`; a match that throws. Soft (reported, not failed): 100% win
     rate with average match under 25s, or 0% with under 25s
   - recovery: scripts/botcheck.ts's recovery check, must recover 6/10
   - KO: some move kills a weight-100 dummy from centre stage under 300%
   - every move's cell exists; every anim override names a real cell
7. **Retry**: on a check failure, call pass 2 again with `--resume <session>` and the failure list,
   twice at most. Still failing → `POST /api/forge/jobs/:id/fail { error }` with the list.
8. **Complete** `POST /api/forge/jobs/:id/complete` JSON: `{ name, tagline, description, source,
   sprite: { px, feetPx, heightPx, anims }, cells: { <cell>: base64 png }, sheet: base64 png, report }`.
   The server rebuilds and validates the bundle before it serves it.

Progress strings (shown to players on the reveal screen): "reading the drawing", "designing the
moveset", "drawing the sheet", "cutting out the cells", "writing the fighter", "balance testing",
"fixing: <first failure>".

## Running it

`FORGE_TOKEN=... SITE=https://bschoolland.dev/sketch-battle OPENAI_API_KEY=... npx tsx forge/worker.ts`
under `systemd --user` (unit in `forge/forge.service`). Logs one line per step per job to stdout and
keeps every job's artefacts under `forge/runs/<jobId>/` for a post-mortem.
