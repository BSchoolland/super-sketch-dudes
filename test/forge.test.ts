import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { runChecks } from "../forge/checks";
import { SPRITE_CELLS } from "../shared/gen/sprite";

const source = readFileSync(new URL("../forge/exemplar/lampjack.fighter.js", import.meta.url), "utf8");
const sprite = { px: 512, feetPx: 448, heightPx: 300, anims: {}, cells: Object.fromEntries(SPRITE_CELLS.map((c) => [c, `/gen/x/${c}.png`])) };
const bundle = (id: string, src: string) => ({ id, source: src, sprite, player: "t", description: "" });

describe("forge checks", () => {
  it("passes the exemplar and reports the ladder, recovery and kill percents", async () => {
    const r = await runChecks({ bundle: bundle("gen-forge-ok", source), height: 120 });
    expect(r.failures).toEqual([]);
    expect(Object.keys(r.ladder)).toEqual(["lampjack", "tank", "sirsticks", "dizzy"]);
    expect(r.recovery).toBeGreaterThanOrEqual(6);
    expect(r.killPercents.fsmash).toBeLessThan(300);
  });

  it("fails a fighter whose uspecial doesn't rise, a throwing hook and the wrong height, each with a specific message", async () => {
    const broken = source
      .replace("f.vy = -7 + (f.frame - 4) * 0.18;", "f.vy = 2;").replace("jumps: 3", "jumps: 1")
      .replace("cast: ({ f, state }) => {", "cast: ({ f, state }) => {\n        if (f.frame === 3) throw new Error(\"kaboom\");");
    expect(broken).not.toBe(source);
    const r = await runChecks({ bundle: bundle("gen-forge-bad", broken), height: 100 });
    const msgs = r.failures.map((f) => f.msg).join("\n");
    expect(msgs).toMatch(/stats\.height is 120 .* set stats\.height = 100/);
    expect(msgs).toMatch(/recovery: .* made it back [0-5]\/10/);
    expect(msgs).toMatch(/hook of move sspecial threw \d+x: "kaboom"/);
    expect(r.ok).toBe(false);
  });

  it("stops at lint and build problems", async () => {
    const r = await runChecks({ bundle: bundle("gen-forge-lint", source.replace("const stats = {", "const r0 = Math.random();\n  const stats = {")), height: 120 });
    expect(r.failures.map((f) => f.msg)).toEqual([expect.stringMatching(/^lint: line \d+: non-deterministic Math/)]);
  });
});
