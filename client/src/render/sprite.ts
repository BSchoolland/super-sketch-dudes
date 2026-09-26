import type { FighterDef, Pose } from "../../../shared/types";
import { PAPER, PENCIL } from "./paper";
import { roster } from "../../../shared/fighters/index";

/**
 * Drawn fighters: one image per sheet cell, tinted variants built once. Cells are square PNGs
 * with the character facing right, feet on row `feetPx`; `heightPx` of image maps onto
 * `stats.height` world units so every cell shares one scale (see SpriteRig).
 */
interface CellImages { base: HTMLImageElement | null; flash: HTMLCanvasElement | null; ghost: HTMLCanvasElement | null; failed: boolean }
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

function load(url: string): CellImages {
  let e = cache.get(url);
  if (e) return e;
  e = { base: null, flash: null, ghost: null, failed: false };
  cache.set(url, e);
  const img = new Image();
  img.onload = () => { e!.base = img; e!.flash = tinted(img, "#ffffff"); e!.ghost = tinted(img, PENCIL); };
  img.onerror = () => { e!.failed = true; console.error(`sprite cell failed to load: ${url}`); };
  img.src = url;
  return e;
}

/** Start loading every cell so the first frame of a match doesn't draw blanks. Resolves when all have loaded or failed. */
export function preloadSprite(def: FighterDef): Promise<void> {
  if (!def.sprite) return Promise.resolve();
  const urls = Object.values(def.sprite.cells);
  return new Promise((resolve) => {
    const check = () => { if (urls.every((u) => { const e = load(u); return e.base || e.failed; })) resolve(); else setTimeout(check, 30); };
    check();
  });
}

export interface SpriteDrawOpts { alpha?: number; flash?: boolean; ghost?: boolean; flip?: boolean }

/**
 * Draws one cell in fighter space (+x facing, +y down, feet at the origin) with the pose's
 * squash, stretch, offset and lean applied about the feet.
 */
export function drawSprite(ctx: CanvasRenderingContext2D, def: FighterDef, cell: string, pose: Pose, opts: SpriteDrawOpts = {}): void {
  const sp = def.sprite;
  if (!sp) throw new Error(`${def.id} has no sprite`);
  const url = sp.cells[cell] ?? sp.cells.idle;
  const e = load(url);
  const u = (roster[def.id] ?? def).stats.height / sp.heightPx;
  ctx.save();
  if (opts.alpha !== undefined) ctx.globalAlpha *= opts.alpha;
  ctx.translate(pose.dx ?? 0, pose.dy ?? 0);
  if (pose.rot) ctx.rotate(-(pose.rot * Math.PI) / 180);
  ctx.scale(pose.sx ?? 1, pose.sy ?? 1);
  if (opts.flip) ctx.scale(-1, 1);
  const img = opts.ghost ? e.ghost : opts.flash ? e.flash : e.base;
  if (img) ctx.drawImage(img, -sp.px / 2 * u, -sp.feetPx * u, sp.px * u, sp.px * u);
  else if (!e.failed) {
    // still loading: a faint paper placeholder the size of the fighter
    ctx.globalAlpha *= 0.25; ctx.fillStyle = PAPER; ctx.strokeStyle = PENCIL; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.roundRect(-def.stats.width / 2, -def.stats.height, def.stats.width, def.stats.height, 12); ctx.fill(); ctx.stroke();
  }
  ctx.restore();
}
