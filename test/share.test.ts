import { afterAll, beforeAll, describe, expect, it } from "vitest";
import http from "node:http";
import express from "express";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { attachAuth } from "../server/auth";
import { attachForge } from "../server/forge";
import { attachCharacters } from "../server/characters";
import { attachShareApi, attachSharePages } from "../server/share";
import { initLibrary, saveCharacter, setHeld, upsertCharacter, findCharacter } from "../server/library";
import { initEvents } from "../server/events";
import { funnel, shareFunnel, sharedFighterOf } from "../server/funnel";
import type { StoredEvent } from "../server/eventlog";
import type { Arrival, VisitSource } from "../shared/source";
import { visitSource } from "../client/src/telemetry/source";
import { SHARE_COPY, shareLink } from "../shared/share";
import type { LibraryEntry } from "../shared/account";

const TOKEN = "t0k";
let server: http.Server, port: number, dataDir: string;
const INDEX = `<!doctype html><html><head><!--front-head--><title>GAME</title><!--/front-head--></head>
<body><canvas id="game"></canvas><!--front-body--><!--/front-body--><script type="module" src="/assets/main.js"></script></body></html>`;
const FONT = path.resolve("client/public/fonts/PatrickHand-Regular.ttf");

const get = (p: string, headers: Record<string, string> = {}) => fetch(`http://127.0.0.1:${port}${p}`, { headers, redirect: "manual" });
const api = (p: string, init: RequestInit & { session?: string; token?: boolean } = {}) => fetch(`http://127.0.0.1:${port}/api${p}`, {
  ...init,
  headers: { "content-type": "application/json", ...(init.token ? { "x-forge-token": TOKEN } : {}), ...(init.session ? { "x-session": init.session } : {}) },
});
const signIn = async (name: string): Promise<{ session: string; player: { id: string } }> => (await api("/auth/dev", { method: "POST", body: JSON.stringify({ name }) })).json();
const guest = async (): Promise<{ session: string; player: { id: string } }> => (await api("/auth/guest", { method: "POST", body: "{}" })).json();

const entry = (id: string, owner: string, extra: Partial<LibraryEntry> = {}): LibraryEntry => ({
  id, owner, status: "ready", stage: "", error: null, name: id.toUpperCase().replace(/-/g, " "), tagline: `${id} hits hard`, description: "d",
  drawingUrl: `/gen/drawings/${id}.png`, bundleUrl: `/gen/${id}/v1/bundle.json`, sheetUrl: null, createdAt: 1, origin: "creator", public: true, ...extra,
});
/** A character on file with the art a card is made from. */
function put(e: LibraryEntry): void {
  fs.mkdirSync(path.join(dataDir, "gen", e.id, "v1"), { recursive: true });
  fs.mkdirSync(path.join(dataDir, "gen", "drawings"), { recursive: true });
  fs.copyFileSync("client/public/house/rocket/idle.png", path.join(dataDir, "gen", e.id, "v1", "idle.png"));
  fs.copyFileSync("client/public/icon.png", path.join(dataDir, "gen", "drawings", `${e.id}.png`));
  upsertCharacter(e, e.owner.startsWith("guest-") ? { id: e.owner, name: "Guest Maker", avatar: null } : undefined);
}

let ann: { session: string; player: { id: string } }, bob: { session: string; player: { id: string } }, staff: { session: string; player: { id: string } };

beforeAll(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "sb-share-"));
  fs.writeFileSync(path.join(dataDir, "staff.json"), JSON.stringify(["dev-staffer"]));
  fs.writeFileSync(path.join(dataDir, "index.html"), INDEX);
  const app = express();
  app.use(express.json());
  const router = express.Router();
  app.use("/api", router);
  initLibrary(dataDir);
  initEvents(dataDir);
  attachAuth(router, { dataDir, devLogin: true, botKey: null, discord: { api: "http://discord.invalid", clientSecret: null }, crazygames: { jwks: "http://crazygames.invalid", gameId: null } });
  attachForge(router, { token: TOKEN, dataDir, genBase: "/gen" });
  attachShareApi(router, TOKEN);
  attachCharacters(router, TOKEN, dataDir);
  attachSharePages(app, { at: (p) => [p, `/sb${p}`], base: "/sb/", indexFile: path.join(dataDir, "index.html"), files: { genDir: path.join(dataDir, "gen"), cardDir: path.join(dataDir, "cards"), fontFile: FONT } });
  server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  port = (server.address() as { port: number }).port;
  ann = await signIn("Ann");
  bob = await signIn("Bob");
  staff = await signIn("Staffer");
  put(entry("gen-ann-ok", ann.player.id, { name: `<b>"ANN" & CO</b>` }));
  put(entry("gen-ann-held", ann.player.id, { held: true }));
  put(entry("gen-ann-private", ann.player.id, { public: false }));
  put(entry("gen-ann-deleted", ann.player.id, { deleted: true }));
  put(entry("gen-ann-queued", ann.player.id, { status: "queued", bundleUrl: null }));
  put(entry("gen-ann-failed", ann.player.id, { status: "failed", bundleUrl: null, error: "nope" }));
  put(entry("gen-ann-later", ann.player.id));
  put(entry("gen-guest", "guest-0123456789abcdef01"));
  put(entry("gen-bob", bob.player.id));
});
afterAll(() => { server.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });

const UNSHAREABLE = ["gen-ann-held", "gen-ann-private", "gen-ann-deleted", "gen-ann-queued", "gen-ann-failed", "gen-nobody", "bad%20id", "gen-ann-ok.."];

describe("a character's page", () => {
  it("is the game page with the character's title, tagline, canonical, card and JSON-LD, escaped, at every address", async () => {
    for (const p of ["/c/gen-ann-ok", "/sb/c/gen-ann-ok", "/c/gen-ann-ok?ref=share"]) {
      const res = await get(p);
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("no-cache");
      const html = await res.text();
      expect(html).toContain(`<title>&#60;b&#62;&#34;ANN&#34; &#38; CO&#60;/b&#62; · Super Sketch Dudes</title>`);
      expect(html).toContain(`<meta property="og:description" content="gen-ann-ok hits hard" />`);
      expect(html).toContain(`<link rel="canonical" href="https://supersketchdudes.com/c/gen-ann-ok" />`);
      expect(html).toMatch(/<meta property="og:image" content="https:\/\/supersketchdudes.com\/c\/gen-ann-ok\/card.png\?v=[0-9a-f]{10}" \/>/);
      expect(html).toMatch(/<meta name="twitter:image" content="https:\/\/supersketchdudes.com\/c\/gen-ann-ok\/card.png\?v=[0-9a-f]{10}" \/>/);
      expect(html).toContain(`<meta name="twitter:card" content="summary_large_image" />`);
      expect(html).not.toContain(`<b>"ANN"`);
      const ld = JSON.parse(/<script type="application\/ld\+json">(.*?)<\/script>/s.exec(html)![1]);
      expect(ld).toMatchObject({ "@type": "CreativeWork", url: "https://supersketchdudes.com/c/gen-ann-ok", creator: { name: "Ann" }, isPartOf: { "@type": "VideoGame" } });
      expect(html.indexOf(`<canvas id="game">`)).toBeLessThan(html.indexOf(`<div id="about">`));
      // the about sections are there, hidden until the title's tab opens them
      expect(html).toContain("#about { display: none;");
    }
  });

  it("has a 1200x630 PNG card, made once and kept", async () => {
    const res = await get("/c/gen-ann-ok/card.png");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("etag")).toBeNull();
    const meta = await sharp(Buffer.from(await res.arrayBuffer())).metadata();
    expect([meta.width, meta.height]).toEqual([1200, 630]);
    const files = fs.readdirSync(path.join(dataDir, "cards"));
    expect(files.filter((f) => f.startsWith("gen-ann-ok-"))).toHaveLength(1);
    expect((await get("/sb/c/gen-ann-ok/card.png")).status).toBe(200);
    expect(fs.readdirSync(path.join(dataDir, "cards"))).toEqual(files);
  });

  it("is a new card when the character changes, and the old one goes", async () => {
    const before = fs.readdirSync(path.join(dataDir, "cards")).filter((f) => f.startsWith("gen-ann-later-"));
    expect((await get("/c/gen-ann-later/card.png")).status).toBe(200);
    const first = fs.readdirSync(path.join(dataDir, "cards")).filter((f) => f.startsWith("gen-ann-later-"));
    expect(before).toHaveLength(0);
    expect(first).toHaveLength(1);
    upsertCharacter({ ...findCharacter("gen-ann-later")!, name: "RENAMED" });
    expect(await (await get("/c/gen-ann-later")).text()).toContain("<title>RENAMED · Super Sketch Dudes</title>");
    expect((await get("/c/gen-ann-later/card.png")).status).toBe(200);
    const second = fs.readdirSync(path.join(dataDir, "cards")).filter((f) => f.startsWith("gen-ann-later-"));
    expect(second).toHaveLength(1);
    expect(second).not.toEqual(first);
  });

  it("is a guest's too", async () => {
    expect((await get("/c/gen-guest")).status).toBe(200);
    expect((await get("/c/gen-guest/card.png")).status).toBe(200);
  });

  it("is a plain 404 with no card for anything held, private, deleted, unfinished or missing", async () => {
    for (const id of UNSHAREABLE) {
      const page = await get(`/c/${id}`);
      expect(page.status, id).toBe(404);
      const html = await page.text();
      expect(html).toContain(SHARE_COPY.notFoundHeading.replace("'", "&#39;"));
      expect(html).toContain(`href="/sb/"`);
      expect(html).not.toContain("og:image");
      expect(html).not.toContain("gen-ann");
      expect((await get(`/c/${id}/card.png`)).status, id).toBe(404);
    }
    expect(fs.readdirSync(path.join(dataDir, "cards")).some((f) => f.startsWith("gen-ann-held"))).toBe(false);
  });

  it("stops at once when a moderator holds it, comes back on release, and is gone for good on a take-down", async () => {
    put(entry("gen-bob-2", bob.player.id));
    expect((await get("/c/gen-bob-2/card.png")).status).toBe(200);
    expect((await api("/characters/gen-bob-2/hold", { method: "POST", token: true })).status).toBe(204);
    expect((await get("/c/gen-bob-2")).status).toBe(404);
    expect((await get("/c/gen-bob-2/card.png")).status).toBe(404);
    expect(fs.readdirSync(path.join(dataDir, "cards")).some((f) => f.startsWith("gen-bob-2-"))).toBe(false);
    expect((await api("/characters/shared/gen-bob-2")).status).toBe(404);
    expect((await api("/characters/gen-bob-2/release", { method: "POST", token: true })).status).toBe(204);
    expect((await get("/c/gen-bob-2")).status).toBe(200);
    expect((await get("/c/gen-bob-2/card.png")).status).toBe(200);
    expect((await api("/characters/gen-bob-2/take-down", { method: "POST", token: true })).status).toBe(204);
    expect((await get("/c/gen-bob-2")).status).toBe(404);
    expect((await get("/c/gen-bob-2/card.png")).status).toBe(404);
  });

  it("stops when its owner makes it private", async () => {
    put(entry("gen-bob-3", bob.player.id));
    expect((await get("/c/gen-bob-3")).status).toBe(200);
    expect((await api("/library/gen-bob-3", { method: "PATCH", session: bob.session, body: JSON.stringify({ public: false }) })).status).toBe(200);
    expect((await get("/c/gen-bob-3")).status).toBe(404);
    expect((await get("/c/gen-bob-3/card.png")).status).toBe(404);
  });
});

describe("the game's shared character", () => {
  it("is any shareable character, saveable only when COMMUNITY lists it", async () => {
    const listed = (await (await api("/characters/shared/gen-ann-ok", { session: bob.session })).json()).character;
    expect(listed).toMatchObject({ id: "gen-ann-ok", saveable: true, mine: false, saved: false, creator: { name: "Ann" } });
    const guests = (await (await api("/characters/shared/gen-guest", { session: bob.session })).json()).character;
    expect(guests).toMatchObject({ id: "gen-guest", saveable: false, mine: false });
    expect((await (await api("/characters/shared/gen-ann-ok", { session: ann.session })).json()).character.mine).toBe(true);
    saveCharacter(bob.player.id, "gen-ann-ok");
    expect((await (await api("/characters/shared/gen-ann-ok", { session: bob.session })).json()).character.saved).toBe(true);
    const anyone = await api("/characters/shared/gen-ann-ok");
    expect(anyone.status).toBe(200);
    for (const id of UNSHAREABLE) expect((await api(`/characters/shared/${id}`)).status, id).toBe(404);
  });
});

describe("the feature opt-in", () => {
  const videos = async (o: { session?: string; token?: boolean }) => api("/characters/videos", o);
  const ids = async (): Promise<string[]> => ((await (await videos({ token: true })).json()).characters as { id: string }[]).map((c) => c.id);
  const feature = (id: string, on: unknown, session: string) => api(`/library/${id}`, { method: "PATCH", session, body: JSON.stringify({ feature: on }) });

  it("is off by default, and only the owner of an account can turn it on", async () => {
    expect(await ids()).toEqual([]);
    expect((await feature("gen-ann-ok", true, bob.session)).status).toBe(404);
    expect((await feature("gen-ann-ok", "yes", ann.session)).status).toBe(400);
    expect((await api("/library/gen-ann-ok", { method: "PATCH", session: ann.session, body: JSON.stringify({ feature: true, public: true }) })).status).toBe(400);
    expect((await api("/library/gen-ann-ok", { method: "PATCH", body: JSON.stringify({ feature: true }) })).status).toBe(401);
    const g = await guest();
    put(entry("gen-guest-own", g.player.id));
    expect((await feature("gen-guest-own", true, g.session)).status).toBe(403);
    const on = await feature("gen-ann-ok", true, ann.session);
    expect(on.status).toBe(200);
    expect((await on.json()).character.feature).toBe(true);
    expect(await ids()).toEqual(["gen-ann-ok"]);
  });

  it("lists the owner's name, the character's name and tagline, and its art, for the token or a staff account only", async () => {
    expect((await videos({})).status).toBe(401);
    expect((await videos({ session: bob.session })).status).toBe(403);
    const list = (await (await videos({ session: staff.session })).json()).characters;
    expect(list).toEqual([{
      id: "gen-ann-ok", name: `<b>"ANN" & CO</b>`, tagline: "gen-ann-ok hits hard", owner: "Ann", page: "https://supersketchdudes.com/c/gen-ann-ok",
      art: {
        idle: "https://supersketchdudes.com/gen/gen-ann-ok/v1/idle.png", drawing: "https://supersketchdudes.com/gen/drawings/gen-ann-ok.png",
        card: expect.stringMatching(/^https:\/\/supersketchdudes.com\/c\/gen-ann-ok\/card.png\?v=[0-9a-f]{10}$/),
        bundle: "https://supersketchdudes.com/gen/gen-ann-ok/v1/bundle.json", sheet: null,
      },
    }]);
  });

  it("keeps through the character's updates, leaves the list while it isn't shareable, and is gone the moment it's withdrawn", async () => {
    upsertCharacter({ ...findCharacter("gen-ann-ok")!, feature: undefined, tagline: "a new tagline" });
    expect(findCharacter("gen-ann-ok")!.feature).toBe(true);
    setHeld("gen-ann-ok", true);
    expect(await ids()).toEqual([]);
    setHeld("gen-ann-ok", false);
    expect(await ids()).toEqual(["gen-ann-ok"]);
    expect((await feature("gen-ann-ok", false, ann.session)).status).toBe(200);
    expect(await ids()).toEqual([]);
    expect(findCharacter("gen-ann-ok")!.feature).toBeUndefined();
  });
});

describe("share attribution", () => {
  const T0 = Date.UTC(2026, 10, 1, 15);
  const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/156.0.0.0 Safari/537.36";
  let n = 0;
  const arrival = (landing: string, ref: string | null, at: number): Arrival => ({ referrer: null, ref, utm: { source: null, medium: null, campaign: null }, landing, at });
  const session = (trace: string, player: string, first: Arrival, business: Record<string, unknown> = {}): StoredEvent => ({
    at: "", id: `e${++n}`, kind: "session", source: "client", trace, parent: null, level: "info", headline: null, t0: T0, t1: T0 + 60_000, seq: 3, final: true, issues: [],
    business: { source: { visit: { ...first, session: trace }, first } satisfies VisitSource, screens: [["CommunityScreen", 0], ["LoadingScreen", 1], ["VersusScreen", 2]], ...business },
    client: { session: trace, build: "dev", bundle: "", ua: UA, w: 1280, h: 720, dpr: 1, player: { id: player, name: player } },
  });

  it("a share link's arrival records ref=share and the character's page", () => {
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) } as Storage;
    const s = visitSource({ referrer: "https://discord.com/channels/1/2", url: shareLink("https://supersketchdudes.com/", "gen-ann-ok") }, storage, storage, "s-abc", T0, () => { throw new Error("no bad storage"); });
    expect(s.first).toMatchObject({ ref: "share", landing: "/c/gen-ann-ok", referrer: "discord.com" });
    expect(sharedFighterOf(s.first.landing)).toBe("gen-ann-ok");
    expect(sharedFighterOf("/sb/c/gen-x")).toBe("gen-x");
    expect(sharedFighterOf("/")).toBeNull();
  });

  it("share arrivals are their own source in the funnel, and counted per character with its shares", () => {
    const events = [
      session("s-ann", "email-ann", arrival("/", null, T0 - 86_400_000), { shares: [{ fighter: "gen-ann-ok", mine: true, how: "copy" }, { fighter: "gen-ann-ok", mine: true, how: "sheet" }] }),
      session("s-bob", "email-bob", arrival("/", null, T0), { shares: [{ fighter: "gen-ann-ok", mine: false, how: "copy" }] }),
      session("s-new1", "guest-1", arrival("/c/gen-ann-ok", "share", T0)),
      session("s-new2", "guest-2", arrival("/c/gen-ann-ok", "share", T0)),
      session("s-new3", "guest-3", arrival("/c/gen-bob", "share", T0)),
      // came back through a share link, but first arrived some other way: not a newcomer by it
      session("s-old", "guest-4", arrival("/", null, T0 - 5 * 86_400_000)),
      session("s-staff", "email-staff", arrival("/c/gen-bob", "share", T0)),
    ];
    const f = funnel(events, T0 - 86_400_000 * 2, "UTC", new Set(["email-staff"]));
    expect(f.rows.find((r) => r.source === "share")?.counts).toMatchObject({ arrived: 3, guest: 3, played: 3, bots: 3 });
    expect(shareFunnel(events, T0 - 86_400_000 * 2, new Set(["email-staff"]))).toEqual([
      { fighter: "gen-ann-ok", shares: 3, sharers: 2, newcomers: 2 },
      { fighter: "gen-bob", shares: 0, sharers: 0, newcomers: 1 },
    ]);
  });
});
