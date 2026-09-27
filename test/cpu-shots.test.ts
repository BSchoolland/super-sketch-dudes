import { beforeAll, describe, expect, it } from "vitest";
import { profileOf } from "../shared/cpu-profile";
import { roster } from "../shared/fighters/index";
import { createMatch, step } from "../shared/sim";
import { cpuInput } from "../shared/cpu";
import { EMPTY_INPUT } from "../shared/input";
import { loadAllHouse } from "./house";

describe("what the CPU knows about shots", () => {
  beforeAll(async () => { await loadAllHouse(); });

  it("profiles where a special's projectiles fly, from the ground and from the air, tapped and held", () => {
    const p = profileOf(roster.wizard);
    const paths = p.shots.nspecial;
    expect(paths.length).toBeGreaterThanOrEqual(2);
    expect(paths.some((q) => q.air)).toBe(true);
    expect(paths.some((q) => !q.air)).toBe(true);
    for (const q of paths) {
      expect(q.pts.length).toBeGreaterThan(0);
      expect(q.hit?.damage).toBeGreaterThan(0);
      expect(q.pts.some((r) => r.x > 200)).toBe(true);
    }
    expect(p.specials.nspecial!.cooldown).toBeGreaterThan(0);
    expect(p.zoning).toBeGreaterThanOrEqual(0);
    expect(p.zoning).toBeLessThanOrEqual(1);
  });

  it("a fighter's projectile marks its last shot, and the CPU waits for the cooldown before firing again", () => {
    const s = createMatch({ stage: "proving", players: [{ fighter: "wizard", cpu: 5 }, { fighter: "woodstove" }], seed: 4 });
    const [w, d] = s.fighters;
    d.x = w.x + 420; d.facing = -1;
    const shots: number[] = [];
    for (let i = 0; i < 600; i++) {
      step(s, [cpuInput(s, 0, 5), EMPTY_INPUT]);
      for (const e of s.events) if (e.t === "projectile" && e.slot === 0) shots.push(s.frame);
      s.events.length = 0;
      if (shots.length) expect(w.lastShot).toBe(shots[shots.length - 1]);
    }
    expect(shots.length).toBeGreaterThan(0);
    const cooldown = profileOf(roster.wizard).specials.nspecial!.cooldown;
    for (let i = 1; i < shots.length; i++) expect(shots[i] - shots[i - 1]).toBeGreaterThanOrEqual(Math.min(150, cooldown * 0.85) - 2);
  });
});
