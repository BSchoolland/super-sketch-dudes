import { describe, expect, it } from "vitest";
import { drawWeighted } from "../server/weighted";
import { brawlWeight, LOOK_WEIGHT } from "../shared/account";

/** Mulberry32: a repeatable stand-in for Math.random. */
const seeded = (seed: number) => () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), seed | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32; };

describe("drawWeighted", () => {
  it("draws n distinct items, as many as there are at most", () => {
    const items = ["a", "b", "c"].map((item) => ({ item, weight: 1 }));
    const two = drawWeighted(items, 2, seeded(1));
    expect(two).toHaveLength(2);
    expect(new Set(two).size).toBe(2);
    expect(drawWeighted(items, 9, seeded(1)).sort()).toEqual(["a", "b", "c"]);
  });

  it("first draws each item about in proportion to its weight", () => {
    const items = [{ item: "heavy", weight: 6 }, { item: "light", weight: 2 }, { item: "faint", weight: 1 }, { item: "faint2", weight: 1 }];
    const random = seeded(7);
    const first: Record<string, number> = {};
    for (let i = 0; i < 20000; i++) { const [x] = drawWeighted(items, 1, random); first[x] = (first[x] ?? 0) + 1; }
    expect(first.heavy / 20000).toBeCloseTo(0.6, 1);
    expect(first.light / 20000).toBeCloseTo(0.2, 1);
    expect(first.faint / 20000).toBeCloseTo(0.1, 1);
  });

  it("refuses a weight that isn't positive", () => {
    expect(() => drawWeighted([{ item: "x", weight: 0 }], 1)).toThrow(/positive/);
  });
});

describe("brawlWeight", () => {
  it("is the BEST score lifted so the worst-looking unsaved character still gets drawn", () => {
    expect(brawlWeight(0, 1)).toBeCloseTo(LOOK_WEIGHT);
    expect(brawlWeight(0, null)).toBe(brawlWeight(0, 5));
    expect(brawlWeight(4, 9)).toBeGreaterThan(brawlWeight(4, 5));
    expect(brawlWeight(4, 5)).toBeGreaterThan(brawlWeight(0, 10));
  });
});
