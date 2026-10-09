import type { Stage, State } from "../../../shared/types";
import { platformOffset } from "../../../shared/physics";
import { VIEW_H, VIEW_W, type Camera } from "./camera";
import { inkPath, noise, PAPER } from "./paper";

/**
 * Stages drawn from art rather than pencil boxes: `public/stages/<theme>/stage.json` and the images next to it,
 * written by ~/ssd-brawl/tools/stageart.py (images converted to WebP). Layers are drawn back to front with depth parallax (see layerView);
 * the main platform is a depth-1 cut-out and the thin platforms are inked in the manifest's style.
 */
export const ART_THEMES: ReadonlySet<string> = new Set(["stadium", "forest", "cliffs", "final"]);

export type Rect = [x1: number, y1: number, x2: number, y2: number];

export interface ArtLayerSpec {
  src: string;
  /** 1 = the stage plane, 0 = pinned to the screen. */
  depth: number;
  /** World rect as seen from the reference camera. */
  rect: Rect;
  /** Gaussian blur in source pixels, applied once at load. */
  blur?: number;
  /** Opaque and must fill the view: its camera is held inside its rect, so it never shows an edge. */
  cover?: boolean;
}

export interface ThinStyle {
  style: "plank" | "branch" | "slab";
  fill: string;
  ink: string;
  accent?: string;
  /** How thick the platform is drawn, world units. */
  depth?: number;
}

export interface StageManifest {
  ref: { x: number; y: number; zoom: number };
  layers: ArtLayerSpec[];
  thin: ThinStyle;
}

interface ArtLayer extends ArtLayerSpec {
  /** mips[k] is the (blurred) image at 1/2^k size. */
  mips: HTMLCanvasElement[];
}

export interface StageArt { theme: string; ref: StageManifest["ref"]; layers: ArtLayer[]; thin: ThinStyle }

interface Entry { art: StageArt | null; promise: Promise<StageArt> }
/** Full art, one stage at a time: each is ~16 MB of canvases, which a Chromebook can't spare four times over. */
const full = new Map<string, Entry>();
/** Picker thumbnails: the same art kept only at THUMB_PX and smaller. */
const thumbs = new Map<string, Entry>();
const THUMB_PX = 512;

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((ok, fail) => {
    const img = new Image();
    img.onload = () => ok(img);
    img.onerror = () => fail(new Error(`stage art image failed to load: ${url}`));
    img.src = url;
  });
}

/** `opaque` canvases blit without blending, which software rasterising notices. */
function canvasOf(w: number, h: number, opaque: boolean): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const g = c.getContext("2d", { alpha: !opaque });
  if (!g) throw new Error("Canvas 2D is required for stage art");
  return [c, g];
}

/** How far a backdrop (cover layer) is faded toward the paper. */
const BACKDROP_WASH = 0.22;

/** The image blurred once (never per frame) and halved until it fits in 512 px, so every zoom draws from a level within 2x of its size. */
function mipChain(img: HTMLImageElement, blur: number, opaque: boolean): HTMLCanvasElement[] {
  const [top, g] = canvasOf(img.naturalWidth, img.naturalHeight, opaque);
  if (blur > 0) {
    // edge pixels are clamped by drawing the image under itself a little larger, so the blur doesn't pull in transparency
    g.filter = `blur(${blur}px)`;
    g.drawImage(img, -blur * 3, -blur * 3, img.naturalWidth + blur * 6, img.naturalHeight + blur * 6);
    g.drawImage(img, 0, 0);
    g.filter = "none";
  } else g.drawImage(img, 0, 0);
  if (opaque) {
    // the backdrop washed toward the paper, so the drawn fighters stand out from a busy painting
    g.globalAlpha = BACKDROP_WASH; g.fillStyle = PAPER; g.fillRect(0, 0, top.width, top.height); g.globalAlpha = 1;
  }
  const mips = [top];
  while (Math.max(mips[mips.length - 1].width, mips[mips.length - 1].height) > 512) {
    const prev = mips[mips.length - 1];
    const [c, h] = canvasOf(Math.ceil(prev.width / 2), Math.ceil(prev.height / 2), opaque);
    h.imageSmoothingQuality = "high";
    h.drawImage(prev, 0, 0, c.width, c.height);
    mips.push(c);
  }
  return mips;
}

async function load(theme: string, thumb: boolean): Promise<StageArt> {
  const dir = `${import.meta.env.BASE_URL}stages/${theme}/`;
  const res = await fetch(`${dir}stage.json`);
  if (!res.ok) throw new Error(`stage art for ${theme}: ${dir}stage.json is HTTP ${res.status}`);
  const m = (await res.json()) as StageManifest;
  if (!m.ref || !Array.isArray(m.layers) || !m.layers.length || !m.thin) throw new Error(`stage art for ${theme}: stage.json needs ref, layers and thin`);
  const layers = await Promise.all(m.layers.map(async (l): Promise<ArtLayer> => {
    const img = await loadImage(`${dir}${l.src}`);
    const mips = mipChain(img, l.blur ?? 0, !!l.cover);
    return { ...l, mips: thumb ? mips.filter((m) => Math.max(m.width, m.height) <= THUMB_PX) : mips };
  }));
  return { theme, ref: m.ref, layers, thin: m.thin };
}

function entry(cache: Map<string, Entry>, theme: string, thumb: boolean): Entry {
  let e = cache.get(theme);
  if (e) return e;
  if (!thumb) cache.clear();
  const made: Entry = { art: null, promise: load(theme, thumb) };
  made.promise.then((art) => { made.art = art; }, (err: unknown) => console.error(err));
  cache.set(theme, made);
  return made;
}

/**
 * The stage's art once it has loaded (asking starts the load, and lets go of any other stage's); null while loading,
 * after a failure (logged), or for a pencil stage.
 */
export function stageArt(stage: Stage): StageArt | null {
  return ART_THEMES.has(stage.theme) ? entry(full, stage.theme, false).art : null;
}

/** The stage's art for a picker card, small; null as for stageArt. */
export function stageArtThumb(stage: Stage): StageArt | null {
  return ART_THEMES.has(stage.theme) ? entry(thumbs, stage.theme, true).art : null;
}

/**
 * Where a layer of depth d is seen from: camera centre ref + (cam - ref) * d, zoom refZoom * (zoom / refZoom)^d,
 * shaken by the world's on-screen shake. At the reference camera every layer lines up like one flat picture.
 * A cover layer's view is held inside its rect (zoomed in and slid), so a camera past the planned range
 * stops the backdrop at its edge instead of showing the paper behind it.
 */
function layerView(cam: Camera, ref: StageArt["ref"], layer: ArtLayer): { cx: number; cy: number; z: number; sx: number; sy: number } {
  const d = layer.depth;
  let cx = ref.x + (cam.x - ref.x) * d, cy = ref.y + (cam.y - ref.y) * d;
  let z = ref.zoom * Math.pow(cam.zoom / ref.zoom, d);
  const sx = cam.shakeX * cam.zoom, sy = cam.shakeY * cam.zoom;
  if (layer.cover) {
    const [x1, y1, x2, y2] = layer.rect;
    z = Math.max(z, (VIEW_W + 2 * Math.abs(sx)) / (x2 - x1), (VIEW_H + 2 * Math.abs(sy)) / (y2 - y1));
    cx = Math.min(Math.max(cx, x1 + (VIEW_W / 2 + sx) / z), x2 - (VIEW_W / 2 - sx) / z);
    cy = Math.min(Math.max(cy, y1 + (VIEW_H / 2 + sy) / z), y2 - (VIEW_H / 2 - sy) / z);
  }
  return { cx, cy, z, sx, sy };
}

/**
 * Draws the part of a layer inside the visible layer-space box [vx1, vy1, vx2, vy2] from the smallest mip that is
 * still at least as sharp as the screen (`screenPerUnit` device pixels per layer unit).
 */
function drawLayerImage(ctx: CanvasRenderingContext2D, layer: ArtLayer, vx1: number, vy1: number, vx2: number, vy2: number, screenPerUnit: number): void {
  const [x1, y1, x2, y2] = layer.rect;
  const ix1 = Math.max(x1, vx1), iy1 = Math.max(y1, vy1), ix2 = Math.min(x2, vx2), iy2 = Math.min(y2, vy2);
  if (ix1 >= ix2 || iy1 >= iy2) return;
  const srcPerUnit = layer.mips[0].width / (x2 - x1);
  const level = Math.max(0, Math.min(layer.mips.length - 1, Math.floor(Math.log2(srcPerUnit / screenPerUnit))));
  const img = layer.mips[level];
  const kx = img.width / (x2 - x1), ky = img.height / (y2 - y1);
  // whole source pixels, a couple past the visible edge so filtering has neighbours
  const sx1 = Math.max(0, Math.floor((ix1 - x1) * kx) - 2), sy1 = Math.max(0, Math.floor((iy1 - y1) * ky) - 2);
  const sx2 = Math.min(img.width, Math.ceil((ix2 - x1) * kx) + 2), sy2 = Math.min(img.height, Math.ceil((iy2 - y1) * ky) + 2);
  ctx.drawImage(img, sx1, sy1, sx2 - sx1, sy2 - sy1, x1 + sx1 / kx, y1 + sy1 / ky, (sx2 - sx1) / kx, (sy2 - sy1) / ky);
}

/** The backdrop, mid layers and platform art, then the thin platforms, onto a context in screen space. `chrome` off skips the layers behind the stage plane. */
export function drawStageArt(ctx: CanvasRenderingContext2D, art: StageArt, state: State, stage: Stage, cam: Camera, chrome: boolean): void {
  const deviceScale = Math.hypot(ctx.getTransform().a, ctx.getTransform().b);
  for (const layer of art.layers) {
    if (!chrome && layer.depth < 1) continue;
    ctx.save();
    if (layer.depth === 1) {
      cam.apply(ctx);
      const sx = cam.shakeX, sy = cam.shakeY;
      drawLayerImage(ctx, layer, cam.x - sx - VIEW_W / 2 / cam.zoom, cam.y - sy - VIEW_H / 2 / cam.zoom, cam.x - sx + VIEW_W / 2 / cam.zoom, cam.y - sy + VIEW_H / 2 / cam.zoom, cam.zoom * deviceScale);
    } else {
      const v = layerView(cam, art.ref, layer);
      ctx.translate(VIEW_W / 2 + v.sx, VIEW_H / 2 + v.sy);
      ctx.scale(v.z, v.z);
      ctx.translate(-v.cx, -v.cy);
      drawLayerImage(ctx, layer, v.cx - (VIEW_W / 2 + v.sx) / v.z, v.cy - (VIEW_H / 2 + v.sy) / v.z, v.cx + (VIEW_W / 2 - v.sx) / v.z, v.cy + (VIEW_H / 2 - v.sy) / v.z, v.z * deviceScale);
    }
    ctx.restore();
  }
  ctx.save();
  cam.apply(ctx);
  stage.platforms.forEach((p, i) => {
    if (p.hidden || p.solid) return;
    const o = platformOffset(state, i);
    drawThin(ctx, art.thin, p.x1 + o.dx, p.x2 + o.dx, p.y + o.dy, i, p.x1 + p.x2 < 0 ? -1 : 1);
  });
  ctx.restore();
}

/** The smallest mip at least `px` wide. */
function mipFor(layer: ArtLayer, px: number): HTMLCanvasElement {
  let img = layer.mips[0];
  for (const m of layer.mips) if (m.width >= px) img = m;
  return img;
}

/**
 * The stage small, for a picker card: the backdrop filling the box, and the platform art and thin platforms to
 * scale, with the world transform already on `ctx` (the thumb's own pencil drawing's); `box` is the card's area
 * in world units.
 */
export function drawStageArtThumb(ctx: CanvasRenderingContext2D, art: StageArt, stage: Stage, box: Rect): void {
  const [bx1, by1, bx2, by2] = box;
  const deviceScale = Math.hypot(ctx.getTransform().a, ctx.getTransform().b);
  const bg = art.layers.find((l) => l.cover);
  if (bg) {
    const [x1, y1, x2, y2] = bg.rect, k = Math.max((bx2 - bx1) / (x2 - x1), (by2 - by1) / (y2 - y1));
    const w = (x2 - x1) * k, h = (y2 - y1) * k;
    ctx.drawImage(mipFor(bg, w * deviceScale), (bx1 + bx2 - w) / 2, (by1 + by2 - h) / 2, w, h);
  }
  for (const layer of art.layers) {
    if (layer.depth !== 1) continue;
    const [x1, y1, x2, y2] = layer.rect;
    ctx.drawImage(mipFor(layer, (x2 - x1) * deviceScale), x1, y1, x2 - x1, y2 - y1);
  }
  stage.platforms.forEach((p, i) => { if (!p.hidden && !p.solid) drawThin(ctx, art.thin, p.x1, p.x2, p.y, i, p.x1 + p.x2 < 0 ? -1 : 1); });
}

type Pt = [number, number];

function shape(ctx: CanvasRenderingContext2D, pts: Pt[], fill: string, ink: string, width: number, seed: number): void {
  inkPath(ctx, pts, true, seed);
  ctx.fillStyle = fill; ctx.fill();
  ctx.strokeStyle = ink; ctx.lineWidth = width; ctx.lineJoin = "round"; ctx.lineCap = "round";
  ctx.stroke();
}

function stroke(ctx: CanvasRenderingContext2D, pts: Pt[], color: string, width: number, seed: number): void {
  inkPath(ctx, pts, false, seed);
  ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineCap = "round"; ctx.lineJoin = "round";
  ctx.stroke();
}

/**
 * A thin platform in the stage's inked style, its walkable top on y from x1 to x2. `outer` is the side away from
 * the stage's middle (-1 left, 1 right): a branch grows from there.
 */
function drawThin(ctx: CanvasRenderingContext2D, s: ThinStyle, x1: number, x2: number, y: number, seed: number, outer: -1 | 1): void {
  const t = s.depth ?? 20, w = x2 - x1, accent = s.accent ?? s.fill;
  const n = (k: number) => noise(seed * 101 + k);
  if (s.style === "plank") {
    shape(ctx, [[x1, y], [x2, y], [x2 - 2, y + t], [x1 + 2, y + t]], s.fill, s.ink, 3, seed);
    ctx.save();
    ctx.globalAlpha = 0.5;
    stroke(ctx, [[x1 + 4, y + 3], [x2 - 4, y + 3]], accent, 2, seed + 1);
    ctx.globalAlpha = 0.45;
    for (let r = 1; r <= 2; r++) {
      const gy = y + (t * r) / 3;
      for (let gx = x1 + 10 + n(r) * 30; gx < x2 - 30; gx += 50 + n(gx) * 40) stroke(ctx, [[gx, gy + n(gx + 1) * 2], [gx + 22 + n(gx + 2) * 20, gy + n(gx + 3) * 2]], s.ink, 1.2, gx);
    }
    ctx.restore();
    const seams = Math.max(1, Math.round(w / 90));
    for (let k = 1; k < seams; k++) {
      const sx = x1 + (w * k) / seams + (n(k + 9) - 0.5) * 10;
      stroke(ctx, [[sx, y + 1], [sx - 1, y + t - 1]], s.ink, 2, seed + k);
    }
    ctx.fillStyle = s.ink;
    for (let k = 0; k <= seams; k++) {
      const nx = Math.min(x2 - 7, Math.max(x1 + 7, x1 + (w * k) / seams + (k === 0 ? 6 : k === seams ? -6 : 6)));
      for (const ny of [y + t * 0.28, y + t * 0.72]) { ctx.beginPath(); ctx.arc(nx, ny, 1.8, 0, Math.PI * 2); ctx.fill(); }
    }
    return;
  }
  if (s.style === "branch") {
    // thick where it leaves the trunk (outer end), thin at the tip
    const root = outer < 0 ? x1 : x2, tip = outer < 0 ? x2 : x1, dir = -outer;
    // the underside, tip back to root
    const under: Pt[] = [];
    for (let k = 8; k >= 0; k--) {
      const f = k / 8;
      under.push([root + (tip - root) * f, y + t * (1.5 - 0.9 * f) + (n(k + 30) - 0.5) * 4]);
    }
    shape(ctx, [[root - outer * 26, y + 2], [root, y], [tip, y], [tip + dir * 12, y + t * 0.35], ...under, [root - outer * 26, y + t * 1.7]], s.fill, s.ink, 3, seed);
    // the cut end of the limb, rings showing
    ctx.save();
    ctx.beginPath(); ctx.ellipse(root - outer * 26, y + t * 0.85, 7, t * 0.85, 0, 0, Math.PI * 2);
    ctx.fillStyle = accent === s.fill ? s.fill : "#d9b98a"; ctx.fill();
    ctx.strokeStyle = s.ink; ctx.lineWidth = 2.5; ctx.stroke();
    ctx.beginPath(); ctx.ellipse(root - outer * 26, y + t * 0.85, 3, t * 0.45, 0, 0, Math.PI * 2); ctx.lineWidth = 1.2; ctx.stroke();
    ctx.restore();
    ctx.save();
    ctx.globalAlpha = 0.55;
    for (let k = 0; k < Math.round(w / 28); k++) {
      const bx = Math.min(x1, x2) + 14 + (k * w) / Math.round(w / 28) + n(k) * 10;
      const f = Math.abs(bx - root) / w, by = y + 5 + n(k + 50) * t * (1.2 - 0.8 * f);
      stroke(ctx, [[bx, by], [bx + 10 + n(k + 7) * 12, by + (n(k + 8) - 0.5) * 3]], s.ink, 1.3, k);
    }
    ctx.restore();
    // a twig hanging under the tip with a few leaves, and leaves along the top edge's tip half
    const tw: Pt = [tip + dir * 4, y + t * 0.5];
    stroke(ctx, [tw, [tw[0] + dir * 22, tw[1] + 18], [tw[0] + dir * 30, tw[1] + 34]], s.ink, 2.5, seed + 3);
    const leaves: Pt[] = [[tw[0] + dir * 22, tw[1] + 18], [tw[0] + dir * 31, tw[1] + 36], [tip - dir * 30, y + t * 0.9 + 6], [tip + dir * 10, y + t * 0.2]];
    leaves.forEach(([lx, ly], k) => {
      ctx.save();
      ctx.translate(lx, ly); ctx.rotate((n(k + 20) - 0.5) * 2.4 + (dir > 0 ? 0.4 : -0.4));
      ctx.beginPath(); ctx.ellipse(0, 0, 11, 5.5, 0, 0, Math.PI * 2);
      ctx.fillStyle = s.accent ?? "#6aa84f"; ctx.fill();
      ctx.strokeStyle = s.ink; ctx.lineWidth = 2; ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-9, 0); ctx.lineTo(9, 0); ctx.lineWidth = 1; ctx.stroke();
      ctx.restore();
    });
    return;
  }
  // slab: a floating block, a lit top face and a tapered underside
  const under = t * 1.1;
  shape(ctx, [[x1, y], [x2, y], [x2, y + t * 0.55], [x2 - w * 0.12, y + t * 0.55 + under], [x1 + w * 0.12, y + t * 0.55 + under], [x1, y + t * 0.55]], s.fill, s.ink, 3, seed);
  ctx.save();
  ctx.fillStyle = accent;
  ctx.beginPath(); ctx.rect(x1 + 3, y + 2, w - 6, t * 0.55 - 4); ctx.fill();
  ctx.restore();
  stroke(ctx, [[x1 + 1, y + t * 0.55], [x2 - 1, y + t * 0.55]], s.ink, 2, seed + 1);
  ctx.save();
  ctx.globalAlpha = 0.5;
  for (let k = 0; k < 3; k++) {
    const cx = x1 + w * (0.25 + 0.25 * k) + (n(k) - 0.5) * 20, cy = y + t * 0.55 + 4;
    stroke(ctx, [[cx, cy], [cx + (n(k + 4) - 0.5) * 14, cy + under * 0.45], [cx + (n(k + 5) - 0.5) * 18, cy + under * 0.75]], s.ink, 1.4, k + seed);
  }
  ctx.restore();
}
