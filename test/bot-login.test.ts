import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Server } from "node:http";
import { attachAuth } from "../server/auth";
import { initLibrary } from "../server/library";

const KEY = "test-bot-key";
let server: Server;
let port = 0;
const post = (p: string, body: unknown) => fetch(`http://127.0.0.1:${port}/api${p}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

beforeAll(async () => {
  const app = express();
  const api = express.Router();
  api.use(express.json());
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "bot-login-"));
  initLibrary(dataDir);
  attachAuth(api, { dataDir, devLogin: false, botKey: KEY });
  app.use("/api", api);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", () => r()));
  port = (server.address() as { port: number }).port;
});
afterAll(() => server.close());

describe("bot login", () => {
  it("signs a bot in as a bot account with the key", async () => {
    const res = await post("/auth/bot", { name: "BenchHost", key: KEY });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.player).toEqual({ id: "bot-benchhost", name: "BenchHost", avatar: null });
    expect(body.lastPlayed).toBeNull();
    expect(typeof body.session).toBe("string");
  });
  it("refuses a wrong or missing key", async () => {
    expect((await post("/auth/bot", { name: "BenchHost", key: "nope" })).status).toBe(401);
    expect((await post("/auth/bot", { name: "BenchHost" })).status).toBe(401);
  });
  it("leaves dev login off", async () => {
    expect((await post("/auth/dev", { name: "Ben" })).status).toBe(404);
  });
});
