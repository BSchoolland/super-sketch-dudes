import { afterAll, beforeAll, describe, expect, it } from "vitest";
import http from "node:http";
import express from "express";
import { WebSocketServer, WebSocket } from "ws";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { attachLobby } from "../server/lobby";
import { attachDraw } from "../server/draw";
import { attachAuth } from "../server/auth";
import { attachForge } from "../server/forge";
import { attachCharacters } from "../server/characters";
import { initLibrary } from "../server/library";
import { SPRITE_CELLS } from "../shared/gen/sprite";
import type { DrawRoomState } from "../shared/draw";

/** Walks a whole DRAW BATTLE through the real server: two players, one round, forge round-trip, one battle. */
const TOKEN = "t0k";
const PASSWORD = "sketch";
let server: http.Server, port: number, dataDir: string;
const source = fs.readFileSync(new URL("../forge/exemplar/lampjack.fighter.js", import.meta.url), "utf8");
const png1x1 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

class Peer {
  ws: WebSocket; inbox: any[] = []; id = 0; draw: DrawRoomState | null = null;
  constructor() { this.ws = new WebSocket(`ws://127.0.0.1:${port}/ws`); this.ws.on("message", (m) => { const j = JSON.parse(String(m)); if (j.t === "hello") this.id = j.id; if (j.t === "draw") this.draw = j.room; this.inbox.push(j); }); }
  open(): Promise<void> { return this.ws.readyState === WebSocket.OPEN ? Promise.resolve() : new Promise((r) => this.ws.once("open", () => r())); }
  send(m: unknown): void { this.ws.send(JSON.stringify(m)); }
  async expect(t: string, pred: (m: any) => boolean = () => true, ms = 4000): Promise<any> {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { const i = this.inbox.findIndex((m) => m.t === t && pred(m)); if (i >= 0) return this.inbox.splice(i, 1)[0]; await new Promise((r) => setTimeout(r, 15)); }
    throw new Error(`no ${t} within ${ms}ms; inbox: ${this.inbox.map((m) => m.t).join(",")}`);
  }
  async phase(p: string, ms = 5000): Promise<DrawRoomState> {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { if (this.draw?.phase === p) return this.draw; await new Promise((r) => setTimeout(r, 15)); }
    throw new Error(`phase ${p} not reached; at ${this.draw?.phase} (${this.draw?.note})`);
  }
}
const api = (p: string, init?: RequestInit) => fetch(`http://127.0.0.1:${port}/api${p}`, { ...init, headers: { "x-forge-token": TOKEN, "content-type": "application/json", ...(init?.headers ?? {}) } });

beforeAll(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "sb-draw-"));
  const app = express();
  app.use(express.json({ limit: "12mb" }));
  const router = express.Router();
  app.use("/api", router);
  initLibrary(dataDir);
  attachAuth(router, { dataDir, devLogin: true });
  attachForge(router, { token: TOKEN, dataDir, genBase: "/gen" });
  attachCharacters(router);
  attachDraw(router, { password: PASSWORD, dataDir });
  server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: "/ws" });
  attachLobby(wss);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  port = (server.address() as { port: number }).port;
  for (const name of ["Ann", "Bob", "Cat"]) S[name] = (await (await api("/auth/dev", { method: "POST", body: JSON.stringify({ name }) })).json()).session;
});
/** dev sessions by name */
const S: Record<string, string> = {};
afterAll(() => { server.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });

describe("draw battle", () => {
  it("runs a full game: password, room, draw, forge, reveal, battle, ladder", async () => {
    const a = new Peer(), b = new Peer();
    await a.open(); await b.open();
    await a.expect("hello"); await b.expect("hello");
    a.send({ t: "drawCreate", session: S.Ann });
    expect((await a.expect("error")).error).toBe("password first");
    a.send({ t: "drawAuth", password: "nope" });
    expect((await a.expect("drawAuth")).ok).toBe(false);
    a.send({ t: "drawAuth", password: PASSWORD }); b.send({ t: "drawAuth", password: PASSWORD });
    expect((await a.expect("drawAuth")).ok).toBe(true); await b.expect("drawAuth");
    a.send({ t: "drawCreate", session: S.Ann });
    const created = await a.expect("draw");
    const code = created.room.code;
    b.send({ t: "drawJoin", code, session: S.Bob });
    await b.expect("draw"); await a.expect("draw", (m) => m.room.players.length === 2);
    // only the host starts; one round keeps the test short
    b.send({ t: "drawStart" }); await new Promise((r) => setTimeout(r, 50));
    expect(a.draw!.phase).toBe("lobby");
    a.send({ t: "drawStart", rounds: 1, drawSeconds: 30 });
    await a.phase("draw"); await b.phase("draw");
    expect(a.draw!.deadline).toBeGreaterThan(Date.now());
    // both submit; the round ends early
    a.send({ t: "drawSubmit", round: 1, png: `data:image/png;base64,${png1x1}` });
    b.send({ t: "drawSubmit", round: 1, png: `data:image/png;base64,${png1x1}` });
    await a.phase("reveal");
    expect(a.draw!.players.map((p) => p.characters[0].status)).toEqual(["queued", "queued"]);
    // the forge claims both jobs, one fails once (goes back on the queue on a real forge; here it just fails), the other completes
    const j1 = await (await api("/forge/jobs/next")).json();
    const j2 = await (await api("/forge/jobs/next")).json();
    expect((await api("/forge/jobs/next")).status).toBe(204);
    expect((await fetch(`http://127.0.0.1:${port}/api/forge/jobs/next?token=wrong`)).status).toBe(401);
    expect(j1.fighterId).toMatch(/^gen-[a-z0-9]{4}-0-1$/);
    expect((await api(`/forge/jobs/${j1.id}/drawing.png`)).status).toBe(200);
    await api(`/forge/jobs/${j1.id}/progress`, { method: "POST", body: JSON.stringify({ stage: "drawing the sheet" }) });
    await a.expect("draw", (m) => m.room.players[0].characters[0].stage === "drawing the sheet");
    const cells = Object.fromEntries(SPRITE_CELLS.map((c) => [c, png1x1]));
    const complete = (id: string, name: string) => api(`/forge/jobs/${id}/complete`, { method: "POST", body: JSON.stringify({ name, tagline: "t", description: "d", source, sprite: { px: 512, feetPx: 448, heightPx: 360, anims: {} }, cells, sheet: png1x1 }) });
    // a broken module is refused by the server too
    const bad = await api(`/forge/jobs/${j1.id}/complete`, { method: "POST", body: JSON.stringify({ name: "x", tagline: "t", description: "d", source: "export default function make(api) { return {}; }", sprite: { px: 512, feetPx: 448, heightPx: 360 }, cells }) });
    expect(bad.status).toBe(400);
    await a.expect("draw", (m) => m.room.players[0].characters[0].status === "failed");
    expect((await complete(j2.id, "BOBBO")).status).toBe(204);
    await a.expect("draw", (m) => m.room.players[1].characters[0].status === "ready" && m.room.players[1].characters[0].bundleUrl?.endsWith("/bundle.json"));
    expect(fs.existsSync(path.join(dataDir, "gen", j2.fighterId, "bundle.json"))).toBe(true);
    // everyone ready -> ladder. Ann has no fighter, so the game is over before it starts.
    a.send({ t: "drawReady", ready: true }); b.send({ t: "drawReady", ready: true });
    const over = await a.phase("over");
    expect(over.note).toMatch(/not enough/);
    a.ws.close(); b.ws.close();
  });

  it("battles: loading waits for everyone, start carries generated fighters, the winner keeps their character", async () => {
    const peers = [new Peer(), new Peer(), new Peer()];
    for (const p of peers) { await p.open(); await p.expect("hello"); p.send({ t: "drawAuth", password: PASSWORD }); await p.expect("drawAuth"); }
    const [a, b, c] = peers;
    a.send({ t: "drawCreate", session: S.Ann }); const code = (await a.expect("draw")).room.code;
    b.send({ t: "drawJoin", code, session: S.Bob }); c.send({ t: "drawJoin", code, session: S.Cat });
    await a.expect("draw", (m) => m.room.players.length === 3);
    a.send({ t: "drawStart", rounds: 2, drawSeconds: 30 });
    for (let round = 1; round <= 2; round++) {
      for (const p of peers) { await p.phase("draw"); p.send({ t: "drawSubmit", round, png: `data:image/png;base64,${png1x1}` }); }
      if (round < 2) await a.phase("draw"); else await a.phase("reveal");
      for (let i = 0; i < 3; i++) {
        const job = await (await api("/forge/jobs/next")).json();
        const cells = Object.fromEntries(SPRITE_CELLS.map((cell) => [cell, png1x1]));
        expect((await api(`/forge/jobs/${job.id}/complete`, { method: "POST", body: JSON.stringify({ name: `F${job.fighterId}`, tagline: "t", description: "d", source, sprite: { px: 512, feetPx: 448, heightPx: 360, anims: {} }, cells }) })).status).toBe(204);
      }
    }
    await a.expect("draw", (m) => m.room.players.every((p: any) => p.characters.every((ch: any) => ch.status === "ready")));
    for (const p of peers) p.send({ t: "drawReady", ready: true });
    const loading = await a.phase("loading");
    expect(loading.battle!.participants.length).toBe(3);
    const fighters = loading.battle!.participants.map((id) => loading.players.find((p) => p.id === id)!.characters[0].fighterId!);
    // two report loaded: no start yet
    a.send({ t: "drawLoaded", fighterIds: fighters }); b.send({ t: "drawLoaded", fighterIds: fighters });
    await new Promise((r) => setTimeout(r, 60));
    expect(a.inbox.some((m) => m.t === "start")).toBe(false);
    c.send({ t: "drawLoaded", fighterIds: fighters });
    const start = await a.expect("start");
    expect(start.config.players.map((p: any) => p.fighter)).toEqual(fighters);
    expect(start.members.map((m: any) => m.slot)).toEqual([0, 1, 2]);
    await a.phase("battle");
    // inputs relay between participants with battle slots
    b.send({ t: "inputs", frame: 3, inputs: [[0, 0, 0, 0, 0]] });
    const relayed = await a.expect("inputs");
    expect(relayed.slot).toBe(1);
    // Bob (slot 1) wins: Ann and Cat spend a character and move on
    a.send({ t: "drawBattleEnd", winner: 1, standings: [1, 0, 2] });
    const between = await a.phase("between");
    expect(between.note).toMatch(/^Bob wins/);
    const ann = between.players.find((p) => p.name === "Ann")!, bob = between.players.find((p) => p.name === "Bob")!;
    expect(ann.characters[0].spent).toBe(true); expect(ann.current).toBe(1);
    expect(bob.characters[0].spent).toBe(false); expect(bob.current).toBe(0); expect(bob.wins).toBe(1);
    for (const p of peers) p.ws.close();
  }, 15000);

  it("the creator: a signed-in player's drawing becomes a queued library entry, the forge completes it, the library shows it ready", async () => {
    const dev = await (await api("/auth/dev", { method: "POST", body: JSON.stringify({ name: "Dee" }) })).json();
    const H = { "x-session": dev.session };
    const created = await (await api("/characters", { method: "POST", headers: H, body: JSON.stringify({ png: `data:image/png;base64,${png1x1}`, name: "big bob!", description: "  a stick guy with a red hat.\nhe kicks.  " }) })).json();
    expect(created.character.status).toBe("queued");
    expect(created.character.owner).toBe(dev.player.id);
    expect(created.character.origin).toBe("creator");
    let lib = await (await api("/library", { headers: H })).json();
    expect(lib.characters.map((c: { id: string }) => c.id)).toContain(created.character.id);
    const job = await (await api("/forge/jobs/next")).json();
    expect(job.fighterId).toBe(created.character.id);
    expect(job.hint).toEqual({ name: "BIG BOB!", description: "a stick guy with a red hat. he kicks." });
    expect((await api(`/forge/jobs/${job.id}/progress`, { method: "POST", body: JSON.stringify({ stage: "drawing the sheet" }) })).status).toBe(204);
    expect((await (await api(`/characters/${job.fighterId}`, { headers: H })).json()).character.stage).toBe("drawing the sheet");
    const cells = Object.fromEntries(SPRITE_CELLS.map((c) => [c, png1x1]));
    expect((await api(`/forge/jobs/${job.id}/complete`, { method: "POST", body: JSON.stringify({ name: "DEE", tagline: "t", description: "d", card: ["ATTACK  a", "SPECIAL  b", "UP+SPECIAL  c", "GRAB  d"], source, sprite: { px: 512, feetPx: 448, heightPx: 360, anims: {} }, cells }) })).status).toBe(204);
    lib = await (await api("/library", { headers: H })).json();
    const entry = lib.characters.find((c: { id: string }) => c.id === created.character.id);
    expect(entry.status).toBe("ready");
    expect(entry.name).toBe("DEE");
    expect(entry.card).toHaveLength(4);
    expect(entry.bundleUrl).toBe(`/gen/${entry.id}/bundle.json`);
    // not signed in: no library
    expect((await api("/library")).status).toBe(401);
    expect((await api(`/library/${entry.id}`, { method: "DELETE", headers: H })).status).toBe(204);
    lib = await (await api("/library", { headers: H })).json();
    expect(lib.characters).toHaveLength(0);
  });
});
