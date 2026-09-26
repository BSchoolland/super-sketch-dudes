import fs from "node:fs";
import { SPRITE_CELLS } from "../shared/gen/sprite";
import type { Concept } from "./concept";

const read = (f: string) => fs.readFileSync(new URL(f, import.meta.url), "utf8");
const CONCEPT = read("./PROMPT-concept.md");
const MODULE = read("./PROMPT-module.md");
const EXEMPLAR = read("./exemplar/lampjack.fighter.js");

function fill(template: string, vars: Record<string, string>): string {
  const out = template.replace(/\{\{([A-Z_]+)\}\}/g, (m, k) => {
    if (!(k in vars)) throw new Error(`prompt placeholder ${m} has no value`);
    return vars[k];
  });
  return out;
}

export function conceptPrompt(o: { drawing: string; out: string; player: string; round: number; siblings: string[] }): string {
  return fill(CONCEPT, {
    DRAWING: o.drawing,
    PLAYER: o.player,
    ROUND: `#${o.round}`,
    SIBLINGS: o.siblings.length ? o.siblings.join(", ") : "none yet",
    OUT: o.out,
  });
}

export interface CellsMeta { px: number; feetPx: number; heightPx: number; cells: Record<string, { box: [number, number, number, number] }> }

export function modulePrompt(o: { concept: Concept; cellsDir: string; meta: CellsMeta; height: number; out: string }): string {
  const { meta, height } = o;
  const u = height / meta.heightPx;
  const half = meta.px / 2;
  const boxes = SPRITE_CELLS.map((c) => {
    const [x1, y1, x2, y2] = meta.cells[c].box;
    const f = (v: number) => Math.round(v * u);
    return `- ${c}: [${f(x1 - half)}, ${f(y1 - meta.feetPx)}, ${f(x2 - half)}, ${f(y2 - meta.feetPx)}]`;
  }).join("\n");
  const src = fill(MODULE, {
    CELLS_DIR: o.cellsDir,
    U: u.toFixed(4),
    HEIGHT: String(height),
    HEIGHT_PX: String(meta.heightPx),
    BOXES: `${boxes}\nUse exactly stats.height = ${height}: the renderer scales the cells by stats.height / heightPx, so these boxes only line up with your hitboxes at that height.`,
    CONCEPT: JSON.stringify(o.concept, null, 1),
    EXEMPLAR,
    OUT: o.out,
    FEEDBACK: "",
  });
  return src.replace(/\n+$/, "\n");
}

export function feedbackPrompt(failures: string[], out: string): string {
  return `The headless checks rejected your fighter. Fix every item below, then Write the whole JSON file to ${out} again (same shape, the complete module source, not a diff).\n\n${failures.map((f) => `- ${f}`).join("\n")}\n`;
}

export function conceptFeedbackPrompt(problems: string[], out: string): string {
  return `The concept file is not usable yet. Fix these and Write the whole JSON to ${out} again:\n\n${problems.map((p) => `- ${p}`).join("\n")}\n`;
}

export function facingPrompt(cellsDir: string, out: string): string {
  return `The image model has drawn your design as nine cells. Read ${cellsDir}/idle.png and ${cellsDir}/atk-fwd.png with the Read tool. The game needs the character facing RIGHT: its front (face, eye, mouth, barrel, whatever leads when it walks and attacks forward) toward the right edge of the image. Which way does it face in these cells? Write ONE JSON file to ${out} with the Write tool: {"faces": "right"} or {"faces": "left"}. Nothing else.\n`;
}
