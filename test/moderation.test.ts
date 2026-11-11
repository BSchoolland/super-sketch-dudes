import { describe, expect, it, beforeEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { attachModeration, blockedError, decide, reputationOf } from "../server/moderation";
import type { Judgement, Verdict } from "../shared/moderation";

const j = (verdict: Verdict): Judgement => ({ verdict, reason: "because" });
const judged = (harsh: Verdict, lenient: Verdict) => ({ harsh: j(harsh), lenient: j(lenient) });

describe("auto moderator reputation", () => {
  let dir = "";
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "mod-")); attachModeration(dir); });

  it("starts everyone at 90, rewards two passes up to 100", () => {
    expect(reputationOf("a")).toBe(90);
    expect(decide("a", { fighterId: "f1" }, judged("pass", "pass"))).toMatchObject({ blocked: false, before: 90, after: 92 });
    for (let i = 0; i < 3; i++) decide("a", { fighterId: `f${i + 2}` }, judged("pass", "pass"));
    expect(decide("a", { fighterId: "f5" }, judged("pass", "pass"))).toMatchObject({ before: 98, after: 100 });
    expect(decide("a", { fighterId: "f6" }, judged("pass", "pass"))).toMatchObject({ after: 100 });
  });

  it("lets one flag through at 75 or above for -5, blocks it below 75", () => {
    expect(decide("b", { fighterId: "f1" }, judged("inappropriate", "pass"))).toMatchObject({ blocked: false, after: 85 });
    decide("b", { fighterId: "f2" }, judged("pass", "gore"));
    expect(decide("b", { fighterId: "f3" }, judged("pass", "gore"))).toMatchObject({ blocked: false, before: 80, after: 75 });
    expect(decide("b", { fighterId: "f4" }, judged("language", "pass"))).toMatchObject({ blocked: false, before: 75, after: 70 });
    const d = decide("b", { fighterId: "f5" }, judged("language", "pass"));
    expect(d).toMatchObject({ blocked: true, before: 70, after: 65 });
    expect(blockedError(d.flags)).toBe("Auto moderator blocked your character for reason: foul language");
  });

  it("blocks two flags for -25 and names every reason once", () => {
    const d = decide("c", { fighterId: "f1" }, judged("inappropriate", "gore"));
    expect(d).toMatchObject({ blocked: true, after: 65 });
    expect(blockedError(d.flags)).toBe("Auto moderator blocked your character for reason: inappropriate art, excessive gore/violence");
    expect(blockedError(decide("c", { fighterId: "f2" }, judged("other", "other")).flags)).toBe("Auto moderator blocked your character for reason: other inappropriate content");
    decide("c", { fighterId: "f3" }, judged("other", "other"));
    expect(reputationOf("c")).toBe(15);
  });

  it("keeps scores across a restart and logs every decision", () => {
    decide("d", { fighterId: "f1" }, judged("gore", "gore"));
    attachModeration(dir);
    expect(reputationOf("d")).toBe(65);
    const log = fs.readFileSync(path.join(dir, "moderation.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    expect(log).toMatchObject([{ player: "d", fighterId: "f1", blocked: true, before: 90, after: 65 }]);
  });
});
