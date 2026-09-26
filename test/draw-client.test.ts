import { describe, expect, it } from "vitest";
import { isBundlePath } from "../shared/account";
import { abandonedResult, battleReporter, DRAW_GRACE_MS, ladderHistory, phaseMs, secondsLeft, standings } from "../client/src/screens/draw/logic";
import type { DrawCharacter, DrawPlayer, DrawRoomState } from "../shared/draw";

const ch = (round: number, name: string, status: DrawCharacter["status"] = "ready"): DrawCharacter => ({ round, status, stage: "", drawingUrl: null, fighterId: name, bundleUrl: null, sheetUrl: null, name, tagline: null, description: null, card: null, error: null, spent: false });
const player = (id: number, characters: DrawCharacter[]): DrawPlayer => ({ id, name: `P${id}`, slot: id, ready: false, loaded: [], characters, current: 0, alive: true, wins: 0, connected: true });
const room = (players: DrawPlayer[], battles: [number[], number][], host = 1): DrawRoomState => ({
  code: "ABCD", host, phase: "between", round: 2, rounds: 2, drawSeconds: 90, deadline: 0, players,
  battles: battles.map(([participants, winner], index) => ({ index, participants, winner, seed: 1, stage: "proving" })), battle: null, note: "",
});

describe("draw client logic", () => {
  it("orders standings winner first, then stocks, then percent", () => {
    const fighters = [{ stocks: 0, percent: 40 }, { stocks: 2, percent: 90 }, { stocks: 1, percent: 10 }, { stocks: 1, percent: 5 }];
    expect(standings(fighters, 1)).toEqual([1, 3, 2, 0]);
    expect(standings(fighters, -1)).toEqual([1, 3, 2, 0]);
  });

  it("replays which character each player brought, skipping failed ones", () => {
    const r = room([player(1, [ch(1, "a1"), ch(2, "a2")]), player(2, [ch(1, "b1", "failed"), ch(2, "b2")]), player(3, [ch(1, "c1"), ch(2, "c2")])], [[[1, 2, 3], 1], [[1, 2, 3], 3]]);
    const names = ladderHistory(r).map((e) => e.fighters.map((f) => f.character?.name ?? null));
    expect(names).toEqual([["a1", "b2", "c1"], ["a1", null, "c2"]]);
  });

  it("the host reports unless they are sitting the battle out", () => {
    const r = room([player(1, []), player(2, []), player(3, [])], []);
    r.battle = { index: 0, participants: [2, 3], winner: null, seed: 1, stage: "proving" };
    expect(battleReporter(r)).toBe(2);
    r.battle.participants = [3, 1];
    expect(battleReporter(r)).toBe(1);
  });

  it("counts the clock down to the deadline minus grace", () => {
    expect(secondsLeft(10_000, 0, 4000)).toBe(6);
    expect(secondsLeft(10_000, 20_000, 4000)).toBe(0);
    expect(secondsLeft(0, 5)).toBe(0);
  });

  it("times each phase the way the server's timer does", () => {
    expect(phaseMs({ phase: "draw", drawSeconds: 45 })).toBe(45_000 + DRAW_GRACE_MS);
    expect(() => phaseMs({ phase: "reveal", drawSeconds: 45 })).toThrow();
    expect(phaseMs({ phase: "between", drawSeconds: 45 })).toBe(8_000);
    expect(() => phaseMs({ phase: "loading", drawSeconds: 45 })).toThrow();
  });

  it("ends an abandoned battle where it stopped, the missing players last", () => {
    const fighters = [{ stocks: 3, percent: 10 }, { stocks: 1, percent: 80 }, { stocks: 2, percent: 0 }];
    expect(abandonedResult(fighters, [0])).toEqual({ winner: 2, standings: [2, 1, 0] });
    expect(abandonedResult(fighters, [])).toEqual({ winner: 0, standings: [0, 2, 1] });
  });
});

describe("room fighter bundles", () => {
  it("accepts only same-site gen/ and house/ bundles named after the fighter", () => {
    expect(isBundlePath("/sketch-battle/gen/gen--ann-6435c8/bundle.json", "gen--ann-6435c8")).toBe(true);
    expect(isBundlePath("/sketch-battle/house/tank/bundle.json", "tank")).toBe(true);
    expect(isBundlePath("/gen/tank/bundle.json", "tank")).toBe(true);
    expect(isBundlePath("/sketch-battle/house/tank/bundle.json?v=709b13d", "tank")).toBe(true);
    expect(isBundlePath("/sketch-battle/gen/gen--ann-6435c8/0badf00d/bundle.json", "gen--ann-6435c8")).toBe(true);
    expect(isBundlePath("/sketch-battle/gen/gen--ann-6435c8/evil/bundle.json", "gen--ann-6435c8")).toBe(false);
    expect(isBundlePath("/sketch-battle/house/tank/bundle.json", "lampjack")).toBe(false);
    expect(isBundlePath("https://evil.example/gen/tank/bundle.json", "tank")).toBe(false);
    expect(isBundlePath("//evil.example/gen/tank/bundle.json", "tank")).toBe(false);
    expect(isBundlePath("/sketch-battle/gen/../api/tank/bundle.json", "tank")).toBe(false);
    expect(isBundlePath("house/tank/bundle.json", "tank")).toBe(false);
  });
});
