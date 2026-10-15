import { afterAll, beforeAll, describe, expect, it } from "vitest";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";
import { WebSocketServer, WebSocket } from "ws";
import { initEvents } from "../server/events";
import { attachLobby } from "../server/lobby";
import { initLibrary } from "../server/library";
import { createMatch, smallestTeam, step } from "../shared/sim";
import { cpuInput } from "../shared/cpu";
import { loadAllHouse } from "./house";

/** Team battles: the room's sides through the real lobby, and a match played on them. */
let server: http.Server, port: number, dataDir: string;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until<T>(fn: () => T | undefined, what: string, ms = 3000): Promise<T> {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { const v = fn(); if (v) return v; await wait(20); }
  throw new Error(`timed out waiting for ${what}`);
}
class Peer {
  ws: WebSocket; inbox: any[] = []; id = 0;
  constructor(trace: string) {
    this.ws = new WebSocket(`ws://127.0.0.1:${port}/ws?trace=${trace}`);
    this.ws.on("message", (m) => { const j = JSON.parse(String(m)); if (j.t === "hello") this.id = j.id; this.inbox.push(j); });
  }
  async ready(): Promise<void> { await new Promise<void>((r) => this.ws.once("open", () => r())); await this.expect("hello"); }
  send(m: unknown): void { this.ws.send(JSON.stringify(m)); }
  expect(t: string, pred: (m: any) => boolean = () => true): Promise<any> {
    return until(() => { const i = this.inbox.findIndex((m) => m.t === t && pred(m)); return i >= 0 ? this.inbox.splice(i, 1)[0] : undefined; }, `${t} message`);
  }
}
const bot = (fighter: string, team: number) => ({ fighter, bundleUrl: `/house/${fighter}/bundle.json`, level: 3, team });
const pick = (p: Peer) => p.send({ t: "pick", fighter: "slugbert", bundleUrl: "/house/slugbert/bundle.json", ready: true });

beforeAll(async () => {
  await loadAllHouse();
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "sb-teams-"));
  initEvents(dataDir);
  initLibrary(dataDir);
  server = http.createServer(express());
  attachLobby(new WebSocketServer({ server, path: "/ws" }));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  port = (server.address() as { port: number }).port;
});
afterAll(() => { server.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });

describe("team battle rooms", () => {
  it("splits the room red and blue, seats a newcomer on the smaller side, lets players switch, and starts with everyone's side", async () => {
    const a = new Peer("s-teams-a"), b = new Peer("s-teams-b"), c = new Peer("s-teams-c");
    await Promise.all([a.ready(), b.ready(), c.ready()]);
    a.send({ t: "create", public: false });
    const room = await a.expect("room");
    b.send({ t: "join", code: room.code });
    await a.expect("room", (m) => m.members.length === 2);
    a.send({ t: "bots", bots: [bot("woodstove", 0)] });
    await a.expect("room", (m) => m.bots.length === 1);
    a.send({ t: "teams", on: true });
    const split = await a.expect("room", (m) => m.teams);
    expect([...split.members.map((m: any) => m.team), ...split.bots.map((x: any) => x.team)]).toEqual([0, 1, 0]);
    c.send({ t: "join", code: room.code });
    const joined = await a.expect("room", (m) => m.members.length === 3);
    expect(joined.members[2].team).toBe(1);

    // only the host turns teams on or off
    b.send({ t: "teams", on: false });
    c.send({ t: "team", team: 2 });
    await a.expect("room", (m) => m.members[2].team === 2);
    expect(a.inbox.some((m) => m.t === "room" && !m.teams)).toBe(false);
    c.send({ t: "team", team: 3 });
    expect((await c.expect("error")).error).toBe("bad team");

    [a, b, c].forEach(pick);
    await a.expect("room", (m) => m.members.every((x: any) => x.ready));
    a.send({ t: "start", config: { stage: "proving", rules: { stocks: 3, time: 0 } } });
    const start = await b.expect("start");
    expect(start.config.rules).toEqual({ stocks: 3, time: 0, teams: true });
    expect(start.config.players.map((p: any) => p.team)).toEqual([0, 1, 2, 0]);
    [a, b, c].forEach((p) => p.ws.close());
  });

  it("won't start a team battle with everyone on one side, and a room without teams starts without them", async () => {
    const a = new Peer("s-teams-one"), b = new Peer("s-teams-one-b");
    await Promise.all([a.ready(), b.ready()]);
    a.send({ t: "create", public: false });
    const room = await a.expect("room");
    b.send({ t: "join", code: room.code });
    await a.expect("room", (m) => m.members.length === 2);
    a.send({ t: "teams", on: true });
    await a.expect("room", (m) => m.teams);
    b.send({ t: "team", team: 0 });
    await a.expect("room", (m) => m.members[1].team === 0);
    [a, b].forEach(pick);
    await a.expect("room", (m) => m.members.every((x: any) => x.ready));
    a.send({ t: "start", config: { stage: "proving", rules: { stocks: 3, time: 0 } } });
    expect((await a.expect("error")).error).toBe("everyone is on one team");

    a.send({ t: "teams", on: false });
    await a.expect("room", (m) => !m.teams);
    a.send({ t: "start", config: { stage: "proving", rules: { stocks: 3, time: 0 } } });
    const start = await b.expect("start");
    expect(start.config.rules.teams).toBe(false);
    expect(start.config.players.some((p: any) => "team" in p)).toBe(false);
    [a, b].forEach((p) => p.ws.close());
  });
});

describe("team battle matches", () => {
  it("seats newcomers on red or blue, whichever is smaller, never green", () => {
    expect(smallestTeam([])).toBe(0);
    expect(smallestTeam([0])).toBe(1);
    expect(smallestTeam([0, 1])).toBe(0);
    expect(smallestTeam([0, 0, 1, 2, 2, 2])).toBe(1);
  });

  it("teammates never hit each other, and the match is won by a side", () => {
    const s = createMatch({ stage: "proving", players: [0, 1, 0, 1].map((team) => ({ fighter: "lampjack", team, cpu: 0 })), rules: { stocks: 1, time: 0, teams: true }, seed: 3 });
    for (let i = 0; i < 60 * 60 * 3 && !s.ended; i++) {
      step(s, s.fighters.map((_, slot) => cpuInput(s, slot, 5)));
      for (const e of s.events) if (e.t === "hit") expect(s.fighters[e.attacker].team).not.toBe(s.fighters[e.victim].team);
      s.events.length = 0;
    }
    expect(s.ended).toBe(true);
    const alive = s.fighters.filter((f) => f.stocks > 0);
    expect(alive.length).toBeGreaterThan(0);
    expect(alive.every((f) => f.team === s.winner)).toBe(true);
  });
});
