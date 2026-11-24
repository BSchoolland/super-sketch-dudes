import { describe, expect, it } from "vitest";
import { createMatch, step } from "../shared/sim";
import { spawnProjectile } from "../shared/hits";
import { EMPTY_INPUT } from "../shared/input";
import { loadHouse } from "./house";

describe("wind", () => {
  it("lifts a standing fighter into the air, and it comes back down", async () => {
    await loadHouse("woodstove"); await loadHouse("slugbert");
    const s = createMatch({ stage: "proving", players: [{ fighter: "woodstove" }, { fighter: "slugbert" }], seed: 3 });
    for (let i = 0; i < 200; i++) step(s, [EMPTY_INPUT, EMPTY_INPUT]);
    const [a, v] = s.fighters;
    v.x = a.x + 200;
    expect(v.grounded).toBe(true);
    expect(v.action).toBe("idle");
    const floor = v.y;
    spawnProjectile(s, a, "roar", v.x, v.y - 60, 0, 0, 14, { frames: [0, 999], x: 0, y: 0, r: 70, damage: 0, angle: 20, base: 120, growth: 0, wind: true });
    let left = false;
    for (let i = 0; i < 400; i++) {
      step(s, [EMPTY_INPUT, EMPTY_INPUT]);
      if (!v.grounded) left = true;
    }
    expect(left).toBe(true);
    expect(v.grounded).toBe(true);
    expect(v.y).toBe(floor);
  });
});
