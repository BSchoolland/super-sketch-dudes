// Where the auto moderator tells Ben: flagged characters and unjudged ones go to a Discord channel through BenBot.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Judgements } from "../shared/moderation";

const run = promisify(execFile);
const BENBOT = path.join(os.homedir(), "Projects/benbot/scripts");
const SEND = process.env.DISCORD_SEND ?? path.join(BENBOT, "discord-send");
const REPORT = process.env.BENBOT_REPORT ?? path.join(BENBOT, "report");

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

const title = (s: Submission) => `**${s.name || "(no name)"}** by ${s.playerName} · \`${s.fighterId}\``;

/** A character at least one judge flagged, whatever came of it. */
export async function alertFlagged(s: Submission, j: Judgements, d: { blocked: boolean; before: number; after: number }): Promise<void> {
  await post(s, [
    title(s),
    `harsh: **${j.harsh.verdict}**: ${j.harsh.reason}`,
    `lenient: **${j.lenient.verdict}**: ${j.lenient.reason}`,
    `${d.blocked ? "🚫 BLOCKED" : "✅ went through"} · reputation ${d.before} → ${d.after}`,
  ].join("\n"));
}

/** The judges couldn't run, so the character is going to the forge unjudged: Ben hears now, BenBot reviews it. */
export async function alertUnavailable(s: Submission, why: string): Promise<void> {
  const { channel, ping } = config();
  await post(s, `<@${ping}> ⚠️ the judges couldn't run, so ${title(s)} is going to the forge unchecked. BenBot is reviewing it.\n\`${why.slice(0, 300)}\``);
  await run(REPORT, ["--from", "sketch-forge", [
    `Auto moderator was unavailable, so the Super Sketch Dudes character "${s.name || "(no name)"}" by ${s.playerName} (${s.fighterId}, forge job ${s.jobId}) is being forged unjudged. Ben has been pinged in #moderation (${channel}).`,
    `Review it yourself: read the drawing at ${s.drawing} and judge it by the auto moderator's rules (forge/moderate.ts in ~/Projects/sketch-battle), as the lenient judge would.`,
    `Post your call in ${channel}. If it fails, remove the character the way SPONGE MY BOY was removed (DELETE /api/library/<id> with the owner's session from server-data/sessions.json on personal-server, once the forge has finished) and say so there.`,
  ].join(" ")]);
}
