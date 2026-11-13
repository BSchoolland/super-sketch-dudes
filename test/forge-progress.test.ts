import { describe, expect, it, vi } from "vitest";
import { FORGE_STEPS } from "../shared/forge-steps";

const clock = vi.hoisted(() => ({ now: 0, warned: [] as string[] }));
vi.mock("../client/src/account", () => ({ serverNow: () => clock.now }));
vi.mock("../client/src/telemetry/events", () => ({ everywhere: (_level: string, _code: string, message: string) => clock.warned.push(message) }));
const { forgeProgress } = await import("../client/src/screens/forge-progress");

/** A forge that spends `took[stage]` seconds on each step, read every second from claim to done. */
function readings(took: (step: (typeof FORGE_STEPS)[number]) => number): { done: number; etaS: number | null }[] {
  const out: { done: number; etaS: number | null }[] = [];
  let at = 0;
  for (const step of FORGE_STEPS.filter((s) => s.s > 0)) {
    const s = took(step);
    for (let t = 0; t < s; t++) { clock.now = (at + t) * 1000; out.push(forgeProgress({ status: "generating", stage: step.stage, stageAt: at * 1000 })); }
    at += s;
  }
  return out;
}

describe("forge progress", () => {
  it("is the same whenever it's read: it comes from the stage and when the server says it began", () => {
    clock.now = 1_000_000;
    const a = forgeProgress({ status: "generating", stage: "designing the moves", stageAt: 1_000_000 - 90_000 });
    const b = forgeProgress({ status: "generating", stage: "designing the moves", stageAt: 1_000_000 - 90_000 });
    expect(a).toEqual(b);
    expect(a.done).toBeGreaterThan(0);
  });

  it("only moves forward, and never reaches the end before it's done, on a typical forge and a slow one", () => {
    for (const pace of [1, 0.4, 3]) {
      const r = readings((s) => Math.max(1, Math.round(s.s * pace)));
      for (let i = 1; i < r.length; i++) expect(r[i].done).toBeGreaterThanOrEqual(r[i - 1].done);
      expect(r[r.length - 1].done).toBeLessThan(1);
    }
  });

  it("counts down on a typical forge, ending under a minute", () => {
    const r = readings((s) => s.s).map((x) => x.etaS!);
    for (let i = 1; i < r.length; i++) expect(r[i]).toBeLessThanOrEqual(r[i - 1] + 1e-9);
    expect(r[0]).toBeGreaterThan(FORGE_STEPS.reduce((t, s) => t + s.s, 0) - 30);
    expect(r[r.length - 1]).toBeLessThan(60);
  });

  it("has no ETA in line, and reports a stage it has no step for instead of breaking the screen", () => {
    expect(forgeProgress({ status: "queued", stage: "waiting in line" }).etaS).toBeNull();
    expect(forgeProgress({ status: "generating", stage: "summoning" }).label).toBe("summoning");
    expect(clock.warned).toEqual(['no step for forge stage "summoning"']);
  });
});
