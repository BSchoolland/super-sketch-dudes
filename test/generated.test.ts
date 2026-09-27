import { beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createMatch, step, cloneState, hashState } from "../shared/sim";
import { cpuInput } from "../shared/cpu";
import { registerFighter, roster, rosterList, unregisterFighter } from "../shared/fighters/index";
import { buildGenerated, lintGeneratedSource, validateGenerated } from "../shared/gen/load";
import { startMove } from "../shared/fighter";
import { EMPTY_INPUT } from "../shared/input";
import { SPRITE_CELLS } from "../shared/gen/sprite";
import { loadHouse } from "./house";

const source = readFileSync(new URL("../forge/exemplar/sword-guy.fighter.js", import.meta.url), "utf8");
const sprite = { px: 512, feetPx: 448, heightPx: 300, anims: {}, cells: Object.fromEntries(SPRITE_CELLS.map((c) => [c, `/gen/sword-guy/${c}.png`])) };

describe("generated fighters", () => {
  beforeAll(async () => { await loadHouse("woodstove"); await loadHouse("slugbert"); });

  it("the exemplar lints, builds, validates and registers", async () => {
    expect(lintGeneratedSource(source)).toEqual([]);
    const def = await buildGenerated({ id: "gen-sword", source, sprite, player: "test", description: "a sword guy" });
    expect(validateGenerated(def)).toEqual([]);
    registerFighter(def);
    expect(roster["gen-sword"]).toBe(def);
    expect(rosterList.some((d) => d.id === "gen-sword")).toBe(true);
  });

  it("a 4-player CPU match with a generated fighter resimulates from a snapshot to the same hash", async () => {
    const def = await buildGenerated({ id: "gen-sword", source, sprite, player: "test", description: "a sword guy" });
    registerFighter(def);
    const cfg = { stage: "proving", players: [{ fighter: "gen-sword", cpu: 5 }, { fighter: "woodstove", cpu: 5 }, { fighter: "slugbert", cpu: 5 }, { fighter: "gen-sword", cpu: 5 }], seed: 7 };
    const a = createMatch(cfg);
    let snap: ReturnType<typeof cloneState> | null = null;
    const inputsAt: ReturnType<typeof cpuInput>[][] = [];
    let hookErrors = 0, moves = new Set<string>();
    for (let i = 0; i < 2400; i++) {
      const inputs = a.fighters.map((f) => cpuInput(a, f.slot, 5));
      inputsAt.push(inputs);
      step(a, inputs);
      for (const e of a.events) { if (e.t === "hookError") hookErrors++; if (e.t === "move" && a.fighters[e.slot].id === "gen-sword") moves.add(e.move); }
      a.events.length = 0;
      if (i === 1200) snap = cloneState(a);
    }
    expect(hookErrors).toBe(0);
    expect(moves.size).toBeGreaterThan(5);
    const b = snap!;
    for (let i = 1201; i < 2400; i++) { step(b, inputsAt[i]); b.events.length = 0; }
    expect(hashState(b)).toBe(hashState(a));
  });

  it("a hook that throws disables the move, drops the fighter to idle and reports it", async () => {
    const bad = source.replace("drive: ({ f, input }) => {", "drive: ({ f, input }) => {\n        if (f.frame === 3) throw new Error(\"kaboom\");");
    expect(bad).not.toBe(source);
    const def = await buildGenerated({ id: "gen-bad", source: bad, sprite, player: "test", description: "" });
    registerFighter(def);
    const s = createMatch({ stage: "proving", players: [{ fighter: "gen-bad" }, { fighter: "woodstove" }], seed: 1 });
    const f = s.fighters[0];
    startMove(s, f, "sspecial");
    const errors: string[] = [];
    for (let i = 0; i < 10; i++) { step(s, [EMPTY_INPUT, EMPTY_INPUT]); for (const e of s.events) if (e.t === "hookError") errors.push(`${e.move}:${e.error}`); s.events.length = 0; }
    expect(errors).toEqual(["sspecial:kaboom"]);
    expect(f.action).toBe("idle");
    // nothing outside the state changed: using the move again throws again, on the same frame
    startMove(s, f, "sspecial");
    for (let i = 0; i < 50; i++) { step(s, [EMPTY_INPUT, EMPTY_INPUT]); for (const e of s.events) if (e.t === "hookError") errors.push(`${e.move}:${e.error}`); s.events.length = 0; }
    expect(errors).toEqual(["sspecial:kaboom", "sspecial:kaboom"]);
    expect(s.projectiles.length).toBe(0);
    unregisterFighter("gen-bad");
  });

  it("validates looks and the hitbox fx that name them", async () => {
    const def = await buildGenerated({ id: "gen-look", source, sprite, player: "test", description: "" });
    expect(def.looks?.blade.crop).toEqual([298, 290, 132, 50]);
    const bad = { ...def, looks: { ...def.looks, weird: { cell: "nope", crop: [0, 0, 600, 10], shape: "cube", texture: "fur", trail: "rainbow", size: 2 } } } as unknown as typeof def;
    const problems = validateGenerated(bad, { strict: true });
    expect(problems).toEqual(expect.arrayContaining([
      expect.stringContaining("looks.weird.cell"), expect.stringContaining("looks.weird.crop outside"), expect.stringContaining("looks.weird.shape"),
      expect.stringContaining("looks.weird.texture"), expect.stringContaining("looks.weird.trail"), expect.stringContaining("looks.weird.size"),
    ]));
    const orphan = { ...def, moves: { ...def.moves, jab1: { ...def.moves.jab1, hitboxes: [{ ...def.moves.jab1.hitboxes[0], fx: "missing" }] } } };
    expect(validateGenerated(orphan, { strict: true }).some((m) => m.includes('jab1.hitboxes[0].fx "missing"'))).toBe(true);
    expect(validateGenerated(orphan)).toEqual([]);
    expect(validateGenerated(def, { strict: true })).toEqual([]);
  });

  it("rejects sources that reach outside the sim or would desync", () => {
    expect(lintGeneratedSource("export default function make(api) { return Math.random(); }")).toHaveLength(1);
    expect(lintGeneratedSource("export default function make(api) { fetch('x'); }")).toHaveLength(1);
    expect(lintGeneratedSource("const x = 1;")).toHaveLength(1);
  });

  it("reports every validation problem at once", async () => {
    const broken = source.replace("fullHop: 13.5", "fullHop: 999").replace('mv("dtilt"', 'mv("dtiltx"');
    await expect(buildGenerated({ id: "gen-broken", source: broken, sprite, player: "t", description: "" })).rejects.toThrow(/fullHop=999[\s\S]*dtilt\.id/);
  });
});

describe("the source lint", () => {
  it("ignores words inside comments and strings", async () => {
    const { codeOnly, lintGeneratedSource } = await import("../shared/gen/load");
    expect(lintGeneratedSource(source.replace("// SWORD GUY", "// SWORD GUY fights with a sword, says document.title"))).toEqual([]);
    expect(codeOnly('const a = "window"; // Date\nlet b = 1;')).toBe('const a = "      ";        \nlet b = 1;');
    expect(lintGeneratedSource(source.replace("const stats = {", "const w = window;\n  const stats = {"))).toEqual([expect.stringMatching(/reaches outside the sim/)]);
  });
});
