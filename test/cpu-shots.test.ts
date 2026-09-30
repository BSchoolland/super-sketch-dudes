import { beforeAll, describe, expect, it } from "vitest";
import { hitAt, profileOf } from "../shared/cpu-profile";
import { GRID_X } from "../shared/cpu-study";
import { buildGenerated } from "../shared/gen/load";
import { registerFighter, roster, unregisterFighter } from "../shared/fighters/index";
import { createMatch, step } from "../shared/sim";
import { cpuInput } from "../shared/cpu";
import { EMPTY_INPUT } from "../shared/input";
import { houseBundle, loadAllHouse } from "./house";

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

  it("studies where each special lands on a dummy standing still, and looks up the spot nearest the target", () => {
    const p = profileOf(roster.wizard);
    const grids = p.hits.nspecial;
    expect(grids.length).toBe(6);
    expect(grids.some((g) => g.cells.some(Boolean))).toBe(true);
    // somewhere in front of it on its own ground the fireball lands; nothing studied lands 2000 away
    expect(GRID_X.some((x) => x > 100 && hitAt(p, "nspecial", false, x, 0))).toBe(true);
    expect(hitAt(p, "nspecial", false, 2000, 0)).toBeNull();
  });

  it("a fighter without the forge's study has no CPU profile", async () => {
    const def = await buildGenerated({ ...houseBundle("rocket"), id: "unstudied", cpu: undefined });
    registerFighter(def);
    try { expect(() => profileOf(def)).toThrow(/no CPU study/); } finally { unregisterFighter("unstudied"); }
  });

  it("a fighter's projectile marks its last shot, and the CPU waits for the special's cooldown before firing it again", () => {
    const s = createMatch({ stage: "proving", players: [{ fighter: "wizard", cpu: 5 }, { fighter: "woodstove" }], seed: 4 });
    const [w, d] = s.fighters;
    d.x = w.x + 420; d.facing = -1;
    const shots: number[] = [];
    for (let i = 0; i < 600; i++) {
      step(s, [cpuInput(s, 0, 5), EMPTY_INPUT]);
      let fired = false;
      for (const e of s.events) if (e.t === "projectile" && e.slot === 0) { fired = true; if (w.move === "nspecial") shots.push(s.frame); }
      s.events.length = 0;
      if (fired) expect(w.lastShot).toBe(s.frame);
    }
    expect(shots.length).toBeGreaterThan(0);
    const cooldown = profileOf(roster.wizard).specials.nspecial!.cooldown;
    for (let i = 1; i < shots.length; i++) expect(shots[i] - shots[i - 1]).toBeGreaterThanOrEqual(Math.min(150, cooldown * 0.85) - 2);
  });
});
