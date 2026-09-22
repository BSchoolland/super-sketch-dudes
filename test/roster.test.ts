import { describe, expect, it } from "vitest";
import { createMatch, step, cloneState, hashState } from "../shared/sim";
import { cpuInput } from "../shared/cpu";
import { rosterList } from "../shared/fighters/index";
import { stageList } from "../shared/stages/index";

describe("roster determinism", () => {
  for (const stage of stageList) {
    it(`4-player CPU match on ${stage.id} resimulates from a mid-match snapshot to the same hash`, () => {
      const cfg = { stage: stage.id, players: rosterList.map((d) => ({ fighter: d.id, cpu: 9 })), seed: 42 };
      const a = createMatch(cfg);
      let snap: ReturnType<typeof cloneState> | null = null;
      const inputsAt: ReturnType<typeof cpuInput>[][] = [];
      for (let i = 0; i < 1800; i++) {
        const inputs = a.fighters.map((f) => cpuInput(a, f.slot, 9));
        inputsAt.push(inputs);
        step(a, inputs);
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
  }
  it("every fighter has the 22 core moves with poses and a rig whose bones are parent-first", () => {
    const core = ["jab1", "ftilt", "utilt", "dtilt", "dashAttack", "fsmash", "usmash", "dsmash", "nair", "fair", "bair", "uair", "dair", "grab", "fthrow", "bthrow", "uthrow", "dthrow", "nspecial", "sspecial", "uspecial", "dspecial"];
    for (const def of rosterList) {
      for (const m of core) {
        expect(def.moves[m], `${def.id}.${m}`).toBeDefined();
        expect(def.moves[m].poses.length, `${def.id}.${m} poses`).toBeGreaterThan(0);
      }
      const seen = new Set<string>();
      for (const b of def.rig.bones) { if (b.parent) expect(seen.has(b.parent), `${def.id} bone ${b.name} before parent`).toBe(true); seen.add(b.name); }
      for (const m of Object.values(def.moves)) for (const hbx of m.hitboxes) if (!m.throwFrame) expect(hbx.frames[1], `${def.id}.${m.id} hitbox past total`).toBeLessThanOrEqual(m.total);
    }
  });
});
