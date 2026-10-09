import type { FighterDef, Pose } from "../../../shared/types";
import { PAPER, PENCIL } from "./paper";
import { roster } from "../../../shared/fighters/index";
import { drawHealth } from "./health";

/**
 * Drawn fighters: one image per sheet cell, tinted variants built once. Cells are square PNGs
 * with the character facing right, feet on row `feetPx`; `heightPx` of image maps onto
 * `stats.height` world units so every cell shares one scale (see SpriteRig).
 * The drawn copies are resampled to the size they appear on screen: a 768px cell shown 200px tall
 * costs a slow machine its frame rate and a small one its memory, three variants per cell.
 */
export interface CellImages {
  src: HTMLImageElement | null;
  base: HTMLCanvasElement | null; flash: HTMLCanvasElement | null; ghost: HTMLCanvasElement | null; failed: boolean;
  /** Pixel size of base/flash/ghost; the source's natural size is the cap. */
  size: number;
  /** Where the ink is, in cell pixels: [x0, y0, x1, y1]. */
  bounds: [number, number, number, number] | null;
  /** The drawing on its paper cut-out (see paperCard), at `size`; the cut-out alone is built once. */
  card: { paper: HTMLCanvasElement; pad: number; onCard: HTMLCanvasElement | null; size: number } | null;
}
const cache = new Map<string, CellImages>();

/** Canvas pixels per world unit at the camera's closest zoom; the app sets it on every resize. */
let pixelsPerUnit = 1.25;
export function setSpriteScale(canvasScale: number): void { pixelsPerUnit = canvasScale * 1.25; }

function resampled(img: HTMLImageElement, size: number, tint: string | null): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d")!;
  g.imageSmoothingQuality = "high";
  g.drawImage(img, 0, 0, size, size);
  if (tint) {
    g.globalCompositeOperation = "source-in";
    g.fillStyle = tint; g.fillRect(0, 0, size, size);
  }
  return c;
}

function ensureSize(e: CellImages, size: number): void {
  if (!e.src || e.size === size) return;
  e.size = size;
  e.base = resampled(e.src, size, null);
  // flash and ghost show for a few frames at a time: half size is plenty
  e.flash = resampled(e.src, Math.ceil(size / 2), "#ffffff");
  e.ghost = resampled(e.src, Math.ceil(size / 2), PENCIL);
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
  e = { src: null, base: null, flash: null, ghost: null, failed: false, size: 0, bounds: null, card: null };
  cache.set(url, e);
  const img = new Image();
  img.onload = () => { e!.bounds = inkBounds(img); e!.src = img; ensureSize(e!, Math.min(img.naturalWidth, 256)); };
  img.onerror = () => { e!.failed = true; drawHealth.failedCells.add(url); console.error(`sprite cell failed to load: ${url}`); };
  img.src = url;
  return e;
}

/** How far the paper cut-out reaches past the ink, in cell pixels per 512, and the resolution it is cut at. */
const CARD_RIM = 9, CARD_PX = 256;

/** Chamfer distance transform in place: every cell becomes its distance (pixels) to the nearest 0. */
function chamfer(dist: Float32Array, W: number, H: number): void {
  const D = Math.SQRT2;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    let v = dist[i];
    if (x > 0) v = Math.min(v, dist[i - 1] + 1);
    if (y > 0) {
      v = Math.min(v, dist[i - W] + 1);
      if (x > 0) v = Math.min(v, dist[i - W - 1] + D);
      if (x < W - 1) v = Math.min(v, dist[i - W + 1] + D);
    }
    dist[i] = v;
  }
  for (let y = H - 1; y >= 0; y--) for (let x = W - 1; x >= 0; x--) {
    const i = y * W + x;
    let v = dist[i];
    if (x < W - 1) v = Math.min(v, dist[i + 1] + 1);
    if (y < H - 1) {
      v = Math.min(v, dist[i + W] + 1);
      if (x < W - 1) v = Math.min(v, dist[i + W + 1] + D);
      if (x > 0) v = Math.min(v, dist[i + W - 1] + D);
    }
    dist[i] = v;
  }
}

/** What is reachable from the border without coming within `grow` of the ink (`dist`: distance to ink). */
function outsideOf(dist: Float32Array, W: number, H: number, grow: number): Uint8Array {
  const outside = new Uint8Array(W * H);
  const queue = new Int32Array(W * H);
  let head = 0, tail = 0;
  const visit = (i: number) => { if (!outside[i] && dist[i] > grow) { outside[i] = 1; queue[tail++] = i; } };
  for (let x = 0; x < W; x++) { visit(x); visit((H - 1) * W + x); }
  for (let y = 0; y < H; y++) { visit(y * W); visit(y * W + W - 1); }
  while (head < tail) {
    const i = queue[head++], x = i % W;
    if (x > 0) visit(i - 1);
    if (x < W - 1) visit(i + 1);
    if (i >= W) visit(i - W);
    if (i < W * (H - 1)) visit(i + W);
  }
  return outside;
}

/**
 * The cell's paper cut-out, so a drawing stays readable on a busy art stage: the ink grown by CARD_RIM with its
 * enclosed holes filled, in the paper colour, soft-edged. Cut once at CARD_PX from the source; growing before
 * filling closes the small gaps in a sketchy outline.
 */
function paperCard(src: HTMLImageElement): { paper: HTMLCanvasElement; pad: number } {
  const n = Math.min(CARD_PX, src.naturalWidth), q = n / src.naturalWidth;
  const rim = CARD_RIM * src.naturalWidth / 512 * q, pad = Math.ceil(rim + 2);
  const W = n + 2 * pad;
  const c = document.createElement("canvas");
  c.width = c.height = W;
  const g = c.getContext("2d", { willReadFrequently: true })!;
  g.drawImage(src, pad, pad, n, n);
  const img = g.getImageData(0, 0, W, W), px = img.data;
  const dist = new Float32Array(W * W);
  for (let i = 0; i < W * W; i++) dist[i] = px[i * 4 + 3] >= 64 ? 0 : 1e9;
  chamfer(dist, W, W);
  const outside = outsideOf(dist, W, W, rim);
  for (let i = 0; i < W * W; i++) {
    const a = outside[i] ? Math.max(0, Math.min(1, rim + 0.5 - dist[i])) : 1;
    px[i * 4] = 0xf4; px[i * 4 + 1] = 0xef; px[i * 4 + 2] = 0xe4; px[i * 4 + 3] = Math.round(a * 255);
  }
  g.putImageData(img, 0, 0);
  return { paper: c, pad: pad / q };
}

/** The base image on its paper cut-out at the base's size (one draw instead of two), rebuilt when that size changes. */
function cardOf(e: CellImages, cellPx: number): NonNullable<CellImages["card"]> | null {
  if (!e.src || !e.base) return null;
  if (!e.card) e.card = { ...paperCard(e.src), onCard: null, size: 0 };
  const card = e.card;
  if (card.size !== e.size) {
    const k = e.size / cellPx;
    const c = document.createElement("canvas");
    c.width = c.height = Math.round((cellPx + 2 * card.pad) * k);
    const g = c.getContext("2d")!;
    g.imageSmoothingQuality = "high";
    g.drawImage(card.paper, 0, 0, c.width, c.height);
    // only onto the card: drops the faint background-removal noise some cells carry around the drawing
    g.globalCompositeOperation = "source-atop";
    g.drawImage(e.base, card.pad * k, card.pad * k, e.size, e.size);
    card.onCard = c; card.size = e.size;
  }
  return card;
}

/** Cuts every cell's paper card in idle time, for a match on an art stage: building one the first time it's drawn is a hitch. */
export function prepareCards(def: FighterDef): void {
  if (typeof requestIdleCallback !== "function") return;
  for (const url of new Set(Object.values(def.sprite.cells))) {
    const e = cellImages(url);
    const cut = (): void => {
      if (e.card) return;
      if (!e.src) { if (!e.failed) requestIdleCallback(cut); return; }
      e.card = { ...paperCard(e.src), onCard: null, size: 0 };
    };
    requestIdleCallback(cut);
  }
}

/** Drops a fighter's cells from the cache; the next draw of them would load them again. */
export function releaseSprite(def: FighterDef): void {
  for (const u of Object.values(def.sprite.cells)) cache.delete(u);
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

/** `spinAround: "middle"` turns the lean about the body's middle instead of its feet (airborne: tumbling, launched). `card`: on its paper cut-out (art stages). */
export interface SpriteDrawOpts { alpha?: number; flash?: boolean; ghost?: boolean; flip?: boolean; spinAround?: "feet" | "middle"; card?: boolean }

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
  if (e.src) {
    // whole 64px steps, so a zooming camera doesn't resample every frame
    const want = Math.ceil(sp.px * u * pixelsPerUnit / 64) * 64;
    ensureSize(e, Math.min(e.src.naturalWidth, Math.max(64, want)));
  }
  const img = opts.ghost ? e.ghost : opts.flash ? e.flash : e.base;
  drawHealth.sprites++;
  if (!img) e.failed ? drawHealth.failed++ : drawHealth.loading++;
  const feet = feetRow(def, stillSprites.has(def.id) ? "idle" : cell, e);
  const card = opts.card && !opts.ghost && img ? cardOf(e, sp.px) : null;
  if (card) {
    const x = (-sp.px / 2 - card.pad) * u, y = (-feet - card.pad) * u, s = (sp.px + 2 * card.pad) * u;
    // a hit flash keeps a faint card under the white
    if (opts.flash) { const a = ctx.globalAlpha; ctx.globalAlpha = a * 0.5; ctx.drawImage(card.paper, x, y, s, s); ctx.globalAlpha = a; }
    else ctx.drawImage(card.onCard!, x, y, s, s);
  }
  if (img && (!card || opts.flash)) ctx.drawImage(img, -sp.px / 2 * u, -feet * u, sp.px * u, sp.px * u);
  else if (!img && !e.failed) {
    // still loading: a faint paper placeholder the size of the fighter
    ctx.globalAlpha *= 0.25; ctx.fillStyle = PAPER; ctx.strokeStyle = PENCIL; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.roundRect(-def.stats.width / 2, -def.stats.height, def.stats.width, def.stats.height, 12); ctx.fill(); ctx.stroke();
  }
  ctx.restore();
}
