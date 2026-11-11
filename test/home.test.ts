import { afterAll, beforeAll, describe, expect, it } from "vitest";
import http from "node:http";
import express from "express";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { initLibrary } from "../server/library";
import { attachHome } from "../server/home";

let server: http.Server, port: number, dataDir: string;
const get = (p: string) => fetch(`http://127.0.0.1:${port}${p}`, { redirect: "manual" });

const ready = (id: string, owner: string, createdAt: number, extra: object = {}) => ({
  id, owner, status: "ready", stage: "", error: null, name: id.toUpperCase(), tagline: `${id} tagline`, description: "d",
  drawingUrl: `/sb/gen/drawings/${id}.png`, bundleUrl: `/sb/gen/${id}/v1/bundle.json`, sheetUrl: null, createdAt, origin: "creator", ...extra,
});

beforeAll(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "sb-home-"));
  fs.mkdirSync(path.join(dataDir, "players"));
  const file = (owner: string, characters: ReturnType<typeof ready>[]) => {
    fs.writeFileSync(path.join(dataDir, "players", `${owner}.json`), JSON.stringify({ player: { id: owner, name: `Player ${owner}`, avatar: null }, lastPlayed: null, characters, saved: [] }));
    for (const c of characters) {
      fs.mkdirSync(path.join(dataDir, "gen", c.id, "v1"), { recursive: true });
      fs.writeFileSync(path.join(dataDir, "gen", c.id, "v1", "idle.png"), `idle of ${c.id}`);
    }
  };
  file("dev-ann", [ready("gen-ann1", "dev-ann", 2, { name: `<b>"ANN" & co</b>` }), ready("gen-ann2", "dev-ann", 3)]);
  file("dev-bob", [ready("gen-bob", "dev-bob", 1)]);
  file("dev-cal", [ready("gen-held", "dev-cal", 4, { held: true })]);
  file("dev-dee", [ready("gen-private", "dev-dee", 5, { public: false }), ready("gen-gone", "dev-dee", 6, { deleted: true })]);
  file("guest-zed", [ready("gen-guest", "guest-zed", 7)]);
  initLibrary(dataDir);
  const app = express();
  attachHome(app, { base: "/sb", genDir: path.join(dataDir, "gen") });
  server = http.createServer(app).listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", () => r()));
  port = (server.address() as { port: number }).port;
});
afterAll(() => { server.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });

describe("the landing page", () => {
  it("shows only listed characters, one per creator, escaped", async () => {
    const html = await (await get("/sb/home/")).text();
    const strip = [...html.matchAll(/fighters\/([\w-]+)\.png/g)].map((m) => m[1]);
    expect(strip.sort()).toEqual(["gen-ann2", "gen-bob"]);
    for (const hidden of ["gen-held", "gen-private", "gen-gone", "gen-guest", "Player dev-"]) expect(html).not.toContain(hidden);
    expect(html).not.toContain(`<b>"ANN"`);
  });

  it("serves a listed character's idle cell and nothing of a held, private, deleted or guest one", async () => {
    expect(await (await get("/home/fighters/gen-bob.png")).text()).toBe("idle of gen-bob");
    for (const id of ["gen-held", "gen-private", "gen-gone", "gen-guest", "..%2Fgen-bob"]) expect((await get(`/sb/home/fighters/${id}.png`)).status).toBe(404);
  });

  it("has the search and sharing tags, and JSON-LD that parses", async () => {
    const html = await (await get("/home/")).text();
    expect(html).toContain(`<link rel="canonical" href="https://supersketchdudes.com/">`);
    expect(html).toContain(`<meta property="og:image" content="https://supersketchdudes.com/og.jpg">`);
    expect(html).toMatch(/<h1>/);
    expect(html).toContain(`href="https://supersketchdudes.com/play/?ref=home"`);
    const ld = JSON.parse(/<script type="application\/ld\+json">(.*?)<\/script>/s.exec(html)![1]);
    expect(ld).toMatchObject({ "@context": "https://schema.org", "@type": "VideoGame", url: "https://supersketchdudes.com/", offers: { price: "0" } });
    expect(html).not.toMatch(/forge/i);
  });

  it("sends the bare path to the trailing slash, where the relative URLs work", async () => {
    for (const p of ["/home", "/sb/home"]) {
      const r = await get(p);
      expect(r.status).toBe(301);
      expect(r.headers.get("location")).toBe("/sb/home/");
    }
  });
});
