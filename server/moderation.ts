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
  pruneLog(Date.now());
}

/** The moderator's records are kept a year (the privacy page says so). */
export const MODERATION_KEEP_MS = 365 * 86_400_000;

function pruneLog(now: number): void {
  if (!fs.existsSync(logFile)) return;
  const lines = fs.readFileSync(logFile, "utf8").split("\n").filter(Boolean);
  const kept = lines.filter((l) => now - (JSON.parse(l) as { at: number }).at <= MODERATION_KEEP_MS);
  if (kept.length !== lines.length) fs.writeFileSync(logFile, kept.map((l) => l + "\n").join(""));
}

export const reputationOf = (player: string): number => scores[player] ?? START;

export const BLOCKED_ERROR = "Auto moderator blocked your character";
export const blockedError = (flags: Flag[]): string => `${BLOCKED_ERROR} for reason: ${[...new Set(flags)].map((f) => FLAG_LABELS[f]).join(", ")}`;

/** `held`: flagged but let through (a drawing is kept out of COMMUNITY until Ben releases it). `flags`: what the judges flagged. */
export interface Decision<F extends string = Flag> { blocked: boolean; held: boolean; flags: F[]; before: number; after: number }

/** What was judged: a drawing (and the name on it) or a name a player asked to go by. */
export type Subject = { fighterId: string } | { name: string };

/** Applies one submission's judgements to its player's reputation, and says whether it is blocked. */
export function decide<V extends string>(player: string, subject: Subject, j: Judgements<V>): Decision<Exclude<V, "pass">> {
  const flags = [j.harsh, j.lenient].map((x) => x.verdict).filter((v): v is Exclude<V, "pass"> => v !== "pass");
  const before = reputationOf(player);
  const blocked = flags.length === 2 || (flags.length === 1 && before < TRUSTED);
  const held = flags.length > 0 && !blocked;
  const after = Math.max(0, Math.min(MAX, before + [BOTH_PASS, ONE_FLAG, BOTH_FLAG][flags.length]));
  scores[player] = after;
  fs.writeFileSync(scoresFile, JSON.stringify(scores, null, 1));
  fs.appendFileSync(logFile, JSON.stringify({ at: Date.now(), player, ...subject, ...j, blocked, held, before, after }) + "\n");
  return { blocked, held, flags, before, after };
}

/** A guest signing in keeps the lower of their two reputations; `to` null drops the guest's score. */
export function moveReputation(from: string, to: string | null): void {
  if (!(from in scores)) return;
  if (to) scores[to] = Math.min(reputationOf(to), scores[from]);
  delete scores[from];
  fs.writeFileSync(scoresFile, JSON.stringify(scores, null, 1));
}
