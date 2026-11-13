import { isGuest } from "../shared/account";
import { sourceLabel } from "../shared/source";
import type { StoredEvent } from "./eventlog";
import type { ForgeJob } from "./forge";
import { sourceOf, type Visitor } from "./visitors";

/**
 * A visitor's first minutes, rebuilt from the wide events: every screen with how long they stayed, what they drew and
 * typed, and what they did while their first fighter was in the forge.
 */
export type ForgeJobRecord = Pick<ForgeJob, "id" | "fighterId" | "hint" | "drawingPath" | "status" | "error" | "createdAt" | "result" | "moderation" | "blocked">;

export interface Stop { at: number; screen: string; ms: number }
export interface Visit { trace: string; t0: number; lastHeard: number; hidden: { count: number; ms: number }; stops: Stop[]; views: number }
/** Only online matches leave a match event; a match against bots shows only as its VersusScreen. */
export interface JourneyMatch { at: number; ms: number; stage: string; opponents: string[]; withOwnForge: boolean }
export interface JourneyForge {
  job: ForgeJobRecord;
  sentAt: number;
  /** When it produced a fighter or failed; null while still in the forge. */
  doneAt: number | null;
  failed: boolean;
  /** Screens they were on while it forged, in order, clipped to the wait. */
  during: Stop[];
  /** Where they were when it finished: a screen, or null when no session was alive then. */
  atDone: string | null;
  /** Last heard from before it finished, when they were gone by then. */
  goneAt: number | null;
  /** Opened the result (the forge screen, their library or a fighter sheet) after it finished. */
  looked: boolean;
}
export interface Journey {
  key: string;
  name: string;
  account: "guest" | "account" | "guest, then signed in" | "no player";
  source: string;
  device: string;
  start: number;
  end: number;
  visits: Visit[];
  forges: JourneyForge[];
  matches: JourneyMatch[];
}

const LOOKS_AT_RESULT = new Set(["ForgeScreen", "LibraryScreen", "SheetScreen"]);

export function device(s: StoredEvent): string {
  const ua = s.client!.ua;
  const d = s.business.device as { touch: number; pads: number } | undefined;
  const view = s.business.view as { w: number; h: number } | undefined;
  const os = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) || (/Macintosh/.test(ua) && (d?.touch ?? 0) > 0) ? "iPad"
    : /Android/.test(ua) ? (/Mobile/.test(ua) ? "Android phone" : "Android tablet") : /CrOS/.test(ua) ? "Chromebook"
    : /Windows/.test(ua) ? "Windows" : /Macintosh/.test(ua) ? "Mac" : /Linux/.test(ua) ? "Linux" : "unknown";
  const browser = /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "?";
  const pads = d?.pads ? `, ${d.pads} gamepad${d.pads > 1 ? "s" : ""}` : "";
  return `${os} ${browser}${view ? ` ${view.w}x${view.h}` : ""}${pads}`;
}

function stops(s: StoredEvent): Stop[] {
  const raw = (s.business.screens as [string, number][] | undefined) ?? [];
  return raw.map(([screen, sec], i) => {
    const at = s.t0 + sec * 1000;
    const next = i + 1 < raw.length ? s.t0 + raw[i + 1][1] * 1000 : s.t1;
    return { at, screen, ms: Math.max(0, next - at) };
  });
}

function clip(list: Stop[], from: number, to: number): Stop[] {
  return list.flatMap((st) => {
    const a = Math.max(st.at, from), b = Math.min(st.at + st.ms, to);
    return b > a || (st.ms === 0 && st.at >= from && st.at < to) ? [{ ...st, at: a, ms: b - a }] : [];
  });
}

/**
 * `minutes`: how much of their start to show; it stretches to see their first forge finish.
 * `jobs`: the forge's own records by job id (what they drew and typed live there, not in the events).
 */
export function journey(v: Visitor, events: StoredEvent[], jobs: Map<string, ForgeJobRecord>, visitorOf: (id: string) => string, minutes: number): Journey {
  const first = v.sessions[0];
  const start = first.t0;
  const owned = (e: StoredEvent) => visitorOf((e.business.job as { owner: string }).owner) === v.key;
  const forgeEvents = events.filter((e) => e.kind === "forge" && e.t0 >= start && owned(e)).sort((a, b) => a.t0 - b.t0);

  const firstForge = forgeEvents[0];
  const firstForgeEnd = firstForge ? (firstForge.final ? firstForge.t1 : Date.now()) : 0;
  const end = Math.max(start + minutes * 60_000, firstForge && firstForge.t0 < start + minutes * 60_000 ? firstForgeEnd + 2 * 60_000 : 0);

  // a bundle swap leaves two events under one trace: the later one carries on where the first stopped
  const byTrace = new Map<string, StoredEvent[]>();
  for (const s of v.sessions) if (s.t0 < end) byTrace.set(s.trace, [...(byTrace.get(s.trace) ?? []), s]);
  const visits: Visit[] = [...byTrace].map(([trace, parts]) => ({
    trace,
    t0: parts[0].t0,
    lastHeard: Math.max(...parts.map((p) => p.t1)),
    hidden: parts.reduce((h, p) => {
      const x = p.business.hidden as { count: number; ms: number } | undefined;
      return { count: h.count + (x?.count ?? 0), ms: h.ms + (x?.ms ?? 0) };
    }, { count: 0, ms: 0 }),
    stops: clip(parts.flatMap(stops), start, end),
    views: parts.reduce((n, p) => n + Math.max(0, ((p.business.views as unknown[] | undefined)?.length ?? 1) - 1), 0),
  }));
  const allStops = visits.flatMap((x) => x.stops).sort((a, b) => a.at - b.at);
  const traces = new Set(visits.map((x) => x.trace));

  const forges: JourneyForge[] = forgeEvents.filter((e) => e.t0 < end).map((e) => {
    const id = (e.business.job as { id: string }).id;
    const job = jobs.get(id);
    if (!job) throw new Error(`forge event ${e.id} names job ${id}, which forge-jobs.json doesn't have`);
    const failed = e.final && !(e.business.result as { bundleUrl?: string } | undefined)?.bundleUrl;
    const doneAt = e.final ? e.t1 : null;
    const waitEnd = doneAt ?? Date.now();
    const alive = visits.filter((x) => x.t0 <= waitEnd && x.lastHeard >= waitEnd);
    const atDone = doneAt === null ? null : alive.length ? ([...allStops].reverse().find((st) => st.at <= doneAt)?.screen ?? null) : null;
    const lastHeard = Math.max(...visits.filter((x) => x.t0 <= waitEnd).map((x) => x.lastHeard));
    const after = allStops.filter((st) => doneAt !== null && st.at >= doneAt);
    return {
      job, sentAt: e.t0, doneAt, failed,
      during: clip(allStops, e.t0, waitEnd),
      atDone,
      goneAt: doneAt !== null && !alive.length ? lastHeard : null,
      looked: after.some((st) => LOOKS_AT_RESULT.has(st.screen)),
    };
  });

  const ownFighters = new Set(forges.map((f) => f.job.fighterId));
  const matches: JourneyMatch[] = events
    .filter((e) => e.kind === "match" && e.source === "client" && e.parent && traces.has(e.parent) && e.t0 < end)
    .map((e) => {
      const m = e.business.match as { stage: string } | undefined;
      const members = (e.business.members as { name: string; fighter: string; local: boolean }[] | undefined) ?? [];
      return {
        at: e.t0, ms: e.t1 - e.t0, stage: m?.stage ?? "?",
        opponents: members.filter((x) => !x.local).map((x) => x.name),
        withOwnForge: members.some((x) => x.local && ownFighters.has(x.fighter)),
      };
    });

  const players = v.sessions.flatMap((s) => (s.client!.player ? [s.client!.player] : []));
  const named = players[players.length - 1];
  const account = !players.length ? "no player" : players.every((p) => isGuest(p.id)) ? "guest" : isGuest(players[0].id) ? "guest, then signed in" : "account";
  const src = sourceOf(first);
  return {
    key: v.key,
    name: named?.name ?? "(never got a player)",
    account,
    source: src ? sourceLabel(src.first) : "(unrecorded)",
    device: device(first),
    start, end, visits, forges, matches,
  };
}
