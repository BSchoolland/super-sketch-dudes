// The drawing -> nine animation cells. Usage: npx tsx forge/tools/sheet.ts <drawing.png> <outdir> [--mirror]
// Writes <outdir>/sheet.png, <outdir>/<cell>.png for idle walk jump atk-fwd atk-up atk-down hit launched block,
// and <outdir>/cells.json (px, feetPx, heightPx and each cell's content box). --mirror flips every cell.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { loadForgeEnv } from "../env";
import { drawSheet } from "../sheet";

loadForgeEnv();
const args = process.argv.slice(2);
const mirror = args.includes("--mirror");
const [drawing, out] = args.filter((a) => !a.startsWith("--"));
if (!drawing || !out) { console.error("usage: npx tsx forge/tools/sheet.ts <drawing.png> <outdir> [--mirror]"); process.exit(2); }
fs.mkdirSync(out, { recursive: true });
const sheet = path.join(out, "sheet.png");
const t0 = Date.now();
if (!fs.existsSync(sheet)) {
  const r = await drawSheet(path.resolve(drawing), null, sheet);
  console.log(`sheet drawn in ${(r.ms / 1000).toFixed(0)}s -> ${sheet}`);
} else console.log(`sheet already there: ${sheet} (delete it to redraw)`);
const norm = spawnSync("python3", [new URL("../img/normalize.py", import.meta.url).pathname, sheet, out, "--mirror", mirror ? "1" : "0"], { encoding: "utf8" });
if (norm.status !== 0) { console.error(norm.stderr || norm.stdout); process.exit(1); }
const meta = JSON.parse(fs.readFileSync(path.join(out, "cells.json"), "utf8"));
console.log(`cells: ${Object.keys(meta.cells).join(" ")} (${meta.px}px, feet at row ${meta.feetPx}, idle ${meta.heightPx}px tall) in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
