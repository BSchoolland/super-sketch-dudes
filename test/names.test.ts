import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import http from "node:http";
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
import { newMapDoc } from "../shared/maps";
import { GOOGLE_CLIENT_ID, type CommunityCharacter, type Player } from "../shared/account";

/** Player names are the game's own: Google's never arrives, and an account can type another. */
const TOKEN = "t0k";
let server: http.Server, port: number, dataDir: string;
const realFetch = globalThis.fetch;

const api = (p: string, init: RequestInit = {}) => realFetch(`http://127.0.0.1:${port}/api${p}`, { ...init, headers: { "content-type": "application/json", ...(init.headers ?? {}) } });
const post = (p: string, body: unknown, session?: string) => api(p, { method: "POST", body: JSON.stringify(body), headers: session ? { "x-session": session } : {} });
const signedIn = async (r: Response) => { expect(r.status).toBe(200); return (await r.json()) as { session: string; player: Player }; };
/** Signs in with a Google ID token for `sub`, whose Google profile says they're Hudson Smith. */
const google = (sub: string, session?: string) => post("/auth/google", { idToken: sub, nonce: "n" }, session).then(signedIn);
const TWO_WORDS = /^[A-Z][a-z]+ [A-Z][a-z]+$/;

beforeAll(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "sb-names-"));
  vi.stubGlobal("fetch", (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    if (!u.startsWith("https://oauth2.googleapis.com/tokeninfo")) return realFetch(url, init);
    const sub = new URL(u).searchParams.get("id_token");
    return Promise.resolve(Response.json({ aud: GOOGLE_CLIENT_ID, iss: "accounts.google.com", sub, nonce: "n", name: "Hudson Smith", given_name: "Hudson", picture: "https://example.com/h.png" }));
  });
  const a = express();
  a.use(express.json({ limit: "12mb" }));
  const router = express.Router();
  a.use("/api", router);
  initLibrary(dataDir);
  initEvents(dataDir);
  attachAuth(router, { dataDir, devLogin: true, botKey: null, discord: { api: "http://discord.invalid", clientSecret: null }, namesOpen: true });
  attachForge(router, { token: TOKEN, dataDir, genBase: "/gen" });
  attachCharacters(router, TOKEN, dataDir);
  initMaps({ dataDir, devLogin: true });
  attachMaps(router);
  server = http.createServer(a);
  server.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", () => r()));
  port = (server.address() as { port: number }).port;
});
afterAll(() => { vi.unstubAllGlobals(); server.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });

describe("player names", () => {
  it("gives a Google sign-in a made-up name, not the Google one, and keeps it next time", async () => {
    const first = await google("g1");
    expect(first.player.id).toBe("google-g1");
    expect(first.player.name).toMatch(TWO_WORDS);
    expect(first.player.name).not.toContain("Hudson");
    expect((await google("g1")).player.name).toBe(first.player.name);
    expect(fs.readFileSync(path.join(dataDir, "players", "google-g1.json"), "utf8")).not.toContain("Hudson");
  });

  it("lets a guest who signs in with Google keep the name they played under", async () => {
    const guest = await signedIn(await post("/auth/guest", {}));
    expect((await google("g2", guest.session)).player.name).toBe(guest.player.name);
  });

  it("renames an account everywhere its name shows, for good", async () => {
    const { session, player } = await google("g3");
    upsertCharacter({ id: "robo", owner: player.id, status: "ready", stage: "", error: null, name: "ROBO", tagline: "t", description: "d", drawingUrl: "/gen/drawings/robo.png", bundleUrl: "/gen/robo/bundle.json", sheetUrl: null, createdAt: 1, origin: "creator", public: true });
    const mapId = "map-0123456789";
    expect((await post("/maps", newMapDoc(mapId, player.id, player.name, "ARENA", 1), session)).status).toBe(200);

    const r = await post("/me/name", { name: "  Dr. <b>Sketch</b>  " }, session);
    expect(r.status).toBe(200);
    expect(((await r.json()) as { player: Player }).player.name).toBe("Dr. bSketchb");

    expect(((await (await api("/me", { headers: { "x-session": session } })).json()) as { player: Player }).player.name).toBe("Dr. bSketchb");
    expect((await google("g3")).player.name).toBe("Dr. bSketchb");
    const community = ((await (await api("/characters/community?sort=new")).json()) as { characters: CommunityCharacter[] }).characters;
    expect(community.find((c) => c.id === "robo")?.creator.name).toBe("Dr. bSketchb");
    expect(JSON.parse(fs.readFileSync(path.join(dataDir, "maps", `${mapId}.json`), "utf8")).ownerName).toBe("Dr. bSketchb");
  });

  it("keeps a dev or email account's stored name over the one a later sign-in brings", async () => {
    const { session } = await signedIn(await post("/auth/dev", { name: "Pat" }));
    expect((await post("/me/name", { name: "Patches" }, session)).status).toBe(200);
    expect((await signedIn(await post("/auth/dev", { name: "Pat" }))).player.name).toBe("Patches");
  });

  it("won't rename a guest, or to nothing", async () => {
    const guest = await signedIn(await post("/auth/guest", {}));
    expect((await post("/me/name", { name: "Sneaky" }, guest.session)).status).toBe(403);
    const { session } = await google("g4");
    expect((await post("/me/name", { name: " <> " }, session)).status).toBe(400);
    expect((await post("/me/name", { name: "x" })).status).toBe(401);
  });
});
