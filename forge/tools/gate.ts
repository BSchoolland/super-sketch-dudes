import fs from "node:fs";
import path from "node:path";
import { buildGenerated, type GeneratedBundle } from "../../shared/gen/load";
import { runChecks, type CheckReport } from "../checks";

export interface CellsMeta { px: number; feetPx: number; heightPx: number; cells: Record<string, { box: number[] }> }

/** The bundle the game would load from this module + these cells (cell URLs are placeholders headless). */
export function bundleOf(js: string, cellsDir: string, anims: Record<string, string> = {}): { bundle: GeneratedBundle; meta: CellsMeta } {
  const meta = JSON.parse(fs.readFileSync(path.join(cellsDir, "cells.json"), "utf8")) as CellsMeta;
  const source = fs.readFileSync(js, "utf8");
  const cells = Object.fromEntries(Object.keys(meta.cells).map((c) => [c, `/gen/x/${c}.png`]));
  return { bundle: { id: "gen-candidate", player: "player", description: "", source, sprite: { px: meta.px, feetPx: meta.feetPx, heightPx: meta.heightPx, anims, cells } }, meta };
}

export async function runCheck(js: string, cellsDir: string, anims: Record<string, string> = {}): Promise<{ report: CheckReport; bundle: GeneratedBundle; meta: CellsMeta; height: number }> {
  const { bundle, meta } = bundleOf(js, cellsDir, anims);
  let height = 120;
  try { height = (await buildGenerated(bundle)).stats.height; } catch { /* the checks report the build problem */ }
  const report = await runChecks({ bundle, height });
  return { report, bundle, meta, height };
}

export function printReport(r: CheckReport): void {
  if (r.failures.length) { console.log("FAILED:"); for (const f of r.failures) console.log(`  - ${f.msg}`); }
  else console.log("OK");
  for (const s of r.soft) console.log(`  note: ${s}`);
  if (r.recovery !== null) console.log(`recovery: made it back ${r.recovery}/10`);
  const ko = Object.entries(r.killPercents).filter(([, v]) => v !== null).map(([k, v]) => `${k} ${v}%`).join(", ");
  if (ko) console.log(`KO percents vs a weight-78 dummy from centre stage: ${ko}`);
  const ladder = Object.entries(r.ladder).map(([k, v]) => `${k} ${v.wins}-${v.losses} (${v.dealtPerMatch}% dealt/match)`).join(", ");
  if (ladder) console.log(`ladder (CPU vs CPU): ${ladder}`);
  if (r.movesUsed.length) console.log(`moves the bot used: ${r.movesUsed.join(" ")}`);
}
