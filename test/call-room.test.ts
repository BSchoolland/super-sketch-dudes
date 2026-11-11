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

/** The Discord Activity's room: everyone who opens the game in one voice channel launch, through the real lobby. */
let server: http.Server, port: number, dataDir: string;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until<T>(fn: () => T | undefined, what: string, ms = 3000): Promise<T> {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { const v = fn(); if (v) return v; await wait(20); }
  throw new Error(`timed out waiting for ${what}`);
}
class Peer {
  ws: WebSocket; inbox: any[] = []; id = 0;
  constructor(public name: string) {
    this.ws = new WebSocket(`ws://127.0.0.1:${port}/ws?trace=s-call-${name.toLowerCase()}`);
    this.ws.on("message", (m) => { const j = JSON.parse(String(m)); if (j.t === "hello") this.id = j.id; this.inbox.push(j); });
  }
  async ready(): Promise<void> { await new Promise<void>((r) => this.ws.once("open", () => r())); await this.expect("hello"); this.send({ t: "name", session: this.name }); }
  send(m: unknown): void { this.ws.send(JSON.stringify(m)); }
  expect(t: string, pred: (m: any) => boolean = () => true): Promise<any> {
    return until(() => { const i = this.inbox.findIndex((m) => m.t === t && pred(m)); return i >= 0 ? this.inbox.splice(i, 1)[0] : undefined; }, `${this.name}: ${t} message`);
  }
  /** The newest room state this peer was sent. */
  async room(pred: (m: any) => boolean): Promise<any> { return this.expect("room", pred); }
}
const peers = async (...names: string[]) => { const ps = names.map((n) => new Peer(n)); await Promise.all(ps.map((p) => p.ready())); return ps; };
const key = (c: string) => c.repeat(32);
const ready = (p: Peer) => p.send({ t: "pick", fighter: "slugbert", bundleUrl: "/house/slugbert/bundle.json", ready: true });

beforeAll(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "sb-call-"));
  initEvents(dataDir);
  initLibrary(dataDir);
  server = http.createServer(express());
  attachLobby(new WebSocketServer({ server, path: "/ws" }), (s) => (typeof s === "string" ? { id: `dev-${s}`, name: s, avatar: null } : null));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  port = (server.address() as { port: number }).port;
});
// the sockets closed last still write their connection events
afterAll(async () => { await wait(300); server.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });

describe("a Discord Activity launch's room", () => {
  it("puts everyone with the launch's key in one private room, the first one hosting, and hands hosting on when they leave", async () => {
    const [a, b, c, other] = await peers("Ann", "Bob", "Cat", "Dee");
    a.send({ t: "call", key: key("a") });
    const made = await a.room((m) => m.members.length === 1);
    expect(made).toMatchObject({ call: true, public: false, host: a.id });
    b.send({ t: "call", key: key("a") });
    c.send({ t: "call", key: key("a") });
    const three = await a.room((m) => m.members.length === 3);
    expect(three.code).toBe(made.code);
    expect(three.members.map((m: any) => m.name)).toEqual(["Ann", "Bob", "Cat"]);
    // another launch (another voice channel) is another room
    other.send({ t: "call", key: key("b") });
    expect((await other.room(() => true)).code).not.toBe(made.code);
    // not listed for JOIN ROOM or QUICK MATCH
    a.send({ t: "rooms" });
    expect((await a.expect("rooms")).rooms.map((r: any) => r.code)).not.toContain(made.code);

    a.send({ t: "leave" });
    const handed = await b.room((m) => m.members.length === 2 && m.members[0].name === "Bob");
    expect(handed.host).toBe(b.id);
    for (const p of [a, b, c, other]) p.ws.close();
  });

  it("refuses a key that isn't a digest", async () => {
    const [a] = await peers("Eve");
    a.send({ t: "call", key: "i-1234-gc-5678-9012" });
    expect((await a.expect("error")).error).toBe("bad call key");
    a.ws.close();
  });

  it("holds someone who opens it mid-match until the host ends the match, then seats them", async () => {
    const [a, b, late] = await peers("Fay", "Gus", "Hal");
    a.send({ t: "call", key: key("c") });
    await a.room(() => true);
    b.send({ t: "call", key: key("c") });
    await a.room((m) => m.members.length === 2);
    ready(a); ready(b);
    await a.room((m) => m.members.every((x: any) => x.ready));
    a.send({ t: "start", config: { stage: "proving", rules: { stocks: 3, time: 0 } } });
    await b.expect("start");
    late.send({ t: "call", key: key("c") });
    await late.expect("waiting");
    expect(late.inbox.some((m) => m.t === "room")).toBe(false);
    a.send({ t: "end" });
    const seated = await late.room((m) => m.members.length === 3);
    expect(seated).toMatchObject({ started: false, host: a.id });
    expect(seated.members.map((m: any) => [m.name, m.slot])).toEqual([["Fay", 0], ["Gus", 1], ["Hal", 2]]);
    for (const p of [a, b, late]) p.ws.close();
  });

  it("seats the waiting when everyone in the match leaves, the first of them hosting", async () => {
    const [a, b, late] = await peers("Ivy", "Jon", "Kit");
    a.send({ t: "call", key: key("d") });
    await a.room(() => true);
    b.send({ t: "call", key: key("d") });
    await a.room((m) => m.members.length === 2);
    ready(a); ready(b);
    await a.room((m) => m.members.every((x: any) => x.ready));
    a.send({ t: "start", config: { stage: "proving", rules: { stocks: 3, time: 0 } } });
    await b.expect("start");
    late.send({ t: "call", key: key("d") });
    await late.expect("waiting");
    a.send({ t: "leave" });
    b.send({ t: "leave" });
    const alone = await late.room((m) => m.members.length === 1);
    expect(alone).toMatchObject({ started: false, host: late.id, call: true });
    for (const p of [a, b, late]) p.ws.close();
  });

  it("tells the seventh person it's full (waiting counts), and a room code can't take a waiting person's place", async () => {
    const five = await peers("P1", "P2", "P3", "P4", "P5");
    five[0].send({ t: "call", key: key("e") });
    await five[0].room(() => true);
    for (const p of five.slice(1)) p.send({ t: "call", key: key("e") });
    const room = await five[0].room((m) => m.members.length === 5);
    for (const p of five) ready(p);
    await five[0].room((m) => m.members.length === 5 && m.members.every((x: any) => x.ready));
    five[0].send({ t: "start", config: { stage: "proving", rules: { stocks: 3, time: 0 } } });
    await five[1].expect("start");
    const [waiter, seventh, byCode] = await peers("P6", "P7", "P8");
    waiter.send({ t: "call", key: key("e") });
    await waiter.expect("waiting");
    seventh.send({ t: "call", key: key("e") });
    await seventh.expect("full");
    five[0].send({ t: "end" });
    await waiter.room((m) => m.members.length === 6);
    byCode.send({ t: "join", code: room.code });
    expect((await byCode.expect("error")).error).toBe("room full");
    for (const p of [...five, waiter, seventh, byCode]) p.ws.close();
  });
});
