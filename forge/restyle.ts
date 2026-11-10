// Restyle: an existing fighter's attacks redrawn with draws, its gameplay untouched. One Opus session in its own
// worktree on RESTYLE-PROMPT.md; the result is kept only if it plays exactly like the original (same-game.ts).
// Usage: npx tsx forge/restyle.ts <bundle.json | fighter.js cellsDir> <outdir>
// Writes <outdir>/fighter.js, cells/, meta.json (from a bundle: what scripts/house-roster.mjs packs) and report.json.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadForgeEnv } from "./env";
import { makeWorktree, removeWorktree, runAgent } from "./forge";
import { bundleOf } from "./tools/gate";
import { sameGame } from "./same-game";

loadForgeEnv();
const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const fromBundle = args[0]?.endsWith("bundle.json");
const [src, cellsArg, outArg] = fromBundle ? [args[0], path.dirname(args[0]), args[1]] : args;
if (!src || !cellsArg || !outArg) { console.error("usage: npx tsx forge/restyle.ts <bundle.json | fighter.js cellsDir> <outdir>"); process.exit(2); }
const out = path.resolve(outArg);
const bundle = fromBundle ? JSON.parse(fs.readFileSync(src, "utf8")) : null;
const source: string = bundle ? bundle.source : fs.readFileSync(src, "utf8");
const id: string = bundle?.id ?? path.basename(src).replace(/\.fighter\.js$|\.js$/, "");
const name: string = bundle?.name ?? id.toUpperCase();

const t0 = Date.now();
const log = (line: string) => console.log(`${new Date().toISOString().slice(11, 19)} [restyle ${id}] ${line}`);
fs.mkdirSync(out, { recursive: true });
const wt = makeWorktree(`restyle-${id}`);
const work = path.join(wt, "forge", "work", id);
const cells = path.join(work, "cells");
fs.mkdirSync(cells, { recursive: true });
fs.writeFileSync(path.join(work, "original.fighter.js"), source);
fs.writeFileSync(path.join(work, `${id}.fighter.js`), source);
for (const f of fs.readdirSync(cellsArg)) if (f.endsWith(".png") || f === "cells.json") fs.copyFileSync(path.join(cellsArg, f), path.join(cells, f));
const rel = (p: string) => path.relative(wt, p);
const prompt = fs.readFileSync(path.join(here, "RESTYLE-PROMPT.md"), "utf8").replace(/\{\{WORK\}\}/g, rel(work)).replace(/\{\{ID\}\}/g, id).replace(/\{\{NAME\}\}/g, name);
fs.writeFileSync(path.join(out, "prompt.txt"), prompt);

const result = await runAgent(wt, prompt, out, { progress: async (s) => log(`> ${s}`), log }, () => false);
const restyled = fs.readFileSync(path.join(work, `${id}.fighter.js`), "utf8");
if (restyled === source) throw new Error("the agent finished without changing the fighter");
const problems = await sameGame(bundleOf(path.join(work, "original.fighter.js"), cells).bundle, bundleOf(path.join(work, `${id}.fighter.js`), cells).bundle);
if (problems.length) throw new Error(`the restyle plays differently, so it's discarded:\n  ${problems.join("\n  ")}`);

fs.writeFileSync(path.join(out, "fighter.js"), restyled);
fs.cpSync(cells, path.join(out, "cells"), { recursive: true });
if (bundle) fs.writeFileSync(path.join(out, "meta.json"), JSON.stringify({ name: bundle.name, tagline: bundle.tagline, description: bundle.description, card: bundle.card, anims: bundle.sprite?.anims ?? {} }));
fs.writeFileSync(path.join(out, "agent-final.txt"), result.text);
const wallMs = Date.now() - t0;
fs.writeFileSync(path.join(out, "report.json"), JSON.stringify({ id, wallMs, costUsd: result.costUsd, sessionId: result.sessionId }, null, 1));
removeWorktree(wt);
log(`DONE: plays the same; wall ${(wallMs / 1000).toFixed(0)}s | agent $${result.costUsd.toFixed(2)}`);
