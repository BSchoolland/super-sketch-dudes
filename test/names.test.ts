import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import http from "node:http";
import express from "express";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { applyName, attachAuth } from "../server/auth";
import { attachNameJudging, NAMES_PER_DAY } from "../server/name-requests";
import { reputationOf } from "../server/moderation";
import { attachForge } from "../server/forge";
import { attachCharacters } from "../server/characters";
import { attachMaps, initMaps } from "../server/maps";
import { initLibrary, upsertCharacter } from "../server/library";
import { initEvents } from "../server/events";
import { newMapDoc } from "../shared/maps";
import { GOOGLE_CLIENT_ID, type CommunityCharacter, type NameStanding, type Player } from "../shared/account";
import type { NameVerdict } from "../shared/moderation";

/** Player names are the game's own: Google's never arrives, and an account can ask for another, which the moderator's judges decide. */
const TOKEN = "t0k";
let server: http.Server, port: number, dataDir: string;
const realFetch = globalThis.fetch;

const api = (p: string, init: RequestInit = {}) => realFetch(`http://127.0.0.1:${port}/api${p}`, { ...init, headers: { "content-type": "application/json", ...(init.headers ?? {}) } });
const post = (p: string, body: unknown, session?: string) => api(p, { method: "POST", body: JSON.stringify(body), headers: session ? { "x-session": session } : {} });
const signedIn = async (r: Response) => { expect(r.status).toBe(200); return (await r.json()) as { session: string; player: Player }; };
/** Signs in with a Google ID token for `sub`, whose Google profile says they're Hudson Smith. */
const google = (sub: string, session?: string) => post("/auth/google", { idToken: sub, nonce: "n" }, session).then(signedIn);
const TWO_WORDS = /^[A-Z][a-z]+ [A-Z][a-z]+$/;
const worker = { "x-forge-token": TOKEN };
const me = async (session: string) => (await (await api("/me/name", { headers: { "x-session": session } })).json()) as NameStanding;
/** The worker takes the next name to its judges. */
const claim = async () => {
  const r = await api("/forge/names/next", { headers: worker });
  return r.status === 204 ? null : ((await r.json()) as { id: string; name: string; player: string; playerName: string });
};
const judged = (harsh: NameVerdict, lenient: NameVerdict) => ({ harsh: { verdict: harsh, reason: "because" }, lenient: { verdict: lenient, reason: "because" } });
const verdict = (id: string, j: ReturnType<typeof judged>) => api(`/forge/names/${id}/verdict`, { method: "POST", headers: worker, body: JSON.stringify(j) });
/** Asks for `name` and has both judges pass it. */
async function approved(session: string, name: string): Promise<void> {
  expect((await post("/me/name", { name }, session)).status).toBe(200);
  const c = (await claim())!;
  expect((await verdict(c.id, judged("pass", "pass"))).status).toBe(200);
}

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
  attachAuth(router, { dataDir, devLogin: true, botKey: null, discord: { api: "http://discord.invalid", clientSecret: null }});
  attachForge(router, { token: TOKEN, dataDir, genBase: "/gen" });
  attachNameJudging(router, { token: TOKEN, rename: applyName });
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

  it("renames an account everywhere its name shows once the judges pass it, for good", async () => {
    const { session, player } = await google("g3");
    upsertCharacter({ id: "robo", owner: player.id, status: "ready", stage: "", error: null, name: "ROBO", tagline: "t", description: "d", drawingUrl: "/gen/drawings/robo.png", bundleUrl: "/gen/robo/bundle.json", sheetUrl: null, createdAt: 1, origin: "creator", public: true });
    const mapId = "map-0123456789";
    expect((await post("/maps", newMapDoc(mapId, player.id, player.name, "ARENA", 1), session)).status).toBe(200);

    const r = await post("/me/name", { name: "  Dr. <b>Sketch</b>  " }, session);
    expect(r.status).toBe(200);
    expect((await r.json()) as NameStanding).toMatchObject({ player: { name: player.name }, request: { name: "Dr. bSketchb", status: "waiting" } });
    // nobody sees it yet
    expect(((await (await api("/me", { headers: { "x-session": session } })).json()) as { player: Player }).player.name).toBe(player.name);
    expect((await me(session)).request).toEqual({ name: "Dr. bSketchb", status: "waiting" });

    const c = (await claim())!;
    expect(c).toMatchObject({ name: "Dr. bSketchb", player: player.id, playerName: player.name });
    expect(await claim()).toBeNull();
    const d = await verdict(c.id, judged("pass", "pass"));
    expect(await d.json()).toMatchObject({ blocked: false, before: 90, after: 92 });
    expect((await verdict(c.id, judged("pass", "pass"))).status).toBe(409);

    expect(await me(session)).toMatchObject({ player: { name: "Dr. bSketchb" }, request: null });
    expect(((await (await api("/me", { headers: { "x-session": session } })).json()) as { player: Player }).player.name).toBe("Dr. bSketchb");
    expect((await google("g3")).player.name).toBe("Dr. bSketchb");
    const community = ((await (await api("/characters/community?sort=new")).json()) as { characters: CommunityCharacter[] }).characters;
    expect(community.find((c) => c.id === "robo")?.creator.name).toBe("Dr. bSketchb");
    expect(JSON.parse(fs.readFileSync(path.join(dataDir, "maps", `${mapId}.json`), "utf8")).ownerName).toBe("Dr. bSketchb");
    const log = fs.readFileSync(path.join(dataDir, "moderation.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    expect(log.at(-1)).toMatchObject({ player: player.id, name: "Dr. bSketchb", blocked: false, before: 90, after: 92 });
  });

  it("keeps the old name when the judges refuse, says why, and takes another", async () => {
    const { session, player } = await google("g5");
    expect((await post("/me/name", { name: "Mean Name" }, session)).status).toBe(200);
    const c = (await claim())!;
    expect(await (await verdict(c.id, judged("bullying", "personal"))).json()).toMatchObject({ blocked: true, before: 90, after: 65 });
    expect(await me(session)).toEqual({
      player, checkerUp: true,
      request: { name: "Mean Name", status: "refused", reason: "it picks on someone, and it looks like a real person's name or personal info" },
    });
    expect((await google("g5")).player.name).toBe(player.name);
    // below 75 now: one judge flagging is enough
    expect(reputationOf(player.id)).toBe(65);
    expect((await post("/me/name", { name: "Edgy Name" }, session)).status).toBe(200);
    expect((await me(session)).request).toEqual({ name: "Edgy Name", status: "waiting" });
    const c2 = (await claim())!;
    expect(await (await verdict(c2.id, judged("pass", "other"))).json()).toMatchObject({ blocked: true, before: 65, after: 60 });
    expect((await me(session)).player.name).toBe(player.name);
  });

  it("lets a trusted player through when only one judge flags", async () => {
    const { session } = await google("g6");
    expect((await post("/me/name", { name: "Doom Hammer" }, session)).status).toBe(200);
    const c = (await claim())!;
    expect(await (await verdict(c.id, judged("inappropriate", "pass"))).json()).toMatchObject({ blocked: false, held: true, before: 90, after: 85 });
    expect((await me(session)).player.name).toBe("Doom Hammer");
  });

  it("waits one name at a time, refuses listed words without the judges, and keeps to a few a day", async () => {
    const { session, player } = await google("g7");
    expect((await post("/me/name", { name: "Sir Fuuuck" }, session)).status).toBe(400);
    expect((await me(session)).request).toBeNull();
    expect(await claim()).toBeNull();

    expect((await post("/me/name", { name: "First Try" }, session)).status).toBe(200);
    const twice = await post("/me/name", { name: "Second Try" }, session);
    expect(twice.status).toBe(409);
    expect((await me(session)).request).toEqual({ name: "First Try", status: "waiting" });

    // judges that couldn't run put it back, and it's offered again
    const c = (await claim())!;
    expect((await api(`/forge/names/${c.id}/release`, { method: "POST", headers: worker, body: JSON.stringify({ error: "usage limit" }) })).status).toBe(204);
    expect((await me(session)).request).toEqual({ name: "First Try", status: "waiting" });
    expect((await verdict((await claim())!.id, judged("other", "other"))).status).toBe(200);

    for (let i = 2; i <= NAMES_PER_DAY; i++) {
      expect((await post("/me/name", { name: `Try ${i}` }, session)).status).toBe(200);
      await verdict((await claim())!.id, judged("other", "other"));
    }
    expect((await post("/me/name", { name: "One Too Many" }, session)).status).toBe(429);
    expect((await me(session)).player.name).toBe(player.name);
  });

  it("keeps a dev or email account's stored name over the one a later sign-in brings", async () => {
    const { session } = await signedIn(await post("/auth/dev", { name: "Pat" }));
    await approved(session, "Patches");
    expect((await signedIn(await post("/auth/dev", { name: "Pat" }))).player.name).toBe("Patches");
  });

  it("gives an email signup a made-up name while the one they typed is checked, and refuses a listed one", async () => {
    expect((await post("/auth/signup", { email: "rude@example.com", password: "password1", name: "b1tch" })).status).toBe(400);
    const { session, player } = await signedIn(await post("/auth/signup", { email: "kid@example.com", password: "password1", name: "Rocket Kid" }));
    expect(player.name).toMatch(TWO_WORDS);
    expect((await me(session)).request).toEqual({ name: "Rocket Kid", status: "waiting" });
    await verdict((await claim())!.id, judged("pass", "pass"));
    expect((await signedIn(await post("/auth/login", { email: "kid@example.com", password: "password1" }))).player.name).toBe("Rocket Kid");
  });

  it("won't rename a guest, or to nothing, and only the worker judges", async () => {
    const guest = await signedIn(await post("/auth/guest", {}));
    expect((await post("/me/name", { name: "Sneaky" }, guest.session)).status).toBe(403);
    const { session } = await google("g4");
    expect((await post("/me/name", { name: " <> " }, session)).status).toBe(400);
    expect((await post("/me/name", { name: "x" })).status).toBe(401);
    expect((await api("/forge/names/next")).status).toBe(401);
  });

  it("lets Ben take a name down", async () => {
    const { session, player } = await google("g8");
    await approved(session, "Sneaky Name");
    const r = await api("/forge/names/take-down", { method: "POST", headers: worker, body: JSON.stringify({ player: player.id }) });
    expect(((await r.json()) as { player: Player }).player.name).toMatch(TWO_WORDS);
    expect((await me(session)).player.name).toMatch(TWO_WORDS);
  });
});
