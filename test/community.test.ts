import { afterAll, beforeAll, describe, expect, it } from "vitest";
import http from "node:http";
import express from "express";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { attachAuth } from "../server/auth";
import { attachForge } from "../server/forge";
import { attachCharacters } from "../server/characters";
import { initLibrary, recordPlays } from "../server/library";
import { initEvents } from "../server/events";
import { SPRITE_CELLS } from "../shared/gen/sprite";
import { STUDY_VERSION } from "../shared/cpu-study";
import type { CommunityCharacter, LibraryEntry } from "../shared/account";

const TOKEN = "t0k";
let server: http.Server, port: number, dataDir: string;
const png1x1 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const source = fs.readFileSync(new URL("../forge/exemplar/sword-guy.fighter.js", import.meta.url), "utf8");

const api = (p: string, init?: RequestInit) => fetch(`http://127.0.0.1:${port}/api${p}`, { ...init, headers: { "x-forge-token": TOKEN, "content-type": "application/json", ...(init?.headers ?? {}) } });
const json = async <T = any>(p: string, init?: RequestInit): Promise<T> => (await api(p, init)).json() as Promise<T>;
const signIn = async (name: string) => ({ "x-session": (await json("/auth/dev", { method: "POST", body: JSON.stringify({ name }) })).session as string });
const community = async (H: Record<string, string>, sort = "best") => (await json<{ characters: CommunityCharacter[] }>(`/characters/community?sort=${sort}`, { headers: H })).characters;
const library = async (H: Record<string, string>) => (await json<{ characters: LibraryEntry[] }>("/library", { headers: H })).characters;

/** A ready character as an older player file has it: no `public` field. */
const ready = (id: string, owner: string, createdAt: number, extra: object = {}) => ({
  id, owner, status: "ready", stage: "", error: null, name: id.toUpperCase(), tagline: "t", description: "d",
  drawingUrl: `/gen/drawings/${id}.png`, bundleUrl: `/gen/${id}/bundle.json`, sheetUrl: null, createdAt, origin: "creator", ...extra,
});

beforeAll(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "sb-community-"));
  fs.mkdirSync(path.join(dataDir, "players"));
  const file = (owner: string, name: string, characters: object[], saved?: string[]) =>
    fs.writeFileSync(path.join(dataDir, "players", `${owner}.json`), JSON.stringify({ player: { id: owner, name, avatar: null }, lastPlayed: null, characters, ...(saved ? { saved: saved.map((id) => ({ id, at: 1 })) } : {}) }));
  file("dev-ann", "Ann", [ready("gen-old", "dev-ann", 1), ready("gen-new", "dev-ann", 3), ready("gen-mid", "dev-ann", 2), ready("gen-hidden", "dev-ann", 2, { public: false })]);
  file("dev-cal", "Cal", [], ["gen-old"]);
  fs.writeFileSync(path.join(dataDir, "staff.json"), JSON.stringify(["dev-boss"]));
  app();
});
function app(): void {
  const a = express();
  a.use(express.json({ limit: "12mb" }));
  const router = express.Router();
  a.use("/api", router);
  initLibrary(dataDir);
  initEvents(dataDir);
  attachAuth(router, { dataDir, devLogin: true, botKey: null, discord: { api: "http://discord.invalid", clientSecret: null } });
  attachForge(router, { token: TOKEN, dataDir, genBase: "/gen" });
  attachCharacters(router, TOKEN);
  server = http.createServer(a);
  server.listen(0, "127.0.0.1");
}
beforeAll(async () => {
  await new Promise<void>((r) => server.once("listening", () => r()));
  port = (server.address() as { port: number }).port;
});
afterAll(() => { server.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });

describe("BEST", () => {
  it("leads with what an admin picked, newest pick first, then the most saved, then the newest", async () => {
    const boss = await signIn("Boss"), fay = await signIn("Fay");
    expect((await community(fay)).map((c) => [c.id, c.saves, c.best])).toEqual([["gen-old", 1, false], ["gen-new", 0, false], ["gen-mid", 0, false]]);
    const pick = (id: string, best: boolean, H: Record<string, string>) => api(`/characters/community/${id}/best`, { method: "POST", headers: H, body: JSON.stringify({ best }) });
    expect((await pick("gen-mid", true, fay)).status).toBe(403);
    expect((await pick("gen-mid", true, {})).status).toBe(401);
    expect((await pick("gen-hidden", true, boss)).status).toBe(404);
    expect((await pick("gen-mid", true, boss)).status).toBe(200);
    expect((await pick("gen-new", true, boss)).status).toBe(200);
    expect((await community(fay)).map((c) => [c.id, c.best])).toEqual([["gen-new", true], ["gen-mid", true], ["gen-old", false]]);
    expect(JSON.parse(fs.readFileSync(path.join(dataDir, "best.json"), "utf8"))).toEqual(["gen-new", "gen-mid"]);
    expect((await json<{ picker: boolean }>("/characters/community", { headers: boss })).picker).toBe(true);
    expect((await json<{ picker: boolean }>("/characters/community", { headers: fay })).picker).toBe(false);
    // leave the shared fixtures as the next tests expect them
    for (const id of ["gen-mid", "gen-new"]) expect((await pick(id, false, boss)).status).toBe(200);
    expect((await community(fay)).map((c) => c.id)).toEqual(["gen-old", "gen-new", "gen-mid"]);
    expect((await api("/characters/community?sort=popular", { headers: fay })).status).toBe(400);
  });
});

describe("looks grades", () => {
  it("move a character up or down BEST by how cool it looks; a pick still leads", async () => {
    const boss = await signIn("Boss"), fay = await signIn("Fay");
    const grade = (looks: unknown, token = TOKEN) => api("/looks", { method: "POST", headers: { "x-forge-token": token }, body: JSON.stringify({ looks }) });
    expect((await grade({ "gen-mid": 9 }, "wrong")).status).toBe(401);
    expect((await grade({ "gen-mid": 11 })).status).toBe(400);
    expect((await grade({ "gen-nope": 5 })).status).toBe(400);
    // gen-old has the one save; a 9 is worth 2.4 saves, a 2 costs 1.8
    expect((await grade({ "gen-mid": 9, "gen-old": 2 })).status).toBe(200);
    expect((await community(fay)).map((c) => c.id)).toEqual(["gen-mid", "gen-new", "gen-old"]);
    expect((await api("/characters/community/gen-old/best", { method: "POST", headers: boss, body: JSON.stringify({ best: true }) })).status).toBe(200);
    expect((await community(fay)).map((c) => c.id)).toEqual(["gen-old", "gen-mid", "gen-new"]);
    // leave the shared fixtures as the next tests expect them
    expect((await api("/characters/community/gen-old/best", { method: "POST", headers: boss, body: JSON.stringify({ best: false }) })).status).toBe(200);
    expect((await grade({ "gen-mid": 5, "gen-old": 5 })).status).toBe(200);
    expect((await community(fay)).map((c) => c.id)).toEqual(["gen-old", "gen-new", "gen-mid"]);
  });
});

describe("community", () => {
  it("lists public ready characters, with the creator's name only, best or new first", async () => {
    const bob = await signIn("Bob");
    const best = await community(bob);
    expect(best.map((c) => c.id)).toEqual(["gen-old", "gen-new", "gen-mid"]);
    expect(best[0]).toMatchObject({ plays: 0, saved: false, mine: false, creator: { name: "Ann" } });
    expect(best[0].creator).toEqual({ name: "Ann" });
    expect((await community(bob, "new")).map((c) => c.id)).toEqual(["gen-new", "gen-mid", "gen-old"]);
    expect((await api("/characters/community?sort=weird")).status).toBe(400);
  });

  it("q keeps the characters whose name has it in, any case; not the creator's name", async () => {
    const H = await signIn("Cal");
    const named = async (q: string) => (await json<{ characters: CommunityCharacter[] }>(`/characters/community?q=${q}`, { headers: H })).characters.map((c) => c.id).sort();
    expect(await named("gen-m")).toEqual(["gen-mid"]);
    expect(await named("GEN-O")).toEqual(["gen-old"]);
    expect(await named("ann")).toEqual([]);
  });

  it("counts online plays without ranking by them, and drops a deleted character", async () => {
    const bob = await signIn("Bob");
    recordPlays(["gen-mid", "gen-mid", "gen-new", "wizard"]);
    expect((await community(bob)).map((c) => [c.id, c.plays])).toEqual([["gen-old", 0], ["gen-new", 1], ["gen-mid", 2]]);
    expect((await community(bob, "new")).map((c) => c.id)).toEqual(["gen-new", "gen-mid", "gen-old"]);
    expect((await api("/library/gen-mid", { method: "DELETE", headers: await signIn("Ann") })).status).toBe(204);
    expect((await community(bob)).map((c) => c.id)).toEqual(["gen-old", "gen-new"]);
  });

  it("saving is a reference: it shows up in the saver's library, counts, and can't be doubled, made of your own, or of a private one", async () => {
    const bob = await signIn("Bob"), ann = await signIn("Ann");
    expect((await api("/library/saved/gen-new", { method: "POST" })).status).toBe(401);
    expect(await json("/library/saved/gen-new", { method: "POST", headers: bob })).toEqual({ saved: true });
    expect(await json("/library/saved/gen-new", { method: "POST", headers: bob })).toEqual({ saved: true });
    expect(await json("/library/saved/gen-old", { method: "POST", headers: bob })).toEqual({ saved: true });
    expect((await api("/library/saved/gen-new", { method: "POST", headers: ann })).status).toBe(400);
    expect((await api("/library/saved/gen-hidden", { method: "POST", headers: bob })).status).toBe(404);
    expect((await api("/library/saved/gen-nope", { method: "POST", headers: bob })).status).toBe(404);
    const lib = await library(bob);
    expect(lib.filter((c) => c.saved).map((c) => c.id).sort()).toEqual(["gen-new", "gen-old"]);
    expect(lib.find((c) => c.id === "gen-new")?.owner).toBe("dev-ann");
    expect(lib.find((c) => c.id === "gen-new")?.saved).toBeGreaterThan(Date.now() - 60_000);
    expect((await community(bob)).every((c) => c.saved)).toBe(true);
    expect((await community(ann)).every((c) => c.mine && !c.saved)).toBe(true);
    // the reference is all that's stored: Bob's file names the ids, Ann's holds the entries
    const bobFile = JSON.parse(fs.readFileSync(path.join(dataDir, "players", "dev-bob.json"), "utf8"));
    expect(bobFile.characters).toEqual([]);
    expect(bobFile.saved.map((s: { id: string }) => s.id)).toEqual(["gen-new", "gen-old"]);

    expect(await json("/library/saved/gen-new", { method: "DELETE", headers: bob })).toEqual({ saved: false });
    expect((await api("/library/saved/gen-new", { method: "DELETE", headers: bob })).status).toBe(404);
    expect((await library(bob)).map((c) => c.id)).toEqual(["gen-old"]);
    // a saved character isn't Bob's to delete
    expect((await api("/library/gen-old", { method: "DELETE", headers: bob })).status).toBe(404);
  });

  it("the owner can make one private: it leaves community, savers keep it, nobody new can save it", async () => {
    const ann = await signIn("Ann"), bob = await signIn("Bob"), dee = await signIn("Dee");
    expect((await api("/library/gen-old", { method: "PATCH", headers: bob, body: JSON.stringify({ public: false }) })).status).toBe(404);
    expect((await api("/library/gen-old", { method: "PATCH", headers: ann, body: JSON.stringify({ public: "no" }) })).status).toBe(400);
    expect((await json("/library/gen-old", { method: "PATCH", headers: ann, body: JSON.stringify({ public: false }) })).character.public).toBe(false);
    expect((await community(dee)).map((c) => c.id)).toEqual(["gen-new"]);
    expect((await api("/library/saved/gen-old", { method: "POST", headers: dee })).status).toBe(404);
    expect((await library(bob)).map((c) => c.id)).toContain("gen-old");
    expect((await json("/library/gen-old", { method: "PATCH", headers: ann, body: JSON.stringify({ public: true }) })).character.public).toBe(true);
    expect((await library(ann)).every((c) => c.public)).toBe(false);
  });

  it("a creator deleting a saved character only hides it: savers keep it until the last one lets go", async () => {
    const ann = await signIn("Ann"), bob = await signIn("Bob");
    // Cal (from his file) and Bob both have gen-old
    expect((await api("/library/gen-old", { method: "DELETE", headers: ann })).status).toBe(204);
    expect((await library(ann)).map((c) => c.id)).not.toContain("gen-old");
    expect((await community(bob)).map((c) => c.id)).not.toContain("gen-old");
    expect((await api("/library/saved/gen-old", { method: "POST", headers: await signIn("Dee") })).status).toBe(404);
    expect((await library(bob)).find((c) => c.id === "gen-old")?.bundleUrl).toBe("/gen/gen-old/bundle.json");
    expect((await api("/characters/gen-old", { headers: bob })).status).toBe(200);
    expect((await api("/library/gen-old", { method: "DELETE", headers: ann })).status).toBe(404);
    const annFile = () => JSON.parse(fs.readFileSync(path.join(dataDir, "players", "dev-ann.json"), "utf8")) as { characters: LibraryEntry[] };
    expect(annFile().characters.find((c) => c.id === "gen-old")?.deleted).toBe(true);
    await api("/library/saved/gen-old", { method: "DELETE", headers: bob });
    expect(annFile().characters.find((c) => c.id === "gen-old")?.deleted).toBe(true);
    await api("/library/saved/gen-old", { method: "DELETE", headers: await signIn("Cal") });
    expect(annFile().characters.map((c) => c.id)).not.toContain("gen-old");
    // nobody had gen-new: deleting it removes it outright
    expect((await api("/library/gen-new", { method: "DELETE", headers: ann })).status).toBe(204);
    expect(annFile().characters.map((c) => c.id)).toEqual(["gen-hidden"]);
  });

  it("the creator's PUBLIC choice is kept through the forge, and counts survive a restart", async () => {
    const eve = await signIn("Eve"), bob = await signIn("Bob");
    const made = async (pub: boolean) => {
      const created = (await json("/characters", { method: "POST", headers: eve, body: JSON.stringify({ png: `data:image/png;base64,${png1x1}`, public: pub }) })).character as LibraryEntry;
      expect(created.public).toBe(pub);
      const job = await json("/forge/jobs/next");
      const cells = Object.fromEntries(SPRITE_CELLS.map((c) => [c, png1x1]));
      expect((await api(`/forge/jobs/${job.id}/complete`, { method: "POST", body: JSON.stringify({ name: "EVE", tagline: "t", description: "d", source, cpu: { version: STUDY_VERSION, base: {}, forms: {} }, sprite: { px: 512, feetPx: 448, heightPx: 360, anims: {} }, cells }) })).status).toBe(204);
      return created.id;
    };
    const hidden = await made(false), shown = await made(true);
    expect((await api("/characters", { method: "POST", headers: eve, body: JSON.stringify({ png: `data:image/png;base64,${png1x1}`, public: "yes" }) })).status).toBe(400);
    const ids = (await community(bob)).map((c) => c.id);
    expect(ids).toContain(shown);
    expect(ids).not.toContain(hidden);
    await api(`/library/saved/${shown}`, { method: "POST", headers: bob });
    server.close();
    app();
    await new Promise<void>((r) => server.once("listening", () => r()));
    port = (server.address() as { port: number }).port;
    expect((await community(await signIn("Bob"))).find((c) => c.id === shown)).toMatchObject({ saved: true });
  });
});
