import { describe, expect, it } from "vitest";
import { MAX_ISSUES, matchTrace, newestById, recordProblem, WideEvent } from "../shared/wide";

const clock = () => { let t = 1000; return () => (t += 10); };
const clientRecord = () => {
  const e = new WideEvent("abc123", "match", "client", "m-ABCD-0000002a", "s-1", clock());
  e.client = { session: "s-1", build: "dev", bundle: "", ua: "test", w: 800, h: 600, dpr: 1, player: null };
  return e;
};

describe("wide event model", () => {
  it("escalates the level but never lowers it", () => {
    const e = new WideEvent("a", "session", "client", "s-1", null, clock());
    expect(e.level).toBe("info");
    e.escalate("warn");
    e.escalate("info");
    expect(e.level).toBe("warn");
    e.issue("error", "camera", "non-finite");
    e.escalate("warn");
    expect(e.level).toBe("error");
  });

  it("counts a repeated issue instead of listing it again, and caps distinct ones", () => {
    const e = new WideEvent("a", "session", "client", "s-1", null, clock());
    e.issue("warn", "console.error", "sprite failed");
    e.issue("warn", "console.error", "sprite failed");
    expect(e.issues).toHaveLength(1);
    expect(e.issues[0].n).toBe(2);
    for (let i = 0; i < MAX_ISSUES + 5; i++) e.issue("warn", "x", `m${i}`);
    expect(e.issues).toHaveLength(MAX_ISSUES);
    expect(e.business.issuesDropped).toBe(6);
  });

  it("headlines the first error, else the first warning, else a business marker's message", () => {
    const e = new WideEvent("a", "match", "client", "m-X", null, clock());
    expect(e.headline()).toBeNull();
    e.set("net", { frames: 3 }).set("summary", { message: "2p proving · 900 frames · done" });
    expect(e.headline()).toBe("2p proving · 900 frames · done");
    e.issue("warn", "waiting", "a WAITING stall longer than 3 s");
    expect(e.headline()).toBe("waiting: a WAITING stall longer than 3 s");
    e.issue("error", "blank", "the world layer drew nothing but paper");
    e.issue("error", "camera", "later");
    expect(e.headline()).toBe("blank: the world layer drew nothing but paper");
  });

  it("snapshots count up and carry the times from the injected clock", () => {
    const e = clientRecord();
    const a = e.snapshot(), b = e.snapshot();
    expect([a.seq, b.seq]).toEqual([1, 2]);
    expect(a.t0).toBe(1010);
    expect(b.t1).toBeGreaterThan(a.t1);
    expect(a.final).toBe(false);
  });

  it("gives every participant of a match the same trace", () => {
    expect(matchTrace("ABCD", 42)).toBe("m-ABCD-0000002a");
    expect(matchTrace("ABCD", 0xffffffff)).toBe("m-ABCD-ffffffff");
  });

  it("accepts a client record and says what's wrong with a bad one", () => {
    const ok = JSON.parse(JSON.stringify(clientRecord().snapshot()));
    expect(recordProblem(ok)).toBeNull();
    expect(recordProblem({ ...ok, kind: "request" })).toMatch(/bad kind/);
    expect(recordProblem({ ...ok, source: "server" })).toMatch(/source/);
    expect(recordProblem({ ...ok, trace: "has spaces" })).toMatch(/trace/);
    expect(recordProblem({ ...ok, client: undefined })).toMatch(/client tier/);
    expect(recordProblem({ ...ok, t1: "soon" })).toMatch(/t1/);
    expect(recordProblem([])).toMatch(/object/);
  });

  it("keeps the newest snapshot of each event", () => {
    const e = clientRecord();
    const first = e.snapshot();
    e.set("net", { frames: 600 });
    const second = JSON.parse(JSON.stringify(e.snapshot()));
    const other = new WideEvent("zzz", "session", "client", "s-1", null, clock()).snapshot();
    const kept = newestById([second, first, other]);
    expect(kept).toHaveLength(2);
    expect(kept.find((r) => r.id === "abc123")!.business).toEqual({ net: { frames: 600 } });
  });
});
