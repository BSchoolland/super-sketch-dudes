// Prints wide events readably; see USAGE. Bundled to dist/events.mjs so it runs on the server too.
import fs from "node:fs";
import path from "node:path";
import { filterEvents, readEvents, type EventQuery, type StoredEvent } from "../server/eventlog";
import type { EventLevel } from "../shared/wide";

const USAGE = `npm run events -- [--trace <id>] [--since 2h] [--level warn] [--kind match] [--grep text]
  [--limit 50] [-v | --full | --json] [--legacy] [--data <dir>]
--trace matches an event's trace, parent or id: a match trace (m-<room>-<seed>) finds every client and the relay,
a session trace (s-...) finds the session with its matches, requests and relay connection.`;
const args = process.argv.slice(2);
const flag = (name: string): boolean => args.includes(name);
const value = (name: string): string | undefined => {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const v = args[i + 1];
  if (v === undefined || v.startsWith("--")) throw new Error(`${name} needs a value`);
  return v;
};
const known = new Set(["--trace", "--since", "--level", "--kind", "--grep", "--limit", "--data", "-v", "--full", "--json", "--legacy", "--help"]);
for (const a of args) if (a.startsWith("-") && !known.has(a)) throw new Error(`unknown flag ${a}\n${USAGE}`);
if (flag("--help")) { console.log(USAGE); process.exit(0); }

function parseSince(s: string): number {
  const m = /^(\d+(?:\.\d+)?)(s|m|h|d)$/.exec(s);
  if (m) return Date.now() - Number(m[1]) * { s: 1e3, m: 6e4, h: 36e5, d: 864e5 }[m[2] as "s" | "m" | "h" | "d"];
  const t = Date.parse(s);
  if (Number.isNaN(t)) throw new Error(`--since wants 90s, 30m, 2h, 1d or a date, not ${s}`);
  return t;
}

const level = value("--level");
if (level && !["info", "warn", "error"].includes(level)) throw new Error(`--level is info, warn or error, not ${level}`);
const dataDir = value("--data") ?? process.env.SKETCHBATTLE_DATA ?? path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "server-data");
const since = value("--since");
const query: EventQuery = { trace: value("--trace"), since: since ? parseSince(since) : undefined, level: level as EventLevel | undefined, kind: value("--kind"), grep: value("--grep") };
const limit = Number(value("--limit") ?? (query.trace ? 500 : 50));
const full = flag("--full");
const verbose = full || flag("-v") || !!query.trace;
const events = filterEvents(readEvents(dataDir), query).slice(-limit);

const tty = process.stdout.isTTY;
const paint = (code: number, s: string): string => (tty ? `\x1b[${code}m${s}\x1b[0m` : s);
const LEVEL_COLOR: Record<EventLevel, number> = { info: 2, warn: 33, error: 31 };
const pad2 = (n: number): string => String(n).padStart(2, "0");
function when(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}
function span(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m${Math.round((ms % 60_000) / 1000)}s`;
  return `${Math.floor(ms / 3_600_000)}h${Math.round((ms % 3_600_000) / 60_000)}m`;
}
const clip = (s: string, n: number): string => (full || s.length <= n ? s : s.slice(0, n - 1) + "…");
function who(e: StoredEvent): string {
  if (e.source === "server") return "server";
  return e.client?.player?.name ?? "anon";
}
function headline(e: StoredEvent): string {
  if (e.request) return `${e.request.method} ${e.request.path} ${e.request.status} ${e.request.ms}ms${e.headline ? ` · ${e.headline}` : ""}`;
  return e.headline ?? "";
}

function line(e: StoredEvent): string {
  const lvl = paint(LEVEL_COLOR[e.level], e.level.toUpperCase().padEnd(5));
  const state = e.final ? "" : paint(35, " open");
  return `${when(e.t0)} ${lvl} ${e.kind.padEnd(10)} ${who(e).padEnd(14)} ${paint(36, e.trace)}${state}  ${clip(headline(e), 140)}`;
}

function detail(e: StoredEvent): string[] {
  const out: string[] = [];
  const row = (k: string, v: string) => out.push(`    ${paint(2, k.padEnd(10))} ${v}`);
  row("event", `${e.id} · seq ${e.seq} · ${e.final ? "final" : "not final"} · ${span(e.t1 - e.t0)} · written ${e.at}${e.parent ? ` · parent ${e.parent}` : ""}`);
  if (e.client) {
    const c = e.client;
    row("client", `${c.session} · build ${c.build}${c.bundle ? ` · bundle ${c.bundle}` : ""} · ${c.w}x${c.h} @${c.dpr} · ${c.player ? `${c.player.name} (${c.player.id})` : "signed out"} · ${clip(c.ua, 90)}`);
  }
  if (e.server) row("server", `build ${e.server.build} · pid ${e.server.pid}`);
  for (const i of e.issues) {
    row(i === e.issues[0] ? "issues" : "", `${paint(LEVEL_COLOR[i.level], i.level)} ${i.code}: ${clip(i.message, 200)}${i.n > 1 ? ` (x${i.n})` : ""} +${span(Math.max(0, i.at - e.t0))}`);
    if (full && i.detail) for (const l of i.detail.split("\n").slice(0, 8)) row("", paint(2, l));
  }
  for (const [k, v] of Object.entries(e.business)) row(k, clip(JSON.stringify(v), 220));
  return out;
}

if (flag("--json")) for (const e of events) console.log(JSON.stringify(e));
else {
  for (const e of events) {
    console.log(line(e));
    if (verbose) { for (const l of detail(e)) console.log(l); console.log(""); }
  }
  console.log(paint(2, `${events.length} event(s) from ${dataDir}`));
}

// builds from before wide events log one-liners to client-log.jsonl
if (flag("--legacy")) {
  const file = path.join(dataDir, "client-log.jsonl");
  for (const f of [file + ".1", file].filter((p) => fs.existsSync(p))) {
    for (const l of fs.readFileSync(f, "utf8").split("\n")) {
      if (!l) continue;
      const r = JSON.parse(l) as { at: string; event: string };
      if (query.since !== undefined && Date.parse(r.at) < query.since) continue;
      if (query.grep && !l.toLowerCase().includes(query.grep.toLowerCase())) continue;
      console.log(`${paint(2, "legacy")} ${r.at} ${r.event} ${clip(l, 200)}`);
    }
  }
}
