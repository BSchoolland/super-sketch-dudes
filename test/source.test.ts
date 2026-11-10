import { describe, expect, it } from "vitest";
import { visitSource } from "../client/src/telemetry/source";
import { sourceLabel, sourceProblem } from "../shared/source";
import { recordProblem, WideEvent } from "../shared/wide";

class MemoryStorage implements Storage {
  [key: string]: any;
  private items = new Map<string, string>();
  get length(): number { return this.items.size; }
  clear(): void { this.items.clear(); }
  getItem(key: string): string | null { return this.items.get(key) ?? null; }
  key(i: number): string | null { return [...this.items.keys()][i] ?? null; }
  removeItem(key: string): void { this.items.delete(key); }
  setItem(key: string, value: string): void { this.items.set(key, value); }
}

const DAY = 86_400_000;
const noBad = (key: string, problem: string) => { throw new Error(`unexpected bad ${key}: ${problem}`); };

describe("visit source capture", () => {
  it("keeps the referrer's host only, the ref and utm params, and the landing path", () => {
    const s = visitSource({ referrer: "https://itch.io/games/tag-drawing?page=2#top", url: "https://example.test/sketch-battle/?ref=itch&utm_source=itch&utm_medium=listing&utm_campaign=launch&other=1" }, new MemoryStorage(), new MemoryStorage(), "s-aaa", 1000, noBad);
    expect(s.visit).toEqual({ referrer: "itch.io", ref: "itch", utm: { source: "itch", medium: "listing", campaign: "launch" }, landing: "/sketch-battle/", at: 1000, session: "s-aaa" });
    expect(s.first).toEqual({ referrer: "itch.io", ref: "itch", utm: { source: "itch", medium: "listing", campaign: "launch" }, landing: "/sketch-battle/", at: 1000 });
    expect(sourceProblem(s)).toBeNull();
  });

  it("records a direct visit as nulls, and empty params as absent", () => {
    const s = visitSource({ referrer: "", url: "https://example.test/sketch-battle/?ref=" }, new MemoryStorage(), new MemoryStorage(), "s-aaa", 1000, noBad);
    expect(s.visit.referrer).toBeNull();
    expect(s.visit.ref).toBeNull();
    expect(s.visit.utm).toEqual({ source: null, medium: null, campaign: null });
    expect(sourceLabel(s.first)).toBe("(direct)");
  });

  it("survives the OAuth round trip: back from Discord, the tab still came from itch.io", () => {
    const tab = new MemoryStorage(), browser = new MemoryStorage();
    const landed = visitSource({ referrer: "https://itch.io/", url: "https://example.test/sketch-battle/" }, tab, browser, "s-before", 1000, noBad);
    const back = visitSource({ referrer: "https://discord.com/", url: "https://example.test/sketch-battle/auth#access_token=x&token_type=Bearer" }, tab, browser, "s-after", 9000, noBad);
    expect(back).toEqual(landed);
    expect(back.visit.session).toBe("s-before");
    expect(sourceLabel(back.first)).toBe("itch.io");
  });

  it("starts a new visit in a new tab but keeps the browser's first-ever arrival", () => {
    const browser = new MemoryStorage();
    visitSource({ referrer: "https://itch.io/", url: "https://example.test/sketch-battle/?ref=itch" }, new MemoryStorage(), browser, "s-day1", 1000, noBad);
    const later = visitSource({ referrer: "", url: "https://example.test/sketch-battle/" }, new MemoryStorage(), browser, "s-day3", 1000 + 2 * DAY, noBad);
    expect(later.visit).toMatchObject({ referrer: null, ref: null, session: "s-day3", at: 1000 + 2 * DAY });
    expect(later.first).toMatchObject({ referrer: "itch.io", ref: "itch", at: 1000 });
  });

  it("counts a Discord Activity launch as its own source, and keeps none of Discord's launch parameters", () => {
    const s = visitSource({ referrer: "https://discord.com/", url: "https://1569520137055240272.discordsays.com/?instance_id=i-1-gc-2-3&guild_id=2&channel_id=3&frame_id=f&platform=desktop", launch: "discord-activity" }, new MemoryStorage(), new MemoryStorage(), "s-aaa", 1000, noBad);
    expect(s.visit).toEqual({ referrer: "discord.com", ref: "discord-activity", utm: { source: null, medium: null, campaign: null }, landing: "/", at: 1000, session: "s-aaa" });
    expect(sourceLabel(s.first)).toBe("discord-activity");
  });

  it("says so when a stored value isn't an arrival, and replaces it", () => {
    const tab = new MemoryStorage(), browser = new MemoryStorage();
    tab.setItem("sketchbattle.visit", "{not json");
    browser.setItem("sketchbattle.firstVisit", JSON.stringify({ referrer: "https://itch.io/a/b", ref: null, utm: { source: null, medium: null, campaign: null }, landing: "/", at: 1 }));
    const bad: string[] = [];
    const s = visitSource({ referrer: "", url: "https://example.test/x" }, tab, browser, "s-aaa", 1000, (key, problem) => bad.push(`${key}: ${problem}`));
    expect(bad).toEqual([expect.stringMatching(/^sketchbattle.visit: SyntaxError/), "sketchbattle.firstVisit: referrer is not a host"]);
    expect(s.first.at).toBe(1000);
    expect(JSON.parse(browser.getItem("sketchbattle.firstVisit")!).at).toBe(1000);
  });
});

describe("source on the session event", () => {
  const session = (source: unknown) => {
    const e = new WideEvent("abc123", "session", "client", "s-aaa", null, () => 1000);
    e.client = { session: "s-aaa", build: "dev", bundle: "", ua: "test", w: 800, h: 600, dpr: 1, player: null };
    e.set("source", source);
    return e.snapshot();
  };
  const arrival = { referrer: "itch.io", ref: null, utm: { source: null, medium: null, campaign: null }, landing: "/sketch-battle/", at: 1 };

  it("accepts a well-formed source and rejects a full referrer URL, a landing with a query, or a missing session", () => {
    expect(recordProblem(session({ visit: { ...arrival, session: "s-aaa" }, first: arrival }))).toBeNull();
    expect(recordProblem(session({ visit: { ...arrival, session: "s-aaa", referrer: "https://itch.io/games" }, first: arrival }))).toBe("bad source: visit: referrer is not a host");
    expect(recordProblem(session({ visit: { ...arrival, session: "s-aaa" }, first: { ...arrival, landing: "/?ref=x" } }))).toBe("bad source: first: landing is not a path");
    expect(recordProblem(session({ visit: arrival, first: arrival }))).toBe("bad source: visit: bad session");
    expect(recordProblem(session({ visit: { ...arrival, session: "s-aaa", ref: "x".repeat(101) }, first: arrival }))).toBe("bad source: visit: bad ref");
  });
});
