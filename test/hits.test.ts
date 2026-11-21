import { describe, expect, it } from "vitest";
import { createMatch, step } from "../shared/sim";
import { startMove } from "../shared/fighter";
import { spawnProjectile } from "../shared/hits";
import { EMPTY_INPUT } from "../shared/input";
import { loadHouse } from "./house";
import { roster } from "../shared/fighters/index";

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

describe("a projectile's end", () => {
  it("tells its fighter once, with why, so an explosion happens on a direct hit as well as on timing out", async () => {
    await loadHouse("woodstove"); await loadHouse("slugbert");
    const s = createMatch({ stage: "proving", players: [{ fighter: "woodstove" }, { fighter: "slugbert" }], seed: 3 });
    const [a, v] = s.fighters;
    v.x = a.x + 300;
    const ends: string[] = [];
    const def = roster[a.id];
    const was = def.onProjectileEnd;
    def.onProjectileEnd = ({ state, f }, p, why) => {
      ends.push(`${p.kind}:${why}`);
      if (p.kind === "bomb") spawnProjectile(state, f, "boom", p.x, p.y, 0, 0, 6, { frames: [0, 999], x: 0, y: 0, r: 80, damage: 9, angle: 45, base: 30, growth: 50 });
    };
    try {
      // one flies into v and hits it; one sits in empty air and times out
      spawnProjectile(s, a, "bomb", v.x, v.y - 60, 0, 0, 40, { frames: [0, 999], x: 0, y: 0, r: 30, damage: 5, angle: 45, base: 20, growth: 40 });
      spawnProjectile(s, a, "dud", a.x - 200, a.y - 300, 0, 0, 3, { frames: [99, 99], x: 0, y: 0, r: 10, damage: 1, angle: 45, base: 1, growth: 1 });
      step(s, [EMPTY_INPUT, EMPTY_INPUT]);
      expect(ends).toEqual(["bomb:hit"]);
      expect(s.projectiles.some((p) => p.kind === "bomb")).toBe(false);
      expect(s.projectiles.some((p) => p.kind === "boom")).toBe(true);
      for (let i = 0; i < 10; i++) step(s, [EMPTY_INPUT, EMPTY_INPUT]);
      expect(ends).toEqual(["bomb:hit", "dud:expired", "boom:expired"]);
    } finally {
      def.onProjectileEnd = was;
    }
  });
});

describe("a bouncing projectile that comes to rest", () => {
  it("stays on the floor instead of sinking through it (a minion or a dropped item settling on a platform)", async () => {
    await loadHouse("woodstove"); await loadHouse("slugbert");
    const s = createMatch({ stage: "proving", players: [{ fighter: "woodstove" }, { fighter: "slugbert" }], seed: 3 });
    const [a, v] = s.fighters;
    for (let i = 0; i < 30; i++) step(s, [EMPTY_INPUT, EMPTY_INPUT]);
    expect(a.grounded).toBe(true);
    const floor = a.y;
    v.x = a.x + 600;
    // the way a summoned minion is dropped: falling, bouncing for as long as it lives
    spawnProjectile(s, a, "settler", a.x - 150, floor - 6, 0, 1, 600, { frames: [99, 99], x: 0, y: 0, r: 1, damage: 0, angle: 0, base: 0, growth: 0 }, { g: 0.45, bounce: 99999 });
    for (let i = 0; i < 300; i++) {
      step(s, [EMPTY_INPUT, EMPTY_INPUT]);
      const p = s.projectiles.find((q) => q.kind === "settler");
      expect(p, `frame ${i}`).toBeTruthy();
      expect(p!.y, `frame ${i}`).toBeLessThanOrEqual(floor + 1);
    }
  });
});
