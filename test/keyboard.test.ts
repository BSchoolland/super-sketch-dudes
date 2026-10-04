import { beforeAll, describe, expect, it } from "vitest";
import { createMatch, step } from "../shared/sim";
import { B, EMPTY_INPUT, type InputFrame } from "../shared/input";
import { C } from "../shared/config";
import type { State } from "../shared/types";
import { loadAllHouse } from "./house";

beforeAll(loadAllHouse);
const two = () => createMatch({ stage: "proving", players: [{ fighter: "lampjack" }, { fighter: "lampjack" }], seed: 5 });
const inp = (p: Partial<InputFrame>): InputFrame => ({ ...EMPTY_INPUT, ...p });
const key = (p: Partial<InputFrame>): InputFrame => inp({ ...p, b: (p.b ?? 0) | B.DIGITAL });
const run = (s: State, frames: InputFrame[]) => { for (const i of frames) step(s, [i, EMPTY_INPUT]); return s.fighters[0]; };
const times = (n: number, i: InputFrame) => Array.from({ length: n }, () => i);

/** Press a direction, then attack on the next frame, and return the move that came out. */
function pressThenAttack(y: number, extra: number): string | null {
  const s = two();
  step(s, [inp({ y, b: extra }), EMPTY_INPUT]);
  step(s, [inp({ y, b: extra | B.ATTACK }), EMPTY_INPUT]);
  return s.fighters[0].move;
}

describe("keyboard attacks", () => {
  it("a fresh stick flick into attack is a smash", () => {
    expect(pressThenAttack(100, 0)).toBe("dsmash");
    expect(pressThenAttack(-100, 0)).toBe("usmash");
  });

  it("a key press and a tap of attack is the tilt, however fast", () => {
    for (const [y, tilt] of [[100, "dtilt"], [-100, "utilt"]] as const) {
      const f = run(two(), [key({ y }), key({ y, b: B.ATTACK }), key({ y })]);
      expect(f.action).toBe("attack");
      expect(f.move).toBe(tilt);
    }
  });

  it("attack held with the key becomes the smash, charging from the press", () => {
    const s = two();
    let f = run(s, [key({ y: -100 }), ...times(C.SMASH_HOLD + 1, key({ y: -100, b: B.ATTACK }))]);
    expect(f.action).toBe("smashCharge");
    expect(f.move).toBe("usmash");
    expect(f.charge).toBeGreaterThanOrEqual(C.SMASH_HOLD);
    f = run(s, [key({ y: -100 }), key({})]);
    expect(f.action).toBe("attack");
    expect(f.move).toBe("usmash");
    expect(f.chargeMul).toBeGreaterThan(1);
  });

  it("attack with no key is the jab at once", () => {
    const f = run(two(), [key({ b: B.ATTACK })]);
    expect(f.move).toBe("jab1");
  });

  it("the key that starts a dash and attack together hit forward in place; later in the dash it's the dash attack", () => {
    const together = run(two(), [key({ x: 100 }), key({ x: 100, b: B.ATTACK }), key({ x: 100 })]);
    expect(together.move).toBe("ftilt");
    const held = run(two(), [key({ x: 100 }), ...times(C.SMASH_HOLD + 2, key({ x: 100, b: B.ATTACK }))]);
    expect(held.move).toBe("fsmash");
    const running = run(two(), [...times(C.KEYS_TOGETHER + 3, key({ x: 100 })), key({ x: 100, b: B.ATTACK })]);
    expect(running.move).toBe("dashAttack");
  });

  it("toward the back turns around", () => {
    const f = run(two(), [key({ x: -100 }), ...times(C.SMASH_HOLD + 2, key({ x: -100, b: B.ATTACK }))]);
    expect(f.move).toBe("fsmash");
    expect(f.facing).toBe(-1);
  });
});
