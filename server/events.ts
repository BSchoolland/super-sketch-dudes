import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import express from "express";
import { recordProblem, TRACE_RE, WideEvent, type EventKind, type WideEventRecord } from "../shared/wide";
import { EVENTS_FILE } from "./eventlog";
import { playerOf } from "./auth";

/**
 * Server side of the wide events: the store writer, the client ingest endpoint, one event per API
 * request, and the long-lived events (process, rooms, connections, matches, forge jobs), which
 * are rewritten every 30 s while they change so a crash still leaves them on disk.
 */
let file = "";
const MAX_BYTES = 64 * 1024 * 1024;
const MAX_RECORD = 48 * 1024;
const open = new Set<WideEvent>();
const written = new WeakMap<WideEvent, string>();
const tier = { build: process.env.BUILD ?? "dev", pid: process.pid };

export const newId = (): string => crypto.randomBytes(8).toString("hex");
export const newTrace = (prefix: string): string => `${prefix}-${crypto.randomBytes(6).toString("hex")}`;

export function initEvents(dataDir: string): void {
  if (!file) setInterval(flushOpen, 30_000).unref();
  file = path.join(dataDir, EVENTS_FILE);
}

function append(records: WideEventRecord[]): void {
  if (!file) throw new Error("initEvents was never called");
  if (fs.existsSync(file) && fs.statSync(file).size > MAX_BYTES) fs.renameSync(file, file + ".1");
  const at = new Date().toISOString();
  fs.appendFileSync(file, records.map((r) => JSON.stringify({ at, ...r })).join("\n") + "\n");
}

const fingerprint = (e: WideEvent): string => JSON.stringify([e.level, e.issues, e.business]);
function write(e: WideEvent): void {
  written.set(e, fingerprint(e));
  append([e.snapshot()]);
}

export function serverEvent(kind: EventKind, trace: string, parent: string | null = null): WideEvent {
  const e = new WideEvent(newId(), kind, "server", trace, parent, Date.now);
  e.server = tier;
  return e;
}

/** A unit of work that outlives one call: rewritten while it changes, until `finish`. */
export function openEvent(kind: EventKind, trace: string, parent: string | null = null): WideEvent {
  const e = serverEvent(kind, trace, parent);
  open.add(e);
  write(e);
  return e;
}

export function finish(e: WideEvent): void {
  if (e.final) {
    console.error(`wide event ${e.kind} ${e.trace} finished twice`);
    e.issue("error", "impossible", "finished twice");
  }
  e.final = true;
  open.delete(e);
  write(e);
}

export function flushOpen(): void {
  for (const e of open) if (written.get(e) !== fingerprint(e)) write(e);
}

/** Everything still open ends with the process. */
export function finishOpen(exit: string): void {
  for (const e of [...open]) { e.business.exit ??= exit; finish(e); }
}

/** The process itself is a unit of work: boot to exit, with the crash that ended it if one did. */
export function watchProcess(details: Record<string, unknown>): WideEvent {
  const e = openEvent("process", newTrace("p")).set("boot", details);
  process.on("uncaughtExceptionMonitor", (err, origin) => {
    e.issue("error", origin, err.message, err.stack);
    finishOpen("crash");
  });
  for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => { finishOpen(signal); process.exit(0); });
  return e;
}

/** Client wide events arrive here, from fetch or sendBeacon (text/plain either way). */
export function attachEvents(api: express.Router): void {
  api.post("/events", express.text({ type: "text/plain", limit: "256kb" }), (req, res) => {
    let body: unknown = req.body;
    const event = res.locals.event as WideEvent | undefined;
    const reject = (error: string, accepted = 0): void => {
      event?.issue("warn", "ingest", error);
      res.status(400).json({ error, accepted });
    };
    if (typeof body === "string") {
      try { body = JSON.parse(body); } catch { return reject("body is not JSON"); }
    }
    const list = (body as { events?: unknown } | null)?.events;
    if (!Array.isArray(list) || !list.length || list.length > 20) return reject("expected { events: [1..20 wide events] }");
    const problems = list.map((r) => recordProblem(r) ?? (JSON.stringify(r).length > MAX_RECORD ? "too large" : null));
    const good = list.filter((_, i) => !problems[i]) as WideEventRecord[];
    if (good.length) append(good);
    const bad = problems.filter(Boolean);
    if (bad.length) return reject(`${bad.length} of ${list.length} rejected: ${bad[0]}`, good.length);
    res.status(204).end();
  });
}

/** One event per API request, traced by the caller's `x-trace-id`. Quiet ones (successful reads, event ingest, the forge worker) are kept only when slow. */
export function requestEvents(): express.RequestHandler {
  return (req, res, next) => {
    const header = req.get("x-trace-id");
    const e = serverEvent("request", header && TRACE_RE.test(header) ? header : newTrace("q"));
    res.locals.event = e;
    res.setHeader("x-trace-id", e.trace);
    const start = performance.now();
    let done = false;
    const end = (): void => {
      if (done) return;
      done = true;
      const ms = Math.round(performance.now() - start);
      const status = res.statusCode;
      const aborted = !res.writableFinished;
      if (aborted) e.issue("warn", "aborted", "the client went away before the response");
      if (status >= 500) e.escalate("error");
      else if (status >= 400) e.escalate("warn");
      const quiet = status < 400 && !aborted && (req.method === "GET" || req.path === "/events" || req.path.startsWith("/forge/"));
      if (quiet && ms < 1000) return;
      e.request = { method: req.method, path: req.baseUrl + req.path, status, ms };
      const player = playerOf(req);
      if (player) e.set("player", { id: player.id, name: player.name });
      e.final = true;
      write(e);
    };
    res.on("finish", end);
    res.on("close", end);
    next();
  };
}

export function requestErrors(): express.ErrorRequestHandler {
  return (err: Error, _req, res, next) => {
    (res.locals.event as WideEvent | undefined)?.issue("error", err.name || "Error", err.message, err.stack);
    next(err);
  };
}
