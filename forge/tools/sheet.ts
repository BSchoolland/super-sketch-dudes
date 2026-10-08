// The drawing -> nine animation cells. Usage:
//   npx tsx forge/tools/sheet.ts <drawing.png> <outdir> [--mirror] [--note "what to do differently"] [--from-drawing]
// Writes <outdir>/sheet.png, <outdir>/<cell>.png for idle walk jump atk-fwd atk-up atk-down hit launched block,
// and <outdir>/cells.json (px, feetPx, heightPx and each cell's content box). --mirror flips every cell.
// An existing sheet.png is reused; --note redraws it with that note to the image model, and --from-drawing
// replaces it with nine copies of the drawing itself (no image model).
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { loadForgeEnv } from "../env";
import { drawSheet } from "../sheet";

loadForgeEnv();
const args = process.argv.slice(2);
const mirror = args.includes("--mirror"), fromDrawing = args.includes("--from-drawing");
const noteAt = args.indexOf("--note");
const note = noteAt >= 0 ? args.splice(noteAt, 2)[1] ?? "" : "";
const [drawing, out] = args.filter((a) => !a.startsWith("--"));
if (!drawing || !out || (noteAt >= 0 && !note.trim()) || (note && fromDrawing)) {
  console.error('usage: npx tsx forge/tools/sheet.ts <drawing.png> <outdir> [--mirror] [--note "what to do differently" | --from-drawing]');
  process.exit(2);
}
fs.mkdirSync(out, { recursive: true });
const sheet = path.join(out, "sheet.png");
const t0 = Date.now();
const run = (script: string, ...a: string[]) => {
  const r = spawnSync("python3", [new URL(`../img/${script}`, import.meta.url).pathname, ...a], { encoding: "utf8" });
  if (r.status !== 0) { console.error(r.stderr || r.stdout); process.exit(1); }
};
if (fromDrawing) {
  run("tile.py", path.resolve(drawing), sheet);
  console.log(`sheet built from the drawing itself -> ${sheet}`);
} else if (note || !fs.existsSync(sheet)) {
  const ledger = process.env.FORGE_SHEET_LEDGER;
  const record = (row: object) => { if (ledger) fs.appendFileSync(ledger, JSON.stringify({ at: new Date().toISOString(), ...row }) + "\n"); };
  const r = await drawSheet(path.resolve(drawing), sheet, note).catch((e: Error) => { record({ error: e.message }); throw e; });
  record({ ms: r.ms, tokens: r.tokens, costUsd: r.costUsd });
  console.log(`sheet drawn in ${(r.ms / 1000).toFixed(0)}s -> ${sheet}`);
} else console.log(`sheet already there: ${sheet} (pass --note to redraw)`);
run("normalize.py", sheet, out, "--mirror", mirror ? "1" : "0");
const meta = JSON.parse(fs.readFileSync(path.join(out, "cells.json"), "utf8"));
console.log(`cells: ${Object.keys(meta.cells).join(" ")} (${meta.px}px, feet at row ${meta.feetPx}, idle ${meta.heightPx}px tall) in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
