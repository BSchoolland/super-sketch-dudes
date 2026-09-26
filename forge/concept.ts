import fs from "node:fs";
import { SPRITE_CELLS, type SpriteCell } from "../shared/gen/sprite";

export const ARCHETYPES = ["walker", "hopper", "floater", "roller", "blob", "swimmer", "crawler"] as const;

export interface Concept {
  name: string;
  tagline: string;
  description: string;
  counts: string[];
  archetype: (typeof ARCHETYPES)[number];
  gimmick: string;
  stats_note: string;
  moves: Record<"strike" | "gimmick" | "recovery", string>;
  /** Four lines the players read while the fight loads. */
  card: string[];
  cells: Record<SpriteCell, string>;
}
export const MOVE_KEYS = ["strike", "gimmick", "recovery"] as const;

/** Reads the pass-1 file; returns the concept or every problem with it. */
export function readConcept(file: string): { concept: Concept | null; problems: string[] } {
  if (!fs.existsSync(file)) return { concept: null, problems: [`you did not write ${file}`] };
  let j: any;
  try { j = JSON.parse(fs.readFileSync(file, "utf8")); } catch (e) { return { concept: null, problems: [`${file} is not valid JSON: ${(e as Error).message}`] }; }
  const p: string[] = [];
  for (const k of ["name", "tagline", "description", "gimmick", "stats_note"]) if (typeof j[k] !== "string" || !j[k].trim()) p.push(`"${k}" must be a non-empty string`);
  if (typeof j.name === "string" && !/^[A-Z0-9 .'!-]{3,14}$/.test(j.name)) p.push(`"name" must be ALL CAPS, 3-14 chars (got "${j.name}")`);
  if (!Array.isArray(j.counts) || !j.counts.length || j.counts.some((c: unknown) => typeof c !== "string")) p.push(`"counts" must be a non-empty array of strings`);
  if (!ARCHETYPES.includes(j.archetype)) p.push(`"archetype" must be one of ${ARCHETYPES.join(" | ")}`);
  if (!j.moves || typeof j.moves !== "object") p.push(`"moves" missing`);
  else for (const k of MOVE_KEYS) if (typeof j.moves[k] !== "string" || !j.moves[k].trim()) p.push(`"moves.${k}" must be a non-empty string (the three moves are strike, gimmick, recovery, grab)`);
  if (!Array.isArray(j.card) || j.card.length !== 3 || j.card.some((c: unknown) => typeof c !== "string" || !(c as string).trim() || (c as string).length > 60)) p.push(`"card" must be three short strings (under 60 chars each)`);
  if (!j.cells || typeof j.cells !== "object") p.push(`"cells" missing`);
  else for (const c of SPRITE_CELLS) if (typeof j.cells[c] !== "string" || !j.cells[c].trim()) p.push(`"cells.${c}" must be a non-empty string`);
  return p.length ? { concept: null, problems: p } : { concept: j as Concept, problems: [] };
}

/**
 * stats.height pass 2 must use: the cell boxes are converted to fighter units with it before the
 * module exists, so it's fixed from the concept and the idle cell's shape. Wide silhouettes (a tank,
 * a worm) get shorter so their width on stage stays in a fighter's range.
 */
export function provisionalHeight(c: Concept, idleBox: [number, number, number, number]): number {
  const base: Record<Concept["archetype"], number> = { walker: 120, hopper: 104, floater: 112, roller: 112, blob: 100, swimmer: 104, crawler: 92 };
  const note = c.stats_note.toLowerCase();
  let h = base[c.archetype];
  if (/\b(heavy|huge|big|giant|massive|tall|hulking)\b/.test(note)) h += 24;
  if (/\b(light|tiny|small|little|short|featherweight)\b/.test(note)) h -= 16;
  const aspect = (idleBox[2] - idleBox[0]) / (idleBox[3] - idleBox[1]);
  h /= Math.sqrt(Math.max(1, aspect / 0.8));
  return Math.round(Math.max(64, Math.min(160, h)));
}
