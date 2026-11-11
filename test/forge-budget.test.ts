import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import http from "node:http";
import express from "express";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { attachAuth } from "../server/auth";
import { attachForge } from "../server/forge";
import { attachCharacters } from "../server/characters";
import { initLibrary } from "../server/library";
import { initEvents } from "../server/events";
import { loadBudget, WEEK_MS } from "../server/budget";

const TOKEN = "t0k";
const ANCHOR = "2026-11-06T19:00:00Z", A = Date.parse(ANCHOR);
const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const BUDGET = { perWeek: 4, weekStartsAt: ANCHOR, paused: null, perPlayerPerDay: 2, waitingPerPlayer: 1, guest: { lifetime: 1, perIpPerDay: 2 } };
let server: http.Server, port: number, dataDir: string;

const api = (p: string, init?: RequestInit & { as?: string; ip?: string }) => fetch(`http://127.0.0.1:${port}/api${p}`, {
  ...init,
  headers: { "x-forge-token": TOKEN, "content-type": "application/json", ...(init?.as ? { "x-session": init.as } : {}), ...(init?.ip ? { "x-forwarded-for": `10.0.0.1, ${init.ip}` } : {}) },
});
const signIn = async (name: string): Promise<string> => (await (await api("/auth/dev", { method: "POST", body: JSON.stringify({ name }) })).json()).session;
const draw = (as: string, ip?: string) => api("/characters", { method: "POST", as, ip, body: JSON.stringify({ png }) });
const standing = async (as: string, ip?: string) => (await (await api("/library", { as, ip })).json()).forge;
const claim = async (): Promise<{ id: string; fighterId: string } | null> => {
  const res = await api("/forge/jobs/next");
  return res.status === 204 ? null : res.json();
};
const owners = new Map<string, string>();
const running: string[] = [];
const claimAll = async (): Promise<string[]> => {
  const got: string[] = [];
  for (let j = await claim(); j; j = await claim()) { got.push(owners.get(j.fighterId) ?? j.fighterId); running.push(j.id); }
  return got;
};
const fail = (id: string) => api(`/forge/jobs/${id}/fail`, { method: "POST", body: JSON.stringify({ error: "the agent fell over" }) });
const failRunning = async () => { for (const id of running.splice(0)) await fail(id); };

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(A + 3_600_000);
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "sb-budget-"));
  fs.writeFileSync(path.join(dataDir, "forge-budget.json"), JSON.stringify(BUDGET));
  fs.writeFileSync(path.join(dataDir, "staff.json"), JSON.stringify(["dev-boss"]));
  // guests come from another change; their sessions are fixtures here
  const guest = (id: string) => [`g-${id}`, { player: { id: `guest-${id}`, name: "Guest", avatar: null }, at: A }];
  fs.writeFileSync(path.join(dataDir, "sessions.json"), JSON.stringify([guest("one"), guest("two"), guest("three")]));
  // a job from before the budget (no claims on record), claimed this week: it counts
  fs.writeFileSync(path.join(dataDir, "forge-jobs.json"), JSON.stringify([{
    id: "old1", fighterId: "gen-old-1", owner: "dev-old", playerName: "Old", drawingPath: "/nowhere.png", status: "done", stage: "", error: null,
    claimedAt: A + 60_000, attempts: 1, origin: "creator", hint: null, public: true, createdAt: A, moderation: null, result: null,
  }]));
  const app = express();
  app.use(express.json({ limit: "12mb" }));
  const router = express.Router();
  app.use("/api", router);
  initLibrary(dataDir);
  initEvents(dataDir);
  attachAuth(router, { dataDir, devLogin: true, botKey: null, discord: { api: "http://discord.invalid", clientSecret: null } });
  attachForge(router, { token: TOKEN, dataDir, genBase: "/gen" });
  attachCharacters(router, TOKEN);
  server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  port = (server.address() as { port: number }).port;
});
afterAll(() => { vi.useRealTimers(); server.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });

describe("the forge budget, over HTTP", () => {
  it("holds players to their day, lets staff past it, rests when the week is spent and reopens fairly", async () => {
    const ann = await signIn("Ann"), bob = await signIn("Bob"), cat = await signIn("Cat"), boss = await signIn("Boss");
    expect(await standing(ann)).toMatchObject({ kind: "player", left: 2, allowance: 2, wall: null, resting: null });
    for (const s of [ann, ann]) {
      const r = await (await draw(s)).json();
      owners.set(r.character.id, "ann");
    }
    const out = await standing(ann);
    expect(out).toMatchObject({ left: 0, wall: "day" });
    expect(out.moreAt).toBe(A + 3_600_000 + 86_400_000);
    const refused = await draw(ann);
    expect(refused.status).toBe(429);
    expect((await refused.json()).forge.wall).toBe("day");

    expect(await claimAll()).toEqual(["ann", "ann"]);
    // three claimed of four (the old job's one included): staff have a player's day, start it over with the
    // admin reset, and every forge counts toward the week
    for (let i = 0; i < 2; i++) owners.set((await (await draw(boss)).json()).character.id, "boss");
    expect((await draw(boss)).status).toBe(429);
    expect((await api("/characters/allowance/reset", { method: "POST", as: ann })).status).toBe(403);
    expect((await (await api("/characters/allowance/reset", { method: "POST", as: boss })).json()).forge).toMatchObject({ kind: "staff", wall: null });
    for (let i = 0; i < 2; i++) owners.set((await (await draw(boss)).json()).character.id, "boss");
    expect(await standing(boss)).toMatchObject({ kind: "staff", wall: null });
    expect(await claimAll()).toEqual(["boss"]);
    expect(await standing(bob)).toMatchObject({ wall: null, resting: { reason: null, until: A + WEEK_MS } });

    // resting: a drawing is kept, one per player
    owners.set((await (await draw(bob)).json()).character.id, "bob");
    expect(await standing(bob)).toMatchObject({ wall: "waiting", waiting: 1, left: 1 });
    expect((await draw(bob)).status).toBe(429);
    owners.set((await (await draw(cat)).json()).character.id, "cat");
    expect(await claimAll()).toEqual([]);

    // the next week, with nothing forging: one of the boss's three first (it's first in line), then Bob and Cat ahead of the rest of the pile
    await failRunning();
    vi.setSystemTime(A + WEEK_MS + 60_000);
    expect(await standing(bob)).toMatchObject({ resting: null, waiting: 1 });
    expect(await claimAll()).toEqual(["boss", "bob", "cat", "boss"]);
    expect((await standing(cat)).resting).toEqual({ reason: null, until: A + 2 * WEEK_MS });
  });

  it("forges a failed character again for free, once, but not one the moderator blocked", async () => {
    vi.setSystemTime(A + 2 * WEEK_MS + 60_000);
    await claimAll();
    await failRunning();
    const dee = await signIn("Dee");
    const first = (await (await draw(dee)).json()).character;
    const job = (await claim())!;
    expect((await fail(job.id)).status).toBe(204);
    const failed = (await (await api(`/characters/${first.id}`, { as: dee })).json()).character;
    expect(failed).toMatchObject({ status: "failed", retryable: true });
    const before = await standing(dee);
    const retried = await (await api(`/characters/${first.id}/retry`, { method: "POST", as: dee })).json();
    expect(retried.character).toMatchObject({ status: "queued" });
    expect(retried.character.retryable).toBeUndefined();
    expect(retried.forge.left).toBe(before.left);
    const again = (await claim())!;
    expect(again.id).toBe(job.id);
    await fail(again.id);
    expect((await api(`/characters/${first.id}/retry`, { method: "POST", as: dee })).status).toBe(409);

    const second = (await (await draw(dee)).json()).character;
    const j2 = (await claim())!;
    const blocked = await (await api(`/forge/jobs/${j2.id}/moderation`, { method: "POST", body: JSON.stringify({ harsh: { verdict: "gore", reason: "r" }, lenient: { verdict: "gore", reason: "r" } }) })).json();
    expect(blocked.blocked).toBe(true);
    expect((await (await api(`/characters/${second.id}`, { as: dee })).json()).character.retryable).toBeUndefined();
    const no = await api(`/characters/${second.id}/retry`, { method: "POST", as: dee });
    expect(no.status).toBe(409);
    expect((await no.json()).error).toMatch(/moderator/);
    expect((await api(`/characters/${second.id}/retry`, { method: "POST", as: await signIn("Eve") })).status).toBe(409);
  });

  it("gives a guest one forge and a network two a day, by the address Apache saw", async () => {
    vi.setSystemTime(A + 3 * WEEK_MS + 60_000);
    expect(await standing("g-one", "198.51.100.7")).toMatchObject({ kind: "guest", left: 1, allowance: 1, perPlayerPerDay: 2 });
    expect((await draw("g-one", "198.51.100.7")).status).toBe(200);
    expect(await standing("g-one", "198.51.100.7")).toMatchObject({ left: 0, wall: "guest" });
    expect((await draw("g-two", "198.51.100.7")).status).toBe(200);
    expect(await standing("g-three", "198.51.100.7")).toMatchObject({ left: 0, wall: "network" });
    const refused = await draw("g-three", "198.51.100.7");
    expect(refused.status).toBe(429);
    expect((await refused.json()).error).toMatch(/sign in/);
    // the earlier entry in X-Forwarded-For is the client's to write; only Apache's counts
    expect((await draw("g-three", "192.0.2.4")).status).toBe(200);
    await claimAll();
  });

  it("pauses everything with the kill switch, and still takes drawings to forge later", async () => {
    vi.setSystemTime(A + 4 * WEEK_MS + 60_000);
    fs.writeFileSync(path.join(dataDir, "forge-budget.json"), JSON.stringify({ ...BUDGET, paused: "the forge is getting a tune-up" }));
    loadBudget(dataDir);
    const fay = await signIn("Fay");
    expect(await standing(fay)).toMatchObject({ resting: { reason: "the forge is getting a tune-up", until: null }, wall: null });
    expect((await draw(fay)).status).toBe(200);
    expect(await claim()).toBeNull();
    fs.writeFileSync(path.join(dataDir, "forge-budget.json"), JSON.stringify(BUDGET));
    loadBudget(dataDir);
    expect(await claim()).not.toBeNull();
    fs.writeFileSync(path.join(dataDir, "forge-budget.json"), "{ \"perWeek\": 4 }");
    expect(() => loadBudget(dataDir)).toThrow(/weekStartsAt.*missing/);
  });
});
