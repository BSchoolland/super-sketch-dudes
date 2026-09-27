import { describe, expect, it } from "vitest";
import { createMatch, step } from "../shared/sim";
import { startMove } from "../shared/fighter";
import { spawnProjectile } from "../shared/hits";
import { EMPTY_INPUT } from "../shared/input";
import { loadHouse } from "./house";

describe("hitlag and pending knockback", () => {
  it("a fighter's own projectile landing while it sits in hitlag doesn't strand its knockback", async () => {
    await loadHouse("woodstove"); await loadHouse("slugbert");
    const s = createMatch({ stage: "proving", players: [{ fighter: "woodstove" }, { fighter: "slugbert" }], seed: 3 });
    const [a, v] = s.fighters;
    v.x = a.x + 60; v.facing = -1;
    // a smashes v: v goes into hitlag with the launch waiting on it
    startMove(s, a, "fsmash");
    for (let i = 0; i < 60 && !v.pending; i++) step(s, [EMPTY_INPUT, EMPTY_INPUT]);
    expect(v.pending).toBeTruthy();
    expect(v.hitlag).toBeGreaterThan(0);
    // during that hitlag, a projectile v owns hits a
    spawnProjectile(s, v, "test-shot", a.x, a.y - 60, 0, 0, 30, { frames: [0, 999], x: 0, y: 0, r: 30, damage: 5, angle: 45, base: 20, growth: 40 });
    step(s, [EMPTY_INPUT, EMPTY_INPUT]);
    expect(s.events.some((e) => e.t === "hit" && e.attacker === v.slot && e.victim === a.slot)).toBe(true);
    // v's hitlag still runs out on its own and the launch is applied: never "pending with no hitlag"
    for (let i = 0; i < 40; i++) {
      step(s, [EMPTY_INPUT, EMPTY_INPUT]);
      expect(!(v.pending && v.hitlag === 0)).toBe(true);
    }
    expect(v.pending).toBeNull();
    expect(v.hitstun).toBeGreaterThan(0);
    expect(Math.abs(v.vx) + Math.abs(v.vy)).toBeGreaterThan(1);
  });
});
