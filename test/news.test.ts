import { afterAll, beforeAll, describe, expect, it } from "vitest";
import http from "node:http";
import express from "express";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { attachAuth } from "../server/auth";
import { attachCharacters } from "../server/characters";
import { initLibrary, recordPlays } from "../server/library";
import { initEvents } from "../server/events";
import { GAME_VERSION, type FeaturedCharacter, type LastPlayed, type News } from "../shared/account";
import { FRESH_MS, compareVersions, releasesSince } from "../shared/releases";

let server: http.Server, port: number, dataDir: string;
const DAY = 24 * 60 * 60 * 1000;
const json = async <T = any>(p: string, init: RequestInit = {}): Promise<T> =>
  (await fetch(`http://127.0.0.1:${port}/api${p}`, { ...init, headers: { "content-type": "application/json", ...(init.headers ?? {}) } })).json() as Promise<T>;
type SignedIn = { session: string; lastPlayed: LastPlayed | null; news: News | null };
const signIn = (name: string) => json<SignedIn>("/auth/dev", { method: "POST", body: JSON.stringify({ name }) });

const ready = (id: string, owner: string, extra: object = {}) => ({
  id, owner, status: "ready", stage: "", error: null, name: id, tagline: "", description: "",
  drawingUrl: `/gen/drawings/${id}.png`, bundleUrl: `/gen/${id}/bundle.json`, sheetUrl: null, createdAt: 1, origin: "creator", ...extra,
});

beforeAll(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "sb-news-"));
  fs.mkdirSync(path.join(dataDir, "players"));
  const file = (owner: string, record: object) => fs.writeFileSync(path.join(dataDir, "players", `${owner}.json`), JSON.stringify({ player: { id: owner, name: owner, avatar: null }, characters: [], saved: [], ...record }));
  file("dev-old", { lastPlayed: { version: "0.1.2", at: 1 } });
  file("dev-stale", { lastPlayed: { version: GAME_VERSION, at: 1 }, news: { since: Date.now() - FRESH_MS - DAY, fresh: ["community"], seen: [] } });
  file("dev-ann", { lastPlayed: null, characters: [ready("a1", "dev-ann"), ready("a2", "dev-ann"), ready("a3", "dev-ann"), ready("a4", "dev-ann", { public: false })] });
  file("dev-bob", { lastPlayed: null, characters: [ready("b1", "dev-bob")] });
  const a = express();
  a.use(express.json());
  const router = express.Router();
  a.use("/api", router);
  initLibrary(dataDir);
  initEvents(dataDir);
  attachAuth(router, { dataDir, devLogin: true, botKey: null });
  attachCharacters(router, "t");
  server = http.createServer(a).listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", () => r()));
  port = (server.address() as { port: number }).port;
});
afterAll(() => { server.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });

describe("versions", () => {
  it("compares numerically", () => {
    expect(compareVersions("0.10.0", "0.9.3")).toBe(1);
    expect(compareVersions("0.2.0", "0.2.0")).toBe(0);
    expect(compareVersions("0.1.2", "0.2.0")).toBe(-1);
  });
  it("lists the releases between two versions", () => {
    expect(releasesSince("0.1.2", "0.2.0").map((r) => r.version)).toEqual(["0.2.0"]);
    expect(releasesSince("0.2.0", "0.2.0")).toEqual([]);
  });
});

describe("news", () => {
  it("a returning player on an older version gets NEW stickers, kept on later visits until opened", async () => {
    const first = await signIn("Old");
    expect(first.lastPlayed?.version).toBe("0.1.2");
    expect(first.news).toMatchObject({ fresh: ["characters", "community"], seen: [] });
    const H = { "x-session": first.session };
    expect((await json<{ news: News }>("/me/news/community", { method: "POST", headers: H })).news.seen).toEqual(["community"]);
    const again = await json<SignedIn>("/me/played", { method: "POST", headers: H });
    expect(again.lastPlayed?.version).toBe(GAME_VERSION);
    expect(again.news).toMatchObject({ since: first.news!.since, seen: ["community"] });
  });
  it("a new player gets none", async () => {
    expect((await signIn("Fresh")).news).toBeNull();
  });
  it("they come off after FRESH_MS", async () => {
    expect((await signIn("Stale")).news).toBeNull();
  });
  it("rejects news that doesn't exist", async () => {
    const H = { "x-session": (await signIn("Old")).session };
    expect(await json("/me/news/maps", { method: "POST", headers: H })).toEqual({ error: "no such news: maps" });
  });
});

describe("featured", () => {
  it("is the most played public characters, at most two from one creator, and how many players have made, private ones too", async () => {
    recordPlays(["a1", "a1", "a1", "a2", "a2", "a3", "a3", "a4", "a4", "a4", "a4", "b1"]);
    const { characters, made } = await json<{ characters: FeaturedCharacter[]; made: number }>("/characters/featured");
    expect(characters.map((c) => c.id)).toEqual(["a1", "a2", "b1"]);
    expect(made).toBe(5);
  });
});
