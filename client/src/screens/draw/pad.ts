import { onPointer, type PointerStroke } from "../../input/pointer";
import { PAPER, INK } from "../../render/paper";

export const PAD_PX = 768;
export const MARKERS = ["#e4483f", "#e98a2d", "#ddb51d", "#329854", "#287ad4"];
export const SIZES = [0.5, 1, 2];

export type ToolKind = "pencil" | "marker" | "eraser";
export interface Tool { kind: ToolKind; color: string }

interface Stroke { kind: ToolKind; color: string; width: number; points: number[] }
type Mark = Stroke | "clear";

const BASE_WIDTH: Record<ToolKind, number> = { pencil: 5, marker: 18, eraser: 34 };

function paint(g: CanvasRenderingContext2D, s: Stroke): void {
  const p = s.points;
  g.save();
  g.globalCompositeOperation = s.kind === "marker" ? "multiply" : "source-over";
  g.globalAlpha = s.kind === "marker" ? 0.8 : 1;
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

function canvas(): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = c.height = PAD_PX;
  const g = c.getContext("2d");
  if (!g) throw new Error("Canvas 2D is required for the draw pad");
  return [c, g];
}

/** The 768x768 drawing: a stack of marks (strokes and clears) replayed onto paper, so undo is exact. */
export class DrawPad {
  tool: Tool = { kind: "pencil", color: INK };
  size = 1;
  locked = false;
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
    this.replay();
  }

  clear(): void {
    if (this.locked || this.blank) return;
    this.marks.push("clear");
    this.replay();
  }

  toPng(): string {
    this.finishStroke();
    return this.committed.toDataURL("image/png");
  }

  draw(ctx: CanvasRenderingContext2D): void {
    if (this.liveDirty) {
      this.lg.drawImage(this.committed, 0, 0);
      if (this.current) paint(this.lg, this.current.stroke);
      this.liveDirty = false;
    }
    const { x, y, w, h } = this.rect;
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
    paint(this.cg, stroke);
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
