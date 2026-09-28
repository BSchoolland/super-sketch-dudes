import { WideEvent, type ClientTier, type EventKind, type Issue, type WideEventRecord } from "../../../shared/wide";
import { site } from "../base";
import { account } from "../account";

/**
 * The page's wide events: the session (mount to page hide or bundle swap) and whatever is open
 * inside it (a match). Open events are sent every 10 s while they change and with
 * sendBeacon when the page hides, so a crash or a closed tab still leaves a partial record.
 * Uncaught errors and console.error land on every open event.
 */
const FLUSH_MS = 10_000;
const open = new Set<WideEvent>();
const sent = new WeakMap<WideEvent, string>();
let session: WideEvent | null = null;
let bundle = "";
const consoleError = console.error;

/** `quality` is the frame pacer's resolution step: dpr already includes it. */
export interface View { w: number; h: number; dpr: number; canvasW: number; canvasH: number; scale: number; quality: number }
export const view: View = { w: 0, h: 0, dpr: 1, canvasW: 0, canvasH: 0, scale: 0, quality: 1 };

export function randomHex(chars: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(Math.ceil(chars / 2)));
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, chars);
}

function tier(): ClientTier {
  if (!session) throw new Error("wide events used before startTelemetry");
  const player = account.player;
  return { session: session.trace, build: site.build, bundle, ua: navigator.userAgent.slice(0, 200), w: innerWidth, h: innerHeight, dpr: devicePixelRatio, player: player ? { id: player.id, name: player.name } : null };
}

export function sessionTrace(): string {
  if (!session) throw new Error("wide events used before startTelemetry");
  return session.trace;
}

/** Opens an event inside this page session; it's sent while it changes until `finishEvent`. */
export function clientEvent(kind: EventKind, trace: string): WideEvent {
  const e = new WideEvent(randomHex(16), kind, "client", trace, sessionTrace(), Date.now);
  e.client = tier();
  open.add(e);
  return e;
}

export function finishEvent(e: WideEvent, exit: string): void {
  // telemetry never throws into the game, but a bookkeeping bug still gets said out loud
  if (!open.has(e)) { console.error(`${e.kind} event ${e.trace} finished twice (exit ${exit})`); return; }
  e.set("exit", exit);
  e.final = true;
  open.delete(e);
  send([snap(e)]);
}

/** An issue on every open event: the session and whatever is running inside it. */
export function everywhere(level: Issue["level"], code: string, message: string, detail?: string): void {
  for (const e of open) e.issue(level, code, message, detail);
  if (level === "error") soon();
}

/** Appends to a list in the session's business, capped. */
export function sessionList(key: string, value: unknown, cap = 80): void {
  if (!session) throw new Error("wide events used before startTelemetry");
  const list = (session.business[key] ??= []) as unknown[];
  if (list.length < cap) list.push(value);
  else session.business[`${key}Dropped`] = ((session.business[`${key}Dropped`] as number) ?? 0) + 1;
}

const fingerprint = (e: WideEvent): string => JSON.stringify([e.level, e.issues, e.business]);
function snap(e: WideEvent): WideEventRecord {
  e.client = tier();
  if (e === session) summarize(e);
  sent.set(e, fingerprint(e));
  return e.snapshot();
}

function summarize(s: WideEvent): void {
  const screens = (s.business.screens as [string, number][] | undefined) ?? [];
  const matches = (s.business.matches as string[] | undefined)?.length ?? 0;
  const last = screens[screens.length - 1]?.[0] ?? "no screen";
  s.set("summary", { message: `${screens.length} screens, now ${last} · ${matches} online matches · ${view.w}x${view.h}@${view.dpr}` });
}

function flush(beacon = false): void {
  const dirty = [...open].filter((e) => sent.get(e) !== fingerprint(e));
  if (dirty.length) send(dirty.map(snap), beacon);
}
let soonTimer = 0;
function soon(): void {
  if (!soonTimer) soonTimer = window.setTimeout(() => { soonTimer = 0; flush(); }, 1000);
}

function send(records: WideEventRecord[], beacon = false): void {
  const url = `${site.base}api/events`;
  const body = JSON.stringify({ events: records });
  if (beacon) {
    if (!navigator.sendBeacon(url, new Blob([body], { type: "text/plain" }))) failed(`sendBeacon refused ${body.length} bytes`);
    return;
  }
  fetch(url, { method: "POST", headers: { "content-type": "text/plain" }, body, keepalive: true }).then(
    (res) => { if (!res.ok) return res.text().then((text) => failed(`HTTP ${res.status} ${text.slice(0, 160)}`)); },
    (error: unknown) => failed(String(error)),
  );
}
/** Telemetry can't break the game, but a failed send is still said out loud and lands on the session. */
function failed(reason: string): void {
  consoleError("wide events: send failed:", reason);
  session?.issue("warn", "telemetry", reason);
}

function describe(value: unknown): string {
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  if (typeof value === "string") return value;
  try { return JSON.stringify(value) ?? String(value); } catch { return String(value); }
}

export interface TelemetryStart {
  canvas: HTMLCanvasElement;
  /** This bundle's hash, "" on the classic page. */
  bundle: string;
  /** The session trace of the bundle that handed over to this one. */
  continues?: string;
}

/** Starts the page session's event and the page hooks; the returned stop ends it (the bundle is being swapped out). */
export function startTelemetry(opts: TelemetryStart): () => void {
  if (session) throw new Error("startTelemetry called twice");
  bundle = opts.bundle;
  const trace = opts.continues ?? `s-${randomHex(12)}`;
  session = new WideEvent(randomHex(16), "session", "client", trace, null, Date.now);
  open.add(session);
  const s = session;
  const nav = navigator as Navigator & { deviceMemory?: number };
  s.set("device", { platform: nav.platform, lang: nav.language, cores: nav.hardwareConcurrency, memory: nav.deviceMemory ?? null, touch: nav.maxTouchPoints, pads: navigator.getGamepads?.().filter(Boolean).length ?? 0 });
  s.set("view", view);
  if (opts.continues) s.set("continues", true);
  const hidden = { count: 0, ms: 0, since: 0 };
  s.set("hidden", hidden);

  const onError = (e: ErrorEvent) => everywhere("error", "uncaught", e.message || describe(e.error), `${e.filename}:${e.lineno}:${e.colno}\n${e.error instanceof Error ? e.error.stack : ""}`);
  const onRejection = (e: PromiseRejectionEvent) => everywhere("error", "unhandled rejection", describe(e.reason), e.reason instanceof Error ? e.reason.stack : undefined);
  const onVisibility = () => {
    if (document.visibilityState === "hidden") {
      hidden.count++; hidden.since = Date.now();
      flush(true);
    } else if (hidden.since) { hidden.ms += Date.now() - hidden.since; hidden.since = 0; }
  };
  const onPageHide = () => {
    for (const e of open) { e.business.exit ??= "pagehide"; e.final = true; }
    send([...open].map(snap), true);
  };
  // back from the bfcache: the page lives on, so do its events
  const onPageShow = (e: PageTransitionEvent) => {
    if (!e.persisted) return;
    for (const ev of open) { ev.final = false; if (ev.business.exit === "pagehide") delete ev.business.exit; }
    s.set("restored", ((s.business.restored as number) ?? 0) + 1);
  };
  const onContextLost = () => everywhere("error", "canvas", "the 2D canvas context was lost");
  const onContextRestored = () => everywhere("warn", "canvas", "the 2D canvas context was restored");
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("pagehide", onPageHide);
  window.addEventListener("pageshow", onPageShow);
  opts.canvas.addEventListener("contextlost", onContextLost);
  opts.canvas.addEventListener("contextrestored", onContextRestored);
  console.error = (...args: unknown[]) => {
    consoleError.apply(console, args);
    const err = args.find((a) => a instanceof Error) as Error | undefined;
    everywhere("warn", "console.error", args.map(describe).join(" "), err?.stack);
  };
  const timer = window.setInterval(() => flush(), FLUSH_MS);
  send([snap(s)]);

  return () => {
    window.clearInterval(timer);
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("pagehide", onPageHide);
    window.removeEventListener("pageshow", onPageShow);
    opts.canvas.removeEventListener("contextlost", onContextLost);
    opts.canvas.removeEventListener("contextrestored", onContextRestored);
    console.error = consoleError;
    for (const e of [...open]) finishEvent(e, "swap");
    session = null;
  };
}

/** The canvas geometry app.ts computed; a history of changes goes on the session. */
export function noteView(next: View): void {
  const changed = next.w !== view.w || next.h !== view.h || next.dpr !== view.dpr || next.scale !== view.scale;
  Object.assign(view, next);
  if (changed && session) sessionList("views", { ...next, at: Date.now() - session.t0 }, 20);
  // a running match checks the view itself, every draw
  if (!(next.scale > 0) || !Number.isFinite(next.scale)) session?.issue("error", "view", `canvas scale is ${next.scale} (window ${next.w}x${next.h}, dpr ${next.dpr})`);
}

export function noteScreen(name: string): void {
  if (!session) throw new Error("wide events used before startTelemetry");
  sessionList("screens", [name, Math.round((Date.now() - session.t0) / 100) / 10]);
}
