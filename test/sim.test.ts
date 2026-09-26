import { beforeAll, describe, expect, it } from "vitest";
import { createMatch, step, cloneState, hashState } from "../shared/sim";
import { cpuInput } from "../shared/cpu";
import { B, EMPTY_INPUT, type InputFrame } from "../shared/input";
import { knockback } from "../shared/hits";
import { roster } from "../shared/fighters/index";
import { loadAllHouse } from "./house";

beforeAll(loadAllHouse);
const two = (seed = 7) => createMatch({ stage: "proving", players: [{ fighter: "lampjack" }, { fighter: "lampjack" }], seed });
const inp = (p: Partial<InputFrame>): InputFrame => ({ ...EMPTY_INPUT, ...p });

describe("determinism", () => {
  it("same inputs give the same hash, and a clone resimulates identically", () => {
    const a = two(), b = two();
    let snap = null as ReturnType<typeof cloneState> | null;
    for (let i = 0; i < 1200; i++) {
      const ia = [cpuInput(a, 0, 9), cpuInput(a, 1, 6)];
      const ib = [cpuInput(b, 0, 9), cpuInput(b, 1, 6)];
      expect(ia).toEqual(ib);
      step(a, ia); step(b, ib);
      if (i === 600) snap = cloneState(a);
      a.events.length = 0; b.events.length = 0;
    }
    expect(hashState(a)).toBe(hashState(b));
    // resimulate from the snapshot with the same CPU inputs
    const c = snap!;
    const d = two();
    for (let i = 0; i < 601; i++) step(d, [cpuInput(d, 0, 9), cpuInput(d, 1, 6)]);
    expect(hashState(c)).toBe(hashState(d));
  });
});

describe("movement", () => {
  it("short hop and full hop differ; double jump exists", () => {
    const s = two();
    const f = s.fighters[0];
    step(s, [inp({ b: B.JUMP }), EMPTY_INPUT]);
    expect(f.action).toBe("jumpSquat");
    step(s, [EMPTY_INPUT, EMPTY_INPUT]); step(s, [EMPTY_INPUT, EMPTY_INPUT]);
    step(s, [EMPTY_INPUT, EMPTY_INPUT]);
    expect(f.grounded).toBe(false);
    const shortV = f.vy;
    const s2 = two();
    const g = s2.fighters[0];
    for (let i = 0; i < 5; i++) step(s2, [inp({ b: B.JUMP }), EMPTY_INPUT]);
    expect(g.vy).toBeLessThan(shortV);
    for (let i = 0; i < 5; i++) step(s2, [EMPTY_INPUT, EMPTY_INPUT]);
    step(s2, [inp({ b: B.JUMP }), EMPTY_INPUT]);
    expect(g.jumpsLeft).toBe(roster.lampjack.stats.jumps - 2);
    expect(g.vy).toBeLessThan(0);
  });
  it("dash then run, and walking off the edge makes you airborne", () => {
    const s = two();
    const f = s.fighters[1];
    for (let i = 0; i < 20; i++) step(s, [EMPTY_INPUT, inp({ x: 100 })]);
    expect(f.action).toBe("run");
    for (let i = 0; i < 120; i++) step(s, [EMPTY_INPUT, inp({ x: 100 })]);
    expect(f.grounded).toBe(false);
  });
  it("falling past the ledge grabs it", () => {
    const s = two();
    const f = s.fighters[1];
    f.x = 600; f.y = -40; f.grounded = false; f.action = "air"; f.vx = 0; f.vy = 2;
    let grabbed = false;
    for (let i = 0; i < 40; i++) { step(s, [EMPTY_INPUT, inp({ x: -60 })]); if (f.ledge >= 0) { grabbed = true; break; } }
    expect(grabbed).toBe(true);
  });
});

describe("hits", () => {
  it("knockback formula matches the reference numbers", () => {
    // 100 weight, 10 damage at 50% after: ((5 + 25) * 1 * 1.4 + 18) * 1 + 30 = 90
    expect(knockback(50, 10, 100, 100, 30)).toBeCloseTo(90);
  });
  it("a jab lands, adds damage, causes hitlag on both, then launches", () => {
    const s = two();
    const a = s.fighters[0], v = s.fighters[1];
    a.x = 0; v.x = 100; v.facing = -1;
    step(s, [inp({ b: B.ATTACK }), EMPTY_INPUT]);
    expect(a.move).toBe("jab1");
    let hit = false;
    for (let i = 0; i < 8; i++) { step(s, [EMPTY_INPUT, EMPTY_INPUT]); if (v.percent > 0) { hit = true; break; } }
    expect(hit).toBe(true);
    expect(a.hitlag).toBeGreaterThan(0);
    expect(v.hitlag).toBeGreaterThan(0);
    expect(v.action).toBe("hitstun");
  });
  it("shield blocks", () => {
    const s = two();
    const a = s.fighters[0], v = s.fighters[1];
    a.x = 0; v.x = 90; v.facing = -1;
    for (let i = 0; i < 10; i++) step(s, [EMPTY_INPUT, inp({ b: B.SHIELD })]);
    expect(v.action).toBe("shield");
    step(s, [inp({ b: B.ATTACK }), inp({ b: B.SHIELD })]);
    for (let i = 0; i < 8; i++) step(s, [EMPTY_INPUT, inp({ b: B.SHIELD })]);
    expect(v.percent).toBe(0);
    expect(v.shield).toBeLessThan(50);
  });
  it("every move's hitboxes are within its total frames", () => {
    for (const def of Object.values(roster)) for (const m of Object.values(def.moves)) for (const h of m.hitboxes) {
      expect(h.frames[0]).toBeLessThanOrEqual(h.frames[1]);
      if (!m.throwFrame) expect(h.frames[1]).toBeLessThanOrEqual(m.total);
    }
  });
  it("a fighter thrown past the blast zone loses a stock and respawns", () => {
    const s = two();
    const v = s.fighters[1];
    v.x = 1400; v.grounded = false; v.action = "air";
    step(s, [EMPTY_INPUT, EMPTY_INPUT]);
    expect(v.stocks).toBe(2);
    expect(v.action).toBe("dead");
    for (let i = 0; i < 100; i++) step(s, [EMPTY_INPUT, EMPTY_INPUT]);
    expect(v.action).toBe("respawn");
  });
});

describe("a full CPU match ends", () => {
  it("two level-9 bots finish a 3-stock match in under 4 minutes", () => {
    const s = two(3);
    let frames = 0;
    while (!s.ended && frames < 60 * 240) { step(s, [cpuInput(s, 0, 9), cpuInput(s, 1, 9)]); s.events.length = 0; frames++; }
    expect(s.ended).toBe(true);
  });
});
