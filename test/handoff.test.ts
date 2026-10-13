import { afterEach, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { WebSocket } from "ws";
import { readEvents } from "../server/eventlog";
import { matchTrace } from "../shared/wide";

/** A deploy mid-match, through two real server processes: the first hands the match over, the second carries it on. */
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until<T>(fn: () => T | undefined | Promise<T | undefined>, what: string, ms = 5000): Promise<T> {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await wait(30); }
  throw new Error(`timed out waiting for ${what}`);
}
const freePort = () => new Promise<number>((resolve) => { const s = net.createServer().listen(0, () => { const { port } = s.address() as net.AddressInfo; s.close(() => resolve(port)); }); });

let servers: ChildProcess[] = [];
afterEach(() => { for (const s of servers) s.kill("SIGKILL"); servers = []; });

async function boot(dataDir: string, port: number, build: string): Promise<ChildProcess> {
  const child = spawn(path.join("node_modules", ".bin", "tsx"), ["server/index.ts"], { env: { ...process.env, PORT: String(port), SKETCHBATTLE_DATA: dataDir, BUILD: build }, stdio: "ignore" });
  servers.push(child);
  await until(() => fetch(`http://127.0.0.1:${port}/api/health`).then((r) => r.ok, () => false), "the server to answer", 15000);
  return child;
}
const stop = (child: ChildProcess) => new Promise<void>((resolve) => { child.once("exit", () => resolve()); child.kill("SIGINT"); });

class Peer {
  ws!: WebSocket; inbox: any[] = []; id = 0; token = "";
  constructor(private port: number) { this.connect(); }
  connect(): void {
    this.inbox = [];
    this.ws = new WebSocket(`ws://127.0.0.1:${this.port}/ws?trace=s-handoff${this.port}`);
    this.ws.on("message", (m) => { const j = JSON.parse(String(m)); if (j.t === "hello" && !this.id) { this.id = j.id; this.token = j.token; } this.inbox.push(j); });
    this.ws.on("error", () => {});
  }
  open(): Promise<void> { return this.ws.readyState === WebSocket.OPEN ? Promise.resolve() : new Promise((r) => this.ws.once("open", () => r())); }
  closed(): Promise<number> { return new Promise((r) => this.ws.once("close", (code) => r(code))); }
  send(m: unknown): void { this.ws.send(JSON.stringify(m)); }
  expect(t: string, pred: (m: any) => boolean = () => true): Promise<any> {
    return until(() => { const i = this.inbox.findIndex((m) => m.t === t && pred(m)); return i >= 0 ? this.inbox.splice(i, 1)[0] : undefined; }, `${t} message`);
  }
}

describe("deploy handoff", () => {
  it("carries a running match across a restart: both players resume, missed inputs are resent, the match event goes on under the same id", async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "sb-handoff-"));
    const port = await freePort();
    const first = await boot(dataDir, port, "old");
    const a = new Peer(port), b = new Peer(port);
    await Promise.all([a.open(), b.open()]);
    a.send({ t: "create", public: false });
    const room = await a.expect("room");
    b.send({ t: "join", code: room.code });
    await a.expect("room", (m) => m.members.length === 2);
    a.send({ t: "pick", fighter: "slugbert", bundleUrl: "/house/slugbert/bundle.json", ready: true });
    b.send({ t: "pick", fighter: "woodstove", bundleUrl: "/house/woodstove/bundle.json", ready: true });
    await a.expect("room", (m) => m.members.every((x: any) => x.ready));
    a.send({ t: "start", config: { stage: "proving", rules: { stocks: 3, time: 0 } } });
    const start = await b.expect("start");
    a.send({ t: "loaded", fills: true }); b.send({ t: "loaded", fills: true });
    await a.expect("go");
    a.send({ t: "inputs", frame: 10, inputs: Array(10).fill([0]) });
    b.send({ t: "inputs", frame: 10, inputs: Array(10).fill([0]) });
    await b.expect("inputs", (m) => m.frame === 10);
    // b's inputs through 20 reach the relay just before the deploy; a never sees them on its old socket
    b.send({ t: "inputs", frame: 20, inputs: Array(10).fill([1]) });
    await b.expect("final", (m) => m.frame === 20);

    const aClosed = a.closed(), bClosed = b.closed();
    await stop(first);
    expect(await aClosed).not.toBe(1000);
    expect(await bClosed).not.toBe(1000);
    expect(fs.existsSync(path.join(dataDir, "handoff.json"))).toBe(true);
    const handedOver = readEvents(dataDir).find((e) => e.kind === "match" && e.trace === matchTrace(room.code, start.seed))!;
    expect(handedOver.final).toBe(false);

    const second = await boot(dataDir, port, "new");
    expect(fs.existsSync(path.join(dataDir, "handoff.json"))).toBe(false);
    a.connect(); b.connect();
    await Promise.all([a.open(), b.open()]);
    a.send({ t: "resume", id: a.id, token: a.token, final: [10, 10] });
    b.send({ t: "resume", id: b.id, token: b.token, final: [10, 20] });
    expect((await a.expect("resumed")).ack).toBe(10);
    expect((await b.expect("resumed")).ack).toBe(20);
    const missed = await a.expect("inputs", (m) => m.slot === 1);
    expect(missed.frame).toBe(20);
    expect(missed.inputs).toHaveLength(10);

    // the match goes on: inputs flow both ways on the new process
    a.send({ t: "inputs", frame: 30, inputs: Array(20).fill([2]) });
    expect((await b.expect("inputs", (m) => m.slot === 0 && m.frame === 30)).inputs).toHaveLength(20);
    await stop(second);
    const carried = readEvents(dataDir).find((e) => e.id === handedOver.id)!;
    expect(carried.server?.build).toBe("new");
    expect(carried.business.handoff).toMatchObject({ gapMs: expect.any(Number) });
    expect((carried.business.relay as { forwarded: number }[]).map((s) => s.forwarded)).toEqual([30, 20]);
    fs.rmSync(dataDir, { recursive: true, force: true });
  }, 60000);

  it("keeps a lobby across a restart: the room and its picks are there when its members resume, and a wrong token gets nothing", async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "sb-handoff-"));
    const port = await freePort();
    const first = await boot(dataDir, port, "old");
    const a = new Peer(port), b = new Peer(port);
    await Promise.all([a.open(), b.open()]);
    a.send({ t: "create", public: true });
    const room = await a.expect("room");
    b.send({ t: "join", code: room.code });
    a.send({ t: "pick", fighter: "slugbert", bundleUrl: "/house/slugbert/bundle.json", ready: true });
    await b.expect("room", (m) => m.members.length === 2 && m.members[0].ready);
    await stop(first);
    await boot(dataDir, port, "new");

    const thief = new Peer(port);
    await thief.open();
    thief.send({ t: "resume", id: a.id, token: "not-the-token", final: [] });
    expect(await thief.closed()).toBe(4003);
    a.connect(); b.connect();
    await Promise.all([a.open(), b.open()]);
    a.send({ t: "resume", id: a.id, token: a.token, final: [] });
    b.send({ t: "resume", id: b.id, token: b.token, final: [] });
    await a.expect("resumed");
    const info = await b.expect("room");
    expect(info.code).toBe(room.code);
    expect(info.members.map((m: any) => [m.id, m.fighter, m.ready])).toEqual([[a.id, "slugbert", true], [b.id, "", false]]);
    // and it's a working room: b picks, a sees it
    b.send({ t: "pick", fighter: "woodstove", bundleUrl: "/house/woodstove/bundle.json", ready: true });
    await a.expect("room", (m) => m.members[1].ready);
    // a fresh client after the restart doesn't take a handed-over client's id
    const fresh = new Peer(port);
    await fresh.open();
    await fresh.expect("hello");
    expect([a.id, b.id, thief.id]).not.toContain(fresh.id);
    fs.rmSync(dataDir, { recursive: true, force: true });
  }, 60000);

  it("drops a handoff from another version instead of playing it", async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "sb-handoff-"));
    fs.writeFileSync(path.join(dataDir, "handoff.json"), JSON.stringify({ version: -1, at: Date.now(), nextId: 50, rooms: [] }));
    const port = await freePort();
    await stop(await boot(dataDir, port, "new"));
    expect(fs.existsSync(path.join(dataDir, "handoff.json"))).toBe(false);
    const proc = readEvents(dataDir).find((e) => e.kind === "process")!;
    expect(proc.level).toBe("warn");
    expect(proc.headline).toMatch(/version -1/);
    fs.rmSync(dataDir, { recursive: true, force: true });
  }, 30000);
});
