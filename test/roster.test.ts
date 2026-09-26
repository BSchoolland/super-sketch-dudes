import { beforeAll, describe, expect, it } from "vitest";
import { createMatch, step, cloneState, hashState } from "../shared/sim";
import { cpuInput } from "../shared/cpu";
import { rosterList } from "../shared/fighters/index";
import { CORE_MOVES, validateGenerated } from "../shared/gen/load";
import { HOUSE_ROSTER } from "../shared/house";
import { stageList } from "../shared/stages/index";
import { loadAllHouse } from "./house";

describe("house roster", () => {
  beforeAll(loadAllHouse);

  stageList.forEach((stage, n) => {
    // four of the eight per stage, rotating so every house fighter plays somewhere
    const four = [0, 1, 2, 3].map((i) => HOUSE_ROSTER[(n * 4 + i) % HOUSE_ROSTER.length].id);
    it(`4-player CPU match on ${stage.id} (${four.join(", ")}) resimulates from a mid-match snapshot to the same hash`, () => {
      const cfg = { stage: stage.id, players: four.map((id) => ({ fighter: id, cpu: 9 })), seed: 42 };
      const a = createMatch(cfg);
      let snap: ReturnType<typeof cloneState> | null = null;
      const inputsAt: ReturnType<typeof cpuInput>[][] = [];
      for (let i = 0; i < 1800; i++) {
        const inputs = a.fighters.map((f) => cpuInput(a, f.slot, 9));
        inputsAt.push(inputs);
        step(a, inputs);
        expect(a.events.filter((e) => e.t === "hookError")).toEqual([]);
        a.events.length = 0;
        if (i === 900) snap = cloneState(a);
      }
      // resimulate the second half from the snapshot with the recorded inputs
      const b = snap!;
      for (let i = 901; i < 1800; i++) { step(b, inputsAt[i]); b.events.length = 0; }
      expect(hashState(b)).toBe(hashState(a));
      // and the cpu is a pure function of state
      const c = createMatch(cfg);
      for (let i = 0; i < 1800; i++) { const inputs = c.fighters.map((f) => cpuInput(c, f.slot, 9)); expect(inputs).toEqual(inputsAt[i]); step(c, inputs); c.events.length = 0; }
      expect(hashState(c)).toBe(hashState(a));
    });
  });

  it("every house fighter validates and has the core moves with poses", () => {
    expect(rosterList.map((d) => d.id)).toEqual(HOUSE_ROSTER.map((h) => h.id));
    for (const def of rosterList) {
      expect(validateGenerated(def), def.id).toEqual([]);
      for (const m of CORE_MOVES) expect(def.moves[m].poses.length, `${def.id}.${m} poses`).toBeGreaterThan(0);
    }
  });
});
