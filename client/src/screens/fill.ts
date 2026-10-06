/** How far (summed RGB) a pixel can be from the tapped one and still fill: soaks up a line's antialiased fringe. */
const FILL_TOLERANCE = 96;
/** The fill reaches this far past its region to recolor the line's fringe instead of leaving a pale seam. */
const FILL_GROW = 2;
/** How far (squared RGB) a pixel can be from a blend of two colours and still count as one. */
const BLEND_MISS = 3 * 12 * 12;

/** The pixels a fill paints, cropped to their bounds: opaque where recolored, transparent elsewhere. */
export interface FillPixels { x: number; y: number; w: number; h: number; data: Uint8ClampedArray<ArrayBuffer> }

/**
 * Flood fills from (sx, sy) on the n×n RGBA `src` in `rgb`; null when the region reaches the edge (it would flood the
 * background) or is already that colour.
 *
 * A pixel near the region is a blend of the tapped colour and the line beside it. Only the tapped colour's share is
 * swapped for the new one, so ink stays ink and a line keeps its width however many times its neighbour is recoloured.
 */
export function fillPixels(src: Uint8ClampedArray, n: number, sx: number, sy: number, rgb: [number, number, number]): FillPixels | null {
  const seed = (sy * n + sx) * 4;
  const s = [src[seed], src[seed + 1], src[seed + 2]];
  const dist = (k: number) => Math.abs(src[k] - s[0]) + Math.abs(src[k + 1] - s[1]) + Math.abs(src[k + 2] - s[2]);
  if (Math.abs(s[0] - rgb[0]) + Math.abs(s[1] - rgb[1]) + Math.abs(s[2] - rgb[2]) < 8) return null;
  const inside = new Uint8Array(n * n);
  const stack = [sy * n + sx];
  inside[sy * n + sx] = 1;
  let x1 = sx, y1 = sy, x2 = sx, y2 = sy;
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % n, y = (i - x) / n;
    if (x === 0 || y === 0 || x === n - 1 || y === n - 1) return null;
    if (x < x1) x1 = x; if (x > x2) x2 = x; if (y < y1) y1 = y; if (y > y2) y2 = y;
    for (const j of [i - 1, i + 1, i - n, i + n]) {
      if (inside[j] || dist(j * 4) > FILL_TOLERANCE) continue;
      inside[j] = 1;
      stack.push(j);
    }
  }
  x1 = Math.max(0, x1 - FILL_GROW); y1 = Math.max(0, y1 - FILL_GROW);
  x2 = Math.min(n - 1, x2 + FILL_GROW); y2 = Math.min(n - 1, y2 + FILL_GROW);
  const w = x2 - x1 + 1, h = y2 - y1 + 1;
  const data = new Uint8ClampedArray(w * h * 4);
  const nearRegion = grow(inside, n);
  const off = new Uint8Array(n * n);
  for (let i = 0; i < n * n; i++) off[i] = dist(i * 4) > FILL_TOLERANCE ? 1 : 0;
  const nearLine = grow(off, n);
  for (let y = y1; y <= y2; y++) {
    for (let x = x1; x <= x2; x++) {
      if (!nearRegion[y * n + x]) continue;
      const k = (y * n + x) * 4;
      // how much of the line this pixel holds: it's a blend of the tapped colour and the strongest neighbour off it that explains it
      let a = 0, fits = false, best = Infinity;
      if (nearLine[y * n + x]) for (let yy = Math.max(0, y - FILL_GROW); yy <= Math.min(n - 1, y + FILL_GROW); yy++) {
        for (let xx = Math.max(0, x - FILL_GROW); xx <= Math.min(n - 1, x + FILL_GROW); xx++) {
          const l = (yy * n + xx) * 4;
          if (!off[l / 4]) continue;
          let dot = 0, len = 0;
          for (let c = 0; c < 3; c++) { const d = src[l + c] - s[c]; dot += (src[k + c] - s[c]) * d; len += d * d; }
          const t = Math.min(1, Math.max(0, dot / len));
          let miss = 0;
          for (let c = 0; c < 3; c++) { const r = src[k + c] - s[c] - t * (src[l + c] - s[c]); miss += r * r; }
          if (miss <= BLEND_MISS) {
            if (!fits || t < a) a = t;
            fits = true;
          } else if (!fits && miss < best) { best = miss; a = t; }
        }
      }
      if (a === 1) continue;
      const o = ((y - y1) * w + (x - x1)) * 4;
      for (let c = 0; c < 3; c++) data[o + c] = src[k + c] + (1 - a) * (rgb[c] - s[c]);
      data[o + 3] = 255;
    }
  }
  return { x: x1, y: y1, w, h, data };
}

/** The n×n mask grown by FILL_GROW in every direction (a square), in two passes. */
function grow(mask: Uint8Array, n: number): Uint8Array {
  const across = new Uint8Array(n * n), out = new Uint8Array(n * n);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      if (!mask[y * n + x]) continue;
      for (let xx = Math.max(0, x - FILL_GROW); xx <= Math.min(n - 1, x + FILL_GROW); xx++) across[y * n + xx] = 1;
    }
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      if (!across[y * n + x]) continue;
      for (let yy = Math.max(0, y - FILL_GROW); yy <= Math.min(n - 1, y + FILL_GROW); yy++) out[yy * n + x] = 1;
    }
  return out;
}
