// Runs the whole forge pipeline on one drawing, no server.
// Usage: npx tsx forge/cli.ts <drawing.png> <outdir> [--name Player] [--url /sketch-battle/gen-test]
// Writes <outdir>/bundle.json (cell URLs under --url/cells), cells/, sheet.png, report.json.
import fs from "node:fs";
import path from "node:path";
import { loadForgeEnv } from "./env";
import { runPipeline, bundleFor, type JobSpec } from "./pipeline";
import { runV2 } from "./v2";

loadForgeEnv();
const args = process.argv.slice(2);
const opt = (k: string, d: string) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args.splice(i, 2)[1] : d; };
const player = opt("name", "Player");
const url = opt("url", "/sketch-battle/gen-test").replace(/\/$/, "");
const forge = opt("forge", "v1") as "v1" | "v2";
const hintName = opt("hint-name", ""), hintDesc = opt("hint-desc", "");
const [drawing, out] = args;
if (!drawing || !out) { console.error("usage: npx tsx forge/cli.ts <drawing.png> <outdir> [--name Player] [--url /base]"); process.exit(2); }

const slug = path.basename(drawing, ".png").toLowerCase().replace(/^in-/, "").replace(/[^a-z0-9]+/g, "-");
const job: JobSpec = { id: `cli-${slug}-${forge}`, fighterId: `gen-${slug}`, playerName: player, round: 1, siblings: [], forge, hint: hintName || hintDesc ? { name: hintName, description: hintDesc } : null };
const dir = path.resolve(out);
const t0 = Date.now();
const log = (line: string) => console.log(`${new Date().toISOString().slice(11, 19)} [${job.fighterId}] ${line}`);
try {
  const payload = await (forge === "v2" ? runV2 : runPipeline)(job, drawing, dir, { progress: async (s) => log(`> ${s}`), log });
  const meta = JSON.parse(fs.readFileSync(path.join(dir, "cells/cells.json"), "utf8"));
  const concept = fs.existsSync(path.join(dir, "concept.json")) ? JSON.parse(fs.readFileSync(path.join(dir, "concept.json"), "utf8")) : { description: payload.description };
  fs.writeFileSync(path.join(dir, "bundle.json"), JSON.stringify(bundleFor(job, concept, payload.source, payload.sprite.anims, meta, `${url}/cells`)));
  const r = payload.report;
  log(`DONE ${payload.name}: "${payload.tagline}"`);
  log(`wall ${((Date.now() - t0) / 1000).toFixed(0)}s | ${Object.entries(r.timings).map(([k, v]) => `${k} ${(v / 1000).toFixed(1)}s`).join(", ")}`);
  log(`cost $${r.costUsd.toFixed(2)} (agent $${r.agent.costUsd.toFixed(2)} over ${r.agent.calls.length} calls, sheet ~$${(r.sheet.costUsd ?? NaN).toFixed(2)})`);
  if (r.checks) log(`ladder ${Object.entries(r.checks.ladder).map(([k, v]) => `${k} ${v.wins}-${v.losses}`).join(", ")} | recovery ${r.checks.recovery}/10 | tries ${r.attempts.length}`);
} catch (e) {
  log(`FAILED after ${((Date.now() - t0) / 1000).toFixed(0)}s: ${e instanceof Error ? e.stack : e}`);
  process.exit(1);
}
