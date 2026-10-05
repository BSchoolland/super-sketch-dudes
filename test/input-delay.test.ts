import { describe, expect, it } from "vitest";
import { autoInputDelay, liveRuns } from "../server/lobby";

describe("auto input delay", () => {
  it("keeps the minimum on a normal ping", () => {
    expect(autoInputDelay([57, 62]).delay).toBe(2);
  });
  it("covers what rollback can't at a trans-Pacific ping", () => {
    // (57 + 210) / 2 = 133.5 ms one way, 8 frames: 4 of delay, 4 left to rollback
    expect(autoInputDelay([57, 210])).toEqual({ delay: 4, oneWayMs: 134, rtts: [57, 210], direct: 0 });
  });
  it("takes the worst pair", () => {
    expect(autoInputDelay([30, 40, 200]).delay).toBe(autoInputDelay([40, 200]).delay);
  });
  it("uses a pair's direct link where it has one", () => {
    // relay: (57 + 210) / 2 = 134 ms one way; the pair's own link has a 120 ms round trip, 60 ms one way
    expect(autoInputDelay([57, 210], () => 120)).toEqual({ delay: 2, oneWayMs: 60, rtts: [57, 210], direct: 1 });
    // a third player without a link to the far one is still judged over the relay
    const linked = (i: number, j: number) => (i === 0 && j === 1 ? 40 : null);
    expect(autoInputDelay([30, 40, 200], linked).delay).toBe(autoInputDelay([40, 200]).delay);
  });
  it("stays in bounds", () => {
    expect(autoInputDelay([0, 0]).delay).toBe(2);
    expect(autoInputDelay([900, 900]).delay).toBe(6);
  });
});

describe("relay fill ranges", () => {
  it("passes on only the frames outside them, as contiguous runs", () => {
    // frames 11..20, with 13-14 and 18 decided away
    const runs = liveRuns(20, [11, 12, 13, 14, 15, 16, 17, 18, 19, 20], [[13, 14], [18, 18]]);
    expect(runs).toEqual([{ frame: 12, inputs: [11, 12] }, { frame: 17, inputs: [15, 16, 17] }, { frame: 20, inputs: [19, 20] }]);
    expect(liveRuns(5, [3, 4, 5], [[1, 10]])).toEqual([]);
  });
});
