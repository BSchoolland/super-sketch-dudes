import { beforeAll, describe, expect, it } from "vitest";
import { createMatch, step } from "../shared/sim";
import { B, EMPTY_INPUT, type InputFrame } from "../shared/input";
import { loadAllHouse } from "./house";

beforeAll(loadAllHouse);
const two = () => createMatch({ stage: "proving", players: [{ fighter: "lampjack" }, { fighter: "lampjack" }], seed: 5 });
const inp = (p: Partial<InputFrame>): InputFrame => ({ ...EMPTY_INPUT, ...p });

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
  it("a key press into attack is a tilt, however fast", () => {
    expect(pressThenAttack(100, B.DIGITAL)).toBe("dtilt");
    expect(pressThenAttack(-100, B.DIGITAL)).toBe("utilt");
  });
  it("the smash key smashes in the held direction, forward when neutral", () => {
    const smashKey = (y: number) => { const s = two(); step(s, [inp({ y, b: B.DIGITAL | B.SMASH | B.ATTACK }), EMPTY_INPUT]); return s.fighters[0].move; };
    expect(smashKey(-100)).toBe("usmash");
    expect(smashKey(100)).toBe("dsmash");
    expect(smashKey(0)).toBe("fsmash");
  });
});
