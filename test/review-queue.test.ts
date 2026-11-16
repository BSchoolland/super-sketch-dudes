import { afterAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "review-queue-"));
process.env.MODERATION_DIR = path.join(dir, "moderation");
process.env.BENBOT_JOBS = "/bin/true";
const { queueReview, REVIEW_QUEUE } = await import("../forge/mod-alerts");

afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("the unjudged-character review queue", () => {
  it("lives in its own folder, with its own copy of the drawing", async () => {
    const run = path.join(dir, "runs", "job1");
    fs.mkdirSync(run, { recursive: true });
    fs.writeFileSync(path.join(run, "drawing.png"), "png");
    await queueReview({ jobId: "job1", fighterId: "gen-1", playerName: "Pat", name: "BOB", drawing: path.join(run, "drawing.png") });
    expect(REVIEW_QUEUE).toBe(path.join(dir, "moderation", "moderation-review.jsonl"));
    fs.rmSync(path.join(dir, "runs"), { recursive: true });
    const entry = JSON.parse(fs.readFileSync(REVIEW_QUEUE, "utf8").trim());
    expect(entry).toMatchObject({ fighterId: "gen-1", name: "BOB" });
    expect(fs.readFileSync(entry.drawing, "utf8")).toBe("png");
  });
});
