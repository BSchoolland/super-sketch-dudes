import { describe, expect, it } from "vitest";
import { admit, DAY_MS, DEFAULT_BUDGET, ipKeyOf, parseBudget, parseStaff, restingOf, standing, WEEK_MS, weekOf, type BudgetJob, type ForgeBudget } from "../server/budget";

const ANCHOR = "2026-11-06T19:00:00Z";
const A = Date.parse(ANCHOR);
const H = 3_600_000;
const budget = (over: Partial<ForgeBudget> = {}): ForgeBudget => ({ ...DEFAULT_BUDGET, weekStartsAt: ANCHOR, perWeek: 5, perPlayerPerDay: 2, waitingPerPlayer: 1, guest: { lifetime: 1, perIpPerDay: 2 }, ...over });
const job = (owner: string, createdAt: number, over: Partial<BudgetJob> = {}): BudgetJob => ({ owner, status: "done", createdAt, claims: [createdAt + 60_000], allowance: "player", ipKey: null, ...over });
const who = (id: string) => ({ id, name: "Fixture", avatar: null });
const none = new Set<string>();

describe("the forge week", () => {
  it("runs 7 days from the anchor, before it as well as after", () => {
    expect(weekOf(ANCHOR, A)).toEqual({ start: A, end: A + WEEK_MS });
    expect(weekOf(ANCHOR, A - 1)).toEqual({ start: A - WEEK_MS, end: A });
    expect(weekOf(ANCHOR, A + WEEK_MS + 5 * H).start).toBe(A + WEEK_MS);
    expect(weekOf(ANCHOR, A - 3 * WEEK_MS + H).start).toBe(A - 3 * WEEK_MS);
  });

  it("moves with a changed anchor: the same claims fall in the new windows", () => {
    const jobs = [job("p1", A + 2 * DAY_MS), job("p2", A + 4 * DAY_MS), job("p3", A + 6 * DAY_MS)];
    const now = A + 6 * DAY_MS + 2 * H;
    expect(restingOf(jobs, now, budget({ perWeek: 3 }))).toEqual({ reason: null, until: A + WEEK_MS });
    // the limit window now resets on Tuesdays at noon: only the claim after Tuesday counts
    const tuesday = "2026-11-10T12:00:00Z";
    expect(weekOf(tuesday, now)).toEqual({ start: Date.parse(tuesday), end: Date.parse(tuesday) + WEEK_MS });
    expect(restingOf(jobs, now, budget({ perWeek: 3, weekStartsAt: tuesday }))).toBeNull();
    expect(restingOf(jobs, now, budget({ perWeek: 1, weekStartsAt: tuesday }))).toEqual({ reason: null, until: Date.parse(tuesday) + WEEK_MS });
  });

  it("counts every claim (a job claimed twice was paid for twice), failed and blocked ones too, never unclaimed ones", () => {
    const jobs = [
      job("p1", A + H, { claims: [A + H, A + 2 * H] }),
      job("p2", A + H, { status: "failed" }),
      job("p3", A + H, { status: "queued", claims: [] }),
      job("p4", A - DAY_MS),
    ];
    expect(restingOf(jobs, A + 3 * H, budget({ perWeek: 3 }))).not.toBeNull();
    expect(restingOf(jobs, A + 3 * H, budget({ perWeek: 4 }))).toBeNull();
  });

  it("rests while the kill switch is on, with the reason, whatever is left", () => {
    expect(restingOf([], A, budget({ paused: "fixing the forge" }))).toEqual({ reason: "fixing the forge", until: null });
    const st = standing(who("dev-a"), "1.1.1.1", [], A, budget({ paused: "fixing the forge" }), none);
    expect(st.resting?.reason).toBe("fixing the forge");
    expect(st.wall).toBeNull();
  });
});

describe("a signed-in player's day", () => {
  it("is so many drawings in any 24 hours, and says when the next comes back", () => {
    const b = budget();
    expect(standing(who("dev-a"), "", [], A, b, none)).toMatchObject({ kind: "player", left: 2, allowance: 2, wall: null, moreAt: null });
    const jobs = [job("dev-a", A + H), job("dev-a", A + 5 * H), job("dev-b", A + 5 * H)];
    expect(standing(who("dev-a"), "", jobs.slice(0, 1), A + 2 * H, b, none)).toMatchObject({ left: 1, wall: null });
    const out = standing(who("dev-a"), "", jobs, A + 6 * H, b, none);
    expect(out).toMatchObject({ left: 0, wall: "day", moreAt: A + H + DAY_MS });
    expect(admit(out)).toEqual({ refused: expect.stringMatching(/today/) });
    expect(standing(who("dev-a"), "", jobs, A + H + DAY_MS + 1, b, none)).toMatchObject({ left: 1, wall: null });
    expect(admit(standing(who("dev-b"), "", jobs, A + 6 * H, b, none))).toEqual({ allowance: "player" });
  });

  it("doesn't apply to staff, whose forges still count toward the week", () => {
    const staff = new Set(["dev-boss"]);
    const jobs = [0, 1, 2, 3, 4].map((i) => job("dev-boss", A + i * H, { allowance: "staff" }));
    const st = standing(who("dev-boss"), "", jobs, A + 5 * H, budget(), staff);
    expect(st).toMatchObject({ kind: "staff", left: null, wall: null, resting: { reason: null, until: A + WEEK_MS } });
    expect(admit(st)).toEqual({ allowance: "staff" });
    expect(standing(who("dev-a"), "", jobs, A + 5 * H, budget(), staff).resting).not.toBeNull();
  });

  it("while the forge rests, lets each player leave so many drawings waiting", () => {
    const spent = [0, 1, 2, 3, 4].map((i) => job("dev-x", A + i * H - 2 * DAY_MS, { claims: [A + i * H] }));
    const st = standing(who("dev-a"), "", spent, A + 6 * H, budget(), none);
    expect(st).toMatchObject({ wall: null, waiting: 0, resting: { until: A + WEEK_MS } });
    const left = [...spent, job("dev-a", A + 6 * H, { status: "queued", claims: [] })];
    expect(standing(who("dev-a"), "", left, A + 7 * H, budget(), none)).toMatchObject({ wall: "waiting", waiting: 1, left: 1 });
    expect(standing(who("dev-a"), "", left, A + 7 * H, budget({ waitingPerPlayer: 2 }), none)).toMatchObject({ wall: null });
    expect(standing(who("dev-boss"), "", [...left, job("dev-boss", A + 7 * H, { status: "queued", claims: [] })], A + 7 * H, budget(), new Set(["dev-boss"])).wall).toBeNull();
  });
});

describe("guests", () => {
  const ip = "203.0.113.9";
  it("get a lifetime allowance, then are told to sign in", () => {
    const b = budget({ guest: { lifetime: 2, perIpPerDay: 10 } });
    expect(standing(who("guest-1"), ip, [], A, b, none)).toMatchObject({ kind: "guest", left: 2, allowance: 2, perPlayerPerDay: 2 });
    const jobs = [job("guest-1", A - 9 * DAY_MS, { allowance: "guest", ipKey: ipKeyOf(ip) }), job("guest-1", A - 8 * DAY_MS, { allowance: "guest", ipKey: ipKeyOf(ip) })];
    const st = standing(who("guest-1"), ip, jobs, A, b, none);
    expect(st).toMatchObject({ left: 0, wall: "guest", moreAt: null });
    expect(admit(st)).toEqual({ refused: expect.stringMatching(/sign in/) });
    expect(admit(standing(who("guest-2"), ip, jobs, A, b, none))).toEqual({ allowance: "guest" });
  });

  it("from one network get so many a day between them, however many guest ids it mints", () => {
    const b = budget();
    const g = (id: string, at: number, from = ip) => job(id, at, { allowance: "guest", ipKey: ipKeyOf(from) });
    const jobs = [g("guest-1", A), g("guest-2", A + H), g("guest-3", A + H, "198.51.100.1")];
    const st = standing(who("guest-4"), ip, jobs, A + 2 * H, b, none);
    expect(st).toMatchObject({ left: 0, wall: "network", moreAt: A + DAY_MS });
    expect(admit(st)).toEqual({ refused: expect.stringMatching(/network/) });
    expect(standing(who("guest-4"), "198.51.100.1", jobs, A + 2 * H, b, none)).toMatchObject({ left: 1, wall: null });
    expect(standing(who("guest-4"), ip, jobs, A + DAY_MS + 1, b, none)).toMatchObject({ left: 1, wall: null });
    // a signed-in player on the same network isn't held to it
    expect(standing(who("dev-a"), ip, jobs, A + 2 * H, b, none).wall).toBeNull();
  });
});

describe("the budget file", () => {
  it("takes the documented shape", () => {
    expect(parseBudget(JSON.parse(JSON.stringify(DEFAULT_BUDGET)), "f")).toEqual(DEFAULT_BUDGET);
    expect(parseBudget({ ...DEFAULT_BUDGET, paused: "back soon", weekStartsAt: "2026-11-06T11:00:00-08:00" }, "f").paused).toBe("back soon");
  });
  it("refuses anything else, loudly", () => {
    const bad: [unknown, RegExp][] = [
      [[], /object/],
      [{ ...DEFAULT_BUDGET, perWeek: "100" }, /perWeek/],
      [{ ...DEFAULT_BUDGET, perWeek: -1 }, /perWeek/],
      [{ ...DEFAULT_BUDGET, perPlayerPerDay: 2.5 }, /perPlayerPerDay/],
      [{ ...DEFAULT_BUDGET, weekStartsAt: "Friday 7pm" }, /weekStartsAt/],
      [{ ...DEFAULT_BUDGET, weekStartsAt: "2026-11-06T19:00:00" }, /weekStartsAt/],
      [{ ...DEFAULT_BUDGET, paused: true }, /paused/],
      [{ ...DEFAULT_BUDGET, paused: "" }, /paused/],
      [{ ...DEFAULT_BUDGET, guest: { lifetime: 1 } }, /perIpPerDay/],
      [{ ...DEFAULT_BUDGET, perweek: 3 }, /unknown field "perweek"/],
      [(({ waitingPerPlayer: _, ...rest }) => rest)(DEFAULT_BUDGET), /waitingPerPlayer.*missing/],
    ];
    for (const [raw, why] of bad) expect(() => parseBudget(raw, "forge-budget.json")).toThrow(why);
    expect(() => parseStaff({ ids: [] }, "staff.json")).toThrow(/array/);
    expect(parseStaff(["a", "b"], "staff.json")).toEqual(new Set(["a", "b"]));
  });
});
