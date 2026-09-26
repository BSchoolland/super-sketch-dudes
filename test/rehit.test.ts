import { describe, expect, it } from "vitest";
import { createMatch, step } from "../shared/sim";
import { startMove } from "../shared/fighter";
import { EMPTY_INPUT } from "../shared/input";
import { loadExemplar, loadHouse } from "./house";

describe("multi-hit moves", () => {
  it("a rehit hitbox can't hit more often than the move's own frames allow, even though every hit freezes the attacker in hitlag", async () => {
    await loadExemplar(); await loadHouse("woodstove");
    const s = createMatch({ stage: "proving", players: [{ fighter: "lampjack" }, { fighter: "woodstove" }], seed: 1 });
    const [a, v] = s.fighters;
    v.x = a.x + 40; v.facing = -1;
    // LAMPJACK's BULB FLASH: rehit 4 over frames 26..38, then a finisher on 39..41
    startMove(s, a, "nspecial");
    let hits = 0;
    for (let i = 0; i < 400 && hits < 50; i++) {
      step(s, [EMPTY_INPUT, EMPTY_INPUT]);
      for (const e of s.events) if (e.t === "hit" && e.attacker === 0) hits++;
      s.events.length = 0;
    }
    expect(hits).toBeGreaterThan(1);
    expect(hits).toBeLessThanOrEqual(5); // ceil(13 / 4) + the finisher
  });
});
