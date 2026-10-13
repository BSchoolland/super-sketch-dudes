import { describe, expect, it } from "vitest";
import { FramePacer } from "../client/src/render/pacing";

/** Draws for `ms` of time, each interval chosen from the pacer's current quality. */
function run(p: FramePacer, from: number, ms: number, interval: (quality: number) => number): number {
  let now = from;
  while (now < from + ms) { now += interval(p.quality); p.drew(now); }
  return now;
}

describe("frame pacer", () => {
  it("leaves the resolution alone when the browser holds draws at 30 fps whatever the size", () => {
    const qualities: number[] = [];
    const p = new FramePacer((q) => qualities.push(q), 0);
    run(p, 0, 20_000, () => 1000 / 30);
    expect(p.quality).toBe(1);
    // it tried one step, saw no gain and went back, then waits instead of trying again
    expect(qualities).toEqual([0.875, 1]);
  });

  it("keeps stepping down while fewer pixels make draws faster", () => {
    const p = new FramePacer(() => {}, 0);
    // a machine whose draw cost follows the pixel count: 30 ms at full size
    run(p, 0, 30_000, (q) => Math.max(1000 / 60, 30 * q * q));
    expect(p.quality).toBeLessThan(1);
    expect(p.quality).toBeGreaterThanOrEqual(0.5);
    expect(30 * p.quality * p.quality).toBeLessThanOrEqual(20);
  });

  it("stays at full size on a machine that keeps up", () => {
    const p = new FramePacer(() => {}, 0);
    run(p, 0, 20_000, () => 1000 / 60);
    expect(p.quality).toBe(1);
  });
});
