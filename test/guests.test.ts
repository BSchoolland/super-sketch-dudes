import { afterAll, beforeAll, describe, expect, it } from "vitest";
import http from "node:http";
import crypto from "node:crypto";
import express from "express";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { attachAuth } from "../server/auth";
import { attachForge } from "../server/forge";
import { attachCharacters } from "../server/characters";
import { attachMaps, initMaps } from "../server/maps";
import { initLibrary, upsertCharacter } from "../server/library";
import { initEvents } from "../server/events";
import { sweepGuests } from "../server/guests";
import { newMapDoc } from "../shared/maps";
import type { LibraryEntry, Player } from "../shared/account";

/** Guest play: a real player with no account, whose things move to the account they sign in to. */
const TOKEN = "t0k";
let server: http.Server, port: number, dataDir: string;
const png1x1 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

const api = (p: string, init: RequestInit = {}) => fetch(`http://127.0.0.1:${port}/api${p}`, { ...init, headers: { "x-forge-token": TOKEN, "content-type": "application/json", ...(init.headers ?? {}) } });
const post = (p: string, body: unknown, session?: string) => api(p, { method: "POST", body: JSON.stringify(body), headers: session ? { "x-session": session } : {} });
const signedIn = async (r: Response) => { expect(r.status).toBe(200); return (await r.json()) as { session: string; player: Player }; };
const guest = async () => signedIn(await post("/auth/guest", {}));
const H = (session: string) => ({ headers: { "x-session": session } });
const library = async (session: string) => ((await (await api("/library", H(session))).json()) as { characters: LibraryEntry[] }).characters;
const communityIds = async () => ((await (await api("/characters/community?sort=new")).json()) as { characters: { id: string }[] }).characters.map((c) => c.id);
const sampleIds = async () => ((await (await api("/characters/sample?n=24")).json()) as { characters: { id: string }[] }).characters.map((c) => c.id);

const ready = (id: string, owner: string, extra: Partial<LibraryEntry> = {}): LibraryEntry => ({
  id, owner, status: "ready", stage: "", error: null, name: id.toUpperCase(), tagline: "t", description: "d",
  drawingUrl: `/gen/drawings/${id}.png`, bundleUrl: `/gen/${id}/bundle.json`, sheetUrl: null, createdAt: 1, origin: "creator", public: true, ...extra,
});
const playerFile = (id: string) => path.join(dataDir, "players", `${id}.json`);

beforeAll(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "sb-guests-"));
  fs.mkdirSync(path.join(dataDir, "players"));
  // an email account from before, password "correct horse"
  const salt = "c2FsdA==";
  const hash = crypto.scryptSync("correct horse", salt, 64).toString("base64");
  fs.writeFileSync(path.join(dataDir, "accounts.json"), JSON.stringify([["old@example.com", { player: { id: "email-old1", name: "OLDIE", avatar: null }, salt, hash }]]));
  const a = express();
  a.use(express.json({ limit: "12mb" }));
  const router = express.Router();
  a.use("/api", router);
  initLibrary(dataDir);
  initEvents(dataDir);
  attachAuth(router, { dataDir, devLogin: true, botKey: null, discord: { api: "http://discord.invalid", clientSecret: null } });
  attachForge(router, { token: TOKEN, dataDir, genBase: "/gen" });
  attachCharacters(router, TOKEN, dataDir);
  initMaps({ dataDir, devLogin: true });
  attachMaps(router);
  server = http.createServer(a);
  server.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", () => r()));
  port = (server.address() as { port: number }).port;
});
afterAll(() => { server.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });

describe("guests", () => {
  it("are real players with a two-word name the server picks, and can use the library", async () => {
    const g = await guest();
    expect(g.player.id).toMatch(/^guest-[0-9a-f]{18}$/);
    expect(g.player.name).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+$/);
    expect(g.player.name.length).toBeLessThanOrEqual(14);
    expect(g.player.avatar).toBeNull();
    expect((await api("/me", H(g.session))).status).toBe(200);
    expect(await library(g.session)).toEqual([]);
    expect(fs.existsSync(playerFile(g.player.id))).toBe(true);
    expect((await guest()).player.id).not.toBe(g.player.id);
  });

  it("never list their characters in COMMUNITY or the brawl; signing in lists them as the account's", async () => {
    const g = await guest();
    upsertCharacter(ready("gen-guestart-1", g.player.id), g.player);
    expect((await library(g.session)).map((c) => c.id)).toContain("gen-guestart-1");
    expect(await communityIds()).not.toContain("gen-guestart-1");
    expect(await sampleIds()).not.toContain("gen-guestart-1");
    expect((await api("/characters/community/gen-guestart-1")).status).toBe(404);
    const other = await guest();
    expect((await post("/library/saved/gen-guestart-1", {}, other.session)).status).toBe(404);

    const acct = await signedIn(await post("/auth/dev", { name: "Pubby" }, g.session));
    expect(await communityIds()).toContain("gen-guestart-1");
    expect((await library(acct.session)).find((c) => c.id === "gen-guestart-1")).toMatchObject({ owner: "dev-pubby", public: true });
  });

  it("signing in moves characters, saves, maps and unfinished forge jobs into an account that already has a library, and ends the guest", async () => {
    // the account, with a character of its own and a save
    const acct = await signedIn(await post("/auth/dev", { name: "Haver" }));
    upsertCharacter(ready("gen-haver-own", "dev-haver"), acct.player);
    upsertCharacter(ready("gen-pub-a", "dev-pubowner"), { id: "dev-pubowner", name: "PUB", avatar: null });
    upsertCharacter(ready("gen-pub-b", "dev-pubowner"));
    expect((await post("/library/saved/gen-pub-a", {}, acct.session)).status).toBe(200);
    await api("/auth/logout", { method: "POST", ...H(acct.session) });

    const g = await guest();
    upsertCharacter(ready("gen-guest-made", g.player.id), g.player);
    expect((await post("/library/saved/gen-pub-a", {}, g.session)).status).toBe(200); // both saved this one
    expect((await post("/library/saved/gen-pub-b", {}, g.session)).status).toBe(200);
    expect((await post("/library/saved/gen-haver-own", {}, g.session)).status).toBe(200); // the account's own
    const queued = (await (await post("/characters", { png: `data:image/png;base64,${png1x1}` }, g.session)).json()) as { character: LibraryEntry };
    const mapId = "map-0123456789";
    expect((await post("/maps", newMapDoc(mapId, g.player.id, g.player.name, "GUEST MAP", 1), g.session)).status).toBe(200);

    const back = await signedIn(await post("/auth/dev", { name: "Haver" }, g.session));
    const lib = await library(back.session);
    const mine = lib.filter((c) => !c.saved && !c.starter).map((c) => c.id).sort();
    expect(mine).toEqual(["gen-guest-made", "gen-haver-own", queued.character.id].sort());
    expect(lib.filter((c) => c.saved).map((c) => c.id).sort()).toEqual(["gen-pub-a", "gen-pub-b"]);
    const saves = ((await (await api("/characters/community?sort=saved")).json()) as { characters: { id: string; saves: number }[] }).characters;
    expect(saves.find((c) => c.id === "gen-pub-a")?.saves).toBe(1);
    expect(saves.find((c) => c.id === "gen-haver-own")?.saves ?? 0).toBe(0);
    const maps = ((await (await api("/maps", H(back.session))).json()) as { maps: { id: string; owner: string; ownerName: string }[] }).maps;
    expect(maps).toEqual([expect.objectContaining({ id: mapId, owner: "dev-haver", ownerName: "Haver" })]);
    // the guest is over
    expect((await api("/me", H(g.session))).status).toBe(401);
    expect(fs.existsSync(playerFile(g.player.id))).toBe(false);
    // the forge job finishing later lands with the account
    const job = await (await api("/forge/jobs/next")).json() as { id: string; playerName: string };
    expect(job.playerName).toBe("Haver");
    await post(`/forge/jobs/${job.id}/fail`, { error: "test" });
    expect((await library(back.session)).find((c) => c.id === queued.character.id)).toMatchObject({ owner: "dev-haver", status: "failed" });
    expect(fs.existsSync(playerFile(g.player.id))).toBe(false);
  });

  it("a sign-in from an account's session moves nothing", async () => {
    const a = await signedIn(await post("/auth/dev", { name: "Keeper" }));
    upsertCharacter(ready("gen-keeper-1", "dev-keeper"), a.player);
    const b = await signedIn(await post("/auth/dev", { name: "Other" }, a.session));
    expect((await library(b.session)).some((c) => c.id === "gen-keeper-1")).toBe(false);
    expect((await library(a.session)).some((c) => c.id === "gen-keeper-1")).toBe(true);
  });

  it("are swept once idle: 7 days with nothing made, 60 with something", async () => {
    const empty = await guest(), maker = await guest();
    upsertCharacter(ready("gen-swept-1", maker.player.id), maker.player);
    fs.mkdirSync(path.join(dataDir, "gen", "gen-swept-1"), { recursive: true });
    fs.writeFileSync(path.join(dataDir, "gen", "gen-swept-1", "bundle.json"), "{}");
    const day = 86_400_000, now = Date.now();
    sweepGuests(now + 6 * day);
    for (const g of [empty, maker]) expect((await api("/me", H(g.session))).status).toBe(200);
    const at8 = sweepGuests(now + 8 * day);
    expect(at8.swept).toBeGreaterThanOrEqual(1);
    expect((await api("/me", H(empty.session))).status).toBe(401);
    expect(fs.existsSync(playerFile(empty.player.id))).toBe(false);
    expect((await api("/me", H(maker.session))).status).toBe(200);
    sweepGuests(now + 61 * day);
    expect((await api("/me", H(maker.session))).status).toBe(401);
    expect(fs.existsSync(playerFile(maker.player.id))).toBe(false);
    expect(fs.existsSync(path.join(dataDir, "gen", "gen-swept-1"))).toBe(false);
  });
});

describe("email accounts", () => {
  it("an existing one still signs in, and new ones can still be made (no age field reaches the server)", async () => {
    expect((await post("/auth/login", { email: "old@example.com", password: "wrong one" })).status).toBe(401);
    expect((await signedIn(await post("/auth/login", { email: "Old@Example.com", password: "correct horse" }))).player.id).toBe("email-old1");
    const made = await signedIn(await post("/auth/signup", { email: "new@example.com", password: "long enough", name: "NEWBIE" }));
    expect(made.player.id).toMatch(/^email-/);
    const stored = JSON.parse(fs.readFileSync(path.join(dataDir, "accounts.json"), "utf8")) as [string, object][];
    expect(Object.keys(stored.find(([k]) => k === "new@example.com")![1]).sort()).toEqual(["hash", "player", "salt"]);
  });
});
