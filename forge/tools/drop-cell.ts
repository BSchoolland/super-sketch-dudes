// Throw out a bad cell: its image becomes a copy of a good one, and the full sheet is deleted so the bad art
// isn't uploaded with the fighter. Usage: npx tsx forge/tools/drop-cell.ts <cellsDir> <bad cell> <good cell>
import fs from "node:fs";
import path from "node:path";
import type { CellsMeta } from "./gate";

const [dir, bad, good] = process.argv.slice(2);
if (!dir || !bad || !good || bad === good) { console.error("usage: npx tsx forge/tools/drop-cell.ts <cellsDir> <bad cell> <good cell>"); process.exit(2); }
const metaFile = path.join(dir, "cells.json");
const meta = JSON.parse(fs.readFileSync(metaFile, "utf8")) as CellsMeta;
for (const c of [bad, good]) if (!meta.cells[c]) { console.error(`no cell "${c}" in ${metaFile} (${Object.keys(meta.cells).join(" ")})`); process.exit(2); }
fs.copyFileSync(path.join(dir, `${good}.png`), path.join(dir, `${bad}.png`));
meta.cells[bad] = { ...meta.cells[good] };
fs.writeFileSync(metaFile, JSON.stringify(meta, null, 1));
fs.rmSync(path.join(dir, "sheet.png"), { force: true });
console.log(`${bad} is now a copy of ${good}; sheet.png deleted, so it won't be uploaded`);
