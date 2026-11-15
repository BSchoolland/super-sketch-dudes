import { beforeAll, describe, expect, it } from "vitest";
import { registerFighter, roster } from "../shared/fighters/index";
import { startMove } from "../shared/fighter";
import type { HookCtx } from "../shared/types";
import { DemoRun, demoMoves, showings, type DemoMove, type Rep } from "../client/src/screens/demorun";
import { loadAllHouse } from "./house";

const all = (job: Generator<void, Rep[]>): Rep[] => {
  for (;;) { const r = job.next(); if (r.done) return r.value; }
};
const move = (id: string, name: string): DemoMove => demoMoves(roster[id]).find((m) => m.name === name)!;

beforeAll(async () => {
  await loadAllHouse();
  const base = roster.lampjack;
  // full RAGE turns the special into the forward smash; so does a full bar the player never sees
  const smashWhenFull = (key: string) => (ctx: HookCtx) => {
    if (ctx.f.frame === 1 && ctx.f.bars[key] >= 10) { startMove(ctx.state, ctx.f, "fsmash"); return; }
    base.hooks.flash(ctx);
  };
  registerFighter({
    ...base, id: "raging",
    bars: { ...base.bars, rage: { label: "RAGE", color: "#f00", max: 10 } },
    hooks: { ...base.hooks, flash: smashWhenFull("rage") },
  });
  registerFighter({
    ...base, id: "hidden",
    bars: { ...base.bars, secret: { label: "SECRET", color: "#f00", max: 10, show: () => false } },
    hooks: { ...base.hooks, flash: smashWhenFull("secret") },
  });
});

describe("move demo showings", () => {
  it("put the dummy where every move of the house fighters lands, sprung up to meet the ones that strike in the air", () => {
    const missed: string[] = [];
    let sprung = 0;
    for (const id of ["woodstove", "slugbert", "rocket", "wizard", "lampjack"]) {
      for (const m of demoMoves(roster[id])) for (const dir of m.dirs) {
        const run = new DemoRun(id, "woodstove", m, { dir, bar: null, tap: false });
        if (run.setup.launch) sprung++;
        let hit = false;
        while (!run.done && !hit) hit = run.tick().some((e) => e.t === "hit" && e.attacker === 0 && e.victim === 1);
        if (!hit) missed.push(`${id} ${m.kind}:${dir}`);
      }
    }
    // lampjack's down special is a counter, and the dummy never attacks
    expect(missed).toEqual(["lampjack special:d"]);
    expect(sprung).toBeGreaterThan(0);
  });

  it("are just the directions when no bar or tap changes what happens", () => {
    // lampjack's HEAT only makes it glow, and its charge never reaches a hit
    for (const m of demoMoves(roster.lampjack)) {
      expect(all(showings("lampjack", "wizard", m))).toEqual(m.dirs.map((dir) => ({ dir, bar: null, tap: false })));
    }
  });

  it("add the move with a bar full when that makes it another move", () => {
    expect(all(showings("raging", "wizard", move("raging", "SPECIAL")))).toEqual([
      { dir: "n", bar: null, tap: false },
      { dir: "n", bar: "rage", tap: false },
    ]);
  });

  it("leave out a bar that's never drawn", () => {
    expect(all(showings("hidden", "wizard", move("hidden", "SPECIAL")))).toEqual([{ dir: "n", bar: null, tap: false }]);
  });

  it("tap a held special first when tapping it does something else", () => {
    expect(all(showings("wizard", "lampjack", move("wizard", "SPECIAL")))).toEqual([
      { dir: "n", bar: null, tap: true },
      { dir: "n", bar: null, tap: false },
    ]);
  });
});
