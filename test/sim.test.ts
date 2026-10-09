import { beforeAll, describe, expect, it } from "vitest";
import { createFighter, createMatch, step, cloneState, hashState } from "../shared/sim";
import { stages } from "../shared/stages/index";
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
      const ia = [cpuInput(a, 0, 5), cpuInput(a, 1, 3)];
      const ib = [cpuInput(b, 0, 5), cpuInput(b, 1, 3)];
      expect(ia).toEqual(ib);
      step(a, ia); step(b, ib);
      if (i === 600) snap = cloneState(a);
      a.events.length = 0; b.events.length = 0;
    }
    expect(hashState(a)).toBe(hashState(b));
    // resimulate from the snapshot with the same CPU inputs
    const c = snap!;
    const d = two();
    for (let i = 0; i < 601; i++) step(d, [cpuInput(d, 0, 5), cpuInput(d, 1, 3)]);
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
    while (!s.ended && frames < 60 * 240) { step(s, [cpuInput(s, 0, 5), cpuInput(s, 1, 5)]); s.events.length = 0; frames++; }
    expect(s.ended).toBe(true);
  });
});

describe("low gravity", () => {
  it("a full hop on the Moon rises about 1/gravity as high and falls slower", () => {
    const hop = (stage: string) => {
      const s = createMatch({ stage, players: [{ fighter: "lampjack" }, { fighter: "lampjack" }], seed: 1 });
      const f = s.fighters[0], y0 = f.y;
      let top = 0, fall = 0;
      for (let i = 0; i < 240; i++) {
        step(s, [inp({ b: i < 12 ? B.JUMP : 0 }), EMPTY_INPUT]);
        top = Math.max(top, y0 - f.y); fall = Math.max(fall, f.vy);
      }
      return { top, fall };
    };
    const earth = hop("proving"), moon = hop("moon");
    expect(moon.top / earth.top).toBeGreaterThan(1.3);
    expect(moon.top / earth.top).toBeLessThan(1.65);
    expect(moon.fall).toBeLessThan(earth.fall);
  });
});

describe("ice", () => {
  /** How far a fighter slides after letting go of a run. */
  const slide = (stage: string) => {
    const s = createMatch({ stage, players: [{ fighter: "lampjack" }, { fighter: "lampjack" }], seed: 1 });
    const f = s.fighters[0];
    s.fighters[1].x = 500;
    f.x = -400;
    for (let i = 0; i < 40; i++) step(s, [inp({ x: 100 }), EMPTY_INPUT]);
    const from = f.x;
    for (let i = 0; i < 90; i++) step(s, [EMPTY_INPUT, EMPTY_INPUT]);
    return f.x - from;
  };
  it("lets a fighter stopping a run on the frozen pond slide on much further", () => {
    expect(slide("snow")).toBeGreaterThan(slide("gym") * 3);
  });
});

describe("trampoline", () => {
  const drop = (hold: Partial<InputFrame>, fighter = "lampjack") => {
    const s = createMatch({ stage: "gym", players: [{ fighter }, { fighter: "lampjack" }], seed: 1 });
    const f = s.fighters[0];
    f.x = 0; f.y = -300; f.grounded = false; f.platform = -1; f.action = "air"; f.jumpsLeft = 0; f.usedUpSpecial = true;
    let low = -Infinity, back = Infinity;
    for (let i = 0; i < 120; i++) {
      step(s, [inp(hold), EMPTY_INPUT]);
      low = Math.max(low, f.y);
      if (low >= -70) back = Math.min(back, f.y);
    }
    return { f, low, back };
  };
  it("springs a fighter falling onto it back up, with its jumps and up special back", () => {
    const { f, low, back } = drop({});
    expect(low).toBeLessThanOrEqual(-70);
    expect(back).toBeLessThan(-250);
    expect(f.usedUpSpecial).toBe(false);
  });
  it("springs everyone about as high, whatever their gravity", () => {
    const tops = ["lampjack", "slugbert", "woodstove"].map((id) => drop({}, id).back);
    expect(Math.max(...tops) - Math.min(...tops)).toBeLessThan(40);
  });
  it("lets a fighter holding down land on it", () => {
    const { f } = drop({ y: 100 });
    expect(f.grounded).toBe(true);
    expect(f.y).toBe(-70);
  });
});

describe("menu brawl stage", () => {
  it("runs six CPUs for a minute on the title screen's stage, fighters dropping in mid-match, and never ends", async () => {
    await loadAllHouse();
    const ids = ["woodstove", "slugbert", "rocket", "wizard", "lampjack", "woodstove"];
    const s = createMatch({ stage: "menu", players: ids.slice(0, 2).map((fighter) => ({ fighter, cpu: 5 })), rules: { stocks: 99, time: 0 }, seed: 11 });
    const stage = stages.menu;
    for (let frame = 0; frame < 3600; frame++) {
      if (frame % 600 === 599 && s.fighters.length < 6) {
        const slot = s.fighters.length;
        s.fighters.push(createFighter(slot, ids[slot], stage, s.rules, slot, 9));
        s.inputs.push({ ...EMPTY_INPUT });
        s.fighters[slot].x = stage.respawn.x; s.fighters[slot].y = stage.respawn.y; s.fighters[slot].grounded = false;
      }
      step(s, s.fighters.map((_, i) => cpuInput(s, i, 5)));
      s.ended = false;
      s.events.length = 0;
    }
    expect(s.fighters.length).toBe(6);
    expect(s.fighters.every((f) => Number.isFinite(f.x) && Number.isFinite(f.y))).toBe(true);
  });
});

describe("CPU pathing", () => {
  it("climbs from the menu floor to a target standing on top of the menu cards, by way of the circling platform and a shelf", async () => {
    await loadAllHouse();
    const s = createMatch({ stage: "menu", players: [{ fighter: "lampjack", cpu: 5 }, { fighter: "woodstove", cpu: 0 }], rules: { stocks: 99, time: 0 }, seed: 3 });
    const [cpu, dummy] = s.fighters;
    cpu.x = 300; cpu.y = 1000; cpu.platform = 0;
    dummy.x = 960; dummy.y = 350; dummy.platform = 1; dummy.grounded = true;
    let closest = Infinity, reachedAt = -1;
    for (let frame = 0; frame < 3600; frame++) {
      step(s, [cpuInput(s, 0, 5), EMPTY_INPUT]);
      s.ended = false; s.events.length = 0;
      dummy.x = 960; dummy.y = 350; dummy.platform = 1; dummy.grounded = true; dummy.percent = 0; dummy.action = "idle"; dummy.stocks = 99;
      const d = Math.hypot(cpu.x - dummy.x, cpu.y - dummy.y);
      if (d < closest) closest = d;
      if (d < 160 && reachedAt < 0) { reachedAt = frame; break; }
    }
    expect(reachedAt, `closest ${Math.round(closest)}`).toBeGreaterThanOrEqual(0);
    expect(reachedAt).toBeGreaterThan(120);
  });
});
