import type { PointerStroke } from "../input/pointer";
import { INK } from "../render/paper";

/** Saturation never drops below this: a pale pick would be keyed out as paper when the sheet is cut. */
const SAT_MIN = 0.2;
const VAL_MIN = 0.15;
/** Ring and disc radii as fractions of the outer radius. */
const RING_IN = 0.8, DISC = 0.68;

function hsvRgb(h: number, s: number, v: number): [number, number, number] {
  const f = (n: number) => {
    const k = (n + h * 6) % 6;
    return Math.round(255 * (v - v * s * Math.max(0, Math.min(k, 4 - k, 1))));
  };
  return [f(5), f(3), f(1)];
}

const hex = (rgb: number[]) => "#" + rgb.map((c) => c.toString(16).padStart(2, "0")).join("");
const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

/** Elliptical grid mapping: the unit disc onto the square [-1, 1]², so the square's corners sit on the rim. */
function discToSquare(u: number, v: number): [number, number] {
  const r = Math.SQRT2 * 2, uu = u * u, vv = v * v;
  const s = (a: number) => Math.sqrt(Math.max(0, a));
  return [
    Math.max(-1, Math.min(1, 0.5 * s(2 + uu - vv + r * u) - 0.5 * s(2 + uu - vv - r * u))),
    Math.max(-1, Math.min(1, 0.5 * s(2 - uu + vv + r * v) - 0.5 * s(2 - uu + vv - r * v))),
  ];
}

function squareToDisc(x: number, y: number): [number, number] {
  return [x * Math.sqrt(1 - (y * y) / 2), y * Math.sqrt(1 - (x * x) / 2)];
}

/**
 * A hue ring around a disc holding saturation (left to right) and brightness (top to bottom) for that hue; drag
 * either to pick.
 */
export class ColorWheel {
  hue = 0;
  sat = 1;
  val = 1;
  private ring: HTMLCanvasElement;
  private disc: HTMLCanvasElement;
  private discHue = -1;
  private drag: { id: number; part: "ring" | "disc" } | null = null;

  constructor(private cx: number, private cy: number, private r: number) {
    this.ring = document.createElement("canvas");
    this.ring.width = this.ring.height = r * 2;
    this.disc = document.createElement("canvas");
    this.disc.width = this.disc.height = Math.ceil(r * DISC) * 2;
    this.paintRing();
  }

  get color(): string {
    return hex(hsvRgb(this.hue, this.sat, this.val));
  }

  /** Moves the pick to the nearest colour the wheel offers. */
  setRgb(r: number, g: number, b: number): void {
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    if (d > 0) {
      const h = max === r ? (g - b) / d : max === g ? 2 + (b - r) / d : 4 + (r - g) / d;
      this.hue = ((h / 6) % 1 + 1) % 1;
    }
    this.sat = Math.max(SAT_MIN, max ? d / max : 0);
    this.val = Math.max(VAL_MIN, max / 255);
  }

  /** Feeds a pointer stroke; true when it changed the colour. */
  pointer(e: PointerStroke): boolean {
    const p = e.points[e.points.length - 1];
    if (e.phase === "down") {
      const part = this.partAt(p.x, p.y);
      if (!part || this.drag) return false;
      this.drag = { id: e.id, part };
    }
    if (!this.drag || this.drag.id !== e.id) return false;
    const dx = p.x - this.cx, dy = p.y - this.cy;
    if (this.drag.part === "ring") {
      this.hue = (Math.atan2(dy, dx) / (Math.PI * 2) + 1) % 1;
    } else {
      const rd = this.r * DISC, d = Math.max(1, Math.hypot(dx, dy) / rd);
      const [x, y] = discToSquare(dx / rd / d, dy / rd / d);
      this.sat = SAT_MIN + (1 - SAT_MIN) * (x + 1) / 2;
      this.val = VAL_MIN + (1 - VAL_MIN) * (1 - y) / 2;
    }
    if (e.phase === "up") this.drag = null;
    return true;
  }

  draw(ctx: CanvasRenderingContext2D): void {
    const { cx, cy, r } = this, rd = this.disc.width / 2;
    if (this.discHue !== this.hue) this.paintDisc();
    ctx.save();
    ctx.drawImage(this.ring, cx - r, cy - r);
    ctx.drawImage(this.disc, cx - rd, cy - rd);
    ctx.lineWidth = 3; ctx.strokeStyle = INK;
    for (const k of [1, RING_IN, DISC]) { ctx.beginPath(); ctx.arc(cx, cy, r * k, 0, Math.PI * 2); ctx.stroke(); }
    const a = this.hue * Math.PI * 2, mid = r * (1 + RING_IN) / 2;
    this.marker(ctx, cx + Math.cos(a) * mid, cy + Math.sin(a) * mid, hex(hsvRgb(this.hue, 1, 1)));
    const [u, v] = squareToDisc((this.sat - SAT_MIN) / (1 - SAT_MIN) * 2 - 1, 1 - (this.val - VAL_MIN) / (1 - VAL_MIN) * 2);
    this.marker(ctx, cx + u * r * DISC, cy + v * r * DISC, this.color);
    ctx.restore();
  }

  private marker(ctx: CanvasRenderingContext2D, x: number, y: number, color: string): void {
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(x, y, 13, 0, Math.PI * 2); ctx.fill();
    ctx.lineWidth = 4; ctx.strokeStyle = "#fff"; ctx.stroke();
    ctx.lineWidth = 2; ctx.strokeStyle = INK; ctx.stroke();
  }

  /** Paints `canvas` pixel by pixel within radius `from..to` (pixels) of its centre. */
  private paint(canvas: HTMLCanvasElement, from: number, to: number, rgbAt: (dx: number, dy: number, d: number) => [number, number, number]): void {
    const n = canvas.width, c = n / 2, g = canvas.getContext("2d");
    if (!g) throw new Error("Canvas 2D is required for the color wheel");
    const img = g.createImageData(n, n);
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const dx = x + 0.5 - c, dy = y + 0.5 - c, d = Math.hypot(dx, dy);
        if (d < from || d > to) continue;
        const i = (y * n + x) * 4, [r, gr, b] = rgbAt(dx, dy, d);
        img.data[i] = r; img.data[i + 1] = gr; img.data[i + 2] = b; img.data[i + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
  }

  private paintRing(): void {
    this.paint(this.ring, this.r * RING_IN, this.r, (dx, dy) => hsvRgb((Math.atan2(dy, dx) / (Math.PI * 2) + 1) % 1, 1, 1));
  }

  private paintDisc(): void {
    const rd = this.disc.width / 2;
    this.paint(this.disc, 0, rd, (dx, dy) => {
      const [x, y] = discToSquare(dx / rd, dy / rd);
      return hsvRgb(this.hue, SAT_MIN + (1 - SAT_MIN) * (x + 1) / 2, VAL_MIN + (1 - VAL_MIN) * (1 - y) / 2);
    });
    this.discHue = this.hue;
  }

  private partAt(x: number, y: number): "ring" | "disc" | null {
    const d = Math.hypot(x - this.cx, y - this.cy);
    if (d <= this.r * (DISC + RING_IN) / 2) return "disc";
    if (d <= this.r + 12) return "ring";
    return null;
  }
}
