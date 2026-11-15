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
import { fightBlock } from "../shared/lobby";

/** The character select's rules: a token on a fighter is being ready, and anyone's FIGHT! opens the host's stage screen. */
let server: http.Server, port: number, dataDir: string;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until<T>(fn: () => T | undefined, what: string, ms = 3000): Promise<T> {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { const v = fn(); if (v) return v; await wait(20); }
  throw new Error(`timed out waiting for ${what}`);
}
class Peer {
  ws: WebSocket; inbox: any[] = []; id = 0; lastRoom: any = null;
  constructor(public name: string) {
    this.ws = new WebSocket(`ws://127.0.0.1:${port}/ws?trace=s-cs-${name.toLowerCase()}`);
    this.ws.on("message", (m) => { const j = JSON.parse(String(m)); if (j.t === "hello") this.id = j.id; if (j.t === "room") this.lastRoom = j; this.inbox.push(j); });
  }
  async ready(): Promise<void> { await new Promise<void>((r) => this.ws.once("open", () => r())); await this.expect("hello"); this.send({ t: "name", session: this.name }); }
  send(m: unknown): void { this.ws.send(JSON.stringify(m)); }
  expect(t: string, pred: (m: any) => boolean = () => true): Promise<any> {
    return until(() => { const i = this.inbox.findIndex((m) => m.t === t && pred(m)); return i >= 0 ? this.inbox.splice(i, 1)[0] : undefined; }, `${this.name}: ${t} message`);
  }
  /** Nothing of type `t` arrives in `ms`. */
  async none(t: string, ms = 250): Promise<void> {
    await wait(ms);
    expect(this.inbox.filter((m) => m.t === t)).toEqual([]);
  }
  /** The newest room state, after letting messages land. */
  async latest(): Promise<any> {
    await wait(120);
    return this.lastRoom;
  }
}
const peers = async (...names: string[]) => { const ps = names.map((n) => new Peer(n)); await Promise.all(ps.map((p) => p.ready())); return ps; };
const house = (id: string) => ({ fighter: id, bundleUrl: `/house/${id}/bundle.json` });
const pick = (p: Peer, id: string) => p.send({ t: "pick", ...house(id) });
const lift = (p: Peer) => p.send({ t: "pick", fighter: "", bundleUrl: "" });
const bot = (fighter: string, level = 3) => ({ ...(fighter ? house(fighter) : { fighter: "", bundleUrl: "" }), level, team: 0 });
const STAGE = { stage: "proving", stocks: 3, time: 0 };

/** A room `host` made, with `guests` in it. */
async function room(host: Peer, ...guests: Peer[]): Promise<string> {
  host.send({ t: "create", public: false });
  const { code } = await host.expect("room");
  for (const g of guests) g.send({ t: "join", code });
  if (guests.length) await host.expect("room", (m) => m.members.length === guests.length + 1);
  return code;
}

beforeAll(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "sb-charselect-"));
  initEvents(dataDir);
  initLibrary(dataDir);
  server = http.createServer(express());
  attachLobby(new WebSocketServer({ server, path: "/ws" }), (s) => (typeof s === "string" ? { id: `dev-${s}`, name: s, avatar: null } : null));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  port = (server.address() as { port: number }).port;
});
afterAll(async () => { await wait(300); server.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });

describe("what keeps a room from FIGHT!", () => {
  const m = (fighter: string, team = 0) => ({ fighter, team });
  const b = (fighter: string, level = 3, team = 0) => ({ fighter, team, level });
  it("needs two slots, every one with a fighter, bots counting", () => {
    expect(fightBlock({ members: [m("a")], bots: [], teams: false })).toBe("alone");
    expect(fightBlock({ members: [m("a")], bots: [b("")], teams: false })).toBe("picking");
    expect(fightBlock({ members: [m(""), m("b")], bots: [], teams: false })).toBe("picking");
    expect(fightBlock({ members: [m("a")], bots: [b("b")], teams: false })).toBeNull();
    expect(fightBlock({ members: [m("a"), m("b")], bots: [b("c"), b("d")], teams: false })).toBeNull();
  });
  it("needs two sides in a team battle, and no friends here in an online room", () => {
    expect(fightBlock({ members: [m("a", 1)], bots: [b("b", 3, 1)], teams: true })).toBe("one team");
    expect(fightBlock({ members: [m("a", 0)], bots: [b("b", 3, 1)], teams: true })).toBeNull();
    expect(fightBlock({ members: [m("a")], bots: [b("b", 0)], teams: false })).toBeNull();
    expect(fightBlock({ members: [m("a"), m("b")], bots: [b("c", 0)], teams: false })).toBe("friends online");
  });
});

describe("tokens in a room", () => {
  it("arrive in hand, go on a fighter (ready), and come back off it", async () => {
    const [a, b] = await peers("Ada", "Ben");
    await room(a, b);
    let info = await a.latest();
    expect(info.members.map((x: any) => [x.fighter, x.ready])).toEqual([["", false], ["", false]]);
    pick(b, "rocket");
    info = await a.expect("room", (r) => r.members[1]?.fighter === "rocket");
    expect(info.members[1].ready).toBe(true);
    lift(b);
    info = await a.expect("room", (r) => r.members[1]?.fighter === "");
    expect(info.members[1]).toMatchObject({ bundleUrl: "", ready: false });
    // a fighter that isn't a bundle is still refused
    b.send({ t: "pick", fighter: "rocket", bundleUrl: "https://evil.example/bundle.json" });
    expect((await b.expect("error")).error).toBe("unknown fighter");
    a.ws.close(); b.ws.close();
  });

  it("leave a member's pick behind when they go to another room", async () => {
    const [a, b, c] = await peers("Cy", "Dot", "Eli");
    await room(a, b);
    pick(b, "wizard");
    await a.expect("room", (r) => r.members[1]?.fighter === "wizard");
    await room(c);
    const code = (await c.latest()).code as string;
    b.send({ t: "join", code });
    const info = await c.expect("room", (r) => r.members.length === 2);
    expect(info.members[1].fighter).toBe("");
    for (const p of [a, b, c]) p.ws.close();
  });

  it("are the host's to put on for bots: a bot can be added with none and given one, and only the host sets them", async () => {
    const [a, b] = await peers("Fay", "Gus");
    await room(a, b);
    a.send({ t: "bots", bots: [bot("")] });
    let info = await b.expect("room", (r) => r.bots.length === 1);
    expect(info.bots[0]).toMatchObject({ fighter: "", bundleUrl: "" });
    a.send({ t: "bots", bots: [bot("slugbert")] });
    info = await b.expect("room", (r) => r.bots[0]?.fighter === "slugbert");
    b.send({ t: "bots", bots: [bot("")] });
    expect((await a.latest()).bots[0].fighter).toBe("slugbert");
    a.ws.close(); b.ws.close();
  });
});

describe("anyone's FIGHT!", () => {
  it("reaches the host only once every slot (bots too) has a fighter", async () => {
    const [a, b] = await peers("Hal", "Ivy");
    await room(a, b);
    a.send({ t: "bots", bots: [bot("")] });
    await b.expect("room", (r) => r.bots.length === 1);
    pick(a, "rocket"); pick(b, "wizard");
    await b.expect("room", (r) => r.members.every((m: any) => m.fighter));
    b.send({ t: "fight" });
    await a.none("fight");
    a.send({ t: "bots", bots: [bot("slugbert")] });
    await b.expect("room", (r) => r.bots[0]?.fighter === "slugbert");
    b.send({ t: "fight" });
    expect(await a.expect("fight")).toMatchObject({ from: b.id });
    // only the host is asked
    await b.none("fight", 50);
    a.send({ t: "picking", pick: STAGE });
    expect((await b.expect("room", (r) => r.picking)).picking).toMatchObject(STAGE);
    // the stage screen is up: another FIGHT! does nothing
    b.send({ t: "fight" });
    await a.none("fight");
    // a token lifted takes everyone back to the lobby
    lift(b);
    expect((await a.expect("room", (r) => r.members[1]?.fighter === "")).picking).toBeNull();
    a.ws.close(); b.ws.close();
  });

  it("from two people at once, and a token lifted as it lands, is harmless", async () => {
    const [a, b, c] = await peers("Jo", "Kim", "Lou");
    await room(a, b, c);
    pick(a, "rocket"); pick(b, "wizard"); pick(c, "slugbert");
    await a.expect("room", (r) => r.members.every((m: any) => m.fighter));
    b.send({ t: "fight" }); c.send({ t: "fight" });
    await a.expect("fight");
    // the host answers each the same way: the room is on the stage screen once, nobody gets an error
    a.send({ t: "picking", pick: STAGE });
    a.send({ t: "picking", pick: STAGE });
    await c.expect("room", (r) => r.picking);
    await wait(150);
    for (const p of [a, b, c]) expect(p.inbox.filter((m) => m.t === "error")).toEqual([]);
    a.send({ t: "picking", pick: null });
    await c.expect("room", (r) => !r.picking);

    // Kim's FIGHT! and Lou lifting their token cross on the way to the host
    b.send({ t: "fight" });
    await a.expect("fight");
    lift(c);
    await a.expect("room", (r) => r.members[2]?.fighter === "");
    a.send({ t: "picking", pick: STAGE });
    await wait(200);
    expect((await a.latest()).picking).toBeNull();
    for (const p of [a, b, c]) expect(p.inbox.filter((m) => m.t === "error")).toEqual([]);
    for (const p of [a, b, c]) p.ws.close();
  });

  it("can't start a match, online or here, with a bot still in hand", async () => {
    const [a, b, solo] = await peers("May", "Ned", "Oz");
    await room(a, b);
    a.send({ t: "bots", bots: [bot("")] });
    pick(a, "rocket"); pick(b, "wizard");
    await b.expect("room", (r) => r.bots.length === 1 && r.members.every((m: any) => m.fighter));
    a.send({ t: "start", config: STAGE });
    expect((await a.expect("error")).error).toBe("not everyone has a fighter");

    await room(solo);
    solo.send({ t: "bots", bots: [bot("")] });
    pick(solo, "rocket");
    await solo.expect("room", (r) => r.bots.length === 1 && r.members[0]?.fighter);
    solo.send({ t: "local" });
    expect((await solo.latest()).started).toBe(false);
    solo.send({ t: "bots", bots: [bot("wizard")] });
    await solo.expect("room", (r) => r.bots[0]?.fighter === "wizard");
    solo.send({ t: "local" });
    await solo.expect("room", (r) => r.started);
    for (const p of [a, b, solo]) p.ws.close();
  });
});
