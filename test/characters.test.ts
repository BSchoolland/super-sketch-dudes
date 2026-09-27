import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
import { SPRITE_CELLS } from "../shared/gen/sprite";

const TOKEN = "t0k";
let server: http.Server, port: number, dataDir: string;
const source = fs.readFileSync(new URL("../forge/exemplar/sword-guy.fighter.js", import.meta.url), "utf8");
const png1x1 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

const api = (p: string, init?: RequestInit) => fetch(`http://127.0.0.1:${port}/api${p}`, { ...init, headers: { "x-forge-token": TOKEN, "content-type": "application/json", ...(init?.headers ?? {}) } });

beforeAll(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "sb-characters-"));
  const app = express();
  app.use(express.json({ limit: "12mb" }));
  const router = express.Router();
  app.use("/api", router);
  initLibrary(dataDir);
  initEvents(dataDir);
  attachAuth(router, { dataDir, devLogin: true });
  attachForge(router, { token: TOKEN, dataDir, genBase: "/gen" });
  attachCharacters(router, TOKEN);
  server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  port = (server.address() as { port: number }).port;
});
afterAll(() => { server.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });

describe("the creator", () => {
  it("a signed-in player's drawing becomes a queued library entry, the forge completes it, the library shows it ready", async () => {
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
    expect(entry.bundleUrl).toMatch(new RegExp(`^/gen/${entry.id}/[0-9a-f]{8}/bundle\\.json$`));
    // not signed in: no library
    expect((await api("/library")).status).toBe(401);
    expect((await api(`/library/${entry.id}`, { method: "DELETE", headers: H })).status).toBe(204);
    lib = await (await api("/library", { headers: H })).json();
    expect(lib.characters).toHaveLength(0);
  });
});

describe("the forge queue survives a restart", () => {
  it("requeues a running job from forge-jobs.json", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sb-forge-"));
    const { attachForge: attach2 } = await import("../server/forge");
    const { initLibrary: init2, libraryOf } = await import("../server/library");
    const express2 = (await import("express")).default;
    const app2 = express2(); app2.use(express2.json({ limit: "12mb" }));
    const r2 = express2.Router(); app2.use("/api", r2);
    init2(dir); attach2(r2, { token: "t2", dataDir: dir, genBase: "/gen" });
    const srv = http.createServer(app2); await new Promise<void>((r) => srv.listen(0, "127.0.0.1", () => r()));
    const p2 = (srv.address() as { port: number }).port;
    const call = (p: string, init?: RequestInit) => fetch(`http://127.0.0.1:${p2}/api${p}`, { ...init, headers: { "x-forge-token": "t2", "content-type": "application/json", ...(init?.headers ?? {}) } });
    const { enqueueJob } = await import("../server/forge");
    enqueueJob({ fighterId: "gen-restart-1", player: { id: "dev-r", name: "R", avatar: null }, png: Buffer.from(png1x1, "base64"), origin: "creator", parent: null });
    const job = await (await call("/forge/jobs/next")).json();
    expect(job.fighterId).toBe("gen-restart-1");
    expect((await call("/forge/jobs/next")).status).toBe(204);
    const saved = JSON.parse(fs.readFileSync(path.join(dir, "forge-jobs.json"), "utf8")) as { fighterId: string; status: string }[];
    expect(saved.find((j) => j.fighterId === "gen-restart-1")?.status).toBe("running");
    // "restart": a data dir whose jobs file says the job was running; attaching again requeues it
    const dir3 = fs.mkdtempSync(path.join(os.tmpdir(), "sb-forge3-"));
    fs.writeFileSync(path.join(dir3, "forge-jobs.json"), JSON.stringify(saved.filter((j) => j.fighterId === "gen-restart-1")));
    init2(dir3);
    const r3 = express2.Router(); app2.use("/api3", r3);
    attach2(r3, { token: "t2", dataDir: dir3, genBase: "/gen" });
    const again = await (await fetch(`http://127.0.0.1:${p2}/api3/forge/jobs/next`, { headers: { "x-forge-token": "t2" } })).json();
    expect(again.fighterId).toBe("gen-restart-1");
    expect(again.attempts).toBe(2);
    fs.rmSync(dir3, { recursive: true, force: true });
    init2(dataDir); // the library module is a singleton: point it back at the main data dir
    srv.close();
    fs.rmSync(dir, { recursive: true, force: true });
    void libraryOf;
  });
});

describe("starter characters", () => {
  it("show up in every library, can't be deleted, and the token sets the list", async () => {
    const own = await (await api("/auth/dev", { method: "POST", body: JSON.stringify({ name: "Own" }) })).json();
    const other = await (await api("/auth/dev", { method: "POST", body: JSON.stringify({ name: "Other" }) })).json();
    const H = (s: { session: string }) => ({ "x-session": s.session });
    const created = await (await api("/characters", { method: "POST", headers: H(own), body: JSON.stringify({ png: `data:image/png;base64,${png1x1}` }) })).json();
    const job = await (await api("/forge/jobs/next")).json();
    const cells = Object.fromEntries(SPRITE_CELLS.map((c) => [c, png1x1]));
    expect((await api(`/forge/jobs/${job.id}/complete`, { method: "POST", body: JSON.stringify({ name: "REF", tagline: "t", description: "d", source, sprite: { px: 512, feetPx: 448, heightPx: 360, anims: {} }, cells }) })).status).toBe(204);
    expect((await api("/starters", { method: "POST", body: JSON.stringify({ ids: ["nope"] }) })).status).toBe(404);
    expect((await api("/starters", { method: "POST", headers: { "x-forge-token": "wrong" }, body: JSON.stringify({ ids: [created.character.id] }) })).status).toBe(401);
    expect((await api("/starters", { method: "POST", body: JSON.stringify({ ids: [created.character.id] }) })).status).toBe(200);
    const theirs = await (await api("/library", { headers: H(other) })).json();
    const star = theirs.characters.find((c: { id: string }) => c.id === created.character.id);
    expect(star.starter).toBe(true);
    expect(star.name).toBe("REF");
    expect((await api(`/library/${created.character.id}`, { method: "DELETE", headers: H(other) })).status).toBe(403);
    const mine = await (await api("/library", { headers: H(own) })).json();
    expect(mine.characters.filter((c: { id: string }) => c.id === created.character.id)).toHaveLength(1);
  });
});
