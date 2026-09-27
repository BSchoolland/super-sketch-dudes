import { beforeAll, describe, expect, it } from "vitest";
import { cloneState, createMatch, hashState, step } from "../shared/sim";
import { registerFighter, roster } from "../shared/fighters/index";
import { fill, take, tripped } from "../shared/bars";
import { EMPTY_INPUT } from "../shared/input";
import { loadExemplar } from "./house";

beforeAll(async () => {
  await loadExemplar();
  registerFighter({
    ...roster.lampjack, id: "barred",
    // heat stays declared because lampjack's own hooks write it; the latch tests use a bar nothing else touches
    bars: {
      heat: { label: "HEAT", color: "#ffb920", max: 100 },
      temp: { label: "TEMP", color: "#f00", max: 100, trip: 100, rearm: 75 },
      ammo: { label: "AMMO", color: "#00f", max: 12, start: 12, trip: 0, rearm: 9 },
    },
  });
});

const match = () => createMatch({ stage: "proving", players: [{ fighter: "barred" }, { fighter: "lampjack" }], seed: 1 });
const tick = (s: ReturnType<typeof match>) => { step(s, [EMPTY_INPUT, EMPTY_INPUT]); s.events.length = 0; };

describe("bars", () => {
  it("start where declared and are clamped after every frame", () => {
    const s = match(), f = s.fighters[0];
    expect(f.bars).toEqual({ heat: 0, temp: 0, ammo: 12 });
    f.bars.temp = 130; f.bars.ammo = -4;
    tick(s);
    expect(f.bars.temp).toBe(100); expect(f.bars.ammo).toBe(0);
    expect(fill(f, "temp")).toBe(1);
  });

  it("latches at trip and frees at rearm, from either side", () => {
    const s = match(), f = s.fighters[0];
    f.bars.temp = 99; tick(s); expect(tripped(f, "temp")).toBe(false);
    f.bars.temp = 100; tick(s); expect(tripped(f, "temp")).toBe(true);
    f.bars.temp = 80; tick(s); expect(tripped(f, "temp")).toBe(true);
    f.bars.temp = 75; tick(s); expect(tripped(f, "temp")).toBe(false);
    f.bars.ammo = 1; tick(s); expect(tripped(f, "ammo")).toBe(false);
    expect(take(f, "ammo", 1)).toBe(true); tick(s); expect(tripped(f, "ammo")).toBe(true);
    expect(take(f, "ammo", 1)).toBe(false);
    f.bars.ammo = 8; tick(s); expect(tripped(f, "ammo")).toBe(true);
    f.bars.ammo = 9; tick(s); expect(tripped(f, "ammo")).toBe(false);
  });

  it("are part of the state a clone carries and the hash sees", () => {
    const s = match();
    s.fighters[0].bars.temp = 40; tick(s);
    const c = cloneState(s);
    expect(hashState(c)).toBe(hashState(s));
    c.fighters[0].bars.temp = 41;
    expect(s.fighters[0].bars.temp).toBe(40);
    expect(hashState(c)).not.toBe(hashState(s));
  });

  it("refuse a bar the fighter doesn't have", () => {
    const s = match();
    expect(() => take(s.fighters[0], "mana", 1)).toThrow(/no bar mana/);
  });
});
