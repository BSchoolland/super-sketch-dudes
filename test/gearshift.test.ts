import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createMatch, step, cloneState, hashState } from "../shared/sim";
import { cpuInput } from "../shared/cpu";
import { registerFighter } from "../shared/fighters/index";
import { buildGenerated, lintGeneratedSource, validateGenerated, type GeneratedBundle } from "../shared/gen/load";
import { defOf, startMove } from "../shared/fighter";
import { hurtbox } from "../shared/hits";
import { cellFor } from "../shared/gen/sprite";
import { EMPTY_INPUT, B, type InputFrame } from "../shared/input";

const bundle = JSON.parse(readFileSync(new URL("./fixtures/gearshift/bundle.json", import.meta.url), "utf8")) as GeneratedBundle;
async function load() {
  const def = await buildGenerated(bundle);
  registerFighter(def);
  return def;
}
const hold = (x: number, b = 0): InputFrame => ({ ...EMPTY_INPUT, x, b });

describe("GEARSHIFT, a two-form drawn fighter", () => {
  it("lints, validates, and both forms pass the checks", async () => {
    expect(lintGeneratedSource(bundle.source)).toEqual([]);
    const def = await load();
    expect(validateGenerated(def)).toEqual([]);
    expect(Object.keys(def.sprite!.cells)).toHaveLength(27);
  });

  it("down-special folds it into the car: new stats, hurtbox, moves and cells; and back", async () => {
    await load();
    const s = createMatch({ stage: "proving", players: [{ fighter: "gearshift" }, { fighter: "sable" }], seed: 1 });
    const f = s.fighters[0];
    const mechHeight = hurtbox(f).y1 - hurtbox(f).y2;
    startMove(s, f, "dspecial");
    const cells: string[] = [];
    for (let i = 0; i < 27; i++) {
      step(s, [EMPTY_INPUT, EMPTY_INPUT]);
      if (f.move === "dspecial") cells.push(cellFor(f, defOf(f), "attack").cell);
    }
    expect(cells[0]).toBe("tf1");
    expect(cells[cells.length - 1]).toBe("tf9");
    expect(new Set(cells).size).toBe(9);
    expect(f.special.form).toBe(1);
    expect(defOf(f).stats.height).toBe(86);
    expect(defOf(f).stats.run).toBe(9.5);
    expect(Math.abs(hurtbox(f).y1 - hurtbox(f).y2)).toBeLessThan(mechHeight);
    // the car shows its own idle cell and rams instead of punching
    step(s, [EMPTY_INPUT, EMPTY_INPUT]);
    expect(cellFor(f, defOf(f), "idle").cell).toBe("car-idle");
    startMove(s, f, "dashAttack");
    expect(defOf(f).moves.dashAttack.cell).toBe("car-atk-fwd");
    for (let i = 0; i < 45; i++) step(s, [EMPTY_INPUT, EMPTY_INPUT]);
    // driving fast on the ground fills the tank
    for (let i = 0; i < 120; i++) step(s, [hold(100), EMPTY_INPUT]);
    expect(f.special.nitro).toBeGreaterThan(20);
    // and back to the mech
    startMove(s, f, "dspecial");
    for (let i = 0; i < 27; i++) step(s, [EMPTY_INPUT, EMPTY_INPUT]);
    expect(f.special.form).toBe(0);
    expect(defOf(f).stats.height).toBe(130);
    expect(s.events.filter((e) => e.t === "hookError")).toEqual([]);
  });

  it("a 4-player CPU match with two GEARSHIFTs resimulates from a snapshot to the same hash, with no hook errors", async () => {
    await load();
    const cfg = { stage: "proving", players: [{ fighter: "gearshift", cpu: 9 }, { fighter: "brick", cpu: 9 }, { fighter: "gearshift", cpu: 9 }, { fighter: "wick", cpu: 9 }], seed: 11 };
    const a = createMatch(cfg);
    let snap: ReturnType<typeof cloneState> | null = null;
    const inputsAt: InputFrame[][] = [];
    let hookErrors = 0, carMoves = 0;
    for (let i = 0; i < 3000; i++) {
      // the bot doesn't reach for a move with no hitbox, so both GEARSHIFTs are folded into cars for it
      if (i === 300) for (const slot of [0, 2]) if (a.fighters[slot].grounded) startMove(a, a.fighters[slot], "dspecial");
      const inputs = a.fighters.map((f) => cpuInput(a, f.slot, 9));
      inputsAt.push(inputs);
      step(a, inputs);
      for (const e of a.events) { if (e.t === "hookError") hookErrors++; if (e.t === "move" && a.fighters[e.slot].special.form === 1) carMoves++; }
      a.events.length = 0;
      if (i === 1500) snap = cloneState(a);
    }
    expect(hookErrors).toBe(0);
    expect(carMoves).toBeGreaterThan(10);
    const b = snap!;
    for (let i = 1501; i < 3000; i++) { step(b, inputsAt[i]); b.events.length = 0; }
    expect(hashState(b)).toBe(hashState(a));
  });
});
