import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type { ForgeStanding, Player } from "../shared/account";

/**
 * The forge's budget. Every forge is an Opus agent session paid for out of a weekly subscription limit, so the
 * server holds the forge to a number of forges a week, in 7-day windows counted from `weekStartsAt` (the instant
 * the subscription's window resets), and each player to a share of it.
 *
 * <dataDir>/forge-budget.json, read at startup (a malformed file stops the server; restart to apply a change):
 *   perWeek          forges the worker may claim in one window; a claim is when the money is spent, so a forge
 *                    that later fails or is blocked by the moderator counts, and so does each retry
 *   weekStartsAt     an ISO instant a window starts at; windows run 7 days from it in both directions
 *   paused           null, or why the forge is paused (the kill switch: nothing new is claimed)
 *   perPlayerPerDay  drawings a signed-in player may send in any 24 hours
 *   waitingPerPlayer drawings a player may leave waiting while the forge rests
 *   guest            { lifetime: drawings one guest may ever send, perIpPerDay: guest drawings per network per 24 hours }
 * Missing, it is DEFAULT_BUDGET. <dataDir>/staff.json (a JSON array of player ids; missing means none) lists
 * players with no per-player limits; their forges still count toward the week.
 */
export interface ForgeBudget {
  perWeek: number;
  weekStartsAt: string;
  paused: string | null;
  perPlayerPerDay: number;
  waitingPerPlayer: number;
  guest: { lifetime: number; perIpPerDay: number };
}

export const DEFAULT_BUDGET: ForgeBudget = {
  perWeek: 100,
  weekStartsAt: "2026-11-06T19:00:00Z",
  paused: null,
  perPlayerPerDay: 3,
  waitingPerPlayer: 1,
  guest: { lifetime: 1, perIpPerDay: 3 },
};

/** Which allowance a job drew on when it was sent. */
export type Allowance = "player" | "guest" | "staff";

/** What the budget reads off a forge job. */
export interface BudgetJob {
  owner: string;
  status: "queued" | "running" | "done" | "failed";
  createdAt: number;
  /** Every time the worker claimed it: each one is a forge paid for. */
  claims: number[];
  allowance: Allowance;
  /** A guest's network (a hash of its address), for the per-network cap; null for everyone else. */
  ipKey: string | null;
}

/** A job's claims; one from before the budget kept only its last claim time. */
export const claimsOf = (j: { claims?: number[]; claimedAt: number }): number[] => j.claims ?? (j.claimedAt ? [j.claimedAt] : []);

export const DAY_MS = 86_400_000, WEEK_MS = 7 * DAY_MS;

export function parseBudget(raw: unknown, where: string): ForgeBudget {
  const fail = (why: string): never => { throw new Error(`${where}: ${why} (see server/budget.ts)`); };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) fail("must be a JSON object");
  const b = raw as Record<string, unknown>;
  const known = ["perWeek", "weekStartsAt", "paused", "perPlayerPerDay", "waitingPerPlayer", "guest"];
  for (const k of Object.keys(b)) if (!known.includes(k)) fail(`unknown field "${k}"`);
  for (const k of known) if (!(k in b)) fail(`"${k}" is missing`);
  const count = (v: unknown, name: string): number => (Number.isInteger(v) && (v as number) >= 0 ? (v as number) : fail(`${name} must be a whole number, 0 or more`));
  if (typeof b.weekStartsAt !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d(:\d\d)?(\.\d+)?(Z|[+-]\d\d:\d\d)$/.test(b.weekStartsAt) || Number.isNaN(Date.parse(b.weekStartsAt))) {
    fail(`weekStartsAt must be an ISO instant with its offset, like "2026-11-06T19:00:00Z"`);
  }
  if (b.paused !== null && (typeof b.paused !== "string" || !b.paused.trim())) fail("paused must be null or the reason, a non-empty string");
  const g = b.guest as Record<string, unknown> | null;
  if (!g || typeof g !== "object" || Array.isArray(g)) fail("guest must be { lifetime, perIpPerDay }");
  for (const k of Object.keys(g!)) if (k !== "lifetime" && k !== "perIpPerDay") fail(`unknown field "guest.${k}"`);
  return {
    perWeek: count(b.perWeek, "perWeek"),
    weekStartsAt: b.weekStartsAt as string,
    paused: b.paused as string | null,
    perPlayerPerDay: count(b.perPlayerPerDay, "perPlayerPerDay"),
    waitingPerPlayer: count(b.waitingPerPlayer, "waitingPerPlayer"),
    guest: { lifetime: count(g!.lifetime, "guest.lifetime"), perIpPerDay: count(g!.perIpPerDay, "guest.perIpPerDay") },
  };
}

export function parseStaff(raw: unknown, where: string): Set<string> {
  if (!Array.isArray(raw) || !raw.every((v) => typeof v === "string" && v)) throw new Error(`${where} must be a JSON array of player ids`);
  return new Set(raw);
}

let budget: ForgeBudget = DEFAULT_BUDGET;
let staff = new Set<string>();

/** Reads forge-budget.json and staff.json; throws on a malformed one. */
export function loadBudget(dataDir: string): ForgeBudget {
  const file = path.join(dataDir, "forge-budget.json");
  if (fs.existsSync(file)) budget = parseBudget(JSON.parse(fs.readFileSync(file, "utf8")), file);
  else {
    budget = DEFAULT_BUDGET;
    console.warn(`no ${file}: the forge budget is the default, ${JSON.stringify(DEFAULT_BUDGET)}`);
  }
  const staffFile = path.join(dataDir, "staff.json");
  staff = fs.existsSync(staffFile) ? parseStaff(JSON.parse(fs.readFileSync(staffFile, "utf8")), staffFile) : new Set();
  return budget;
}

export const currentBudget = (): ForgeBudget => budget;
export const staffIds = (): ReadonlySet<string> => staff;

/** The 7-day window `now` falls in, counted from the anchor either way. */
export function weekOf(anchor: string, now: number): { start: number; end: number } {
  const a = Date.parse(anchor);
  const start = a + Math.floor((now - a) / WEEK_MS) * WEEK_MS;
  return { start, end: start + WEEK_MS };
}

export function claimsBetween(jobs: Iterable<BudgetJob>, start: number, end: number): number {
  let n = 0;
  for (const j of jobs) for (const t of j.claims) if (t >= start && t < end) n++;
  return n;
}

/** Why the forge isn't taking jobs, or null when it is. */
export function restingOf(jobs: Iterable<BudgetJob>, now: number, b = budget): ForgeStanding["resting"] {
  if (b.paused !== null) return { reason: b.paused, until: null };
  const week = weekOf(b.weekStartsAt, now);
  return claimsBetween(jobs, week.start, week.end) >= b.perWeek ? { reason: null, until: week.end } : null;
}

export const allowanceOf = (player: Player, s: ReadonlySet<string> = staff): Allowance =>
  s.has(player.id) ? "staff" : player.id.startsWith("guest-") ? "guest" : "player";

/** A network's key on a guest's jobs: the address itself isn't kept. */
export const ipKeyOf = (ip: string): string => crypto.createHash("sha256").update(`sketch-battle forge ${ip}`).digest("hex").slice(0, 16);

/**
 * Of the times in `at` (when each counted drawing was sent), how many are within the last 24 hours, and, once
 * `limit` of them are, when the oldest that keeps it at the limit turns 24 hours old.
 */
function rolling(at: number[], limit: number, now: number): { used: number; moreAt: number | null } {
  const recent = at.filter((t) => t > now - DAY_MS).sort((x, y) => x - y);
  return { used: recent.length, moreAt: limit > 0 && recent.length >= limit ? recent[recent.length - limit] + DAY_MS : null };
}

export function standing(player: Player, ip: string, jobs: readonly BudgetJob[], now: number, b = budget, s: ReadonlySet<string> = staff): ForgeStanding {
  const kind = allowanceOf(player, s);
  const mine = jobs.filter((j) => j.owner === player.id);
  const waiting = mine.filter((j) => j.status === "queued").length;
  const resting = restingOf(jobs, now, b);
  const base = { kind, perPlayerPerDay: b.perPlayerPerDay, resting, waiting, waitingPerPlayer: b.waitingPerPlayer };
  if (kind === "staff") return { ...base, left: null, allowance: null, wall: null, moreAt: null };
  let left: number, wall: ForgeStanding["wall"] = null, moreAt: number | null = null;
  if (kind === "player") {
    const day = rolling(mine.map((j) => j.createdAt), b.perPlayerPerDay, now);
    left = Math.max(0, b.perPlayerPerDay - day.used);
    if (!left) { wall = "day"; moreAt = day.moreAt; }
  } else {
    const key = ipKeyOf(ip);
    const net = rolling(jobs.filter((j) => j.allowance === "guest" && j.ipKey === key).map((j) => j.createdAt), b.guest.perIpPerDay, now);
    const ever = Math.max(0, b.guest.lifetime - mine.length);
    left = Math.min(ever, Math.max(0, b.guest.perIpPerDay - net.used));
    if (!ever) wall = "guest";
    else if (!left) { wall = "network"; moreAt = net.moreAt; }
  }
  if (!wall && resting && waiting >= b.waitingPerPlayer) wall = "waiting";
  return { ...base, left, allowance: kind === "player" ? b.perPlayerPerDay : b.guest.lifetime, wall, moreAt };
}

const REFUSALS: Record<NonNullable<ForgeStanding["wall"]>, string> = {
  day: "that's all your new characters for today",
  guest: "guests get one new character: sign in to draw more",
  network: "guests on this network have made today's characters: sign in to draw more",
  waiting: "new characters are paused and your drawing is already waiting in line",
};

/** May this player send a drawing now: the allowance it draws on, or why not. */
export function admit(st: ForgeStanding): { allowance: Allowance } | { refused: string } {
  return st.wall ? { refused: REFUSALS[st.wall] } : { allowance: st.kind };
}
