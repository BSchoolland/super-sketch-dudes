// The drawing -> nine animation cells. Usage:
//   npx tsx forge/tools/sheet.ts <drawing.png> <outdir> [--mirror] [--note "what to do differently"] [--from-drawing] [--from-rig rig.json]
// Writes <outdir>/sheet.png, <outdir>/<cell>.png for idle walk jump atk-fwd atk-up atk-down hit launched block,
// and <outdir>/cells.json (px, feetPx, heightPx and each cell's content box). --mirror flips every cell.
// An existing sheet.png is reused; --note redraws it with that note to the image model, and --from-drawing
// replaces it with nine copies of the drawing itself (no image model). --from-rig cuts the drawing into the parts
// rig.json outlines and poses them nine ways (see forge/img/rig.py); it also writes <outdir>/rig-parts.png showing the cut.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { loadForgeEnv } from "../env";
import { drawSheet } from "../sheet";

loadForgeEnv();
const args = process.argv.slice(2);
const mirror = args.includes("--mirror"), fromDrawing = args.includes("--from-drawing");
const rigAt = args.indexOf("--from-rig");
const rig = rigAt >= 0 ? args.splice(rigAt, 2)[1] ?? "" : "";
const noteAt = args.indexOf("--note");
const note = noteAt >= 0 ? args.splice(noteAt, 2)[1] ?? "" : "";
const [drawing, out] = args.filter((a) => !a.startsWith("--"));
if (!drawing || !out || (noteAt >= 0 && !note.trim()) || (rigAt >= 0 && !rig) || [note, fromDrawing, rig].filter(Boolean).length > 1) {
  console.error('usage: npx tsx forge/tools/sheet.ts <drawing.png> <outdir> [--mirror] [--note "what to do differently" | --from-drawing | --from-rig rig.json]');
  process.exit(2);
}
fs.mkdirSync(out, { recursive: true });
const sheet = path.join(out, "sheet.png");
const t0 = Date.now();
const run = (script: string, ...a: string[]) => {
  const r = spawnSync("python3", [new URL(`../img/${script}`, import.meta.url).pathname, ...a], { encoding: "utf8" });
  if (r.status !== 0) { console.error(r.stderr || r.stdout); process.exit(1); }
};
// an earlier sheet is kept beside the new one (never uploaded) so the run shows what was rejected
if ((fromDrawing || note || rig) && fs.existsSync(sheet)) {
  let n = 1;
  while (fs.existsSync(path.join(out, `rejected-sheet-${n}.png`))) n++;
  fs.renameSync(sheet, path.join(out, `rejected-sheet-${n}.png`));
}
if (fromDrawing) {
  run("tile.py", path.resolve(drawing), sheet);
  console.log(`sheet built from the drawing itself -> ${sheet}`);
} else if (rig) {
  run("rig.py", path.resolve(drawing), path.resolve(rig), sheet, path.join(out, "rig-parts.png"));
  console.log(`sheet posed from the rig -> ${sheet} (the cut: ${path.join(out, "rig-parts.png")})`);
} else if (note || !fs.existsSync(sheet)) {
  const ledger = process.env.FORGE_SHEET_LEDGER;
  const record = (row: object) => { if (ledger) fs.appendFileSync(ledger, JSON.stringify({ at: new Date().toISOString(), ...row }) + "\n"); };
  const r = await drawSheet(path.resolve(drawing), sheet, note).catch((e: Error & { code?: string }) => {
    record({ error: e.message });
    if (e.code === "moderation_blocked") {
      console.error("The image model's safety system refused to draw this character (moderation_blocked). It refuses the same drawing again, note or not: don't retry. Rig the drawing instead (--from-rig), or --from-drawing if it has nothing to move.");
      process.exit(3);
    }
    throw e;
  });
  record({ backend: r.backend, codexError: r.codexError, ms: r.ms, tokens: r.tokens, costUsd: r.costUsd });
  console.log(`sheet drawn in ${(r.ms / 1000).toFixed(0)}s -> ${sheet}`);
} else console.log(`sheet already there: ${sheet} (pass --note to redraw)`);
run("normalize.py", sheet, out, "--mirror", mirror ? "1" : "0");
const meta = JSON.parse(fs.readFileSync(path.join(out, "cells.json"), "utf8"));
console.log(`cells: ${Object.keys(meta.cells).join(" ")} (${meta.px}px, feet at row ${meta.feetPx}, idle ${meta.heightPx}px tall) in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
