import { afterEach, describe, expect, it, vi } from "vitest";
vi.hoisted(() => { (globalThis as Record<string, unknown>).__BUILD__ = "test"; });
vi.mock("../client/src/telemetry/events", async () => {
  const { WideEvent } = await import("../shared/wide");
  return {
    clientEvent: (kind: "match", trace: string) => new WideEvent("e", kind, "client", trace, null, Date.now),
    finishEvent: () => {},
    sessionList: () => {},
    view: {},
  };
});
import { MatchTelemetry } from "../client/src/telemetry/match";
import type { RollbackSession } from "../client/src/net/rollback";

function telemetry() {
  const t = new MatchTelemetry({
    room: { code: "TEST", trace: null },
    config: { seed: 1, stage: "rooftops", rules: { stocks: 3, time: 0 }, players: [{ fighter: "a" }, { fighter: "b" }, { fighter: "c" }] } as never,
    members: [{ id: 1, name: "Ben", slot: 0 }, { id: 2, name: "Adrean", slot: 1 }, { id: 3, name: "Kirill", slot: 2 }],
    localSlot: 0, inputDelay: 2, bundles: [],
  });
  let missing: number[] = [];
  const session = { state: { frame: 0, ended: false }, confirmedThrough: 0, frameLead: () => 0, waitingOn: () => missing };
  (t as unknown as { session: RollbackSession }).session = session as unknown as RollbackSession;
  let now = 1000;
  vi.spyOn(performance, "now").mockImplementation(() => now);
  const tick = (ms: number, waitingOn: number[] | null) => { now += ms; missing = waitingOn ?? []; t.tick(50, waitingOn !== null); };
  const net = () => t.event.business.net as { waitingMs: number; waits: number; unattributedWaitMs: number; waitedOn: Record<number, { name: string; waitingMs: number; waits: number; longestWaitMs: number }> };
  return { t, tick, net };
}

describe("match telemetry wait attribution", () => {
  afterEach(() => vi.restoreAllMocks());

  it("charges each WAITING stall to the remote players whose input was missing", () => {
    const { tick, net } = telemetry();
    tick(16, null);
    tick(100, [2]);
    tick(100, [1, 2]);
    tick(16, null);
    tick(200, [2]);
    tick(16, null);
    tick(50, []);
    tick(16, null);
    expect(net().waits).toBe(3);
    expect(net().waitedOn[2]).toEqual({ name: "Kirill", waitingMs: 400, waits: 2, longestWaitMs: 200 });
    expect(net().waitedOn[1]).toEqual({ name: "Adrean", waitingMs: 100, waits: 1, longestWaitMs: 100 });
    expect(net().unattributedWaitMs).toBe(50);
  });

  it("names the player in the long-stall issue and the summary", () => {
    const { t, tick } = telemetry();
    tick(16, null);
    tick(3500, [2]);
    tick(16, null);
    t.finish("done");
    expect(t.event.issues[0].message).toBe("a WAITING stall longer than 3 s, waiting on Kirill");
    expect((t.event.business.summary as { message: string }).message).toContain("most on Kirill, 3.5 s");
  });
});
