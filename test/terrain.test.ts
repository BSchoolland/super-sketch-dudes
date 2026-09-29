import { beforeAll, describe, expect, it } from "vitest";
import { newMapDoc, type MapPiece } from "../shared/maps";
import { createMatch, step, type MatchConfig } from "../shared/sim";
import { B, EMPTY_INPUT, type InputFrame } from "../shared/input";
import { roster } from "../shared/fighters/index";
import type { State } from "../shared/types";
import { loadAllHouse } from "./house";

beforeAll(loadAllHouse);

const ID = "map-7e55a1d000";
/** A match on the default floor (-560..560 at y 0, 260 deep) plus `extra` pieces; fighter 0 at `x`, fighter 1 parked far left. */
function arena(extra: MapPiece[], x: number): State {
  const d = newMapDoc(ID, "x", "X", "TERRAIN", 1);
  d.pieces.push(...extra);
  const cfg: MatchConfig = { stage: ID, map: d, players: [{ fighter: "lampjack" }, { fighter: "lampjack" }], seed: 1 };
  const s = createMatch(cfg);
  s.fighters[0].x = x; s.fighters[1].x = -520;
  return s;
}
const inp = (p: Partial<InputFrame>): InputFrame => ({ ...EMPTY_INPUT, ...p });
const run = (s: State, frames: number, input: InputFrame, watch?: (f: State["fighters"][0], i: number) => void) => { for (let i = 0; i < frames; i++) { step(s, [input, EMPTY_INPUT]); watch?.(s.fighters[0], i); } };
const stats = () => roster.lampjack.stats;

describe("terrain shapes", () => {
  it("seam: a runner crosses onto an adjacent block at the same height without leaving the ground", () => {
    const s = arena([{ kind: "terrain", x: 560, y: 0, w: 600, h: 260 }], 300);
    const f = s.fighters[0];
    const seen = new Set<string>();
    run(s, 90, inp({ x: 100 }), (g) => seen.add(g.action));
    expect(f.x).toBeGreaterThan(700);
    expect(f.grounded).toBe(true);
    expect(f.platform).toBe(1);
    expect(seen.has("air")).toBe(false);
    expect(seen.has("land")).toBe(false);
  });
  it("step up: walking into a taller block stops at its wall; jumping lands on top of it", () => {
    const s = arena([{ kind: "terrain", x: 300, y: -120, w: 400, h: 380 }], 100);
    const f = s.fighters[0];
    run(s, 60, inp({ x: 100 }));
    expect(f.grounded).toBe(true);
    expect(f.platform).toBe(0);
    expect(f.x).toBeCloseTo(300 - stats().width / 2, 3);
    run(s, 6, inp({ x: 100, b: B.JUMP }));
    run(s, 60, inp({ x: 100 }));
    expect(f.grounded).toBe(true);
    expect(f.platform).toBe(1);
    expect(f.y).toBe(-120);
  });
  it("step down: walking off a higher block drops onto the lower one", () => {
    const s = arena([{ kind: "terrain", x: -200, y: -100, w: 300, h: 360 }], -100);
    const f = s.fighters[0];
    step(s, [EMPTY_INPUT, EMPTY_INPUT]);
    f.grounded = true; f.platform = 1; f.y = -100; f.action = "idle";
    run(s, 80, inp({ x: 100 }));
    expect(f.grounded).toBe(true);
    expect(f.platform).toBe(0);
    expect(f.y).toBe(0);
    expect(f.x).toBeGreaterThan(100);
  });
  it("overhang: a jump under a block stops at its underside", () => {
    const h = stats().height;
    const s = arena([{ kind: "terrain", x: -200, y: -h - 500, w: 400, h: 400 }], 0);
    const f = s.fighters[0];
    let top = Infinity;
    run(s, 6, inp({ b: B.JUMP }));
    run(s, 60, EMPTY_INPUT, (g) => { top = Math.min(top, g.y); });
    expect(top).toBeCloseTo(-100, 3);
    expect(f.grounded).toBe(true);
  });
  it("corner: falling with the centre over a block's edge lands on it instead of sliding down its wall", () => {
    const halfW = stats().width / 2;
    const s = arena([{ kind: "terrain", x: 200, y: -300, w: 300, h: 300 }], 200 + halfW / 2);
    const f = s.fighters[0];
    f.grounded = false; f.platform = -1; f.action = "air"; f.y = -320; f.vy = 4; f.vx = 0;
    run(s, 30, EMPTY_INPUT);
    expect(f.grounded).toBe(true);
    expect(f.platform).toBe(1);
  });
  it("overlap: two overlapping blocks at the same height are one floor", () => {
    const s = arena([{ kind: "terrain", x: 400, y: 0, w: 600, h: 200 }], 300);
    const f = s.fighters[0];
    const seen = new Set<string>();
    run(s, 90, inp({ x: 100 }), (g) => seen.add(g.action));
    expect(f.grounded).toBe(true);
    expect(f.x).toBeGreaterThan(700);
    expect(seen.has("air")).toBe(false);
  });
  it("gap: a body can't squeeze into a slot narrower than itself, and doesn't jitter trying", () => {
    const w = stats().width;
    const s = arena([{ kind: "terrain", x: 200, y: -300, w: 200, h: 300 }, { kind: "terrain", x: 400 + w * 0.6, y: -300, w: 200, h: 300 }], 0);
    const f = s.fighters[0];
    run(s, 40, inp({ x: 100 }));
    const xs: number[] = [];
    run(s, 30, inp({ x: 100 }), (g) => xs.push(g.x));
    expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(1);
    expect(f.x).toBeLessThanOrEqual(200 - w / 2 + 0.01);
    expect(f.grounded).toBe(true);
  });
});
