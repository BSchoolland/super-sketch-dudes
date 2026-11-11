import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Server } from "node:http";
import { attachAuth } from "../server/auth";
import { initLibrary, upsertCharacter } from "../server/library";
import { initEvents } from "../server/events";
import { attachMaps, initMaps } from "../server/maps";
import { attachCharacters } from "../server/characters";
import { crazyGamesPlayerId, verifyCrazyGamesToken, type Jwk } from "../server/crazygames";
import { isCrazyGames, isGuest, type LibraryEntry, type Player } from "../shared/account";
import { newMapDoc } from "../shared/maps";
// @ts-expect-error a plain .mjs script, no types
import { fakeCrazyGamesUserId, signJwt, startFakeCrazyGames } from "../scripts/fake-crazygames.mjs";

/** Signing in inside CrazyGames: the SDK's user token, checked against the published keys, against a fake CrazyGames. */
const GAME = "test-game-1";
type Mint = (name: string, o?: { payload?: object; header?: object; key?: crypto.KeyObject }) => string;
let fake: { url: string; jwks: string; mint: Mint; close(): void };
let keys: Jwk[];
const servers: Server[] = [];
const dirs: string[] = [];

interface Game { post(p: string, body: unknown, session?: string): Promise<Response>; get(p: string, session: string): Promise<Response>; dataDir: string }

async function gameServer(gameId: string | null, jwks = fake.jwks): Promise<Game> {
  const app = express();
  const api = express.Router();
  api.use(express.json());
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "crazygames-auth-"));
  dirs.push(dataDir);
  initLibrary(dataDir);
  initEvents(dataDir);
  initMaps({ dataDir, devLogin: true });
  attachAuth(api, { dataDir, devLogin: true, botKey: null, discord: { api: "http://discord.invalid", clientSecret: null }, crazygames: { jwks, gameId } });
  attachMaps(api);
  attachCharacters(api, "t0k", dataDir);
  app.use("/api", api);
  const server = app.listen(0, "127.0.0.1");
  servers.push(server);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
  return {
    dataDir,
    post: (p, body, session) => fetch(`${base}${p}`, { method: "POST", headers: { "content-type": "application/json", ...(session ? { "x-session": session } : {}) }, body: JSON.stringify(body) }),
    get: (p, session) => fetch(`${base}${p}`, { headers: { "x-session": session } }),
  };
}
const signedIn = async (r: Response) => { expect(r.status).toBe(200); return (await r.json()) as { session: string; player: Player }; };
const refused = async (r: Response) => { expect(r.status).toBe(401); return ((await r.json()) as { error: string }).error; };

beforeAll(async () => {
  fake = await startFakeCrazyGames({ gameId: GAME });
  keys = ((await (await fetch(fake.jwks)).json()) as { keys: Jwk[] }).keys;
});
afterAll(() => {
  fake.close();
  for (const s of servers) s.close();
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
});

describe("a CrazyGames user token", () => {
  const now = Date.now();
  const verify = (token: string, gameId = GAME) => verifyCrazyGamesToken(token, keys, gameId, now);

  it("says who the user is when CrazyGames signed it for this game", () => {
    expect(verify(fake.mint("Ann_Stub", { payload: { profilePictureUrl: "https://images.example/a.png" } })))
      .toEqual({ userId: fakeCrazyGamesUserId("Ann_Stub"), username: "Ann_Stub", profilePictureUrl: "https://images.example/a.png" });
  });

  it("is refused when another key signed it, it expired, or it's another game's", () => {
    const other = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey;
    expect(verify(fake.mint("Ann_Stub", { key: other }))).toEqual({ error: "bad signature" });
    expect(verify(fake.mint("Ann_Stub", { payload: { exp: Math.floor(now / 1000) - 1 } }))).toEqual({ error: "token expired" });
    expect(verify(fake.mint("Ann_Stub"), "another-game")).toEqual({ error: `token is for game ${GAME}, not this one` });
  });

  it("is refused unless it's RS256 with a key we have, and a changed payload breaks the signature", () => {
    const real = fake.mint("Ann_Stub");
    const [h, p, s] = real.split(".");
    const forged = { ...JSON.parse(Buffer.from(p, "base64url").toString()), userId: "someone-else" };
    expect(verify(`${h}.${Buffer.from(JSON.stringify(forged)).toString("base64url")}.${s}`)).toEqual({ error: "bad signature" });
    const none = `${Buffer.from(JSON.stringify({ alg: "none", kid: "ingame-auth" })).toString("base64url")}.${p}.`;
    expect(verify(none)).toEqual({ error: "token signed with none, not RS256" });
    expect(verify(fake.mint("Ann_Stub", { header: { kid: "rotated-away" } }))).toEqual({ error: "no CrazyGames key rotated-away", unknownKey: true });
    expect(verify("not.a")).toEqual({ error: "not a token" });
    expect(verify("@@.@@.@@")).toMatchObject({ error: expect.stringMatching(/^unreadable token/) });
  });

  it("with no kid (the SDK's local demo tokens) must still match one of the keys", () => {
    expect(verify(fake.mint("User1", { header: { kid: undefined } }))).toMatchObject({ username: "User1" });
    const key = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey;
    const payload = { userId: "idUser1", username: "User1", gameId: GAME, exp: Math.floor(now / 1000) + 60 };
    expect(verify(signJwt({ alg: "RS256", typ: "JWT" }, payload, key))).toEqual({ error: "bad signature" });
  });

  it("keys players on a user id that is safe as a file name", () => {
    expect(verify(fake.mint("Ann_Stub", { payload: { userId: "../../etc" } }))).toEqual({ error: 'unexpected user id "../../etc"' });
    expect(verify(fake.mint("Ann_Stub", { payload: { userId: 42 } }))).toEqual({ error: "unexpected user id 42" });
    expect(crazyGamesPlayerId("abc123")).toBe("crazygames-abc123");
    expect(isCrazyGames("crazygames-abc123")).toBe(true);
    expect(isGuest("crazygames-abc123")).toBe(false);
    expect(isCrazyGames("guest-abc")).toBe(false);
  });
});

describe("POST /auth/crazygames", () => {
  it("makes a crazygames-<user id> player named by their username, and keeps them across sign-ins", async () => {
    const game = await gameServer(GAME);
    const first = await signedIn(await game.post("/auth/crazygames", { token: fake.mint("Ann_Stub") }));
    expect(first.player).toEqual({ id: `crazygames-${fakeCrazyGamesUserId("Ann_Stub")}`, name: "Ann_Stub", avatar: null });
    const again = await signedIn(await game.post("/auth/crazygames", { token: fake.mint("Ann_Stub") }));
    expect(again.player).toEqual(first.player);
    expect(again.session).not.toBe(first.session);
  });

  it("follows a changed CrazyGames username, on the record, open sessions and maps; CHANGE NAME is refused", async () => {
    const game = await gameServer(GAME);
    const userId = fakeCrazyGamesUserId("Old_Name");
    const before = await signedIn(await game.post("/auth/crazygames", { token: fake.mint("Old_Name") }));
    const mapId = "map-0c00000001";
    expect((await game.post("/maps", newMapDoc(mapId, before.player.id, before.player.name, "CG MAP", 1), before.session)).status).toBe(200);
    const after = await signedIn(await game.post("/auth/crazygames", { token: fake.mint("New_Name", { payload: { userId } }) }));
    expect(after.player).toMatchObject({ id: before.player.id, name: "New_Name" });
    expect(((await (await game.get("/me", before.session)).json()) as { player: Player }).player.name).toBe("New_Name");
    const maps = ((await (await game.get("/maps", after.session)).json()) as { maps: { id: string; ownerName: string }[] }).maps;
    expect(maps.find((m) => m.id === mapId)?.ownerName).toBe("New_Name");
    const rename = await game.post("/me/name", { name: "PICKED" }, after.session);
    expect(rename.status).toBe(403);
    expect((await rename.json()).error).toBe("your name is your CrazyGames username");
  });

  it("from a guest's session moves what the guest made to the CrazyGames player and ends the guest", async () => {
    const game = await gameServer(GAME);
    const guest = await signedIn(await game.post("/auth/guest", {}));
    const made: LibraryEntry = {
      id: "gen-cgguest-1", owner: guest.player.id, status: "ready", stage: "", error: null, name: "STICK", tagline: "t", description: "d",
      drawingUrl: "/gen/drawings/gen-cgguest-1.png", bundleUrl: "/gen/gen-cgguest-1/bundle.json", sheetUrl: null, createdAt: 1, origin: "creator", public: true,
    };
    upsertCharacter(made, guest.player);
    const cg = await signedIn(await game.post("/auth/crazygames", { token: fake.mint("Bea_Stub") }, guest.session));
    expect(cg.player.id).toBe(`crazygames-${fakeCrazyGamesUserId("Bea_Stub")}`);
    const lib = ((await (await game.get("/library", cg.session)).json()) as { characters: LibraryEntry[] }).characters;
    expect(lib.find((c) => c.id === made.id)).toMatchObject({ owner: cg.player.id });
    expect((await game.get("/me", guest.session)).status).toBe(401);
    expect(fs.existsSync(path.join(game.dataDir, "players", `${guest.player.id}.json`))).toBe(false);
  });

  it("refuses tokens that don't check out, and asks for the keys again when a token names a new one", async () => {
    let served = 0;
    const keyServer = express().get("/jwks", (_req, res) => { served++; res.json({ keys }); }).listen(0, "127.0.0.1");
    servers.push(keyServer);
    await new Promise<void>((r) => keyServer.once("listening", () => r()));
    const game = await gameServer(GAME, `http://127.0.0.1:${(keyServer.address() as { port: number }).port}/jwks`);
    expect(await refused(await game.post("/auth/crazygames", { token: fake.mint("Ann_Stub", { payload: { gameId: "another" } }) }))).toBe("CrazyGames sign-in refused: token is for game another, not this one");
    expect(served).toBe(1);
    expect(await refused(await game.post("/auth/crazygames", { token: fake.mint("Ann_Stub", { header: { kid: "next-key" } }) }))).toBe("CrazyGames sign-in refused: no CrazyGames key next-key");
    expect(served).toBe(2);
    // another unknown key within the minute doesn't ask again
    expect(await refused(await game.post("/auth/crazygames", { token: fake.mint("Ann_Stub", { header: { kid: "after-that" } }) }))).toBe("CrazyGames sign-in refused: no CrazyGames key after-that");
    expect(served).toBe(2);
    expect((await game.post("/auth/crazygames", {})).status).toBe(400);
  });

  it("fails loud without CRAZYGAMES_GAME_ID, and when CrazyGames' keys can't be had", async () => {
    const unset = await gameServer(null);
    const res = await unset.post("/auth/crazygames", { token: fake.mint("Ann_Stub") });
    expect(res.status).toBe(500);
    expect((await res.json()).error).toMatch(/CRAZYGAMES_GAME_ID is not set/);
    const keyless = await gameServer(GAME, `${fake.url}/nothing-here`);
    const down = await keyless.post("/auth/crazygames", { token: fake.mint("Ann_Stub") });
    expect(down.status).toBe(502);
    expect((await down.json()).error).toMatch(/said 404/);
  });
});
