import { onPointer, type PointerStroke } from "../input/pointer";
import { PAPER, INK } from "../render/paper";
import { fillPixels, type FillPixels } from "./fill";
import { encodePng, type Pixels } from "./png";
import { Raster, type Patch, type Rgb } from "./raster";

export const PAD_PX = 768;
/** Pen colours, black first. Lines are solid: the sheet model reads clean ink best. */
export const COLORS = [INK, "#e4483f", "#e98a2d", "#ddb51d", "#329854", "#287ad4", "#8b5a2b", "#7b4fb8"];
export const SIZES = [0.25, 0.6, 1, 1.5, 2.2];

export type ToolKind = "pen" | "eraser" | "fill" | "pick";
export interface Tool { kind: ToolKind; color: string }

type StrokeKind = "pen" | "eraser";
interface Stroke { kind: StrokeKind; color: string; width: number; points: number[] }
/** A picture laid down whole: an earlier character's drawing to start from. */
interface Picture { kind: "picture"; pixels: Pixels }
/** A filled region, kept as pixels cropped to its bounds so redo is exact. */
interface Fill { kind: "fill"; px: FillPixels }
type Mark = Stroke | Picture | Fill | "clear";

const BASE_WIDTH: Record<StrokeKind, number> = { pen: 18, eraser: 40 };

function paint(r: Raster, m: Mark): Patch {
  if (m === "clear") return r.paper(hexRgb(PAPER));
  if (m.kind === "fill") return r.fill(m.px);
  if (m.kind === "picture") return r.picture(m.pixels);
  return r.stroke(m.points, m.width, hexRgb(m.kind === "eraser" ? PAPER : m.color));
}

/** The stroke under the pen, drawn straight onto the screen; the raster takes it over when the pen lifts. */
function paintLive(g: CanvasRenderingContext2D, s: Stroke): void {
  const p = s.points;
  g.save();
  g.strokeStyle = g.fillStyle = s.kind === "eraser" ? PAPER : s.color;
  g.lineWidth = s.width; g.lineCap = "round"; g.lineJoin = "round";
  if (p.length === 2) {
    g.beginPath(); g.arc(p[0], p[1], s.width / 2, 0, Math.PI * 2); g.fill();
  } else {
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

function hexRgb(hex: string): Rgb {
  const n = parseInt(hex.slice(1), 16);
  return [n >> 16, (n >> 8) & 255, n & 255];
}

/**
 * The 768x768 drawing: a stack of marks (strokes, fills, pictures and clears) painted onto paper in a Raster, each
 * keeping what it painted over so undo is exact, and the PNG sent is what was drawn whatever the browser does to
 * canvas readback.
 */
export class DrawPad {
  tool: Tool = { kind: "pen", color: INK };
  size = 2;
  locked = false;
  /** When (performance.now) a fill was last refused for reaching the edge. */
  leakedAt = -Infinity;
  /** Called with the pixel under a press while the tool is "pick". */
  onPick: ((r: number, g: number, b: number) => void) | null = null;
  /** Goes up with every mark added or undone. */
  revision = 0;
  private marks: { mark: Mark; patch: Patch }[] = [];
  /** Marks taken off by undo, most recent last; any new mark drops them. */
  private undone: Mark[] = [];
  private current: { id: number; stroke: Stroke } | null = null;
  private raster = new Raster(PAD_PX);
  /** The raster on screen: written to, never read back. */
  private committed: HTMLCanvasElement;
  private cg: CanvasRenderingContext2D;
  private live: HTMLCanvasElement;
  private lg: CanvasRenderingContext2D;
  private liveDirty = true;
  private unsubscribe: (() => void) | null = null;

  constructor(public rect: { x: number; y: number; w: number; h: number }) {
    [this.committed, this.cg] = canvas();
    [this.live, this.lg] = canvas();
    this.raster.paper(hexRgb(PAPER));
    this.show();
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
    return !this.marks.length || this.marks[this.marks.length - 1].mark === "clear";
  }

  get canUndo(): boolean {
    return this.marks.length > 0;
  }

  get canRedo(): boolean {
    return this.undone.length > 0;
  }

  undo(): void {
    if (this.locked || !this.marks.length) return;
    const { mark, patch } = this.marks.pop()!;
    this.raster.restore(patch);
    this.undone.push(mark);
    this.revision++;
    this.show();
  }

  redo(): void {
    if (this.locked || !this.undone.length) return;
    this.put(this.undone.pop()!);
  }

  clear(): void {
    if (this.locked || this.blank) return;
    this.add("clear");
  }

  /** Lays down a whole picture (a copied character's drawing, an attached image); it undoes and clears like any mark. */
  startFrom(pixels: Pixels): void {
    this.finishStroke();
    this.add({ kind: "picture", pixels });
  }

  /** The drawing as a PNG data URL. */
  async toPng(): Promise<string> {
    this.finishStroke();
    const bytes = await encodePng(this.raster.pixels);
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return `data:image/png;base64,${btoa(bin)}`;
  }

  draw(ctx: CanvasRenderingContext2D, at = this.rect): void {
    if (this.liveDirty) {
      this.lg.drawImage(this.committed, 0, 0);
      if (this.current) paintLive(this.lg, this.current.stroke);
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
      const ix = Math.min(PAD_PX - 1, Math.floor(px)), iy = Math.min(PAD_PX - 1, Math.floor(py));
      if (this.tool.kind === "fill") { this.fill(ix, iy); return; }
      if (this.tool.kind === "pick") { const [r, g, b] = this.raster.pixel(ix, iy); this.onPick?.(r, g, b); return; }
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
    this.add(stroke);
  }

  /** Refused (null from fillPixels) when the region reaches the pad's edge: it would flood the background. */
  private fill(x: number, y: number): void {
    const px = fillPixels(this.raster.data, PAD_PX, x, y, hexRgb(this.tool.color));
    if (!px) { this.leakedAt = performance.now(); return; }
    this.add({ kind: "fill", px });
  }

  private add(mark: Mark): void {
    this.undone.length = 0;
    this.put(mark);
  }

  private put(mark: Mark): void {
    this.marks.push({ mark, patch: paint(this.raster, mark) });
    this.revision++;
    this.show();
  }

  private show(): void {
    this.cg.putImageData(new ImageData(this.raster.data, PAD_PX, PAD_PX), 0, 0);
    this.liveDirty = true;
  }
}
