import { describe, expect, it } from "vitest";
import { journey, type ForgeJobRecord } from "../server/journey";
import { visitors } from "../server/visitors";
import type { StoredEvent } from "../server/eventlog";

const T0 = Date.UTC(2026, 10, 11, 15);
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Firefox/140.0";
const pip = { id: "guest-pip", name: "Pip" };

function session(trace: string, t0: number, t1: number, screens: [string, number][]): StoredEvent {
  return { at: "", id: `e-${trace}`, kind: "session", source: "client", trace, parent: null, level: "info", headline: null, t0, t1, seq: 3, final: false, issues: [],
    business: { screens }, client: { session: trace, build: "dev", bundle: "", ua: UA, w: 1280, h: 720, dpr: 1, player: pip } };
}
function forge(id: string, t0: number, t1: number, ok: boolean): StoredEvent {
  return { at: "", id: `e-${id}`, kind: "forge", source: "server", trace: `f-${id}`, parent: null, level: "info", headline: null, t0, t1, seq: 6, final: true, issues: [],
    business: { job: { id, owner: pip.id }, ...(ok ? { result: { bundleUrl: "/gen/x/bundle.json" } } : {}) } };
}
const job = (id: string): ForgeJobRecord => ({ id, fighterId: `gen-${id}`, hint: { name: "SAM", description: "he walks" }, drawingPath: "/d.png", status: "done", error: null, createdAt: T0, result: null, moderation: null, blocked: false });

function build(events: StoredEvent[]) {
  const v = visitors(events, 0, new Set());
  return journey(v.humans[0], events, new Map([["j1", job("j1")]]), v.visitorOf, 10);
}

describe("journey", () => {
  it("follows what they did while the forge ran, and stretches past the window to see it finish", () => {
    const j = build([
      session("s-1", T0, T0 + 15 * 60_000, [["TitleScreen", 0], ["CreateScreen", 5], ["DescribeScreen", 65], ["LibraryScreen", 80], ["LoadingScreen", 90], ["VersusScreen", 91]]),
      forge("j1", T0 + 80_000, T0 + 12 * 60_000, true),
    ]);
    const f = j.forges[0];
    expect(f.during.map((s) => s.screen)).toEqual(["LibraryScreen", "LoadingScreen", "VersusScreen"]);
    expect(f.atDone).toBe("VersusScreen");
    expect(f.goneAt).toBeNull();
    expect(j.end).toBe(T0 + 14 * 60_000);
  });

  it("tells when they had left before their fighter was done", () => {
    const j = build([
      session("s-1", T0, T0 + 90_000, [["TitleScreen", 0], ["CreateScreen", 5], ["LibraryScreen", 85]]),
      forge("j1", T0 + 84_000, T0 + 10 * 60_000, true),
    ]);
    expect(j.forges[0].atDone).toBeNull();
    expect(j.forges[0].goneAt).toBe(T0 + 90_000);
    expect(j.forges[0].looked).toBe(false);
  });
});
