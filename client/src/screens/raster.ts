import type { FillPixels } from "./fill";
import type { Pixels } from "./png";

export type Rgb = [number, number, number];
/** What a mark painted over: the pixels it changed and their colour before, so undo puts them back. */
export interface Patch { at: Int32Array; was: Uint8Array }

/** How finely a stroke's curves are cut into straight pieces, in pixels. */
const FLAT_STEP = 2;
/** How far the straight pieces may stray from the curve once merged, in pixels: well under what antialiasing shows. */
const SIMPLIFY = 0.2;

/**
 * The draw pad's pixels, painted in plain bytes rather than read back from a canvas: what the pad shows, what fill
 * floods and what gets sent are all these bytes, the same in every browser.
 */
export class Raster {
  readonly data: Uint8ClampedArray<ArrayBuffer>;
  /** A stroke's coverage, pad-sized and kept zeroed between strokes (only the spans a stroke touched are cleared). */
  private cover: Float32Array;
  private touched: number[] | null = null;

  constructor(readonly n: number) {
    this.data = new Uint8ClampedArray(n * n * 4);
    this.cover = new Float32Array(n * n);
  }

  get pixels(): Pixels {
    return { w: this.n, h: this.n, data: this.data };
  }

  paper(rgb: Rgb): Patch {
    return this.record(() => { for (let k = 0; k < this.data.length; k += 4) this.blend(k, rgb[0], rgb[1], rgb[2], 1); });
  }

  /** Undoes the most recent mark not yet undone: patches go back in the reverse of the order they were made. */
  restore(p: Patch): void {
    for (let i = p.at.length - 1; i >= 0; i--) {
      const k = p.at[i] * 4;
      this.data[k] = p.was[i * 3]; this.data[k + 1] = p.was[i * 3 + 1]; this.data[k + 2] = p.was[i * 3 + 2];
    }
  }

  private record(paint: () => void): Patch {
    this.touched = [];
    paint();
    const t = this.touched;
    this.touched = null;
    const at = new Int32Array(t.length / 4), was = new Uint8Array(at.length * 3);
    for (let i = 0; i < at.length; i++) { at[i] = t[i * 4]; was[i * 3] = t[i * 4 + 1]; was[i * 3 + 1] = t[i * 4 + 2]; was[i * 3 + 2] = t[i * 4 + 3]; }
    return { at, was };
  }

  pixel(x: number, y: number): Rgb {
    const k = (y * this.n + x) * 4;
    return [this.data[k], this.data[k + 1], this.data[k + 2]];
  }

  /**
   * A round-capped, round-joined line `width` wide through `points` (x, y pairs), smoothed with quadratics through the
   * midpoints; one point is a dot. Antialiased by distance to the centreline, painted once however often it crosses itself.
   */
  stroke(points: number[], width: number, rgb: Rgb): Patch {
    return this.record(() => this.strokeOnto(points, width, rgb));
  }

  private strokeOnto(points: number[], width: number, rgb: Rgb): void {
    const path = simplify(flatten(points));
    const r = width / 2;
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    for (let i = 0; i < path.length; i += 2) {
      x1 = Math.min(x1, path[i]); x2 = Math.max(x2, path[i]); y1 = Math.min(y1, path[i + 1]); y2 = Math.max(y2, path[i + 1]);
    }
    const bx = Math.max(0, Math.floor(x1 - r - 1)), by = Math.max(0, Math.floor(y1 - r - 1));
    const ex = Math.min(this.n - 1, Math.ceil(x2 + r + 1)), ey = Math.min(this.n - 1, Math.ceil(y2 + r + 1));
    if (bx > ex || by > ey) return;
    const bw = ex - bx + 1, rows = ey - by + 1, n = this.n, cover = this.cover;
    // each row's touched span, so the blend pass covers the line and not its whole bounding box
    const lo = new Int32Array(rows).fill(bw), hi = new Int32Array(rows).fill(-1);
    const segs = Math.max(1, path.length / 2 - 1);
    for (let s = 0; s < segs; s++) {
      const ax = path[s * 2], ay = path[s * 2 + 1];
      const qx = path.length > 2 ? path[s * 2 + 2] : ax, qy = path.length > 2 ? path[s * 2 + 3] : ay;
      const sx1 = Math.max(bx, Math.floor(Math.min(ax, qx) - r - 1)), sx2 = Math.min(ex, Math.ceil(Math.max(ax, qx) + r + 1));
      const sy1 = Math.max(by, Math.floor(Math.min(ay, qy) - r - 1)), sy2 = Math.min(ey, Math.ceil(Math.max(ay, qy) + r + 1));
      const dx = qx - ax, dy = qy - ay, len2 = dx * dx + dy * dy, reach = (r + 0.5) * (r + 0.5);
      for (let y = sy1; y <= sy2; y++) {
        const row = y * n, py = y + 0.5 - ay;
        for (let x = sx1; x <= sx2; x++) {
          const px = x + 0.5 - ax;
          const t = len2 ? Math.min(1, Math.max(0, (px * dx + py * dy) / len2)) : 0;
          const ox = px - t * dx, oy = py - t * dy, d2 = ox * ox + oy * oy;
          if (d2 >= reach) continue;
          const c = r + 0.5 - Math.sqrt(d2), k = row + x;
          if (c > cover[k]) {
            cover[k] = c > 1 ? 1 : c;
            if (x - bx < lo[y - by]) lo[y - by] = x - bx;
            if (x - bx > hi[y - by]) hi[y - by] = x - bx;
          }
        }
      }
    }
    for (let j = 0; j < rows; j++) {
      for (let i = lo[j]; i <= hi[j]; i++) {
        const k = (by + j) * n + bx + i, c = cover[k];
        if (c) { this.blend(k * 4, rgb[0], rgb[1], rgb[2], c); cover[k] = 0; }
      }
    }
  }

  fill(px: FillPixels): Patch {
    return this.record(() => this.fillOnto(px));
  }

  private fillOnto(px: FillPixels): void {
    for (let j = 0; j < px.h; j++) {
      for (let i = 0; i < px.w; i++) {
        const o = (j * px.w + i) * 4, a = px.data[o + 3] / 255;
        if (a) this.blend(((px.y + j) * this.n + px.x + i) * 4, px.data[o], px.data[o + 1], px.data[o + 2], a);
      }
    }
  }

  /** A whole picture scaled to fit the pad, centred: averaged over each pixel's footprint shrinking, bilinear growing. */
  picture(p: Pixels): Patch {
    return this.record(() => this.pictureOnto(p));
  }

  private pictureOnto(p: Pixels): void {
    const k = this.n / Math.max(p.w, p.h);
    const dw = p.w * k, dh = p.h * k, ox = (this.n - dw) / 2, oy = (this.n - dh) / 2;
    const at = (x: number, y: number, c: number) => p.data[(Math.min(p.h - 1, Math.max(0, y)) * p.w + Math.min(p.w - 1, Math.max(0, x))) * 4 + c];
    const out = [0, 0, 0, 0];
    for (let y = Math.max(0, Math.floor(oy)); y < Math.min(this.n, Math.ceil(oy + dh)); y++) {
      for (let x = Math.max(0, Math.floor(ox)); x < Math.min(this.n, Math.ceil(ox + dw)); x++) {
        const sx = (x + 0.5 - ox) / k, sy = (y + 0.5 - oy) / k;
        if (sx < 0 || sy < 0 || sx >= p.w || sy >= p.h) continue;
        if (k < 1) {
          const fx1 = Math.floor((x - ox) / k), fx2 = Math.max(fx1 + 1, Math.ceil((x + 1 - ox) / k));
          const fy1 = Math.floor((y - oy) / k), fy2 = Math.max(fy1 + 1, Math.ceil((y + 1 - oy) / k));
          out.fill(0);
          let n = 0;
          for (let yy = fy1; yy < fy2; yy++) for (let xx = fx1; xx < fx2; xx++, n++) for (let c = 0; c < 4; c++) out[c] += at(xx, yy, c);
          for (let c = 0; c < 4; c++) out[c] /= n;
        } else {
          const x0 = Math.floor(sx - 0.5), y0 = Math.floor(sy - 0.5), fx = sx - 0.5 - x0, fy = sy - 0.5 - y0;
          for (let c = 0; c < 4; c++) {
            out[c] = (at(x0, y0, c) * (1 - fx) + at(x0 + 1, y0, c) * fx) * (1 - fy) + (at(x0, y0 + 1, c) * (1 - fx) + at(x0 + 1, y0 + 1, c) * fx) * fy;
          }
        }
        if (out[3]) this.blend((y * this.n + x) * 4, out[0], out[1], out[2], out[3] / 255);
      }
    }
  }

  private blend(k: number, r: number, g: number, b: number, a: number): void {
    const d = this.data;
    this.touched?.push(k / 4, d[k], d[k + 1], d[k + 2]);
    d[k] = r * a + d[k] * (1 - a);
    d[k + 1] = g * a + d[k + 1] * (1 - a);
    d[k + 2] = b * a + d[k + 2] * (1 - a);
    d[k + 3] = 255;
  }
}

/** The stroke's centreline as straight pieces: quadratics through the midpoints, as the pad has always drawn it. */
function flatten(p: number[]): number[] {
  if (p.length <= 4) return p.slice();
  const out = [p[0], p[1]];
  let cx = p[0], cy = p[1];
  for (let i = 2; i < p.length - 2; i += 2) {
    const qx = p[i], qy = p[i + 1], ex = (p[i] + p[i + 2]) / 2, ey = (p[i + 1] + p[i + 3]) / 2;
    const steps = Math.max(1, Math.ceil((Math.hypot(qx - cx, qy - cy) + Math.hypot(ex - qx, ey - qy)) / FLAT_STEP));
    for (let s = 1; s <= steps; s++) {
      const t = s / steps, u = 1 - t;
      out.push(u * u * cx + 2 * u * t * qx + t * t * ex, u * u * cy + 2 * u * t * qy + t * t * ey);
    }
    cx = ex; cy = ey;
  }
  out.push(p[p.length - 2], p[p.length - 1]);
  return out;
}

/** Drops the points a straight piece can pass within SIMPLIFY of (Douglas-Peucker): a pen's dense points cost a raster per piece. */
function simplify(p: number[]): number[] {
  const n = p.length / 2;
  if (n <= 2) return p;
  const keep = new Uint8Array(n);
  keep[0] = keep[n - 1] = 1;
  const stack: [number, number][] = [[0, n - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const ax = p[a * 2], ay = p[a * 2 + 1], dx = p[b * 2] - ax, dy = p[b * 2 + 1] - ay, len2 = dx * dx + dy * dy;
    let far = -1, worst = SIMPLIFY * SIMPLIFY;
    for (let i = a + 1; i < b; i++) {
      const px = p[i * 2] - ax, py = p[i * 2 + 1] - ay;
      const t = len2 ? Math.min(1, Math.max(0, (px * dx + py * dy) / len2)) : 0;
      const ox = px - t * dx, oy = py - t * dy, d = ox * ox + oy * oy;
      if (d > worst) { worst = d; far = i; }
    }
    if (far >= 0) { keep[far] = 1; stack.push([a, far], [far, b]); }
  }
  const out: number[] = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(p[i * 2], p[i * 2 + 1]);
  return out;
}
