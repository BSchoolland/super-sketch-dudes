import type { VisitSource } from "../shared/source";
import type { StoredEvent } from "./eventlog";

/**
 * Page sessions grouped by who was behind them. A visitor is a player (a guest or an account; a guest who signed in is
 * the account they signed in to, joined by the sign-in request's `adopted`), else a page session with no player; those
 * in a tab that later has one join that player (the tab's recorded source links them).
 */
export interface Visitor {
  /** `p:<player id>` for a player, `t:<tab session>` or `s:<trace>` for a session that never had one. */
  key: string;
  /** Oldest first. A bundle swap carries a page session on in a new event under the same trace: both are here. */
  sessions: StoredEvent[];
}
export interface Visitors {
  humans: Visitor[];
  /** Every visitor key, the excluded ones too. */
  all: Set<string>;
  excluded: { sessions: number; visitors: number; why: Record<string, number> };
  /** The visitor key a player id counts under. */
  visitorOf: (playerId: string) => string;
  /** Visitors who were a guest before signing in. */
  adopters: Set<string>;
}

export const sourceOf = (s: StoredEvent): VisitSource | undefined => s.business.source as VisitSource | undefined;

function nonHuman(s: StoredEvent, visitor: string, staff: Set<string>): string | null {
  const ua = s.client!.ua, player = s.client!.player;
  if (/HeadlessChrome/.test(ua)) return "headless browser";
  if (/bot|crawl|spider|slurp/i.test(ua)) return "bot user agent";
  if (player?.id.startsWith("bot-")) return "bench bot account";
  if (visitor.startsWith("p:") && staff.has(visitor.slice(2))) return "staff account";
  return null;
}

/** `staff`: player ids of the people who run the game, left out with the bots. */
export function visitors(events: StoredEvent[], since: number, staff: Set<string>): Visitors {
  const sessions = events.filter((e) => e.kind === "session" && e.t0 >= since);

  const accountOf = new Map<string, string>();
  for (const e of events) {
    const adopted = e.kind === "request" ? (e.business.adopted as { guest: string; player: string } | undefined) : undefined;
    if (adopted) accountOf.set(adopted.guest, adopted.player);
  }
  const visitorOf = (id: string): string => `p:${accountOf.get(id) ?? id}`;
  const adopters = new Set([...accountOf.values()].map((id) => `p:${id}`));

  // the first player to sign in in a tab owns its signed-out sessions
  const tabPlayer = new Map<string, { id: string; t0: number }>();
  for (const s of sessions) {
    const tab = sourceOf(s)?.visit.session, player = s.client!.player;
    if (!tab || !player) continue;
    const had = tabPlayer.get(tab);
    if (!had || s.t0 < had.t0) tabPlayer.set(tab, { id: player.id, t0: s.t0 });
  }
  const grouped = new Map<string, StoredEvent[]>();
  for (const s of sessions) {
    const tab = sourceOf(s)?.visit.session, player = s.client!.player;
    const key = player ? visitorOf(player.id) : tab ? (tabPlayer.has(tab) ? visitorOf(tabPlayer.get(tab)!.id) : `t:${tab}`) : `s:${s.trace}`;
    grouped.set(key, [...(grouped.get(key) ?? []), s]);
  }

  const humans: Visitor[] = [];
  const excluded = { sessions: 0, visitors: 0, why: {} as Record<string, number> };
  for (const [key, list] of grouped) {
    const reasons = list.map((s) => nonHuman(s, key, staff));
    if (reasons.some(Boolean)) {
      excluded.visitors++;
      excluded.sessions += new Set(list.map((s) => s.trace)).size;
      for (const why of reasons) if (why) excluded.why[why] = (excluded.why[why] ?? 0) + 1;
      continue;
    }
    humans.push({ key, sessions: list.sort((a, b) => a.t0 - b.t0) });
  }
  return { humans, all: new Set(grouped.keys()), excluded, visitorOf, adopters };
}
