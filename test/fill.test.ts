import { describe, expect, it } from "vitest";
import { fillPixels } from "../client/src/screens/fill";

const N = 64;
const PAPER = [244, 239, 228], INK = [41, 39, 34];
const COLORS: [number, number, number][] = [[228, 72, 63], [40, 122, 212], [139, 90, 43], [221, 181, 29], [50, 152, 84]];

/** Paper with an antialiased square ring of ink `width` px wide, centred on the square from 16 to 48. */
function ring(width: number): Uint8ClampedArray {
  const img = new Uint8ClampedArray(N * N * 4);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const cx = x + 0.5, cy = y + 0.5;
      const inSquare = Math.max(Math.abs(cx - 32), Math.abs(cy - 32));
      const a = Math.min(1, Math.max(0, width / 2 + 0.5 - Math.abs(inSquare - 16)));
      for (let c = 0; c < 3; c++) img[(y * N + x) * 4 + c] = Math.round(INK[c] * a + PAPER[c] * (1 - a));
      img[(y * N + x) * 4 + 3] = 255;
    }
  }
  return img;
}

function fill(img: Uint8ClampedArray, x: number, y: number, rgb: [number, number, number]): void {
  const px = fillPixels(img, N, x, y, rgb)!;
  expect(px).not.toBeNull();
  for (let j = 0; j < px.h; j++) {
    for (let i = 0; i < px.w; i++) {
      const o = (j * px.w + i) * 4, k = ((px.y + j) * N + px.x + i) * 4;
      if (px.data[o + 3]) for (let c = 0; c < 3; c++) img[k + c] = px.data[o + c];
    }
  }
}

/** How much ink is in column 32 across the ring's top edge, in pixels: each pixel's share of ink against what's beside the line there. */
const ink = (img: Uint8ClampedArray, inside: readonly number[]): number => {
  let sum = 0;
  for (let y = 8; y < 24; y++) {
    const bg = y < 16 ? PAPER : inside, k = (y * N + 32) * 4;
    let dot = 0, len = 0;
    for (let c = 0; c < 3; c++) { const d = INK[c] - bg[c]; dot += (img[k + c] - bg[c]) * d; len += d * d; }
    sum += Math.min(1, Math.max(0, dot / len));
  }
  return sum;
};

describe("fill", () => {
  it.each([3, 5, 10])("keeps a %ipx line's width however often the region beside it is recoloured", (width) => {
    const img = ring(width);
    const before = ink(img, PAPER);
    expect(before).toBeCloseTo(width, 0);
    for (let i = 0; i < 10; i++) {
      fill(img, 32, 32, COLORS[i % COLORS.length]);
      expect(ink(img, COLORS[i % COLORS.length])).toBeCloseTo(before, 1);
    }
  });

  it("recolours the line's fringe instead of leaving a pale seam", () => {
    const img = ring(5);
    fill(img, 32, 32, COLORS[0]);
    // from the ring's inner fringe to the centre, every pixel is a blend of ink and red, with no paper left in it
    for (let y = 16; y < 32; y++) {
      const k = (y * N + 32) * 4;
      let dot = 0, len = 0;
      for (let c = 0; c < 3; c++) { const d = INK[c] - COLORS[0][c]; dot += (img[k + c] - COLORS[0][c]) * d; len += d * d; }
      const t = Math.min(1, Math.max(0, dot / len));
      let miss = 0;
      for (let c = 0; c < 3; c++) miss += (img[k + c] - COLORS[0][c] - t * (INK[c] - COLORS[0][c])) ** 2;
      expect(miss, `row ${y}: ${img[k]},${img[k + 1]},${img[k + 2]}`).toBeLessThan(3 * 6 * 6);
    }
  });

  it("refuses a fill that reaches the edge, and one in the colour already there", () => {
    const img = ring(3);
    expect(fillPixels(img, N, 2, 2, [255, 0, 0])).toBeNull();
    expect(fillPixels(img, N, 32, 32, PAPER as [number, number, number])).toBeNull();
  });
});
