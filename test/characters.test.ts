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
import { STUDY_VERSION } from "../shared/cpu-study";
import { GAME_VERSION } from "../shared/account";

const TOKEN = "t0k";
let server: http.Server, port: number, dataDir: string;
const source = fs.readFileSync(new URL("../forge/exemplar/sword-guy.fighter.js", import.meta.url), "utf8");
// the server stores the forge's CPU study without reading it; an empty one of the right version will do
const STUDY = { version: STUDY_VERSION, base: {}, forms: {} };
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
  attachAuth(router, { dataDir, devLogin: true, botKey: null });
  attachForge(router, { token: TOKEN, dataDir, genBase: "/gen" });
  attachCharacters(router, TOKEN);
  server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  port = (server.address() as { port: number }).port;
});
afterAll(() => { server.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });

describe("last played", () => {
  it("a new player starts on the current version; each sign-in or returning visit hands back the one before and moves it to now", async () => {
    const first = await (await api("/auth/dev", { method: "POST", body: JSON.stringify({ name: "Newbie" }) })).json();
    expect(first.lastPlayed).toBeNull();
    const record = () => JSON.parse(fs.readFileSync(path.join(dataDir, "players", `${first.player.id}.json`), "utf8"));
    const stamped = record().lastPlayed;
    expect(stamped.version).toBe(GAME_VERSION);
    const again = await (await api("/auth/dev", { method: "POST", body: JSON.stringify({ name: "Newbie" }) })).json();
    expect(again.lastPlayed).toEqual(stamped);
    const visit = await (await api("/me/played", { method: "POST", headers: { "x-session": again.session } })).json();
    expect(visit.lastPlayed.version).toBe(GAME_VERSION);
    expect(visit.lastPlayed.at).toBeGreaterThanOrEqual(stamped.at);
    expect((await api("/me/played", { method: "POST" })).status).toBe(401);
  });
});

describe("the brawl's sample", () => {
  it("is a random handful of the house and everyone's ready characters, none of the ones asked to leave out", async () => {
    const all = (await (await api("/characters/sample?n=24")).json()).characters as { id: string; bundleUrl: string | null }[];
    expect(all.length).toBeGreaterThanOrEqual(4);
    expect(all.filter((c) => c.bundleUrl === null).map((c) => c.id).sort()).toEqual(["rocket", "slugbert", "wizard", "woodstove"]);
    const three = (await (await api("/characters/sample?n=3")).json()).characters;
    expect(three).toHaveLength(3);
    const rest = (await (await api(`/characters/sample?n=24&not=${all.map((c) => c.id).join(",")}`)).json()).characters;
    expect(rest).toEqual([]);
  });
});

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
    expect((await api(`/forge/jobs/${job.id}/complete`, { method: "POST", body: JSON.stringify({ name: "DEE", tagline: "t", description: "d", source, cpu: STUDY, sprite: { px: 512, feetPx: 448, heightPx: 360, anims: {} }, cells }) })).status).toBe(204);
    lib = await (await api("/library", { headers: H })).json();
    const entry = lib.characters.find((c: { id: string }) => c.id === created.character.id);
    expect(entry.status).toBe("ready");
    expect(entry.name).toBe("DEE");
    expect(entry.bundleUrl).toMatch(new RegExp(`^/gen/${entry.id}/[0-9a-f]{8}/bundle\\.json$`));
    // not signed in: no library
    expect((await api("/library")).status).toBe(401);
    expect((await api(`/library/${entry.id}`, { method: "DELETE", headers: H })).status).toBe(204);
    lib = await (await api("/library", { headers: H })).json();
    expect(lib.characters).toHaveLength(0);
  });
});

describe("the auto moderator", () => {
  it("fails a drawing both judges flag with the reason the player sees, and won't moderate a job twice", async () => {
    const dev = await (await api("/auth/dev", { method: "POST", body: JSON.stringify({ name: "Mo" }) })).json();
    const H = { "x-session": dev.session };
    const draw = async () => (await (await api("/characters", { method: "POST", headers: H, body: JSON.stringify({ png: `data:image/png;base64,${png1x1}`, name: "x" }) })).json()).character;
    const judge = (id: string, harsh: string, lenient: string) => api(`/forge/jobs/${id}/moderation`, { method: "POST", body: JSON.stringify({ harsh: { verdict: harsh, reason: "r" }, lenient: { verdict: lenient, reason: "r" } }) });

    const ok = await draw();
    const okJob = await (await api("/forge/jobs/next")).json();
    expect(okJob.moderated).toBe(false);
    expect(await (await judge(okJob.id, "pass", "inappropriate")).json()).toMatchObject({ blocked: false });
    expect((await judge(okJob.id, "pass", "pass")).status).toBe(409);
    expect((await (await api(`/characters/${ok.id}`, { headers: H })).json()).character.status).toBe("generating");
    expect((await api(`/forge/jobs/${okJob.id}/fail`, { method: "POST", body: JSON.stringify({ error: "done with it" }) })).status).toBe(204);

    const bad = await draw();
    const badJob = await (await api("/forge/jobs/next")).json();
    expect((await judge(badJob.id, "bogus", "pass")).status).toBe(400);
    expect(await (await judge(badJob.id, "language", "inappropriate")).json()).toMatchObject({ blocked: true });
    const entry = (await (await api(`/characters/${bad.id}`, { headers: H })).json()).character;
    expect(entry.status).toBe("failed");
    expect(entry.error).toBe("Auto moderator blocked your character for reason: foul language, inappropriate art");
    const scores = JSON.parse(fs.readFileSync(path.join(dataDir, "reputation.json"), "utf8"));
    expect(scores[dev.player.id]).toBe(60);
  });
});

describe("a character one judge flagged", () => {
  it("forges but stays out of COMMUNITY and the menu brawl until it's released; a private one never shows there", async () => {
    const dev = await (await api("/auth/dev", { method: "POST", body: JSON.stringify({ name: "Hel" }) })).json();
    const H = { "x-session": dev.session };
    const cells = Object.fromEntries(SPRITE_CELLS.map((c) => [c, png1x1]));
    const forge = async (pub: boolean, harsh: string) => {
      const created = (await (await api("/characters", { method: "POST", headers: H, body: JSON.stringify({ png: `data:image/png;base64,${png1x1}`, public: pub }) })).json()).character;
      const job = await (await api("/forge/jobs/next")).json();
      const d = await (await api(`/forge/jobs/${job.id}/moderation`, { method: "POST", body: JSON.stringify({ harsh: { verdict: harsh, reason: "r" }, lenient: { verdict: "pass", reason: "r" } }) })).json();
      expect((await api(`/forge/jobs/${job.id}/complete`, { method: "POST", body: JSON.stringify({ name: "HEL", tagline: "t", description: "d", source, cpu: STUDY, sprite: { px: 512, feetPx: 448, heightPx: 360, anims: {} }, cells }) })).status).toBe(204);
      return { id: created.id as string, held: d.held as boolean };
    };
    const listed = async () => {
      const community = (await (await api("/characters/community?sort=new")).json()).characters.map((c: { id: string }) => c.id);
      const sample = (await (await api("/characters/sample?n=24")).json()).characters.map((c: { id: string }) => c.id);
      return (id: string) => [community.includes(id), sample.includes(id)];
    };
    const flagged = await forge(true, "other");
    const clean = await forge(true, "pass");
    const secret = await forge(false, "pass");
    expect(flagged.held).toBe(true);
    expect(clean.held).toBe(false);
    let seen = await listed();
    expect(seen(flagged.id)).toEqual([false, false]);
    expect(seen(clean.id)).toEqual([true, true]);
    expect(seen(secret.id)).toEqual([false, false]);
    expect((await (await api(`/characters/${flagged.id}`, { headers: H })).json()).character).toMatchObject({ status: "ready", held: true });
    expect((await api(`/characters/${flagged.id}/release`, { method: "POST" })).status).toBe(204);
    seen = await listed();
    expect(seen(flagged.id)).toEqual([true, true]);
    expect((await api(`/characters/${clean.id}/hold`, { method: "POST" })).status).toBe(204);
    seen = await listed();
    expect(seen(clean.id)).toEqual([false, false]);
  });
});

describe("taking a character down", () => {
  it("removes it from its owner and from everyone who saved it, with the forge token only", async () => {
    const owner = await (await api("/auth/dev", { method: "POST", body: JSON.stringify({ name: "Tad" }) })).json();
    const fan = await (await api("/auth/dev", { method: "POST", body: JSON.stringify({ name: "Fan" }) })).json();
    const created = (await (await api("/characters", { method: "POST", headers: { "x-session": owner.session }, body: JSON.stringify({ png: `data:image/png;base64,${png1x1}` }) })).json()).character;
    const job = await (await api("/forge/jobs/next")).json();
    const cells = Object.fromEntries(SPRITE_CELLS.map((c) => [c, png1x1]));
    expect((await api(`/forge/jobs/${job.id}/complete`, { method: "POST", body: JSON.stringify({ name: "TAD", tagline: "t", description: "d", source, cpu: STUDY, sprite: { px: 512, feetPx: 448, heightPx: 360, anims: {} }, cells }) })).status).toBe(204);
    expect((await api(`/library/saved/${created.id}`, { method: "POST", headers: { "x-session": fan.session } })).status).toBe(200);
    const ids = async (s: string) => (await (await api("/library", { headers: { "x-session": s } })).json()).characters.map((c: { id: string }) => c.id);
    expect(await ids(fan.session)).toContain(created.id);
    expect((await api(`/characters/${created.id}/take-down`, { method: "POST", headers: { "x-forge-token": "nope" } })).status).toBe(401);
    expect((await api(`/characters/${created.id}/take-down`, { method: "POST" })).status).toBe(204);
    expect(await ids(owner.session)).not.toContain(created.id);
    expect(await ids(fan.session)).not.toContain(created.id);
    expect((await api(`/characters/${created.id}/take-down`, { method: "POST" })).status).toBe(404);
  });
});

describe("the forge queue survives a restart", () => {
  it("keeps a running job running across a restart, so the worker still on it can finish it", async () => {
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
    enqueueJob({ fighterId: "gen-restart-1", player: { id: "dev-r", name: "R", avatar: null }, png: Buffer.from(png1x1, "base64"), origin: "creator", public: true, parent: null });
    const job = await (await call("/forge/jobs/next")).json();
    expect(job.fighterId).toBe("gen-restart-1");
    expect((await call("/forge/jobs/next")).status).toBe(204);
    const saved = JSON.parse(fs.readFileSync(path.join(dir, "forge-jobs.json"), "utf8")) as { fighterId: string; status: string }[];
    expect(saved.find((j) => j.fighterId === "gen-restart-1")?.status).toBe("running");
    // "restart": a data dir whose jobs file says the job was running; attaching again keeps it running
    const dir3 = fs.mkdtempSync(path.join(os.tmpdir(), "sb-forge3-"));
    fs.writeFileSync(path.join(dir3, "forge-jobs.json"), JSON.stringify(saved.filter((j) => j.fighterId === "gen-restart-1")));
    init2(dir3);
    const r3 = express2.Router(); app2.use("/api3", r3);
    attach2(r3, { token: "t2", dataDir: dir3, genBase: "/gen" });
    const api3 = (p: string, init?: RequestInit) => fetch(`http://127.0.0.1:${p2}/api3${p}`, { ...init, headers: { "x-forge-token": "t2", "content-type": "application/json", ...(init?.headers ?? {}) } });
    // not handed out again: that's how one character got forged twice and failed on the second
    expect((await api3("/forge/jobs/next")).status).toBe(204);
    // and the worker's progress still lands
    expect((await api3(`/forge/jobs/${job.id}/progress`, { method: "POST", body: JSON.stringify({ stage: "balance testing" }) })).status).toBe(204);
    fs.rmSync(dir3, { recursive: true, force: true });
    init2(dataDir); // the library module is a singleton: point it back at the main data dir
    srv.close();
    fs.rmSync(dir, { recursive: true, force: true });
    void libraryOf;
  });
});

describe("the forge queue is fair", () => {
  it("puts a player with nothing forging first and caps each player's share", async () => {
    const { enqueueJob } = await import("../server/forge");
    const png = Buffer.from(png1x1, "base64");
    const who = (id: string) => ({ id, name: id, avatar: null });
    for (const [fighterId, owner] of [["fair-a1", "dev-fa"], ["fair-a2", "dev-fa"], ["fair-a3", "dev-fa"], ["fair-b1", "dev-fb"]] as const)
      enqueueJob({ fighterId, player: who(owner), png, origin: "creator", public: true, parent: null });
    const claimed: string[] = [];
    for (let i = 0; i < 5; i++) {
      const res = await api("/forge/jobs/next");
      if (res.status !== 200) break;
      claimed.push((await res.json()).fighterId);
    }
    // a1 first in line; b1 jumps a2 because B has nothing forging; a2 is A's second; a3 fits once
    // nobody else is waiting (three while the queue is quiet)
    expect(claimed).toEqual(["fair-a1", "fair-b1", "fair-a2", "fair-a3"]);
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
    expect((await api(`/forge/jobs/${job.id}/complete`, { method: "POST", body: JSON.stringify({ name: "REF", tagline: "t", description: "d", source, cpu: STUDY, sprite: { px: 512, feetPx: 448, heightPx: 360, anims: {} }, cells }) })).status).toBe(204);
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
