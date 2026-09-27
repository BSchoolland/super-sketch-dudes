import { beforeAll, describe, expect, it } from "vitest";
import { createMatch, step } from "../shared/sim";
import { B, EMPTY_INPUT, type InputFrame } from "../shared/input";
import { hitOf } from "../shared/hits";
import { cpuInput } from "../shared/cpu";
import { roster } from "../shared/fighters/index";
import { C } from "../shared/config";
import { loadAllHouse } from "./house";

beforeAll(loadAllHouse);
const two = () => createMatch({ stage: "proving", players: [{ fighter: "lampjack" }, { fighter: "lampjack" }], seed: 5 });
const inp = (p: Partial<InputFrame>): InputFrame => ({ ...EMPTY_INPUT, ...p });
const run = (s: ReturnType<typeof two>, n: number, a: InputFrame = EMPTY_INPUT, b: InputFrame = EMPTY_INPUT) => { for (let i = 0; i < n; i++) { step(s, [a, b]); s.events.length = 0; } };

function launch(s: ReturnType<typeof two>, percent: number, angle = 40, damage = 12) {
  const a = s.fighters[0], v = s.fighters[1];
  a.x = -60; v.x = 0; v.facing = -1; a.facing = 1; a.moveFacing = 1; v.percent = percent;
  a.action = "attack"; a.move = "ftilt"; a.frame = 8; a.moveInstance = 1;
  hitOf(s, a, v, { frames: [8, 10], x: 60, y: -84, r: 14, damage, angle, base: 40, growth: 100 }, 0, -60);
  a.action = "idle"; a.move = null;
}

describe("defensive mechanics", () => {
  it("parry: shield raised within the window takes no shield damage and leaves the attacker in extra hitlag", () => {
    const s = two();
    const a = s.fighters[0], v = s.fighters[1];
    a.x = 0; v.x = 90; v.facing = -1;
    step(s, [inp({ b: B.ATTACK }), EMPTY_INPUT]);
    expect(a.move).toBe("jab1");
    // jab1 is active on frames 4-5: raise the shield on frame 3
    step(s, [EMPTY_INPUT, EMPTY_INPUT]); step(s, [EMPTY_INPUT, EMPTY_INPUT]);
    step(s, [EMPTY_INPUT, inp({ b: B.SHIELD })]);
    const before = v.shield;
    let parried = false;
    for (let i = 0; i < 4; i++) { step(s, [EMPTY_INPUT, inp({ b: B.SHIELD })]); if (s.events.some((e) => e.t === "parry")) parried = true; s.events.length = 0; }
    expect(parried).toBe(true);
    expect(v.shield).toBeGreaterThan(before - C.SHIELD_DRAIN * 5 - 0.01);
    expect(v.action).toBe("parry");
    expect(a.hitlag).toBeGreaterThan(8);
  });
  it("shield breaks when its HP is gone, and the victim is stunned for a long time", () => {
    const s = two();
    const v = s.fighters[1];
    v.shield = 3;
    v.x = 90; v.facing = -1; s.fighters[0].x = 0;
    for (let i = 0; i < 6; i++) step(s, [EMPTY_INPUT, inp({ b: B.SHIELD })]);
    step(s, [inp({ b: B.ATTACK }), inp({ b: B.SHIELD })]);
    let broke = false;
    for (let i = 0; i < 12; i++) { step(s, [EMPTY_INPUT, inp({ b: B.SHIELD })]); if (s.events.some((e) => e.t === "shieldBreak")) broke = true; s.events.length = 0; }
    expect(broke).toBe(true);
    expect(v.action).toBe("shieldBreak");
    run(s, 200, EMPTY_INPUT, inp({ b: B.SHIELD }));
    expect(v.action).toBe("shieldBreak");
  });
  it("DI perpendicular to the launch rotates it: holding out on an upward hit lowers the apex and adds distance", () => {
    const a = two(), b = two();
    launch(a, 80, 80); launch(b, 80, 80);
    // both victims are in hitlag; the stick during hitlag is DI
    let apexA = 0, apexB = 0;
    for (let i = 0; i < 90; i++) {
      step(a, [EMPTY_INPUT, EMPTY_INPUT]); step(b, [EMPTY_INPUT, inp({ x: 100 })]);
      apexA = Math.min(apexA, a.fighters[1].y); apexB = Math.min(apexB, b.fighters[1].y);
    }
    expect(apexB).toBeGreaterThan(apexA + 20); // y is down: DI out = a lower apex
    expect(Math.abs(b.fighters[1].x)).toBeGreaterThan(Math.abs(a.fighters[1].x) + 20);
  });
  it("teching a tumble landing avoids knockdown", () => {
    const noTech = two(), tech = two();
    launch(noTech, 20, 20, 14); launch(tech, 20, 20, 14);
    expect(noTech.fighters[1].action).toBe("tumble");
    let landedNo = "", landedTech = "", airNo = false, airTech = false;
    for (let i = 0; i < 400; i++) {
      step(noTech, [EMPTY_INPUT, EMPTY_INPUT]);
      const f = noTech.fighters[1];
      if (!f.grounded) airNo = true;
      if (airNo && f.grounded && !landedNo) landedNo = f.action;
      // tech: press shield every 12 frames so a press lands inside the 20-frame window before impact
      step(tech, [EMPTY_INPUT, inp({ b: i % 12 === 0 ? B.SHIELD : 0 })]);
      const g = tech.fighters[1];
      if (!g.grounded) airTech = true;
      if (airTech && g.grounded && !landedTech) landedTech = g.action;
      noTech.events.length = 0; tech.events.length = 0;
    }
    expect(landedNo).toBe("knockdown");
    expect(["tech", "techRoll"]).toContain(landedTech);
  });
  it("ledge trump: grabbing an occupied ledge pushes the occupant off", () => {
    const s = two();
    const a = s.fighters[0], b = s.fighters[1];
    a.x = 600; a.y = -40; a.grounded = false; a.action = "air"; a.vy = 2;
    for (let i = 0; i < 40 && a.ledge < 0; i++) step(s, [inp({ x: -60 }), EMPTY_INPUT]);
    expect(a.ledge).toBe(1);
    run(s, 10);
    b.x = 600; b.y = -40; b.grounded = false; b.action = "air"; b.vy = 2; b.ledgeCooldown = 0;
    for (let i = 0; i < 40 && b.ledge < 0; i++) step(s, [EMPTY_INPUT, inp({ x: -60 })]);
    expect(b.ledge).toBe(1);
    expect(a.ledge).toBe(-1);
    expect(a.action).toBe("air");
  });
  it("hitstun scales with knockback and ends", () => {
    const s = two();
    launch(s, 100, 40, 12);
    const v = s.fighters[1];
    const stun = v.pending!.hitstun;
    expect(stun).toBeGreaterThan(30);
    run(s, v.hitlag + stun + 70);
    expect(["air", "tumble", "idle", "land", "knockdown", "tech"]).toContain(v.action);
    if (v.action === "tumble") expect(v.frame).toBeGreaterThanOrEqual(v.hitstun);
  });
  it("the CPU recovers every house fighter from below the ledge", () => {
    for (const id of Object.keys(roster)) {
      const s = createMatch({ stage: "proving", players: [{ fighter: id }, { fighter: "lampjack" }], seed: 2 });
      const f = s.fighters[0];
      f.x = -700; f.y = 150; f.grounded = false; f.action = "air"; f.vy = 3; f.jumpsLeft = 1;
      let recovered = false;
      for (let i = 0; i < 400; i++) {
        step(s, [cpuInput(s, 0, 5), EMPTY_INPUT]);
        s.events.length = 0;
        if (f.ledge >= 0 || (f.grounded && f.x > -600)) { recovered = true; break; }
        if (f.stocks < 3) break;
      }
      expect(recovered, `${id} recovery`).toBe(true);
    }
  });
});

describe("edges", () => {
  it("a launch fast enough to put the centre inside the stage's side in one frame is pushed back out", () => {
    const s = two();
    const f = s.fighters[0];
    const halfW = roster.lampjack.stats.width / 2;
    f.grounded = false; f.platform = -1; f.action = "tumble"; f.hitstun = 40; f.frame = 2;
    f.x = 560 + halfW + 10; f.y = 80; f.vx = -90; f.vy = 0;
    s.fighters[1].x = -300;
    step(s, [EMPTY_INPUT, EMPTY_INPUT]);
    expect(f.x - halfW).toBeGreaterThanOrEqual(560 - 0.01);
  });

  it("a fighter coming down beside the edge is pushed clear of the wall instead of sinking into the stage's side", () => {
    for (const action of ["attack", "hitstun", "air"] as const) {
      const s = two();
      const f = s.fighters[0];
      const halfW = roster.lampjack.stats.width / 2;
      f.grounded = false; f.platform = -1; f.action = action; f.move = action === "attack" ? "nair" : null; f.frame = 3; f.hitstun = action === "hitstun" ? 30 : 0;
      f.x = 560 + halfW * 0.4; f.y = -3; f.vx = 0; f.vy = 6;
      s.fighters[1].x = -300;
      for (let i = 0; i < 12; i++) {
        step(s, [EMPTY_INPUT, EMPTY_INPUT]); s.events.length = 0;
        if (f.y > 1 && f.ledge < 0) expect(f.x - halfW, `${action} frame ${i}`).toBeGreaterThanOrEqual(560 - 0.01);
      }
    }
  });
});
