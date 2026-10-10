// Where the forge tells Ben: flagged characters, unjudged ones and sheet fallbacks go to a Discord channel through BenBot.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import type { Judgements } from "../shared/moderation";

const run = promisify(execFile);
const BENBOT = path.join(os.homedir(), "Projects/benbot/scripts");
const SEND = process.env.DISCORD_SEND ?? path.join(BENBOT, "discord-send");
const JOBS = process.env.BENBOT_JOBS ?? path.join(BENBOT, "jobs");
/** Read by BenBot's moderation-review job (~/Projects/benbot/jobs/moderation-review.md). */
export const REVIEW_QUEUE = path.join(path.dirname(fileURLToPath(import.meta.url)), "runs", "moderation-review.jsonl");

export interface Submission { jobId: string; fighterId: string; playerName: string; name: string; drawing: string }

function config(): { channel: string; ping: string } {
  const channel = process.env.MODERATION_CHANNEL, ping = process.env.MODERATION_PING;
  if (!channel || !ping) throw new Error("MODERATION_CHANNEL and MODERATION_PING (a Discord user id) must be set (~/.config/sketch-forge/env)");
  return { channel, ping };
}
/** Checked once at startup so a misconfigured worker doesn't wait for the first flag to find out. */
export const checkAlertConfig = (): void => void config();

async function post(s: Submission, text: string): Promise<void> {
  // the SPOILER_ prefix is what makes Discord blur an attachment
  const file = path.join(path.dirname(s.drawing), `SPOILER_${s.fighterId}.png`);
  fs.copyFileSync(s.drawing, file);
  await run(SEND, [config().channel, "--file", file, "--", text]);
}

/** Anything else the forge needs Ben to hear about, with a ping. */
export async function tellBen(text: string): Promise<void> {
  await run(SEND, [config().channel, `<@${config().ping}> ${text}`]);
}

const title = (s: Submission) => `**${s.name || "(no name)"}** by ${s.playerName} · \`${s.fighterId}\``;

/** A character at least one judge flagged, whatever came of it. */
export async function alertFlagged(s: Submission, j: Judgements, d: { blocked: boolean; held: boolean; before: number; after: number }): Promise<void> {
  await post(s, [
    title(s),
    `harsh: **${j.harsh.verdict}**: ${j.harsh.reason}`,
    `lenient: **${j.lenient.verdict}**: ${j.lenient.reason}`,
    `${d.blocked ? "🚫 BLOCKED" : d.held ? "⏸ forging, held out of Community: @BenBot release or take it down" : "✅ went through"} · reputation ${d.before} → ${d.after}`,
  ].join("\n"));
}

/** The judges couldn't run, so the character is going to the forge unjudged: Ben hears now. */
export async function alertUnavailable(s: Submission, why: string): Promise<void> {
  await post(s, `<@${config().ping}> ⚠️ the judges couldn't run, so ${title(s)} is going to the forge unchecked. BenBot will review it once it's forged.\n\`${why.slice(0, 300)}\``);
}

/** An unjudged character, now forged, for BenBot's moderation-review job to look at (and take down if it fails). */
export async function queueReview(s: Submission): Promise<void> {
  fs.appendFileSync(REVIEW_QUEUE, JSON.stringify({ ...s, at: Date.now() }) + "\n");
  await run(JOBS, ["run", "moderation-review"]);
}
