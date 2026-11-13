import { sourceLabel } from "../shared/source";
import { isGuest } from "../shared/account";
import type { StoredEvent } from "./eventlog";
import { sourceOf, visitors } from "./visitors";

/** How far visitors (see visitors.ts) got, per source, from the wide event store. */
export const STEPS = ["arrived", "guest", "drew", "forged", "forgeDone", "played", "bots", "online", "touch", "signedIn", "cameBack"] as const;
export type Step = (typeof STEPS)[number];
export type Counts = Record<Step, number>;
export interface FunnelRow { source: string; counts: Counts }
export interface Funnel {
  rows: FunnelRow[];
  total: Counts;
  sessions: number;
  excluded: { sessions: number; visitors: number; why: Record<string, number> };
  /** Sessions whose only snapshot is the opening one: no screen ever reached the server. */
  screenless: number;
  /** Players who sent a forge job in the window without a page session in it. */
  orphanForges: number;
}

export const UNRECORDED = "(unrecorded)";
/** Local matches entered from these are practice against the dummy or a map test, not a match. */
const NOT_A_MATCH_FROM = new Set(["LibraryScreen", "MapEditorScreen"]);

const screensOf = (s: StoredEvent): string[] => ((s.business.screens as [string, number][] | undefined) ?? []).map(([name]) => name);

/** A local match that wasn't practice: what came before it, past the loading screen and rematches. */
function playedLocal(screens: string[]): boolean {
  return screens.some((name, i) => {
    if (name !== "VersusScreen") return false;
    let j = i - 1;
    while (j >= 0 && (screens[j] === "LoadingScreen" || screens[j] === "VersusScreen")) j--;
    return j >= 0 && !NOT_A_MATCH_FROM.has(screens[j]);
  });
}

/** `staff`: player ids of the people who run the game, left out of the count. */
export function funnel(events: StoredEvent[], since: number, timeZone: string, staff: Set<string>): Funnel {
  const day = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
  const sessions = events.filter((e) => e.kind === "session" && e.t0 >= since);
  const { humans, all, excluded, visitorOf, adopters } = visitors(events, since, staff);

  const forged = new Set<string>(), forgeDone = new Set<string>(), online = new Set<string>();
  for (const e of events) {
    if (e.kind === "forge" && e.t0 >= since) {
      const owner = visitorOf((e.business.job as { owner: string }).owner);
      forged.add(owner);
      if (e.final && (e.business.result as { bundleUrl?: string } | undefined)?.bundleUrl) forgeDone.add(owner);
    }
    if (e.kind === "match" && e.source === "client" && e.parent) online.add(e.parent);
    if (e.kind === "match" && e.source === "server") for (const m of e.business.members as { session?: string }[]) if (m.session) online.add(m.session);
  }

  const zero = (): Counts => Object.fromEntries(STEPS.map((k) => [k, 0])) as Counts;
  const bySource = new Map<string, Counts>();
  const total = zero();
  for (const { key, sessions: list } of humans) {
    const firstSource = sourceOf(list[0]);
    const days = new Set(list.map((s) => day.format(s.t0)));
    const firstDay = day.format(list[0].t0);
    const traces = list.map((s) => s.trace);
    const screens = list.map(screensOf);
    const bots = screens.some(playedLocal), net = traces.some((t) => online.has(t));
    const players = list.flatMap((s) => (s.client!.player ? [s.client!.player.id] : []));
    const reached: Record<Step, boolean> = {
      arrived: true,
      guest: players.some(isGuest) || adopters.has(key),
      drew: screens.some((l) => l.includes("CreateScreen")),
      forged: forged.has(key),
      forgeDone: forgeDone.has(key),
      played: bots || net,
      bots,
      online: net,
      touch: list.some((s) => ((s.business.touch as { matches: number } | undefined)?.matches ?? 0) > 0),
      signedIn: players.some((id) => !isGuest(id)),
      cameBack: days.size > 1 || list.some((s) => { const first = sourceOf(s)?.first; return !!first && day.format(first.at) < firstDay; }),
    };
    const label = firstSource ? sourceLabel(firstSource.first) : UNRECORDED;
    const counts = bySource.get(label) ?? zero();
    bySource.set(label, counts);
    for (const k of STEPS) if (reached[k]) { counts[k]++; total[k]++; }
  }

  const screenless = sessions.filter((s) => s.seq === 1 && !s.business.screens).length;
  const rows = [...bySource].map(([source, counts]) => ({ source, counts })).sort((a, b) => b.counts.arrived - a.counts.arrived || a.source.localeCompare(b.source));
  const orphanForges = [...forged].filter((owner) => !all.has(owner)).length;
  return { rows, total, sessions: new Set(sessions.map((s) => s.trace)).size, excluded, screenless, orphanForges };
}
