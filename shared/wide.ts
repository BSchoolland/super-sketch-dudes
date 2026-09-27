/**
 * The wide event: one structured record per unit of work (a page session, one client's view of a
 * match, a room, a forge job, a request), built up over its whole life and persisted whole.
 * The typed tiers are what every event shares; `business` is the open domain payload.
 *
 * Long-lived events are sent as snapshots while the work runs (`seq` counts up, `final` stays
 * false) so a crash or a killed tab still leaves a partial record; the store keeps the newest
 * snapshot per id. Nothing here reads a clock or makes randomness: ids and the clock come in
 * from the client or the server.
 */
export type EventLevel = "info" | "warn" | "error";
export type EventKind = "session" | "match" | "draw" | "request" | "connection" | "room" | "forge" | "process";
export const CLIENT_KINDS: readonly EventKind[] = ["session", "match", "draw"];
const LEVEL_RANK: Record<EventLevel, number> = { info: 0, warn: 1, error: 2 };

export interface Issue { level: "warn" | "error"; code: string; message: string; detail?: string; at: number; n: number }
/** Who is on the other end: identical for every event a page sends. */
export interface ClientTier {
  session: string;
  build: string;
  /** Game bundle hash, "" on the classic single-build page. */
  bundle: string;
  ua: string;
  w: number;
  h: number;
  dpr: number;
  player: { id: string; name: string } | null;
}
export interface ServerTier { build: string; pid: number }
export interface RequestTier { method: string; path: string; status: number; ms: number }

export interface WideEventRecord {
  id: string;
  kind: EventKind;
  source: "client" | "server";
  /** Correlates everything about one thing: a session, a match (`m-<room>-<seed>`), a room, a forge job. */
  trace: string;
  /** The trace this one happened inside: a match's session, a request's forge job's origin. */
  parent: string | null;
  level: EventLevel;
  headline: string | null;
  t0: number;
  t1: number;
  seq: number;
  final: boolean;
  client?: ClientTier;
  server?: ServerTier;
  request?: RequestTier;
  issues: Issue[];
  business: Record<string, unknown>;
}

export const MAX_ISSUES = 40;

export class WideEvent {
  level: EventLevel = "info";
  issues: Issue[] = [];
  business: Record<string, unknown> = {};
  client?: ClientTier;
  server?: ServerTier;
  request?: RequestTier;
  seq = 0;
  final = false;
  readonly t0: number;

  constructor(readonly id: string, readonly kind: EventKind, readonly source: "client" | "server", readonly trace: string, readonly parent: string | null, private clock: () => number) {
    this.t0 = clock();
  }

  escalate(level: EventLevel): this {
    if (LEVEL_RANK[level] > LEVEL_RANK[this.level]) this.level = level;
    return this;
  }

  /** A problem worth reading: escalates the level; the same code and message again only bumps its count. */
  issue(level: Issue["level"], code: string, message: string, detail?: string): this {
    this.escalate(level);
    const same = this.issues.find((i) => i.code === code && i.message === message);
    if (same) { same.n++; return this; }
    if (this.issues.length >= MAX_ISSUES) { this.business.issuesDropped = ((this.business.issuesDropped as number) ?? 0) + 1; return this; }
    this.issues.push({ level, code, message: message.slice(0, 300), ...(detail ? { detail: detail.slice(0, 800) } : {}), at: this.clock(), n: 1 });
    return this;
  }

  set(key: string, value: unknown): this {
    this.business[key] = value;
    return this;
  }

  /** The one line a person reads first: the first error, else the first warning, else a business marker with a `message`. */
  headline(): string | null {
    const first = this.issues.find((i) => i.level === "error") ?? this.issues[0];
    if (first) return `${first.code}: ${first.message}`;
    for (const value of Object.values(this.business)) {
      if (value && typeof value === "object" && typeof (value as { message?: unknown }).message === "string") return (value as { message: string }).message;
    }
    return null;
  }

  snapshot(): WideEventRecord {
    this.seq++;
    return {
      id: this.id, kind: this.kind, source: this.source, trace: this.trace, parent: this.parent,
      level: this.level, headline: this.headline(), t0: this.t0, t1: this.clock(), seq: this.seq, final: this.final,
      ...(this.client ? { client: this.client } : {}), ...(this.server ? { server: this.server } : {}),
      ...(this.request ? { request: this.request } : {}),
      issues: this.issues, business: this.business,
    };
  }
}

/** One match's trace, the same on every participant and the server: the room code and the seed the server picked. */
export function matchTrace(code: string, seed: number): string {
  return `m-${code}-${(seed >>> 0).toString(16).padStart(8, "0")}`;
}

export const TRACE_RE = /^[\w-]{1,64}$/;
const LEVELS = new Set<string>(["info", "warn", "error"]);

/** Why a record from a client isn't a wide event, or null when it is one. */
export function recordProblem(v: unknown): string | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return "not an object";
  const r = v as Record<string, unknown>;
  if (typeof r.id !== "string" || !TRACE_RE.test(r.id)) return "bad id";
  if (typeof r.kind !== "string" || !CLIENT_KINDS.includes(r.kind as EventKind)) return `bad kind ${String(r.kind).slice(0, 20)}`;
  if (r.source !== "client") return "source must be client";
  if (typeof r.trace !== "string" || !TRACE_RE.test(r.trace)) return "bad trace";
  if (r.parent !== null && (typeof r.parent !== "string" || !TRACE_RE.test(r.parent))) return "bad parent";
  if (typeof r.level !== "string" || !LEVELS.has(r.level)) return "bad level";
  if (r.headline !== null && typeof r.headline !== "string") return "bad headline";
  for (const k of ["t0", "t1", "seq"]) if (typeof r[k] !== "number" || !Number.isFinite(r[k])) return `bad ${k}`;
  if (typeof r.final !== "boolean") return "bad final";
  if (!Array.isArray(r.issues)) return "bad issues";
  if (!r.business || typeof r.business !== "object" || Array.isArray(r.business)) return "bad business";
  if (!r.client || typeof r.client !== "object" || typeof (r.client as ClientTier).session !== "string") return "missing client tier";
  return null;
}

/** The store keeps every snapshot; readers want the newest one per event. */
export function newestById<T extends Pick<WideEventRecord, "id" | "seq">>(records: Iterable<T>): T[] {
  const byId = new Map<string, T>();
  for (const r of records) {
    const prev = byId.get(r.id);
    if (!prev || r.seq > prev.seq) byId.set(r.id, r);
  }
  return [...byId.values()];
}
