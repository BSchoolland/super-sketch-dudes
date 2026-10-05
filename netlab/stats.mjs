// Online match quality from wide events, the same way for production and the lab: per match and player, how much of
// the fight was frozen in WAITING, how often, on whom, the round trip, rollbacks, frame times and the relay's view.
// Usage: node netlab/stats.mjs [events.jsonl ...] [--prod] [--trace m-XXXX-...] [--room CODE] [--since 2026-10-05] [--player Name] [--json]
//   --prod reads production's event log (synced into netlab/.cache/prod by `node netlab/prod.mjs events`).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const PROD_EVENTS = path.join(HERE, ".cache", "prod", "events.jsonl");

/** Newest snapshot of every event in the files (an event is rewritten as it grows; `seq` orders the snapshots). */
export function readEvents(files) {
  const byId = new Map();
  for (const file of files.flatMap((f) => [f + ".1", f]).filter((f) => fs.existsSync(f))) {
    for (const line of fs.readFileSync(file, "utf8").split("\n")) {
      if (!line) continue;
      const e = JSON.parse(line);
      const prev = byId.get(e.id);
      if (!prev || e.seq >= prev.seq) byId.set(e.id, e);
    }
  }
  return [...byId.values()];
}

const round1 = (n) => Math.round(n * 10) / 10;

/** One row per player per match (matches shorter than `minFrames` are skipped: lobby bounces, instant quits). */
export function matchStats(events, { minFrames = 600 } = {}) {
  const relays = new Map(events.filter((e) => e.kind === "match" && e.source === "server").map((e) => [e.trace, e]));
  const byTrace = new Map();
  for (const e of events) {
    if (e.kind !== "match" || e.source !== "client") continue;
    const b = e.business ?? {}, net = b.net;
    if (!net || net.frames < minFrames) continue;
    const minutes = net.frames / 3600;
    const rb = b.rollback ?? {}, fm = b.render?.frameMs ?? {};
    const draws = Object.values(fm).reduce((s, v) => s + v, 0) || 1;
    const relay = relays.get(e.trace)?.business;
    const relayIndex = relay?.members?.findIndex((m) => m.session === e.client?.session) ?? -1;
    const row = {
      name: e.client?.player?.name ?? "?", slot: b.match?.localSlot, build: e.client?.build, ua: uaShort(e.client?.ua ?? ""),
      minutes: round1(minutes), waitSPerMin: round1(net.waitingMs / 1000 / minutes), waitsPerMin: Math.round(net.waits / minutes),
      longestWaitMs: net.longestWaitMs, rttAvg: net.rtt?.avg, rttMax: net.rtt?.max, rollbacksPerMin: Math.round((rb.rollbacks ?? 0) / minutes),
      maxDepth: rb.maxDepth, slowFramePct: round1((100 * (draws - (fm["17"] ?? 0) - (fm["25"] ?? 0))) / draws), maxFrameMs: b.render?.maxFrameMs,
      inputDelay: b.match?.inputDelay, waitedOn: net.waitedOn ?? null, unattributedWaitMs: net.unattributedWaitMs ?? null,
      relayGapMs: relayIndex >= 0 ? relay.relay?.[relayIndex]?.maxGapMs : null, relayStalls: relayIndex >= 0 ? relay.relay?.[relayIndex]?.stalls : null,
      exit: b.exit,
    };
    let m = byTrace.get(e.trace);
    if (!m) byTrace.set(e.trace, (m = { trace: e.trace, room: b.match?.room, at: new Date(e.t0).toISOString(), stage: b.match?.stage, players: [] }));
    m.players.push(row);
  }
  const matches = [...byTrace.values()].sort((a, b) => a.at.localeCompare(b.at));
  for (const m of matches) {
    m.players.sort((a, b) => (a.slot ?? 0) - (b.slot ?? 0));
    const p = m.players;
    m.size = p.length;
    m.waitSPerMin = round1(p.reduce((s, r) => s + r.waitSPerMin, 0) / p.length);
    m.waitsPerMin = Math.round(p.reduce((s, r) => s + r.waitsPerMin, 0) / p.length);
    m.longestWaitMs = Math.max(...p.map((r) => r.longestWaitMs));
  }
  return matches;
}

function uaShort(ua) {
  const os = /Windows/.test(ua) ? "win" : /Mac OS/.test(ua) ? "mac" : /CrOS/.test(ua) ? "chromeos" : /Android/.test(ua) ? "android" : /iPhone|iPad/.test(ua) ? "ios" : /Linux/.test(ua) ? "linux" : "?";
  const headless = /Headless/.test(ua) ? " headless" : "";
  return os + headless;
}

export function formatMatches(matches) {
  const out = [];
  for (const m of matches) {
    out.push(`${m.at.slice(0, 16).replace("T", " ")}  ${m.trace}  ${m.size}p ${m.stage}  frozen ${m.waitSPerMin} s/min · ${m.waitsPerMin} waits/min · longest ${m.longestWaitMs} ms`);
    for (const r of m.players) {
      const on = r.waitedOn ? Object.values(r.waitedOn).map((w) => `${w.name} ${round1(w.waitingMs / 1000)}s/${w.waits}`).join(", ") : "";
      out.push(`    ${r.name.padEnd(12)} ${r.ua.padEnd(9)} ${String(r.minutes).padStart(4)}m  wait ${String(r.waitSPerMin).padStart(4)} s/min ${String(r.waitsPerMin).padStart(3)}/min longest ${String(r.longestWaitMs).padStart(5)}  rtt ${r.rttAvg}/${r.rttMax}  rb ${r.rollbacksPerMin}/min  slow frames ${r.slowFramePct}% (max ${r.maxFrameMs})  relay gap ${r.relayGapMs ?? "-"} stalls ${r.relayStalls ?? "-"}  delay ${r.inputDelay}${on ? `  waited on: ${on}` : ""}`);
    }
  }
  return out.join("\n");
}

/**
 * The lab match against the production range, per player (matched by name) and for the match: each metric's lab value,
 * production min-max, and a mark when the lab falls outside it. This is what calibrating a profile reads.
 */
export function compareToProduction(lab, targets) {
  const metrics = [["waitSPerMin", "frozen s/min"], ["waitsPerMin", "waits/min"], ["longestWaitMs", "longest ms"], ["rttAvg", "rtt avg"], ["rttMax", "rtt max"], ["relayGapMs", "relay gap"], ["relayStalls", "gaps >1 s"]];
  const range = (vals) => vals.length ? [Math.min(...vals), Math.max(...vals)] : null;
  const cell = (v, r) => r ? `${v}${v < r[0] ? " ↓" : v > r[1] ? " ↑" : ""} (${r[0]}–${r[1]})` : `${v}`;
  const rows = [["", ...metrics.map(([, label]) => label)]];
  rows.push(["match", ...metrics.slice(0, 3).map(([k]) => cell(lab[k], range(targets.map((t) => t[k])))), "", "", "", ""]);
  for (const p of lab.players) {
    const prod = targets.flatMap((t) => t.players.filter((q) => q.name === p.name));
    rows.push([p.name, ...metrics.map(([k]) => cell(p[k] ?? "-", range(prod.map((q) => q[k]).filter((v) => typeof v === "number"))))]);
  }
  const widths = rows[0].map((_, i) => Math.max(...rows.map((r) => String(r[i]).length)));
  return rows.map((r) => r.map((c, i) => String(c).padEnd(widths[i])).join("  ").trimEnd()).join("\n");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const value = (flag) => { const i = args.indexOf(flag); if (i < 0) return undefined; const v = args[i + 1]; if (!v || v.startsWith("--")) throw new Error(`${flag} needs a value`); args.splice(i, 2); return v; };
  const flag = (f) => { const i = args.indexOf(f); if (i < 0) return false; args.splice(i, 1); return true; };
  const trace = value("--trace"), room = value("--room"), since = value("--since"), player = value("--player");
  const json = flag("--json"), prod = flag("--prod");
  const files = [...args, ...(prod ? [PROD_EVENTS] : [])];
  if (!files.length) throw new Error("give an events.jsonl or --prod");
  if (prod && !fs.existsSync(PROD_EVENTS)) throw new Error(`no production events at ${PROD_EVENTS}: run node netlab/prod.mjs events`);
  let matches = matchStats(readEvents(files));
  if (trace) matches = matches.filter((m) => m.trace === trace);
  if (room) matches = matches.filter((m) => m.room === room);
  if (since) matches = matches.filter((m) => m.at >= new Date(since).toISOString());
  if (player) matches = matches.filter((m) => m.players.some((p) => p.name === player));
  console.log(json ? JSON.stringify(matches, null, 2) : formatMatches(matches));
}
