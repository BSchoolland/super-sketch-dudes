// This week's forge budget: the window, used and remaining, the top spenders, guests' share, and the drawings
// waiting for a resting forge. Reads the live server's data over ssh (read-only), or a local data dir.
// Usage: npm run forge-budget [-- --data <dir>] [--top 10]
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { claimsOf, DEFAULT_BUDGET, parseBudget, parseStaff, restingOf, weekOf, type BudgetJob } from "../server/budget";

const arg = (name: string): string | null => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; };
const data = arg("--data");
const top = Number(arg("--top") ?? 10);
/** A data file's text, or null when it doesn't exist. */
function read(file: string): string | null {
  if (data) return fs.existsSync(path.join(data, file)) ? fs.readFileSync(path.join(data, file), "utf8") : null;
  const out = execFileSync("ssh", ["ssd-server", `f=~/sketch-battle/server-data/${file}; if [ -f $f ]; then cat $f; else echo MISSING; fi`], { encoding: "utf8" });
  return out.trim() === "MISSING" ? null : out;
}

const budgetText = read("forge-budget.json");
const budget = budgetText === null ? DEFAULT_BUDGET : parseBudget(JSON.parse(budgetText), "forge-budget.json");
const staffText = read("staff.json");
const staff = staffText === null ? new Set<string>() : parseStaff(JSON.parse(staffText), "staff.json");
const jobsText = read("forge-jobs.json");
if (jobsText === null) throw new Error("no forge-jobs.json");
type Job = BudgetJob & { playerName: string; claimedAt: number };
const jobs = (JSON.parse(jobsText) as Job[]).map((j) => ({ ...j, claims: claimsOf(j), allowance: j.allowance ?? "player", ipKey: j.ipKey ?? null }));

const now = Date.now();
const week = weekOf(budget.weekStartsAt, now);
const inWeek = (t: number) => t >= week.start && t < week.end;
const used = jobs.reduce((n, j) => n + j.claims.filter(inWeek).length, 0);
const byOwner = new Map<string, { name: string; forges: number; kind: string }>();
let guests = 0;
for (const j of jobs) {
  const n = j.claims.filter(inWeek).length;
  if (!n) continue;
  if (j.allowance === "guest") guests += n;
  const o = byOwner.get(j.owner) ?? { name: j.playerName, forges: 0, kind: staff.has(j.owner) ? "staff" : j.owner.startsWith("guest-") ? "guest" : "player" };
  o.forges += n;
  byOwner.set(j.owner, o);
}
const resting = restingOf(jobs, now, budget);
console.log(JSON.stringify({
  source: data ?? "ssd-server",
  budget: budgetText === null ? { ...budget, note: "no forge-budget.json: the default" } : budget,
  week: { from: new Date(week.start).toISOString(), to: new Date(week.end).toISOString() },
  used, remaining: Math.max(0, budget.perWeek - used),
  resting: resting && { reason: resting.reason, until: resting.until && new Date(resting.until).toISOString() },
  guests: { forges: guests, share: used ? +(guests / used).toFixed(3) : 0 },
  waiting: { drawings: jobs.filter((j) => j.status === "queued").length, players: new Set(jobs.filter((j) => j.status === "queued").map((j) => j.owner)).size, forTheForgeToReopen: !!resting },
  topSpenders: [...byOwner.values()].sort((a, b) => b.forges - a.forges).slice(0, top),
}, null, 1));
