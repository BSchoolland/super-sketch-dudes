import { onPointer, type PointerStroke } from "../input/pointer";
import { PAPER, INK } from "../render/paper";

export const PAD_PX = 768;
/** Pen colours, black first. Lines are solid: the sheet model reads clean ink best. */
export const COLORS = [INK, "#e4483f", "#e98a2d", "#ddb51d", "#329854", "#287ad4", "#8b5a2b", "#7b4fb8"];
export const SIZES = [0.25, 0.6, 1, 1.5, 2.2];

export type ToolKind = "pen" | "eraser" | "fill";
export interface Tool { kind: ToolKind; color: string }

type StrokeKind = "pen" | "eraser";
interface Stroke { kind: StrokeKind; color: string; width: number; points: number[] }
/** A picture laid down whole: an earlier character's drawing to start from. */
interface Picture { kind: "picture"; img: HTMLImageElement }
/** A filled region, kept as pixels cropped to its bounds so replay is exact. */
interface Fill { kind: "fill"; x: number; y: number; layer: HTMLCanvasElement }
type Mark = Stroke | Picture | Fill | "clear";

const BASE_WIDTH: Record<StrokeKind, number> = { pen: 18, eraser: 40 };
/** How far (summed RGB) a pixel can be from the tapped one and still fill: soaks up a line's antialiased fringe. */
const FILL_TOLERANCE = 96;
/** The fill grows this far past its region so it tucks under the line instead of leaving a pale seam. */
const FILL_GROW = 2;

function paint(g: CanvasRenderingContext2D, s: Stroke | Picture | Fill): void {
  if (s.kind === "fill") { g.drawImage(s.layer, s.x, s.y); return; }
  if (s.kind === "picture") {
    const k = PAD_PX / Math.max(s.img.naturalWidth, s.img.naturalHeight);
    const w = s.img.naturalWidth * k, h = s.img.naturalHeight * k;
    g.drawImage(s.img, (PAD_PX - w) / 2, (PAD_PX - h) / 2, w, h);
    return;
  }
  const p = s.points;
  g.save();
  g.strokeStyle = g.fillStyle = s.kind === "eraser" ? PAPER : s.color;
  g.lineWidth = s.width; g.lineCap = "round"; g.lineJoin = "round";
  if (p.length === 2) {
    g.beginPath(); g.arc(p[0], p[1], s.width / 2, 0, Math.PI * 2); g.fill();
  } else {
    // quadratic through the midpoints: smooth without lagging behind the pen
    g.beginPath(); g.moveTo(p[0], p[1]);
    for (let i = 2; i < p.length - 2; i += 2) g.quadraticCurveTo(p[i], p[i + 1], (p[i] + p[i + 2]) / 2, (p[i + 1] + p[i + 3]) / 2);
    g.lineTo(p[p.length - 2], p[p.length - 1]);
    g.stroke();
  }
  g.restore();
}

function canvas(w = PAD_PX, h = PAD_PX): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const g = c.getContext("2d");
  if (!g) throw new Error("Canvas 2D is required for the draw pad");
  return [c, g];
}

function hexRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [n >> 16, (n >> 8) & 255, n & 255];
}

/** Flood fills from (sx, sy) on `g` in `color`; null when the region reaches the pad's edge (it would flood the background). */
function floodFill(g: CanvasRenderingContext2D, sx: number, sy: number, color: string): Fill | null {
  const N = PAD_PX;
  const src = g.getImageData(0, 0, N, N).data;
  const seed = (sy * N + sx) * 4;
  const [r0, g0, b0] = [src[seed], src[seed + 1], src[seed + 2]];
  const [fr, fg, fb] = hexRgb(color);
  if (Math.abs(r0 - fr) + Math.abs(g0 - fg) + Math.abs(b0 - fb) < 8) return null;
  const inside = new Uint8Array(N * N);
  const stack = [sy * N + sx];
  inside[sy * N + sx] = 1;
  let x1 = sx, y1 = sy, x2 = sx, y2 = sy;
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % N, y = (i - x) / N;
    if (x === 0 || y === 0 || x === N - 1 || y === N - 1) return null;
    if (x < x1) x1 = x; if (x > x2) x2 = x; if (y < y1) y1 = y; if (y > y2) y2 = y;
    for (const j of [i - 1, i + 1, i - N, i + N]) {
      if (inside[j]) continue;
      const k = j * 4;
      if (Math.abs(src[k] - r0) + Math.abs(src[k + 1] - g0) + Math.abs(src[k + 2] - b0) > FILL_TOLERANCE) continue;
      inside[j] = 1;
      stack.push(j);
    }
  }
  x1 = Math.max(0, x1 - FILL_GROW); y1 = Math.max(0, y1 - FILL_GROW);
  x2 = Math.min(N - 1, x2 + FILL_GROW); y2 = Math.min(N - 1, y2 + FILL_GROW);
  const w = x2 - x1 + 1, h = y2 - y1 + 1;
  const [layer, lg] = canvas(w, h);
  const out = lg.createImageData(w, h);
  for (let y = y1; y <= y2; y++) {
    for (let x = x1; x <= x2; x++) {
      let hit = false;
      for (let dy = -FILL_GROW; dy <= FILL_GROW && !hit; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= N) continue;
        for (let dx = -FILL_GROW; dx <= FILL_GROW; dx++) {
          const xx = x + dx;
          if (xx >= 0 && xx < N && inside[yy * N + xx]) { hit = true; break; }
        }
      }
      if (!hit) continue;
      const k = ((y - y1) * w + (x - x1)) * 4;
      out.data[k] = fr; out.data[k + 1] = fg; out.data[k + 2] = fb; out.data[k + 3] = 255;
    }
  }
  lg.putImageData(out, 0, 0);
  return { kind: "fill", x: x1, y: y1, layer };
}

/** The 768x768 drawing: a stack of marks (strokes and clears) replayed onto paper, so undo is exact. */
export class DrawPad {
  tool: Tool = { kind: "pen", color: INK };
  size = 2;
  locked = false;
  /** When (performance.now) a fill was last refused for reaching the edge. */
  leakedAt = -Infinity;
  /** Goes up with every mark added or undone. */
  revision = 0;
  private marks: Mark[] = [];
  private current: { id: number; stroke: Stroke } | null = null;
  private committed: HTMLCanvasElement;
  private cg: CanvasRenderingContext2D;
  private live: HTMLCanvasElement;
  private lg: CanvasRenderingContext2D;
  private liveDirty = true;
  private unsubscribe: (() => void) | null = null;

  constructor(public rect: { x: number; y: number; w: number; h: number }) {
    [this.committed, this.cg] = canvas();
    [this.live, this.lg] = canvas();
    this.replay();
  }

  attach(): void {
    if (!this.unsubscribe) this.unsubscribe = onPointer((stroke) => this.pointer(stroke));
  }

  detach(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.finishStroke();
  }

  get blank(): boolean {
    const last = this.marks.lastIndexOf("clear");
    return this.marks.length === last + 1;
  }

  get canUndo(): boolean {
    return this.marks.length > 0;
  }

  undo(): void {
    if (this.locked || !this.marks.length) return;
    this.marks.pop();
    this.revision++;
    this.replay();
  }

  clear(): void {
    if (this.locked || this.blank) return;
    this.marks.push("clear");
    this.revision++;
    this.replay();
  }

  /** Lays down a whole picture (a copied character's drawing, an attached image); it undoes and clears like any mark. */
  startFrom(img: HTMLImageElement): void {
    this.finishStroke();
    this.marks.push({ kind: "picture", img });
    this.revision++;
    paint(this.cg, { kind: "picture", img });
    this.liveDirty = true;
  }

  toPng(): string {
    this.finishStroke();
    return this.committed.toDataURL("image/png");
  }

  draw(ctx: CanvasRenderingContext2D, at = this.rect): void {
    if (this.liveDirty) {
      this.lg.drawImage(this.committed, 0, 0);
      if (this.current) paint(this.lg, this.current.stroke);
      this.liveDirty = false;
    }
    const { x, y, w, h } = at;
    ctx.drawImage(this.live, x, y, w, h);
  }

  private pointer(e: PointerStroke): void {
    if (this.locked) return;
    const { x, y, w, h } = this.rect;
    const k = PAD_PX / w;
    const pts = e.points.map((p) => [(p.x - x) * k, (p.y - y) * (PAD_PX / h)] as const);
    if (e.phase === "down") {
      const [px, py] = pts[0];
      if (this.current || px < 0 || py < 0 || px > PAD_PX || py > PAD_PX) return;
      if (this.tool.kind === "fill") { this.fill(Math.min(PAD_PX - 1, Math.floor(px)), Math.min(PAD_PX - 1, Math.floor(py))); return; }
      this.current = { id: e.id, stroke: { kind: this.tool.kind, color: this.tool.color, width: BASE_WIDTH[this.tool.kind] * SIZES[this.size], points: [px, py] } };
      this.liveDirty = true;
      return;
    }
    if (!this.current || this.current.id !== e.id) return;
    for (const [px, py] of pts) this.current.stroke.points.push(px, py);
    this.liveDirty = true;
    if (e.phase === "up") this.finishStroke();
  }

  private finishStroke(): void {
    if (!this.current) return;
    const stroke = this.current.stroke;
    this.current = null;
    // a tap that ended where it started is a dot
    if (stroke.points.length === 4 && stroke.points[0] === stroke.points[2] && stroke.points[1] === stroke.points[3]) stroke.points.length = 2;
    this.marks.push(stroke);
    this.revision++;
    paint(this.cg, stroke);
    this.liveDirty = true;
  }

  private fill(x: number, y: number): void {
    const fill = floodFill(this.cg, x, y, this.tool.color);
    if (!fill) { this.leakedAt = performance.now(); return; }
    this.marks.push(fill);
    this.revision++;
    paint(this.cg, fill);
    this.liveDirty = true;
  }

  private replay(): void {
    const g = this.cg;
    g.globalCompositeOperation = "source-over";
    g.fillStyle = PAPER;
    g.fillRect(0, 0, PAD_PX, PAD_PX);
    const from = this.marks.lastIndexOf("clear") + 1;
    for (const mark of this.marks.slice(from)) if (mark !== "clear") paint(g, mark);
    this.liveDirty = true;
  }
}
