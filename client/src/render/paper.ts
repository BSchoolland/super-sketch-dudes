export const PAPER = "#f4efe4";
export const INK = "#292722";
export const PENCIL = "#777267";
export const FONT = "'Patrick Hand', 'Comic Sans MS', cursive";

export function noise(seed: number): number {
  let n = Math.imul(seed ^ 0x45d9f3b, 0x45d9f3b);
  n = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

export function inkPath(ctx: CanvasRenderingContext2D, points: readonly (readonly [number, number])[], closed = false, seed = 0, flicker = false): void {
  const tick = flicker ? Math.floor(performance.now() * 0.006) : 0;
  ctx.beginPath();
  ctx.moveTo(points[0][0], points[0][1]);
  const count = closed ? points.length : points.length - 1;
  for (let i = 0; i < count; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1;
    const steps = Math.max(1, Math.ceil(len / 16));
    for (let j = 1; j <= steps; j++) {
      const t = j / steps, wobble = j === steps ? 0 : (noise(seed + tick * 97 + i * 613 + j * 31) - 0.5) * 1.35;
      ctx.lineTo(a[0] + dx * t - dy / len * wobble, a[1] + dy * t + dx / len * wobble);
    }
  }
  if (closed) ctx.closePath();
}

export function inkLine(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, color = INK, width = 2.3, seed = 0, flicker = false): void {
  ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineCap = "round"; ctx.lineJoin = "round";
  inkPath(ctx, [[x1, y1], [x2, y2]], false, seed, flicker); ctx.stroke();
}

export function inkRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color = INK, width = 2): void {
  ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineJoin = "round";
  inkPath(ctx, [[x, y], [x + w, y], [x + w, y + h], [x, y + h]], true, Math.round(x + y)); ctx.stroke();
}

export function inkArc(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, start = 0, end = Math.PI * 2, color = INK, width = 2.3, seed = 0): void {
  const n = Math.max(24, Math.ceil(Math.abs(end - start) * r / 6));
  const points: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const a = start + (end - start) * i / n;
    const rr = r + (noise(seed + i * 17) - 0.5) * 0.6;
    points.push([x + Math.cos(a) * rr, y + Math.sin(a) * rr]);
  }
  ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineCap = "round";
  inkPath(ctx, points); ctx.stroke();
}

export function canvas2d(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement("canvas"); canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D is required for paper rendering");
  return [canvas, ctx];
}
let paper: { canvas: HTMLCanvasElement; w: number; h: number; s: number } | undefined;
/** Paper above this canvas scale is resampled from a smaller texture rather than cached at full size (memory). */
const PAPER_MAX_SCALE = 1.5;
const patterns = new WeakMap<CanvasRenderingContext2D, Map<string, CanvasPattern>>();
const hatchTiles = new Map<string, HTMLCanvasElement>();

/**
 * Pencil hatching over the rect. With `onPaper` the tile carries the paper under it and the hatch
 * at that strength, so a solid hatched area is one opaque fill instead of paper plus a blended layer.
 */
export function hatch(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color = PENCIL, onPaper?: number): void {
  let cache = patterns.get(ctx);
  if (!cache) { cache = new Map(); patterns.set(ctx, cache); }
  const key = `${color} ${onPaper ?? ""}`;
  let pattern = cache.get(key);
  if (!pattern) {
    let tile = hatchTiles.get(key);
    if (!tile) {
      const [canvas, c] = canvas2d(48, 48); tile = canvas;
      if (onPaper !== undefined) { c.fillStyle = PAPER; c.fillRect(0, 0, 48, 48); c.globalAlpha = onPaper; }
      for (let i = -48; i < 96; i += 8) inkLine(c, i, 48, i + 48, 0, color, 0.8, i);
      hatchTiles.set(key, tile);
    }
    const made = ctx.createPattern(tile, "repeat");
    if (!made) throw new Error("Could not create pencil hatch pattern");
    pattern = made; cache.set(key, pattern);
  }
  ctx.fillStyle = pattern; ctx.fillRect(x, y, w, h);
}

/**
 * The paper background, built once at the canvas's own resolution so every frame is a 1:1 blit rather than a
 * filtered resample of a 1920x1080 texture (the single largest per-frame cost on a weak machine).
 */
export function drawPaper(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const m = ctx.getTransform();
  const s = Math.min(PAPER_MAX_SCALE, Math.round(m.a * 100) / 100);
  if (!paper || paper.w !== w || paper.h !== h || paper.s !== s) {
    const [canvas, c] = canvas2d(Math.ceil(w * s), Math.ceil(h * s));
    c.scale(s, s);
    c.fillStyle = PAPER; c.fillRect(0, 0, w, h);
    c.strokeStyle = "rgba(100,105,103,0.075)"; c.lineWidth = 0.7;
    c.beginPath();
    for (let x = 0; x < w; x += 32) { c.moveTo(x, 0); c.lineTo(x, h); }
    for (let y = 0; y < h; y += 32) { c.moveTo(0, y); c.lineTo(w, y); }
    c.stroke();
    for (let i = 0; i < w * h / 65; i++) {
      c.fillStyle = i % 2 ? "rgba(65,53,34,0.035)" : "rgba(255,255,255,0.28)";
      c.fillRect(noise(i * 2) * w, noise(i * 2 + 1) * h, 1, 1);
    }
    paper = { canvas, w, h, s };
  }
  if (m.a === s && m.b === 0 && m.c === 0) {
    ctx.setTransform(1, 0, 0, 1, m.e, m.f);
    ctx.drawImage(paper.canvas, 0, 0);
    ctx.setTransform(m);
  } else ctx.drawImage(paper.canvas, 0, 0, w, h);
}

export function paperCard(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, selected = false): void {
  ctx.save(); ctx.translate(x + w / 2, y + h / 2);
  ctx.rotate((noise(Math.round(x + y)) - 0.5) * 0.006);
  ctx.fillStyle = "rgba(41,39,34,0.08)"; ctx.fillRect(-w / 2 + 5, -h / 2 + 6, w, h);
  ctx.fillStyle = PAPER; ctx.fillRect(-w / 2, -h / 2, w, h);
  inkRect(ctx, -w / 2, -h / 2, w, h, INK, selected ? 3 : 1.4);
  if (selected) inkRect(ctx, -w / 2 - 4, -h / 2 + 3, w + 7, h - 1, PENCIL, 1);
  ctx.restore();
}
