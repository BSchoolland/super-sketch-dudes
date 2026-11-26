import { beforeAll, describe, expect, it } from "vitest";
import { createMatch, hashState, step } from "../shared/sim";
import { cpuInput } from "../shared/cpu";
import { SHOWMAN_TIER } from "../shared/cpu-skill";
import { loadAllHouse } from "./house";

beforeAll(loadAllHouse);

/** Two CPUs at `tier` for up to `frames`: the frame it stopped on, the state hash each second, and every KO. */
function fight(a: string, b: string, tier: number, stage: string, seed: number, stocks: number, frames: number) {
  const s = createMatch({ stage, players: [{ fighter: a, cpu: tier }, { fighter: b, cpu: tier }], rules: { stocks, time: 0 }, seed });
  const hashes: number[] = [], kos: { slot: number; by: number }[] = [];
  for (let i = 0; i < frames && !s.ended; i++) {
    step(s, [cpuInput(s, 0, tier), cpuInput(s, 1, tier)]);
    for (const e of s.events) if (e.t === "ko") kos.push({ slot: e.slot, by: e.by });
    s.events.length = 0;
    if (s.frame % 60 === 0) hashes.push(hashState(s));
  }
  return { frame: s.frame, hash: hashState(s), hashes, kos };
}

describe("CPU tiers", () => {
  // recorded before the showman existed: two CPUs at every tier, 40 seconds or 2 stocks, seed 11 + tier
  const GOLDEN: [string, string, number, number, number][] = [
    ["woodstove", "rocket", 1, 2400, 1427526149], ["woodstove", "rocket", 2, 2400, 3062700235], ["woodstove", "rocket", 3, 2400, 561426419],
    ["woodstove", "rocket", 4, 2400, 2543065005], ["woodstove", "rocket", 5, 2400, 2262157452],
    ["slugbert", "wizard", 1, 2400, 1957165240], ["slugbert", "wizard", 2, 2400, 144231434], ["slugbert", "wizard", 3, 2200, 3734475923],
    ["slugbert", "wizard", 4, 2030, 2648497385], ["slugbert", "wizard", 5, 2400, 3342277921],
    ["lampjack", "woodstove", 1, 2400, 3496816933], ["lampjack", "woodstove", 2, 2400, 3868954586], ["lampjack", "woodstove", 3, 2400, 1547408767],
    ["lampjack", "woodstove", 4, 2400, 890148701], ["lampjack", "woodstove", 5, 2400, 2728855740],
    ["rocket", "wizard", 1, 2400, 3651185417], ["rocket", "wizard", 2, 2400, 2140786952], ["rocket", "wizard", 3, 2400, 1261836854],
    ["rocket", "wizard", 4, 2400, 865448336], ["rocket", "wizard", 5, 2400, 1632802535],
  ];
  it("play exactly the fights they always have", () => {
    for (const [a, b, tier, frame, hash] of GOLDEN) {
      const r = fight(a, b, tier, "proving", 11 + tier, 2, 60 * 40);
      expect(`${a} v ${b} tier ${tier}: frame ${r.frame} hash ${r.hash}`).toBe(`${a} v ${b} tier ${tier}: frame ${frame} hash ${hash}`);
    }
  });
});

describe("showman CPU", () => {
  it("fights the same fight from the same seed", () => {
    for (const [a, b, seed] of [["woodstove", "rocket", 7], ["wizard", "lampjack", 8]] as const) {
      const one = fight(a, b, SHOWMAN_TIER, "final", seed, 1, 60 * 90), two = fight(a, b, SHOWMAN_TIER, "final", seed, 1, 60 * 90);
      expect(two.hashes).toEqual(one.hashes);
      expect(two.frame).toBe(one.frame);
    }
  });

  it("ends one-stock fights in a KO by the opponent, not a fall off the stage", () => {
    for (const [a, b] of [["woodstove", "rocket"], ["slugbert", "wizard"], ["lampjack", "woodstove"], ["rocket", "slugbert"]]) {
      for (const stage of ["proving", "final"]) for (const seed of [1, 2]) {
        const r = fight(a, b, SHOWMAN_TIER, stage, seed, 1, 60 * 90);
        const what = `${a} v ${b} on ${stage}, seed ${seed}`;
        expect(r.kos.length, `${what}: no KO in 90 s`).toBe(1);
        const [ko] = r.kos;
        expect(ko.by >= 0 && ko.by !== ko.slot, `${what}: slot ${ko.slot} self-destructed`).toBe(true);
      }
    }
  });
});
