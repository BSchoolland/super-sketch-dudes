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
  moves: Record<string, string>;
  cells: Record<SpriteCell, string>;
}

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
  if (!j.cells || typeof j.cells !== "object") p.push(`"cells" missing`);
  else for (const c of SPRITE_CELLS) if (typeof j.cells[c] !== "string" || !j.cells[c].trim()) p.push(`"cells.${c}" must be a non-empty string`);
  return p.length ? { concept: null, problems: p } : { concept: j as Concept, problems: [] };
}

/**
 * stats.height pass 2 must use: the cell boxes are converted to fighter units with it before the
 * module exists, so it's fixed from the concept.
 */
export function provisionalHeight(c: Concept): number {
  const base: Record<Concept["archetype"], number> = { walker: 120, hopper: 104, floater: 112, roller: 112, blob: 100, swimmer: 104, crawler: 92 };
  const note = c.stats_note.toLowerCase();
  let h = base[c.archetype];
  if (/\b(heavy|huge|big|giant|massive|tall|hulking)\b/.test(note)) h += 24;
  if (/\b(light|tiny|small|little|short|featherweight)\b/.test(note)) h -= 16;
  return Math.max(76, Math.min(160, h));
}
