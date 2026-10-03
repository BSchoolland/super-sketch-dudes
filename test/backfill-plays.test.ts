import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { initLibrary, playCount } from "../server/library";

/** scripts/backfill-plays.mjs over a hand-built event log shaped like the relay's. */
const match = (trace: string, seq: number, fighters?: string[], source = "server") => JSON.stringify({
  at: "2026-10-01T00:00:00.000Z", id: `${trace}-${source}`, kind: "match", source, trace, parent: null, level: "info", headline: null,
  t0: 1, t1: 1, seq, final: false, issues: [], business: fighters ? { members: fighters.map((fighter, slot) => ({ id: `p${slot}`, slot, fighter })) } : {},
});
const other = JSON.stringify({ id: "x", kind: "room", source: "server", trace: "r-A", seq: 1, business: { members: [{ fighter: "wizard" }] } });

function dataDir(current: string[], rotated?: string[]): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sb-backfill-"));
  fs.writeFileSync(path.join(dir, "events.jsonl"), current.join("\n") + "\n");
  if (rotated) fs.writeFileSync(path.join(dir, "events.jsonl.1"), rotated.join("\n") + "\n");
  return dir;
}
const backfill = (dir: string) => spawnSync("node", ["scripts/backfill-plays.mjs", dir], { encoding: "utf8" });
const plays = (dir: string) => JSON.parse(fs.readFileSync(path.join(dir, "plays.json"), "utf8"));

describe("backfill-plays", () => {
  it("counts each server match once per member, across the rotated log, in the file the server reads", () => {
    const dir = dataDir(
      [match("m-B", 1), match("m-B", 2, ["gen-a", "gen-b"]), match("m-B", 3, ["gen-a", "gen-b"]), match("m-A", 4, ["gen-a", "wizard"]), match("m-B", 1, ["gen-b", "gen-b"], "client"), other],
      [match("m-A", 1), match("m-A", 2, ["gen-a", "wizard"]), match("m-C", 2, ["gen-a", "gen-a", "rocket"])],
    );
    const run = backfill(dir);
    expect(run.status, run.stderr).toBe(0);
    expect(plays(dir)).toEqual({ "gen-a": 4, "gen-b": 1, wizard: 1, rocket: 1 });
    initLibrary(dir);
    expect([playCount("gen-a"), playCount("gen-c")]).toEqual([4, 0]);
  });

  it("leaves an existing plays.json alone", () => {
    const dir = dataDir([match("m-A", 2, ["gen-a", "gen-b"])]);
    fs.writeFileSync(path.join(dir, "plays.json"), JSON.stringify({ "gen-a": 7 }));
    expect(backfill(dir).status).toBe(0);
    expect(plays(dir)).toEqual({ "gen-a": 7 });
  });

  it("fails without writing on a broken line, malformed members, or a match that never got its members", () => {
    for (const [lines, error] of [
      [[match("m-A", 2, ["gen-a", "gen-b"]), "{not json"], /events\.jsonl:2:/],
      [[match("m-A", 2, ["gen-a", ""])], /m-A has malformed members/],
      [[match("m-A", 1), match("m-B", 2, ["gen-a", "gen-b"])], /no members snapshot: m-A/],
    ] as const) {
      const dir = dataDir([...lines]);
      const run = backfill(dir);
      expect(run.status).not.toBe(0);
      expect(run.stderr).toMatch(error);
      expect(fs.existsSync(path.join(dir, "plays.json"))).toBe(false);
    }
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), "sb-backfill-"));
    expect(backfill(empty).stderr).toMatch(/no .*events\.jsonl/);
  });
});
