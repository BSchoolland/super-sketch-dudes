import fs from "node:fs";
import path from "node:path";
import { FLAG_LABELS, type Flag, type Judgements } from "../shared/moderation";

/**
 * Player reputation, 0-100, driven by the auto moderator's two judges. Scores live in <dataDir>/reputation.json;
 * every decision is appended to <dataDir>/moderation.jsonl.
 */
const START = 90, MAX = 100;
/** Below this, one judge flagging is enough to block. */
const TRUSTED = 75;
const BOTH_PASS = 2, ONE_FLAG = -5, BOTH_FLAG = -25;

let scores: Record<string, number> = {};
let scoresFile = "", logFile = "";

export function attachModeration(dataDir: string): void {
  scoresFile = path.join(dataDir, "reputation.json");
  logFile = path.join(dataDir, "moderation.jsonl");
  scores = fs.existsSync(scoresFile) ? JSON.parse(fs.readFileSync(scoresFile, "utf8")) : {};
}

export const reputationOf = (player: string): number => scores[player] ?? START;

/** `held`: flagged but let through, so kept out of COMMUNITY until Ben releases it. */
export interface Decision { blocked: boolean; held: boolean; error: string | null; before: number; after: number }

/** Applies one submission's judgements to its player's reputation, and says whether it may go to the forge. */
export function decide(player: string, fighterId: string, j: Judgements): Decision {
  const flags = [j.harsh, j.lenient].map((x) => x.verdict).filter((v): v is Flag => v !== "pass");
  const before = reputationOf(player);
  const blocked = flags.length === 2 || (flags.length === 1 && before < TRUSTED);
  const after = Math.max(0, Math.min(MAX, before + [BOTH_PASS, ONE_FLAG, BOTH_FLAG][flags.length]));
  scores[player] = after;
  fs.writeFileSync(scoresFile, JSON.stringify(scores, null, 1));
  const error = blocked ? `Auto moderator blocked your character for reason: ${[...new Set(flags)].map((f) => FLAG_LABELS[f]).join(", ")}` : null;
  fs.appendFileSync(logFile, JSON.stringify({ at: Date.now(), player, fighterId, ...j, blocked, held: flags.length > 0 && !blocked, before, after }) + "\n");
  return { blocked, held: flags.length > 0 && !blocked, error, before, after };
}
