// Mark where the character's body ends in the idle cell, so props drawn above it (a raised weapon, a staff,
// flames) don't count toward its size. Usage: npx tsx forge/tools/body.ts <cellsDir> [--top <row>]
// `stats.height` is drawn as `heightPx` cell pixels; sheet.ts sets heightPx to the whole idle drawing,
// --top <row> sets it to feetPx - row instead. Writes <cellsDir>/body.png with the line drawn on.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import type { CellsMeta } from "./gate";

const args = process.argv.slice(2);
const i = args.indexOf("--top");
const topArg = i >= 0 ? Number(args.splice(i, 2)[1]) : null;
const [dir] = args;
if (!dir || (topArg !== null && !Number.isInteger(topArg))) { console.error("usage: npx tsx forge/tools/body.ts <cellsDir> [--top <row>]"); process.exit(2); }
const metaFile = path.join(dir, "cells.json");
const meta = JSON.parse(fs.readFileSync(metaFile, "utf8")) as CellsMeta;
const idle = meta.cells.idle?.box;
if (!idle) { console.error(`no idle cell box in ${metaFile}`); process.exit(2); }
const inkTop = idle[1], inkH = meta.feetPx - inkTop;
if (topArg !== null) {
  if (topArg < inkTop || topArg > meta.feetPx - inkH * 0.25) {
    console.error(`--top ${topArg} is outside the idle drawing: its ink runs from row ${inkTop} to the feet at ${meta.feetPx}, and the body has to be at least a quarter of that`);
    process.exit(2);
  }
  meta.heightPx = meta.feetPx - topArg;
  fs.writeFileSync(metaFile, JSON.stringify(meta, null, 1));
}
const top = meta.feetPx - meta.heightPx;
const out = path.join(dir, "body.png");
const r = spawnSync("python3", [new URL("../img/body.py", import.meta.url).pathname, path.join(dir, "idle.png"), out, String(meta.feetPx), String(top)], { encoding: "utf8" });
if (r.status !== 0) { console.error(r.stderr); process.exit(1); }
console.log(`body: rows ${top}..${meta.feetPx} (${meta.heightPx}px = stats.height); the idle ink starts at row ${inkTop}${top > inkTop ? `, so ${top - inkTop}px above the body is a prop` : ""} -> ${out}`);
