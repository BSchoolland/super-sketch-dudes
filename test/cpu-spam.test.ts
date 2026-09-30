import { beforeAll, describe, expect, it } from "vitest";
import { createMatch, step } from "../shared/sim";
import { cpuInput } from "../shared/cpu";
import { C } from "../shared/config";
import { EMPTY_INPUT } from "../shared/input";
import { loadAllHouse } from "./house";

beforeAll(loadAllHouse);

describe("CPU move spam", () => {
  it("never starts a move again once it has started only that move for 12 seconds", () => {
    let locked = 0;
    for (const fighter of ["lampjack", "woodstove", "slugbert", "rocket", "wizard"]) {
      for (const tier of [1, 3, 5]) {
        // against a player who just stands there, the easiest target to hammer with one move; every move it
        // starts is marked as already spammed, so the lock is tested whatever it would have spammed on its own
        const s = createMatch({ stage: "proving", players: [{ fighter, cpu: tier }, { fighter: "lampjack" }], rules: { stocks: 99, time: 0 }, seed: 3 });
        const f = s.fighters[0];
        for (let frame = 0; frame < 60 * 90; frame++) {
          const wasLocked = f.streakMove !== null && f.streakLast - f.streakFrom >= 12 * C.FPS ? f.streakMove : null;
          step(s, [cpuInput(s, 0, tier), { ...EMPTY_INPUT }]);
          // whatever it just started, it has (as far as the lock can tell) been starting for 12 seconds
          if (f.streakMove !== null) f.streakFrom = Math.min(f.streakFrom, f.streakLast - 12 * C.FPS);
          for (const e of s.events) if (e.t === "move" && e.slot === 0 && wasLocked) {
            locked++;
            expect(`${fighter} tier ${tier} frame ${s.frame}: ${e.move}`).not.toBe(`${fighter} tier ${tier} frame ${s.frame}: ${wasLocked}`);
          }
          s.events.length = 0;
        }
      }
    }
    expect(locked).toBeGreaterThan(0);
  });
});
