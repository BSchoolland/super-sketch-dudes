import { sourceLabel, type VisitSource } from "../shared/source";
import { isGuest } from "../shared/account";
import type { StoredEvent } from "./eventlog";

/**
 * How far visitors got, per source, from the wide event store. A visitor is a player (a guest or an account; a guest
 * who signed in is the account they signed in to, joined by the sign-in request's `adopted`), else a page session with
 * no player; those in a tab that later has one join that player (the tab's recorded source links them).
 */
export const STEPS = ["arrived", "guest", "drew", "forged", "forgeDone", "played", "bots", "online", "signedIn", "cameBack"] as const;
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

/** `visitor`: the key the session counts under (`p:<player id>` for a player, a guest under the account they signed in to). */
function nonHuman(s: StoredEvent, visitor: string, staff: Set<string>): string | null {
  const ua = s.client!.ua, player = s.client!.player;
  if (/HeadlessChrome/.test(ua)) return "headless browser";
  if (/bot|crawl|spider|slurp/i.test(ua)) return "bot user agent";
  if (player?.id.startsWith("bot-")) return "bench bot account";
  if (visitor.startsWith("p:") && staff.has(visitor.slice(2))) return "staff account";
  return null;
}

const screensOf = (s: StoredEvent): string[] => ((s.business.screens as [string, number][] | undefined) ?? []).map(([name]) => name);
const sourceOf = (s: StoredEvent): VisitSource | undefined => s.business.source as VisitSource | undefined;

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
  // a bundle swap carries a page session on in a new event under the same trace: both count as that session
  const sessions = events.filter((e) => e.kind === "session" && e.t0 >= since);

  // a guest who signed in, at any time, is their account
  const accountOf = new Map<string, string>();
  for (const e of events) {
    const adopted = e.kind === "request" ? (e.business.adopted as { guest: string; player: string } | undefined) : undefined;
    if (adopted) accountOf.set(adopted.guest, adopted.player);
  }
  const visitorOf = (id: string): string => `p:${accountOf.get(id) ?? id}`;
  const adopters = new Set([...accountOf.values()].map((id) => `p:${id}`));

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

  // the first player to sign in in a tab owns its signed-out sessions
  const tabPlayer = new Map<string, { id: string; t0: number }>();
  for (const s of sessions) {
    const tab = sourceOf(s)?.visit.session, player = s.client!.player;
    if (!tab || !player) continue;
    const had = tabPlayer.get(tab);
    if (!had || s.t0 < had.t0) tabPlayer.set(tab, { id: player.id, t0: s.t0 });
  }
  const visitors = new Map<string, StoredEvent[]>();
  for (const s of sessions) {
    const tab = sourceOf(s)?.visit.session, player = s.client!.player;
    const key = player ? visitorOf(player.id) : tab ? (tabPlayer.has(tab) ? visitorOf(tabPlayer.get(tab)!.id) : `t:${tab}`) : `s:${s.trace}`;
    visitors.set(key, [...(visitors.get(key) ?? []), s]);
  }

  const zero = (): Counts => Object.fromEntries(STEPS.map((k) => [k, 0])) as Counts;
  const bySource = new Map<string, Counts>();
  const total = zero();
  const excluded = { sessions: 0, visitors: 0, why: {} as Record<string, number> };
  for (const [key, list] of visitors) {
    const reasons = list.map((s) => nonHuman(s, key, staff));
    if (reasons.some(Boolean)) {
      excluded.visitors++;
      excluded.sessions += new Set(list.map((s) => s.trace)).size;
      for (const why of reasons) if (why) excluded.why[why] = (excluded.why[why] ?? 0) + 1;
      continue;
    }
    list.sort((a, b) => a.t0 - b.t0);
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
  const orphanForges = [...forged].filter((owner) => !visitors.has(owner)).length;
  return { rows, total, sessions: new Set(sessions.map((s) => s.trace)).size, excluded, screenless, orphanForges };
}
