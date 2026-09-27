// Runs the forge on one drawing, no server.
// Usage: npx tsx forge/cli.ts <drawing.png> <outdir> [--name Player] [--url /sketch-battle/gen-test] [--hint-name N] [--hint-desc D]
// Writes <outdir>/bundle.json (cell URLs under --url/cells), cells/, payload.json, report.json.
import fs from "node:fs";
import path from "node:path";
import { SPRITE_CELLS } from "../shared/gen/sprite";
import type { GeneratedBundle } from "../shared/gen/load";
import { loadForgeEnv } from "./env";
import { runForge, type JobSpec } from "./forge";

loadForgeEnv();
const args = process.argv.slice(2);
const opt = (k: string, d: string) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args.splice(i, 2)[1] : d; };
const player = opt("name", "Player");
const url = opt("url", "/sketch-battle/gen-test").replace(/\/$/, "");
const hintName = opt("hint-name", ""), hintDesc = opt("hint-desc", "");
const [drawing, out] = args;
if (!drawing || !out) { console.error("usage: npx tsx forge/cli.ts <drawing.png> <outdir> [--name Player] [--url /base]"); process.exit(2); }

const slug = path.basename(drawing, ".png").toLowerCase().replace(/^in-/, "").replace(/[^a-z0-9]+/g, "-");
const job: JobSpec = { id: `cli-${slug}`, fighterId: `gen-${slug}`, playerName: player, hint: hintName || hintDesc ? { name: hintName, description: hintDesc } : null };
const dir = path.resolve(out);
const t0 = Date.now();
const log = (line: string) => console.log(`${new Date().toISOString().slice(11, 19)} [${job.fighterId}] ${line}`);
try {
  const payload = await runForge(job, drawing, dir, { progress: async (s) => log(`> ${s}`), log });
  const bundle: GeneratedBundle = {
    id: job.fighterId, player, description: payload.description, source: payload.source,
    sprite: { ...payload.sprite, cells: Object.fromEntries(SPRITE_CELLS.map((c) => [c, `${url}/cells/${c}.png`])) },
  };
  fs.writeFileSync(path.join(dir, "bundle.json"), JSON.stringify(bundle));
  const r = payload.report;
  log(`DONE ${payload.name}: "${payload.tagline}"`);
  log(`wall ${((Date.now() - t0) / 1000).toFixed(0)}s | agent $${r.costUsd.toFixed(2)}`);
  if (r.checks) log(`ladder ${Object.entries(r.checks.ladder).map(([k, v]) => `${k} ${v.wins}-${v.losses}`).join(", ")} | recovery ${r.checks.recovery}/10`);
} catch (e) {
  log(`FAILED after ${((Date.now() - t0) / 1000).toFixed(0)}s: ${e instanceof Error ? e.stack : e}`);
  process.exit(1);
}
