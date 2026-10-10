#!/usr/bin/env node
// What the forge spent over a window, at API list prices: Claude agent (session result) + sprite sheets (sheet-cost.jsonl).
// Usage: node scripts/forge-spend.mjs [--hours 24]
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const i = process.argv.indexOf("--hours");
const hours = i > 0 ? Number(process.argv[i + 1]) : 24;
const since = Date.now() - hours * 36e5;
const runs = path.join(path.dirname(new URL(import.meta.url).pathname), "..", "forge", "runs");
const jobs = new Map(JSON.parse(execFileSync("ssh", ["personal-server", "cat ~/sketch-battle/server-data/forge-jobs.json"], { encoding: "utf8" })).map((j) => [j.id, j]));

// players are named by display name, with an account suffix (the one in their fighter ids) where two share a name
const owners = new Map();
for (const j of jobs.values()) (owners.get(j.playerName) ?? owners.set(j.playerName, new Set()).get(j.playerName)).add(j.owner);
const who = (j) => (!j ? "?" : owners.get(j.playerName).size > 1 ? `${j.playerName} (${j.owner.replace(/\W+/g, "").slice(-4)})` : j.playerName);

const rows = [];
for (const id of fs.readdirSync(runs)) {
  const prompt = path.join(runs, id, "prompt.txt");
  if (!fs.existsSync(prompt) || fs.statSync(prompt).mtimeMs < since) continue;
  const session = path.join(runs, id, "session.jsonl");
  let agent = 0;
  if (fs.existsSync(session)) for (const l of fs.readFileSync(session, "utf8").split("\n")) if (l.includes('"type":"result"')) agent = Number(JSON.parse(l).total_cost_usd ?? 0);
  const ledger = path.join(runs, id, "sheet-cost.jsonl");
  const sheetLines = fs.existsSync(ledger) ? fs.readFileSync(ledger, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
  const job = jobs.get(id);
  rows.push({ id, player: who(job), name: job?.result?.name ?? job?.hint?.name ?? "?", status: job?.status ?? "?", agent,
    sheets: sheetLines.reduce((s, r) => s + (r.costUsd ?? 0), 0), sheetCalls: sheetLines.length, blocked: sheetLines.filter((r) => r.error).length,
    codexSheets: sheetLines.filter((r) => r.backend === "codex").length, codexFallbacks: sheetLines.filter((r) => r.codexError).map((r) => r.codexError), logged: fs.existsSync(ledger) });
}
// the auto moderator stops jobs before the forge writes a run, so it's counted from the server's records
const recent = [...jobs.values()].filter((j) => j.createdAt >= since);
const judged = execFileSync("ssh", ["personal-server", "cat ~/sketch-battle/server-data/moderation.jsonl 2>/dev/null || true"], { encoding: "utf8" })
  .split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((d) => d.at >= since);
// every judge run in the window, blocked jobs included (they never write a prompt.txt)
let judgeUsd = 0;
for (const id of fs.readdirSync(runs)) for (const x of ["harsh", "lenient"]) {
  const log = path.join(runs, id, `moderation-${x}`, "session.log");
  if (!fs.existsSync(log) || fs.statSync(log).mtimeMs < since) continue;
  for (const l of fs.readFileSync(log, "utf8").split("\n")) if (l.includes('"type":"result"')) judgeUsd += Number(JSON.parse(l).total_cost_usd ?? 0);
}
const moderation = {
  judgeUsd: +judgeUsd.toFixed(2),
  judged: judged.length,
  split: judged.filter((d) => (d.harsh.verdict === "pass") !== (d.lenient.verdict === "pass")).length,
  blocked: recent.filter((j) => j.error?.startsWith("Auto moderator blocked")).map((j) => `${who(j)}: ${j.hint?.name || "(no name)"}: ${j.error.replace("Auto moderator blocked your character for reason: ", "")}`),
  // the judges couldn't run and the character was forged unjudged (fail open)
  unavailable: rows.filter((r) => ["harsh", "lenient"].some((x) => fs.existsSync(path.join(runs, r.id, `moderation-${x}`)) && !fs.existsSync(path.join(runs, r.id, `moderation-${x}`, "verdict.json")))).map((r) => `${r.player}: ${r.name}`),
};

const sum = (f) => rows.reduce((s, r) => s + f(r), 0);
const byPlayer = {};
for (const r of rows) (byPlayer[r.player] ??= { n: 0, usd: 0 }), byPlayer[r.player].n++, (byPlayer[r.player].usd += r.agent + r.sheets);
console.log(JSON.stringify({
  hours, forges: rows.length, done: rows.filter((r) => r.status === "done").length, failed: rows.filter((r) => r.status === "failed").length,
  claudeUsd: +sum((r) => r.agent).toFixed(2), sheetUsd: +sum((r) => r.sheets).toFixed(2), sheetCalls: sum((r) => r.sheetCalls), sheetBlocked: sum((r) => r.blocked),
  // sheets drawn through Ben's ChatGPT login ($0) vs on the paid API because codex failed or the pool was past the forge's cap
  codex: { sheets: sum((r) => r.codexSheets), fallbacks: rows.flatMap((r) => r.codexFallbacks), weeklyPercent: JSON.parse(execFileSync(path.join(os.homedir(), "Projects/benbot/scripts/codex-limits"), ["--json"], { encoding: "utf8" })).weekly.percent },
  runsWithoutSheetLog: rows.filter((r) => !r.logged).length,
  byPlayer: Object.fromEntries(Object.entries(byPlayer).sort((a, b) => b[1].usd - a[1].usd).map(([p, v]) => [p, { forges: v.n, usd: +v.usd.toFixed(2) }])),
  moderation,
  failures: rows.filter((r) => r.status === "failed").map((r) => `${r.player}: ${r.name}`),
}, null, 1));
