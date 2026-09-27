import type { FighterDef, Pose } from "../../../shared/types";
import { PAPER, PENCIL } from "./paper";
import { roster } from "../../../shared/fighters/index";
import { drawHealth } from "./health";

/**
 * Drawn fighters: one image per sheet cell, tinted variants built once. Cells are square PNGs
 * with the character facing right, feet on row `feetPx`; `heightPx` of image maps onto
 * `stats.height` world units so every cell shares one scale (see SpriteRig).
 */
export interface CellImages {
  base: HTMLImageElement | null; flash: HTMLCanvasElement | null; ghost: HTMLCanvasElement | null; failed: boolean;
  /** Where the ink is, in cell pixels: [x0, y0, x1, y1]. */
  bounds: [number, number, number, number] | null;
}
const cache = new Map<string, CellImages>();

function tinted(img: HTMLImageElement, color: string): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = img.naturalWidth; c.height = img.naturalHeight;
  const g = c.getContext("2d")!;
  g.drawImage(img, 0, 0);
  g.globalCompositeOperation = "source-in";
  g.fillStyle = color; g.fillRect(0, 0, c.width, c.height);
  return c;
}

function inkBounds(img: HTMLImageElement): [number, number, number, number] {
  const c = document.createElement("canvas");
  c.width = img.naturalWidth; c.height = img.naturalHeight;
  const g = c.getContext("2d", { willReadFrequently: true })!;
  g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, c.width, c.height).data;
  let x0 = c.width, y0 = c.height, x1 = -1, y1 = -1;
  for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
    // background removal leaves a faint halo around some drawings: only solid ink counts
    if (d[(y * c.width + x) * 4 + 3] < 96) continue;
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return x1 < 0 ? [0, 0, c.width, c.height] : [x0, y0, x1 + 1, y1 + 1];
}

export function cellImages(url: string): CellImages {
  let e = cache.get(url);
  if (e) return e;
  e = { base: null, flash: null, ghost: null, failed: false, bounds: null };
  cache.set(url, e);
  const img = new Image();
  img.onload = () => { e!.base = img; e!.flash = tinted(img, "#ffffff"); e!.ghost = tinted(img, PENCIL); e!.bounds = inkBounds(img); };
  img.onerror = () => { e!.failed = true; drawHealth.failedCells.add(url); console.error(`sprite cell failed to load: ${url}`); };
  img.src = url;
  return e;
}

/** Start loading every cell so the first frame of a match doesn't draw blanks. Resolves when all have loaded or failed. */
export function preloadSprite(def: FighterDef): Promise<void> {
  const urls = Object.values(def.sprite.cells);
  return new Promise((resolve) => {
    const check = () => { if (urls.every((u) => { const e = cellImages(u); return e.base || e.failed; })) resolve(); else setTimeout(check, 30); };
    check();
  });
}

/** Cells a fighter stands in: drawn on their own ink bottom, since generated cells don't all put the feet on the sheet's feet line. */
const STANDING_CELLS = new Set(["idle", "walk", "hit", "block"]);

/** The cell row the fighter's feet (its position) sit on. */
function feetRow(def: FighterDef, cell: string, e: CellImages): number {
  return STANDING_CELLS.has(cell) && e.bounds ? e.bounds[3] : def.sprite.feetPx;
}

/** Animations drawn lying on the floor rather than standing on it. */
export const FLOOR_ANIMS = new Set(["knockdown", "roll"]);

/**
 * The pose with its offset replaced so the rotated, scaled drawing rests on the floor, centred
 * on the fighter: a downed body lies across its position instead of pivoting into the ground.
 */
export function restOnFloor(def: FighterDef, cell: string, pose: Pose): Pose {
  const sp = def.sprite;
  const e = cellImages(sp.cells[cell] ?? sp.cells.idle);
  const b = e.bounds;
  if (!b) return pose;
  const feet = feetRow(def, cell, e);
  const u = (roster[def.id] ?? def).stats.height / sp.heightPx;
  const sx = pose.sx ?? 1, sy = pose.sy ?? 1, a = -((pose.rot ?? 0) * Math.PI) / 180;
  const cos = Math.cos(a), sin = Math.sin(a);
  let minX = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [px, py] of [[b[0], b[1]], [b[2], b[1]], [b[0], b[3]], [b[2], b[3]]]) {
    const x = (px - sp.px / 2) * u * sx, y = (py - feet) * u * sy;
    const rx = x * cos - y * sin, ry = x * sin + y * cos;
    minX = Math.min(minX, rx); maxX = Math.max(maxX, rx); maxY = Math.max(maxY, ry);
  }
  return { ...pose, dx: -(minX + maxX) / 2, dy: -maxY };
}

/** Fighters drawn as their idle cell whatever they're doing (the practice dummy); the state poses' leans still apply. */
export const stillSprites = new Set<string>();

/** `spinAround: "middle"` turns the lean about the body's middle instead of its feet (airborne: tumbling, launched). */
export interface SpriteDrawOpts { alpha?: number; flash?: boolean; ghost?: boolean; flip?: boolean; spinAround?: "feet" | "middle" }

/**
 * Draws one cell in fighter space (+x facing, +y down, feet at the origin) with the pose's
 * squash, stretch, offset and lean applied about the feet.
 */
export function drawSprite(ctx: CanvasRenderingContext2D, def: FighterDef, cell: string, pose: Pose, opts: SpriteDrawOpts = {}): void {
  const sp = def.sprite;
  const url = stillSprites.has(def.id) ? sp.cells.idle : sp.cells[cell] ?? sp.cells.idle;
  const e = cellImages(url);
  const u = (roster[def.id] ?? def).stats.height / sp.heightPx;
  ctx.save();
  if (opts.alpha !== undefined) ctx.globalAlpha *= opts.alpha;
  ctx.translate(pose.dx ?? 0, pose.dy ?? 0);
  if (pose.rot) {
    const mid = opts.spinAround === "middle" ? (roster[def.id] ?? def).stats.height / 2 : 0;
    ctx.translate(0, -mid);
    ctx.rotate(-(pose.rot * Math.PI) / 180);
    ctx.translate(0, mid);
  }
  ctx.scale(pose.sx ?? 1, pose.sy ?? 1);
  if (opts.flip) ctx.scale(-1, 1);
  const img = opts.ghost ? e.ghost : opts.flash ? e.flash : e.base;
  drawHealth.sprites++;
  if (!img) e.failed ? drawHealth.failed++ : drawHealth.loading++;
  if (img) ctx.drawImage(img, -sp.px / 2 * u, -feetRow(def, stillSprites.has(def.id) ? "idle" : cell, e) * u, sp.px * u, sp.px * u);
  else if (!e.failed) {
    // still loading: a faint paper placeholder the size of the fighter
    ctx.globalAlpha *= 0.25; ctx.fillStyle = PAPER; ctx.strokeStyle = PENCIL; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.roundRect(-def.stats.width / 2, -def.stats.height, def.stats.width, def.stats.height, 12); ctx.fill(); ctx.stroke();
  }
  ctx.restore();
}
