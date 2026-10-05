import type { PointerStroke } from "../input/pointer";
import { INK } from "../render/paper";

/** Saturation never drops below this: a pale pick would be keyed out as paper when the sheet is cut. */
const SAT_MIN = 0.2;
const VAL_MIN = 0.15;

function hsvHex(h: number, s: number, v: number): string {
  const f = (n: number) => {
    const k = (n + h * 6) % 6;
    return Math.round(255 * (v - v * s * Math.max(0, Math.min(k, 4 - k, 1))));
  };
  return "#" + [f(5), f(3), f(1)].map((c) => c.toString(16).padStart(2, "0")).join("");
}

/** A hue/saturation disc over a brightness bar, laid over the tool column; drag either to pick. */
export class ColorWheel {
  hue = 0;
  sat = 1;
  val = 1;
  private disc: HTMLCanvasElement;
  private discVal = -1;
  private drag: { id: number; part: "disc" | "bar" } | null = null;

  constructor(private cx: number, private cy: number, private r: number, private bar: { x: number; y: number; w: number; h: number }) {
    this.disc = document.createElement("canvas");
    this.disc.width = this.disc.height = r * 2;
  }

  get color(): string {
    return hsvHex(this.hue, this.sat, this.val);
  }

  contains(x: number, y: number): boolean {
    return this.partAt(x, y) !== null;
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
    if (this.drag.part === "disc") {
      const dx = p.x - this.cx, dy = p.y - this.cy;
      this.hue = (Math.atan2(dy, dx) / (Math.PI * 2) + 1) % 1;
      this.sat = SAT_MIN + (1 - SAT_MIN) * Math.min(1, Math.hypot(dx, dy) / this.r);
    } else {
      this.val = VAL_MIN + (1 - VAL_MIN) * Math.max(0, Math.min(1, (p.x - this.bar.x) / this.bar.w));
    }
    if (e.phase === "up") this.drag = null;
    return true;
  }

  draw(ctx: CanvasRenderingContext2D): void {
    const { cx, cy, r, bar } = this;
    if (this.discVal !== this.val) this.paintDisc();
    ctx.save();
    ctx.drawImage(this.disc, cx - r, cy - r);
    ctx.lineWidth = 3; ctx.strokeStyle = INK;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
    const k = (this.sat - SAT_MIN) / (1 - SAT_MIN) * r, a = this.hue * Math.PI * 2;
    this.marker(ctx, cx + Math.cos(a) * k, cy + Math.sin(a) * k);

    const grad = ctx.createLinearGradient(bar.x, 0, bar.x + bar.w, 0);
    grad.addColorStop(0, hsvHex(this.hue, this.sat, VAL_MIN));
    grad.addColorStop(1, hsvHex(this.hue, this.sat, 1));
    ctx.fillStyle = grad;
    ctx.fillRect(bar.x, bar.y, bar.w, bar.h);
    ctx.strokeRect(bar.x, bar.y, bar.w, bar.h);
    this.marker(ctx, bar.x + (this.val - VAL_MIN) / (1 - VAL_MIN) * bar.w, bar.y + bar.h / 2);
    ctx.restore();
  }

  private marker(ctx: CanvasRenderingContext2D, x: number, y: number): void {
    ctx.fillStyle = this.color;
    ctx.beginPath(); ctx.arc(x, y, 13, 0, Math.PI * 2); ctx.fill();
    ctx.lineWidth = 4; ctx.strokeStyle = "#fff"; ctx.stroke();
    ctx.lineWidth = 2; ctx.strokeStyle = INK; ctx.stroke();
  }

  private paintDisc(): void {
    const n = this.r * 2, g = this.disc.getContext("2d");
    if (!g) throw new Error("Canvas 2D is required for the color wheel");
    const img = g.createImageData(n, n);
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const dx = x + 0.5 - this.r, dy = y + 0.5 - this.r, d = Math.hypot(dx, dy) / this.r;
        if (d > 1) continue;
        const hex = hsvHex((Math.atan2(dy, dx) / (Math.PI * 2) + 1) % 1, SAT_MIN + (1 - SAT_MIN) * d, this.val);
        const i = (y * n + x) * 4, c = parseInt(hex.slice(1), 16);
        img.data[i] = c >> 16; img.data[i + 1] = (c >> 8) & 255; img.data[i + 2] = c & 255; img.data[i + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    this.discVal = this.val;
  }

  private partAt(x: number, y: number): "disc" | "bar" | null {
    if (Math.hypot(x - this.cx, y - this.cy) <= this.r + 12) return "disc";
    const b = this.bar;
    if (x >= b.x - 16 && x <= b.x + b.w + 16 && y >= b.y - 16 && y <= b.y + b.h + 16) return "bar";
    return null;
  }
}
