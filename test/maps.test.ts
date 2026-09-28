import { beforeAll, describe, expect, it } from "vitest";
import { checkMap, defaultSpawns, newMapDoc, stageFromMap, type MapDoc } from "../shared/maps";
import { createMatch, hashState, step } from "../shared/sim";
import { platformMotion } from "../shared/physics";
import { registerStage, stages } from "../shared/stages/index";
import { cpuInput } from "../shared/cpu";
import { loadAllHouse } from "./house";

beforeAll(loadAllHouse);

const ID = "map-0123456789";
function doc(): MapDoc {
  const d = newMapDoc(ID, "953441333601763358", "Ben", "TEST MAP", 1);
  d.pieces.push(
    { kind: "terrain", x: 700, y: -120, w: 300, h: 200 },
    { kind: "platform", x: -200, y: -180, w: 200 },
    { kind: "platform", x: 100, y: -300, w: 160, motion: { kind: "line", dx: 300, dy: -200, period: 300, phase: 0 } },
    { kind: "platform", x: -500, y: -400, w: 120, motion: { kind: "orbit", cx: -500, cy: -400, rx: 200, ry: 200, period: 600, phase: 100 } },
  );
  return d;
}

describe("checkMap", () => {
  it("accepts a fresh map and the fixture", () => {
    expect(checkMap(newMapDoc(ID, "x", "X", "NEW", 1))).toEqual([]);
    expect(checkMap(doc())).toEqual([]);
  });
  it("rejects what the editor can't produce", () => {
    expect(checkMap(null)).toEqual(["map must be an object"]);
    expect(checkMap({ ...doc(), id: "rooftops" })).toContain("bad map id");
    expect(checkMap({ ...doc(), name: "" })).toContain("the map needs a name");
    expect(checkMap({ ...doc(), pieces: [] })).toContain("a map needs at least one piece of terrain");
    expect(checkMap({ ...doc(), spawns: [] })).toContain("a map needs four spawn points");
    expect(checkMap({ ...doc(), pieces: [{ kind: "terrain", x: 0, y: 0, w: 10, h: 10 }] })[0]).toMatch(/at least 80×40/);
    expect(checkMap({ ...doc(), pieces: [{ kind: "terrain", x: 0, y: 0, w: 500, h: 100 }, { kind: "platform", x: 0, y: 0, w: 100, motion: { kind: "line", dx: 0, dy: 0, period: 1, phase: 0 } }] })[0]).toMatch(/period/);
    expect(checkMap({ ...doc(), pieces: [{ kind: "terrain", x: 1e9, y: 0, w: 500, h: 100 }] })[0]).toMatch(/out of range/);
    expect(checkMap({ ...doc(), pieces: Array.from({ length: 60 }, () => ({ kind: "terrain", x: 0, y: 0, w: 500, h: 100 })) })[0]).toMatch(/at most/);
  });
});

describe("stageFromMap", () => {
  it("puts the biggest terrain first, with ledges on every block and a derived arena", () => {
    const d = doc();
    d.pieces.unshift({ kind: "terrain", x: -2000, y: 400, w: 100, h: 50 });
    const s = stageFromMap(d);
    expect(s.id).toBe(ID);
    expect(s.platforms[0]).toMatchObject({ x1: -560, x2: 560, y: 0, solid: true, bottom: 260 });
    expect(s.platforms.filter((p) => p.solid)).toHaveLength(3);
    expect(s.ledges).toHaveLength(6);
    expect(s.ledges[0]).toEqual({ x: -560, y: 0, side: -1, platform: 0 });
    expect(s.ledges[1]).toEqual({ x: 560, y: 0, side: 1, platform: 0 });
    // the arena reaches past everything, moving platforms' whole paths included
    expect(s.blast.left).toBeLessThan(-2000);
    expect(s.blast.top).toBeLessThan(-600);
    expect(s.blast.right).toBeGreaterThan(1000);
    expect(s.camera.left).toBeGreaterThan(s.blast.left);
    expect(s.camera.bottom).toBeLessThan(s.blast.bottom);
    expect(s.respawn).toEqual({ x: 0, y: -440 });
    expect(s.spawns).toEqual(defaultSpawns({ kind: "terrain", x: -560, y: 0, w: 1120, h: 260 }));
  });
});

describe("platform motion", () => {
  it("a line eases out to its far end and back over one period", () => {
    const p = { x1: 0, x2: 100, y: 0, motion: { kind: "line" as const, dx: 300, dy: -200, period: 300, phase: 0 } };
    expect(platformMotion(p, 0)).toEqual({ dx: 0, dy: 0 });
    expect(platformMotion(p, 150).dx).toBeCloseTo(300, 3);
    expect(platformMotion(p, 150).dy).toBeCloseTo(-200, 3);
    expect(platformMotion(p, 300).dx).toBeCloseTo(0, 3);
    expect(platformMotion(p, 75).dx).toBeCloseTo(150, 3);
  });
});

describe("a match on a map", () => {
  it("registers the map from its config and runs deterministically with CPUs", () => {
    const cfg = { stage: ID, map: doc(), players: [{ fighter: "lampjack" }, { fighter: "lampjack" }], seed: 11 };
    const a = createMatch(cfg), b = createMatch(cfg);
    expect(stages[ID]).toBeDefined();
    expect(a.fighters.every((f) => f.grounded && f.platform === 0)).toBe(true);
    for (let i = 0; i < 900; i++) {
      step(a, [cpuInput(a, 0, 5), cpuInput(a, 1, 5)]);
      step(b, [cpuInput(b, 0, 5), cpuInput(b, 1, 5)]);
      a.events.length = 0; b.events.length = 0;
    }
    expect(hashState(a)).toBe(hashState(b));
    expect(a.platOffsets[4]).not.toEqual({ dx: 0, dy: 0 });
  });
  it("a spawn over nothing starts airborne; a spawn on a platform stands on it", () => {
    const d = doc();
    d.spawns[0] = { x: -100, y: -180, facing: 1 };
    d.spawns[1] = { x: 3000, y: -900, facing: -1 };
    const s = createMatch({ stage: ID, map: d, players: [{ fighter: "lampjack" }, { fighter: "lampjack" }], seed: 1 });
    expect(s.fighters[0].grounded).toBe(true);
    expect(s.fighters[0].platform).toBe(2);
    expect(s.fighters[1].grounded).toBe(false);
  });
  it("refuses a config whose stage isn't its map, and a map named like a shipped stage", () => {
    expect(() => createMatch({ stage: "proving", map: doc(), players: [{ fighter: "lampjack" }, { fighter: "lampjack" }], seed: 1 })).toThrow(/not its map/);
    expect(() => registerStage({ ...stageFromMap(doc()), id: "rooftops" })).toThrow(/built in/);
  });
});
