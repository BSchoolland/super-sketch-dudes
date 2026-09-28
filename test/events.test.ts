import { afterAll, beforeAll, describe, expect, it } from "vitest";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";
import { WebSocketServer, WebSocket } from "ws";
import { attachEvents, initEvents, requestErrors, requestEvents } from "../server/events";
import { filterEvents, readEvents } from "../server/eventlog";
import { attachAuth } from "../server/auth";
import { attachLobby, dropSilentPlayers, INPUT_TIMEOUT_MS } from "../server/lobby";
import { matchTrace, WideEvent } from "../shared/wide";

/** The wide event store through the real server pieces: client ingest, request events, and the relay's room/match/connection events. */
let server: http.Server, port: number, dataDir: string;
const url = (p: string) => `http://127.0.0.1:${port}/api${p}`;
const events = () => readEvents(dataDir);
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until<T>(fn: () => T | undefined, what: string, ms = 3000): Promise<T> {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { const v = fn(); if (v) return v; await wait(20); }
  throw new Error(`timed out waiting for ${what}`);
}

function record(id: string, seq: number, business: Record<string, unknown> = {}) {
  let t = 5000;
  const e = new WideEvent(id, "match", "client", "m-TEST-00000001", "s-tester", () => (t += 1));
  e.client = { session: "s-tester", build: "dev", bundle: "", ua: "vitest", w: 1280, h: 720, dpr: 1, player: { id: "dev-ann", name: "Ann" } };
  Object.assign(e.business, business);
  e.seq = seq - 1;
  return e.snapshot();
}
const post = (body: string, type = "text/plain", trace?: string) => fetch(url("/events"), { method: "POST", headers: { "content-type": type, ...(trace ? { "x-trace-id": trace } : {}) }, body });

class Peer {
  ws: WebSocket; inbox: any[] = []; id = 0;
  constructor(trace: string) {
    this.ws = new WebSocket(`ws://127.0.0.1:${port}/ws?trace=${trace}`);
    this.ws.on("message", (m) => { const j = JSON.parse(String(m)); if (j.t === "hello") this.id = j.id; this.inbox.push(j); });
  }
  open(): Promise<void> { return this.ws.readyState === WebSocket.OPEN ? Promise.resolve() : new Promise((r) => this.ws.once("open", () => r())); }
  send(m: unknown): void { this.ws.send(JSON.stringify(m)); }
  expect(t: string, pred: (m: any) => boolean = () => true): Promise<any> {
    return until(() => { const i = this.inbox.findIndex((m) => m.t === t && pred(m)); return i >= 0 ? this.inbox.splice(i, 1)[0] : undefined; }, `${t} message`);
  }
}

beforeAll(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "sb-events-"));
  initEvents(dataDir);
  const app = express();
  app.use(express.json({ limit: "256kb" }));
  const api = express.Router();
  app.use("/api", api);
  api.use(requestEvents());
  attachEvents(api);
  attachAuth(api, { dataDir, devLogin: true, botKey: null });
  api.get("/boom", () => { throw new Error("kaboom"); });
  api.use(requestErrors());
  server = http.createServer(app);
  attachLobby(new WebSocketServer({ server, path: "/ws" }));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  port = (server.address() as { port: number }).port;
});
afterAll(() => { server.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });

describe("client event ingest", () => {
  it("stores a batch sent as text/plain (sendBeacon's type) and keeps only the newest snapshot of each event", async () => {
    const res = await post(JSON.stringify({ events: [record("ingest1", 1, { net: { frames: 10 } }), record("ingest2", 1)] }));
    expect(res.status).toBe(204);
    expect((await post(JSON.stringify({ events: [record("ingest1", 2, { net: { frames: 600 } })] }), "application/json")).status).toBe(204);
    const mine = events().filter((e) => e.id.startsWith("ingest"));
    expect(mine.map((e) => e.id).sort()).toEqual(["ingest1", "ingest2"]);
    const one = mine.find((e) => e.id === "ingest1")!;
    expect(one.seq).toBe(2);
    expect(one.business).toEqual({ net: { frames: 600 } });
    expect(Date.parse(one.at)).toBeGreaterThan(0);
    expect(fs.readFileSync(path.join(dataDir, "events.jsonl"), "utf8").split("\n").filter((l) => l.includes("ingest1"))).toHaveLength(2);
  });

  it("rejects what isn't a client wide event, keeps the good ones, and records the rejection loudly", async () => {
    const bad = { ...record("rejected1", 1), source: "server" };
    const res = await post(JSON.stringify({ events: [record("accepted1", 1), bad] }), "text/plain", "s-sender");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "1 of 2 rejected: source must be client", accepted: 1 });
    const all = events();
    expect(all.some((e) => e.id === "accepted1")).toBe(true);
    expect(all.some((e) => e.id === "rejected1")).toBe(false);
    const req = all.find((e) => e.kind === "request" && e.trace === "s-sender")!;
    expect(req.level).toBe("warn");
    expect(req.request).toMatchObject({ method: "POST", path: "/api/events", status: 400 });
    expect(req.headline).toBe("ingest: 1 of 2 rejected: source must be client");
    expect((await post("not json")).status).toBe(400);
    expect((await post(JSON.stringify({ events: [] }))).status).toBe(400);
  });
});

describe("request events", () => {
  it("files a write under the caller's trace and echoes it; successful reads stay quiet; failures don't", async () => {
    const res = await fetch(url("/auth/dev"), { method: "POST", headers: { "content-type": "application/json", "x-trace-id": "s-writer" }, body: JSON.stringify({ name: "Ann" }) });
    expect(res.headers.get("x-trace-id")).toBe("s-writer");
    const { session } = await res.json();
    expect((await fetch(url("/me"), { headers: { "x-session": session, "x-trace-id": "s-reader" } })).status).toBe(200);
    expect((await fetch(url("/me"), { headers: { "x-trace-id": "s-stranger" } })).status).toBe(401);
    expect((await fetch(url("/boom"), { headers: { "x-trace-id": "s-boom" } })).status).toBe(500);
    await wait(50);
    const all = events();
    expect(all.find((e) => e.trace === "s-writer")).toMatchObject({ kind: "request", level: "info", final: true, request: { method: "POST", path: "/api/auth/dev", status: 200 } });
    expect(all.some((e) => e.trace === "s-reader")).toBe(false);
    expect(all.find((e) => e.trace === "s-stranger")?.level).toBe("warn");
    const boom = all.find((e) => e.trace === "s-boom")!;
    expect(boom.level).toBe("error");
    expect(boom.issues[0]).toMatchObject({ code: "Error", message: "kaboom" });
  });
});

describe("relay events", () => {
  it("drops a mid-match player the relay hasn't heard inputs from for INPUT_TIMEOUT_MS", async () => {
    const a = new Peer("s-quiet-host"), b = new Peer("s-quiet-guest");
    await a.open(); await b.open();
    await a.expect("hello"); await b.expect("hello");
    a.send({ t: "create" });
    const room = await a.expect("room");
    b.send({ t: "join", code: room.code });
    await a.expect("room", (m) => m.members.length === 2);
    a.send({ t: "pick", fighter: "rocket", bundleUrl: "/house/rocket/bundle.json", ready: true });
    b.send({ t: "pick", fighter: "wizard", bundleUrl: "/house/wizard/bundle.json", ready: true });
    await a.expect("room", (m) => m.members.every((x: any) => x.ready));
    a.send({ t: "start", config: { stage: "proving", rules: { stocks: 3, time: 0 }, inputDelay: 2 } });
    const start = await b.expect("start");
    await wait(500);
    a.send({ t: "inputs", frame: 3, inputs: [] });
    await b.expect("inputs");
    const now = Date.now();
    dropSilentPlayers(now + INPUT_TIMEOUT_MS - 1000);
    await wait(50);
    expect(b.ws.readyState).toBe(WebSocket.OPEN);
    // b has been silent since the start, half a second longer than a: b goes, a stays
    dropSilentPlayers(now + INPUT_TIMEOUT_MS - 200);
    await a.expect("left", (m) => m.duringMatch === true);
    await until(() => b.ws.readyState === WebSocket.CLOSED ? true : undefined, "guest socket closed");
    expect(a.ws.readyState).toBe(WebSocket.OPEN);
    a.send({ t: "end" });
    await a.expect("room", (m) => !m.started);
    const match = await until(() => events().find((e) => e.kind === "match" && e.source === "server" && e.trace === matchTrace(room.code, start.seed) && e.final), "the relay's match event");
    expect(match.issues.map((i) => i.code)).toEqual(expect.arrayContaining(["timeout", "left"]));
    a.ws.close();
  });

  it("records the room, each connection under its page session, and the match on the trace the clients use", async () => {
    const a = new Peer("s-host"), b = new Peer("s-guest");
    await a.open(); await b.open();
    await a.expect("hello"); await b.expect("hello");
    a.send({ t: "name", name: "Ann" }); b.send({ t: "name", name: "Bob" });
    a.send({ t: "create" });
    const room = await a.expect("room");
    expect(room.trace).toMatch(new RegExp(`^r-${room.code}-`));
    b.send({ t: "join", code: room.code });
    await a.expect("room", (m) => m.members.length === 2);
    a.send({ t: "pick", fighter: "rocket", bundleUrl: "/house/rocket/bundle.json", ready: true });
    b.send({ t: "pick", fighter: "wizard", bundleUrl: "/house/wizard/bundle.json", ready: true });
    await a.expect("room", (m) => m.members.every((x: any) => x.ready));
    a.send({ t: "start", config: { stage: "proving", rules: { stocks: 3, time: 0 }, inputDelay: 2 } });
    const start = await b.expect("start");
    for (let f = 1; f <= 5; f++) { a.send({ t: "inputs", frame: f, inputs: [], ahead: [0, 2.5] }); b.send({ t: "inputs", frame: f, inputs: [] }); }
    // the sender's frame lead rides along for time sync; a client that doesn't send one relays none
    expect(await b.expect("inputs")).toMatchObject({ slot: 0, frame: 1, ahead: [0, 2.5] });
    expect("ahead" in (await a.expect("inputs"))).toBe(false);
    a.send({ t: "hash", frame: 30, hash: 111 }); b.send({ t: "hash", frame: 30, hash: 222 });
    await b.expect("hash");
    a.send({ t: "end" });
    await b.expect("room", (m) => !m.started);
    b.ws.close();
    await until(() => events().find((e) => e.kind === "connection" && e.trace === "s-guest" && e.final), "guest connection event");
    a.ws.close();
    await until(() => events().find((e) => e.kind === "room" && e.final && (e.business.room as { code: string }).code === room.code), "room event");

    const trace = matchTrace(room.code, start.seed);
    const [match] = filterEvents(events(), { trace, kind: "match" });
    expect(match).toMatchObject({ source: "server", parent: room.trace, level: "error", final: true });
    expect(match.business.exit).toBe("host ended");
    expect((match.business.members as { session: string }[]).map((m) => m.session)).toEqual(["s-host", "s-guest"]);
    expect((match.business.relay as { inputs: number; newest: number; hashes: number }[]).map((s) => [s.inputs, s.newest, s.hashes])).toEqual([[5, 5, 1], [5, 5, 1]]);
    expect(match.headline).toBe("desync: frame 30: slot 0 hashed 111, slot 1 hashed 222");

    const roomEvent = events().find((e) => e.trace === room.trace && e.kind === "room")!;
    expect(roomEvent.parent).toBe("s-host");
    expect(roomEvent.business.matches).toEqual([trace]);
    expect(roomEvent.business.exit).toBe("empty");
    const guest = events().find((e) => e.kind === "connection" && e.trace === "s-guest")!;
    expect(guest.business).toMatchObject({ name: "Bob", rooms: [room.code], msgs: { join: 1, pick: 1, inputs: 5, hash: 1 } });
    // a session trace finds its connection and the room it made
    expect(filterEvents(events(), { trace: "s-host" }).map((e) => e.kind).sort()).toEqual(["connection", "room"]);
  });
});
