import { beforeAll, describe, expect, it } from "vitest";
import { cloneState, createMatch, hashState, MAX_PLAYERS, spawnFor, step } from "../shared/sim";
import { cpuInput } from "../shared/cpu";
import { B, EMPTY_INPUT } from "../shared/input";
import { stageList } from "../shared/stages/index";
import { stageFromMap, type MapDoc } from "../shared/maps";
import { loadAllHouse } from "./house";

beforeAll(loadAllHouse);
const six = ["woodstove", "slugbert", "rocket", "wizard", "woodstove", "slugbert"];

describe("six players", () => {
  it("every stage starts six apart, the first four where they always were", () => {
    for (const stage of stageList) {
      const xs = [0, 1, 2, 3, 4, 5].map((i) => spawnFor(stage, i).x);
      expect(new Set(xs).size).toBe(6);
      for (let i = 0; i < 4; i++) expect(spawnFor(stage, i)).toEqual(stage.spawns[i]);
    }
  });

  it("on a player map with a pit between its spawns, five and six still start on ground", () => {
    const doc: MapDoc = {
      id: "m-pit", name: "PIT", owner: "o", ownerName: "o", createdAt: 0, updatedAt: 0,
      pieces: [{ kind: "terrain", x: -700, y: 0, w: 500, h: 200 }, { kind: "terrain", x: 200, y: -60, w: 500, h: 200 }],
      spawns: [{ x: -600, y: 0, facing: 1 }, { x: -300, y: 0, facing: 1 }, { x: 600, y: -60, facing: -1 }, { x: 300, y: -60, facing: -1 }],
    };
    const stage = stageFromMap(doc);
    for (const slot of [4, 5]) {
      const sp = spawnFor(stage, slot);
      expect(stage.platforms.some((p) => p.solid && p.y === sp.y && sp.x > p.x1 && sp.x < p.x2)).toBe(true);
    }
  });

  it("next to a spawn on a moving platform, five and six start beside it, not over the pit", () => {
    const doc: MapDoc = {
      id: "m-lift", name: "LIFT", owner: "o", ownerName: "o", createdAt: 0, updatedAt: 0,
      pieces: [
        { kind: "platform", x: -700, y: 0, w: 300, motion: { kind: "line", dx: 0, dy: -200, period: 240, phase: 0 } },
        { kind: "terrain", x: 200, y: 0, w: 500, h: 200 },
      ],
      spawns: [{ x: -600, y: 0, facing: 1 }, { x: -500, y: 0, facing: 1 }, { x: 600, y: 0, facing: -1 }, { x: 300, y: 0, facing: -1 }],
    };
    const stage = stageFromMap(doc);
    for (const slot of [4, 5]) {
      const sp = spawnFor(stage, slot), a = stage.spawns[slot - 4];
      expect(Math.abs(sp.x - a.x)).toBeLessThanOrEqual(40);
      expect(sp.y).toBe(a.y);
    }
  });

  it("beside a moving spawn, a midpoint on ground keeps clear of that ground's end", () => {
    const doc: MapDoc = {
      id: "m-lift-edge", name: "LIFT", owner: "o", ownerName: "o", createdAt: 0, updatedAt: 0,
      pieces: [
        { kind: "platform", x: -700, y: 0, w: 300, motion: { kind: "line", dx: 0, dy: -200, period: 240, phase: 0 } },
        { kind: "terrain", x: 200, y: 0, w: 900, h: 200 },
      ],
      spawns: [{ x: -600, y: 0, facing: 1 }, { x: -500, y: 0, facing: 1 }, { x: 1020, y: 0, facing: -1 }, { x: 300, y: 0, facing: -1 }],
    };
    const sp = spawnFor(stageFromMap(doc), 4);
    expect(sp.x).toBeGreaterThanOrEqual(250);
    expect(sp.y).toBe(0);
  });

  it("refuses a seventh", () => {
    expect(() => createMatch({ stage: "rooftops", players: [...six, "rocket"].map((fighter) => ({ fighter })), seed: 1 })).toThrow(String(MAX_PLAYERS));
  });

  it("a six-CPU free-for-all plays out the same from a snapshot", () => {
    const s = createMatch({ stage: "rooftops", players: six.map((fighter) => ({ fighter, cpu: 9 })), rules: { stocks: 2, time: 0 }, seed: 7 });
    let snap = null as ReturnType<typeof cloneState> | null;
    const inputs: ReturnType<typeof cpuInput>[][] = [];
    for (let f = 0; f < 60 * 120 && !s.ended; f++) {
      if (f === 600) snap = cloneState(s);
      const frame = s.fighters.map((fi) => cpuInput(s, fi.slot, 9));
      if (f >= 600) inputs.push(frame);
      step(s, frame);
      s.events.length = 0;
    }
    expect(s.ended).toBe(true);
    expect(snap).not.toBeNull();
    for (const frame of inputs) { step(snap!, frame); snap!.events.length = 0; }
    expect(hashState(snap!)).toBe(hashState(s));
  });

});
