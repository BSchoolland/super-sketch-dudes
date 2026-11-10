import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Server } from "node:http";
import { attachAuth } from "../server/auth";
import { initLibrary } from "../server/library";
// @ts-expect-error a plain .mjs script, no types
import { fakeUserId, startFakeDiscord } from "../scripts/fake-discord.mjs";

/** The Activity's sign-in: a code from the Embedded App SDK, exchanged with the client secret, against a fake Discord. */
const SECRET = "test-client-secret";
let discord: { api: string; exchanges: Record<string, string>[]; close(): void };
const servers: Server[] = [];
const dirs: string[] = [];

async function gameServer(clientSecret: string | null): Promise<(p: string, body: unknown) => Promise<Response>> {
  const app = express();
  const api = express.Router();
  api.use(express.json());
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "activity-auth-"));
  dirs.push(dataDir);
  initLibrary(dataDir);
  attachAuth(api, { dataDir, devLogin: false, botKey: null, discord: { api: discord.api, clientSecret } });
  app.use("/api", api);
  const server = app.listen(0, "127.0.0.1");
  servers.push(server);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const port = (server.address() as { port: number }).port;
  return (p, body) => fetch(`http://127.0.0.1:${port}/api${p}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

beforeAll(async () => { discord = await startFakeDiscord({ secret: SECRET }); });
afterAll(() => {
  discord.close();
  for (const s of servers) s.close();
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
});

describe("Discord Activity sign-in", () => {
  it("trades the SDK's code for the same player the website's Discord sign-in makes", async () => {
    const post = await gameServer(SECRET);
    const res = await post("/auth/discord/activity", { code: "stub-Ann" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.player).toEqual({ id: fakeUserId("Ann"), name: "Ann", avatar: null });
    expect(typeof body.session).toBe("string");
    // the website's implicit grant hands the server an access token for the same Discord user
    const web = await (await post("/auth/discord", { accessToken: "fake-Ann" })).json();
    expect(web.player).toEqual(body.player);
  });

  it("exchanges with the app's id and secret and no redirect_uri, as the Activity's authorize had none", async () => {
    const post = await gameServer(SECRET);
    discord.exchanges.length = 0;
    expect((await post("/auth/discord/activity", { code: "stub-Bob" })).status).toBe(200);
    expect(discord.exchanges).toEqual([{ client_id: "1506034935838937201", client_secret: SECRET, grant_type: "authorization_code", code: "stub-Bob" }]);
  });

  it("says so when Discord refuses the code, and wants a code at all", async () => {
    const post = await gameServer(SECRET);
    const refused = await post("/auth/discord/activity", { code: "not a code" });
    expect(refused.status).toBe(401);
    expect((await refused.json()).error).toMatch(/^discord refused the code: 400/);
    expect((await post("/auth/discord/activity", {})).status).toBe(400);
  });

  it("fails loud without DISCORD_CLIENT_SECRET instead of trying the exchange", async () => {
    const post = await gameServer(null);
    discord.exchanges.length = 0;
    const res = await post("/auth/discord/activity", { code: "stub-Ann" });
    expect(res.status).toBe(500);
    expect((await res.json()).error).toMatch(/DISCORD_CLIENT_SECRET is not set/);
    expect(discord.exchanges).toEqual([]);
  });
});
