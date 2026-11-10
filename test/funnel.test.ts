import { describe, expect, it } from "vitest";
import { funnel, type Counts } from "../server/funnel";
import type { StoredEvent } from "../server/eventlog";
import type { Arrival, VisitSource } from "../shared/source";
import type { EventKind } from "../shared/wide";

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 9, 1, 15);
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/156.0.0.0 Safari/537.36";
let n = 0;

function event(kind: EventKind, source: "client" | "server", trace: string, parent: string | null, t0: number, business: Record<string, unknown>, extra: Partial<StoredEvent> = {}): StoredEvent {
  return { at: "", id: `e${++n}`, kind, source, trace, parent, level: "info", headline: null, t0, t1: t0 + 60_000, seq: 3, final: true, issues: [], business, ...extra };
}
const arrival = (referrer: string | null, at: number, ref: string | null = null): Arrival => ({ referrer, ref, utm: { source: null, medium: null, campaign: null }, landing: "/sketch-battle/", at });
interface SessionOpts { player?: { id: string; name: string }; screens?: string[]; source?: VisitSource; ua?: string; seq?: number }
function session(trace: string, t0: number, o: SessionOpts = {}): StoredEvent {
  return event("session", "client", trace, null, t0, { ...(o.screens ? { screens: o.screens.map((s, i) => [s, i]) } : {}), ...(o.source ? { source: o.source } : {}) }, {
    seq: o.seq ?? 3,
    client: { session: trace, build: "dev", bundle: "", ua: o.ua ?? UA, w: 1280, h: 720, dpr: 1, player: o.player ?? null },
  });
}
const forge = (owner: string, t0: number, done: boolean) => event("forge", "server", "f-1", "s-x", t0, { job: { owner }, ...(done ? { result: { bundleUrl: "/gen/x/bundle.json" } } : {}) });
const clientMatch = (session: string, t0: number) => event("match", "client", "m-AAAA-00000001", session, t0, {});
const serverMatch = (sessions: string[], t0: number) => event("match", "server", "m-BBBB-00000002", "r-BBBB", t0, { members: sessions.map((s, slot) => ({ slot, session: s })) });

const ann = { id: "google-ann", name: "Ann" };
const itch = (session: string, at: number): VisitSource => ({ visit: { ...arrival("itch.io", at), session }, first: arrival("itch.io", at) });
const only = (c: Counts, ...steps: (keyof Counts)[]) => Object.fromEntries(Object.keys(c).map((k) => [k, steps.includes(k as keyof Counts) ? 1 : 0]));

const STAFF = new Set(["discord-1", "email-b2", "email-bb"]);

describe("funnel", () => {
  it("joins the signed-out half of an OAuth round trip to the player, and attributes them to where the tab came from", () => {
    const f = funnel([
      session("s-land", T0, { screens: ["SignInScreen"], source: itch("s-land", T0) }),
      session("s-back", T0 + 30_000, { player: ann, screens: ["TitleScreen", "LibraryScreen", "CreateScreen", "DescribeScreen", "ForgeScreen"], source: itch("s-land", T0) }),
      forge("google-ann", T0 + 40_000, true),
    ], T0 - DAY, "UTC", STAFF);
    expect(f.rows.map((r) => r.source)).toEqual(["itch.io"]);
    expect(f.total).toEqual(only(f.total, "arrived", "signedIn", "drew", "forged", "forgeDone"));
    expect(f.sessions).toBe(2);
  });

  it("tells a match against bots from practice and map tests, and finds online matches from either side's record", () => {
    const f = funnel([
      session("s-practice", T0, { player: { id: "email-p", name: "Pip" }, screens: ["TitleScreen", "LibraryScreen", "LoadingScreen", "VersusScreen", "VersusScreen", "MapEditorScreen", "LoadingScreen", "VersusScreen"] }),
      session("s-bots", T0, { player: { id: "email-b", name: "Bo" }, screens: ["TitleScreen", "BattleMenuScreen", "OnlineScreen", "LoadingScreen", "VersusScreen"] }),
      session("s-client", T0, { player: { id: "email-c", name: "Cy" }, screens: ["TitleScreen"] }),
      session("s-server", T0, { player: { id: "email-d", name: "Di" }, screens: ["TitleScreen"] }),
      clientMatch("s-client", T0 + 1000),
      serverMatch(["s-server", "s-not-in-window"], T0 + 1000),
    ], T0 - DAY, "UTC", STAFF);
    expect(f.total).toMatchObject({ arrived: 4, signedIn: 4, played: 3, bots: 1, online: 2 });
  });

  it("counts a visit on a later calendar day, or a browser that first arrived on an earlier one, as coming back", () => {
    const eve = Date.UTC(2026, 9, 1, 23, 0);
    const f = funnel([
      session("s-a1", eve, { player: ann, screens: ["TitleScreen"] }),
      session("s-a2", eve + 2 * 3_600_000, { player: ann, screens: ["TitleScreen"] }),
      session("s-anon", T0 + 3 * DAY, { screens: ["SignInScreen"], source: { visit: { ...arrival(null, T0 + 3 * DAY), session: "s-anon" }, first: arrival("itch.io", T0) } }),
      session("s-same-day", T0, { player: { id: "email-s", name: "Sam" }, screens: ["TitleScreen"] }),
      session("s-same-day2", T0 + 3_600_000, { player: { id: "email-s", name: "Sam" }, screens: ["TitleScreen"] }),
    ], T0 - DAY, "UTC", STAFF);
    expect(f.total).toMatchObject({ arrived: 3, cameBack: 2 });
    // the same two visits are one calendar day in Chicago
    expect(funnel([session("s-a1", eve, { player: ann }), session("s-a2", eve + 2 * 3_600_000, { player: ann })], T0 - DAY, "America/Chicago", STAFF).total.cameBack).toBe(0);
  });

  it("buckets sessions from before sources were recorded, and leaves out non-humans and Ben", () => {
    const f = funnel([
      session("s-old", T0, { screens: ["SignInScreen"] }),
      session("s-ghost", T0, { seq: 1 }),
      session("s-headless", T0, { ua: "Mozilla/5.0 (X11; Linux x86_64) HeadlessChrome/153.0.0.0 Safari/537.36" }),
      session("s-crawler", T0, { ua: "DuckDuckBot/1.0; (+http://duckduckgo.com/duckduckbot.html)" }),
      session("s-bench", T0, { player: { id: "bot-host", name: "Host" } }),
      session("s-ben", T0, { player: { id: "discord-1", name: "Owner" } }),
      session("s-ben-tab", T0 - 1000, { screens: ["SignInScreen"], source: itch("s-ben-tab", T0) }),
      session("s-ben-signed", T0, { player: { id: "email-b2", name: "Owner" }, source: itch("s-ben-tab", T0) }),
      session("s-benbot", T0, { player: { id: "email-bb", name: "BenBotGuest" } }),
      session("s-before-window", T0 - 2 * DAY, { screens: ["SignInScreen"] }),
    ], T0 - DAY, "UTC", STAFF);
    expect(f.rows).toEqual([{ source: "(unrecorded)", counts: { ...only(f.total), arrived: 2 } }]);
    expect(f.screenless).toBe(1);
    expect(f.excluded).toEqual({ sessions: 7, visitors: 6, why: { "headless browser": 1, "bot user agent": 1, "bench bot account": 1, "staff account": 3 } });
  });

  it("counts forges by their owner, and says when an owner has no session in the window", () => {
    const f = funnel([
      session("s-a", T0, { player: ann, screens: ["TitleScreen", "CreateScreen"] }),
      forge("google-ann", T0 + 1000, false),
      forge("google-ann", T0 - 2 * DAY, true),
      forge("email-elsewhere", T0 + 1000, true),
    ], T0 - DAY, "UTC", STAFF);
    expect(f.total).toMatchObject({ drew: 1, forged: 1, forgeDone: 0 });
    expect(f.orphanForges).toBe(1);
  });
});
