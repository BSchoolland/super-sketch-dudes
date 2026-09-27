# The forge

Turns a player's drawing into a fighter. Runs on Ben's machine as a worker that polls the site;
the site never calls in. One job = one character = one Opus session with full tools.

```
forge/
  worker.ts        poll loop: claim job -> runForge -> post bundle (or failure). N jobs in parallel.
  forge.ts         runForge: a git worktree per job, `claude -p` (claude-opus-5-5) on PROMPT.md, reads back payload.json
  PROMPT.md        the agent's prompt
  cli.ts           runForge on one local drawing, no server
  tools/           what the agent runs: sheet.ts, check.ts, preview.ts, deploy.ts
  sheet.ts         gpt-image-2.5-sunburst images.edit from the drawing, SHEET-PROMPT.md with the nine cell poses
  img/normalize.py sheet -> nine keyed, scaled, aligned cells + cells.json content boxes
  checks.ts        headless gate: lint/build/validate, determinism resim, ladder vs the house roster, recovery, KO
  exemplar/        the example fighters (SWORD GUY, FIRE WIZARD) the agent reads before writing its own
```

## A job

1. **Claim** `GET /api/forge/jobs/next` (header `x-forge-token`). 204 = nothing to do; poll every 2s.
   Job: `{ id, fighterId, playerName, attempts, hint }`. Download `GET /api/forge/jobs/:id/drawing.png`.
2. **Worktree** at `../forge-worktrees/<jobId>` from HEAD, `node_modules` symlinked, the drawing copied to
   `forge/work/<fighterId>/`.
3. **Agent** gets PROMPT.md and does everything with `forge/tools`:
   - `sheet.ts <drawing> <cells>` draws the 3x3 sheet and cuts it into cells (`--mirror` flips a left-facing one)
   - reads the exemplar and its cells, writes `<fighterId>.fighter.js`
   - `check.ts` runs the gate; `preview.ts` renders contact sheets of every move with the real renderer
   - `deploy.ts --name --tagline --card` re-runs the gate and writes `payload.json`, the only thing that leaves the worktree
4. **Complete** `POST /api/forge/jobs/:id/complete` with the payload: `{ name, tagline, description, card, source,
   sprite: { px, feetPx, heightPx, anims }, cells: { <cell>: base64 png }, sheet, report }`.
   The server rebuilds and validates the bundle before it serves it. No payload after 15 minutes, or the agent
   stops without deploying → `POST /api/forge/jobs/:id/fail { error }`.

Progress strings (shown to players on the reveal screen) come from the agent's tool calls: "drawing the
animation", "writing the fighter", "balance testing", "final checks and upload".

## Running it

`FORGE_TOKEN=... SITE=https://bschoolland.dev/sketch-battle OPENAI_API_KEY=... npx tsx forge/worker.ts`
under `systemd --user` (unit in `forge/forge.service`). Logs one line per tool call per job to stdout and
keeps every job's prompt, session stream, fighter, payload and cells under `forge/runs/<jobId>/`.
