// Character pages and sharing end to end on the built server (server/share.ts, client/src/share.ts). Builds, starts
// dist/server.mjs on a scratch data dir with made-up characters (listed ones, a guest's, a held one, a private one), then:
//   1. A link unfurler reads a character's page: title, description, canonical, og/twitter tags, JSON-LD; the card is a
//      1200x630 PNG (saved for looking at). Anything held, private or missing is a 404 with no card.
//   2. A guest opens the share link on a desktop: the game opens on the character's page (SAVE, PRACTICE; no SHARE on
//      someone else's character). Their session records ref=share and the character's page.
//   3. A guest's own character's link opens its page too (no SAVE: COMMUNITY doesn't list it).
//   4. The owner, on MY CHARACTERS: SHARE copies the link, beside the line on what it does.
//   5. A phone (sideways and upright): the link opens the character's page at the screen's width.
// Usage: node scripts/sharecheck.mjs [--shots <dir>]   (screenshots default to /tmp/ssd-share; SERVER_PORT 4810)
import { chromium } from "playwright";
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { viewToCss } from "./lib/view.mjs";

const SERVER_PORT = Number(process.env.SERVER_PORT ?? 4810);
const TOKEN = "share-check-token";
const shotsAt = process.argv.indexOf("--shots");
const shots = shotsAt > 0 ? process.argv[shotsAt + 1] : "/tmp/ssd-share";
fs.mkdirSync(shots, { recursive: true });
const data = fs.mkdtempSync(path.join(os.tmpdir(), "sharecheck-"));
const site = `http://localhost:${SERVER_PORT}`;
const LIVE = "https://supersketchdudes.com/";
const fail = (message) => { throw new Error(message); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PHONE = { viewport: { width: 844, height: 390 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36" };
const UPRIGHT = { ...PHONE, viewport: { width: 390, height: 844 } };
const DESKTOP = { viewport: { width: 1280, height: 720 } };
const SETTINGS = () => { localStorage.setItem("sketchbattle.settings", JSON.stringify({ cpuTier: 1, volume: 0, music: 0 })); localStorage.setItem("sketchbattle.mobileNote", "1"); };

const HOUSE = ["rocket", "slugbert", "wizard", "woodstove"];
/** Characters drawn like house fighters: [id, owner, name, tagline, extra]. */
const MADE = [
  ["gen-maker0-0", "dev-maker0", "TEAPOT TITAN", "Pours scalding justice.", {}],
  ["gen-maker1-0", "dev-maker1", "SIR SLUG", "Slow, sticky, unstoppable.", {}],
  ["gen-maker2-0", "dev-maker2", "CAPTAIN SPAGHETTI THE MAGNIFICENT", "Twirls you off the stage.", {}],
  ["gen-guest-0", "guest-00112233445566778899", "STOVE BOY", "Hot hands, warm heart.", {}],
  ["gen-held-0", "dev-maker1", "HELD ONE", "Nobody sees this.", { held: true }],
  ["gen-private-0", "dev-maker2", "SECRET ONE", "Kept to myself.", { public: false }],
  ["gen-dummy-0", "dev-maker3", "DUMMY", "Stands there.", {}],
];
function seed() {
  fs.mkdirSync(path.join(data, "players"));
  fs.mkdirSync(path.join(data, "gen", "drawings"), { recursive: true });
  const players = new Map();
  MADE.forEach(([id, owner, name, tagline, extra], i) => {
    const dir = path.join(data, "gen", id, "0badf00d");
    fs.mkdirSync(dir, { recursive: true });
    const from = path.join("client/public/house", HOUSE[i % HOUSE.length]);
    for (const f of fs.readdirSync(from)) fs.copyFileSync(path.join(from, f), path.join(dir, f));
    // the house fighter's bundle, as this character: its id is the roster key it loads under
    const bundle = JSON.parse(fs.readFileSync(path.join(dir, "bundle.json"), "utf8"));
    fs.writeFileSync(path.join(dir, "bundle.json"), JSON.stringify({ ...bundle, id, name }));
    fs.copyFileSync(path.join(from, "idle.png"), path.join(data, "gen", "drawings", `${id}.png`));
    const c = { id, owner, status: "ready", stage: "", error: null, name, tagline, description: "d", drawingUrl: `/gen/drawings/${id}.png`, bundleUrl: `/gen/${id}/0badf00d/bundle.json`, sheetUrl: null, createdAt: 1000 + i, origin: "creator", public: true, ...extra };
    if (!players.has(owner)) players.set(owner, { player: { id: owner, name: owner.startsWith("guest-") ? "Quiet Otter" : `Maker ${owner.slice(-1)}`, avatar: null }, lastPlayed: { version: "0.2.0", at: Date.now() }, characters: [], saved: [] });
    players.get(owner).characters.push(c);
  });
  for (const [owner, rec] of players) fs.writeFileSync(path.join(data, "players", `${owner}.json`), JSON.stringify(rec));
  fs.writeFileSync(path.join(data, "dummy.json"), JSON.stringify("gen-dummy-0"));
  fs.writeFileSync(path.join(data, "staff.json"), JSON.stringify([]));
}

const toCss = (page, vx, vy) => { const v = page.viewportSize(); return viewToCss(v, v.height > v.width, vx, vy); };
const screenName = (p) => p.evaluate(() => window.sketchbattle?.screen?.constructor.name);
/** The game opened on the shared character: its page with its buttons laid out. */
const onCharacter = (p, id) => p.waitForFunction((id) => {
  const s = window.sketchbattle?.screen;
  return s?.constructor.name === "CommunityScreen" && s.selected?.id === id;
}, id, { timeout: 30000 });
/** A button of the screen's detail, in view pixels. */
const detailButton = (p, id) => p.evaluate((id) => {
  const s = window.sketchbattle.screen;
  const b = s.detailButtons(s.selected).find((x) => x.id === id);
  return b ? { x: b.x + b.w / 2, y: b.y + b.h / 2, disabled: !!b.disabled } : null;
}, id);
/** The tags a link unfurler reads, from the page's head. */
function tags(html) {
  const meta = {};
  for (const m of html.matchAll(/<meta (?:property|name)="([^"]+)" content="([^"]*)"/g)) meta[m[1]] = m[2];
  return { meta, title: /<title>([^<]*)<\/title>/.exec(html)?.[1], canonical: /<link rel="canonical" href="([^"]+)"/.exec(html)?.[1], ld: /<script type="application\/ld\+json">(.*?)<\/script>/s.exec(html)?.[1] };
}

/** From the title, MY CHARACTERS by the keys, and the first character in it big. */
async function ownCharacter(owner) {
  const lib = await owner.evaluate(() => window.sketchbattle.screen.items.findIndex((it) => it.id === "library"));
  if (lib < 0) fail("the title has no MY CHARACTERS");
  for (let n = 0; n < 12; n++) {
    const sel = await owner.evaluate(() => window.sketchbattle.screen.sel);
    if (sel === lib) break;
    await owner.keyboard.press("ArrowDown");
    await owner.waitForFunction((sel) => window.sketchbattle.screen.sel !== sel, sel, { timeout: 5000 });
  }
  await owner.keyboard.press("Enter");
  await owner.waitForFunction(() => window.sketchbattle.screen.constructor.name === "LibraryScreen" && (window.sketchbattle.screen.entries ?? []).length > 0, null, { timeout: 10000 });
  const first = await owner.evaluate(() => window.sketchbattle.screen.entries[0].id);
  if (first !== "gen-maker0-0") fail(`MY CHARACTERS starts with ${first}`);
  await owner.keyboard.press("Enter");
}

let server, browser;
const errors = [];
try {
  execFileSync("npm", ["run", "build"], { stdio: "ignore" });
  seed();
  server = spawn("node", ["dist/server.mjs"], { env: { ...process.env, PORT: String(SERVER_PORT), SKETCHBATTLE_DATA: data, DEV_LOGIN: "1", FORGE_TOKEN: TOKEN }, stdio: ["ignore", "ignore", "inherit"] });
  for (let i = 0; !(await fetch(`${site}/api/health`).then((r) => r.ok, () => false)); i++) { if (i > 100) fail("the server never came up"); await sleep(100); }

  console.log("1. the link unfurls");
  for (const [id, , name, tagline] of MADE.slice(0, 4)) {
    const res = await fetch(`${site}/c/${id}?ref=share`, { headers: { "user-agent": "Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)" } });
    if (res.status !== 200) fail(`${id}: ${res.status}`);
    const t = tags(await res.text());
    const want = {
      "og:title": `${name} · Super Sketch Dudes`, "twitter:title": `${name} · Super Sketch Dudes`, "og:description": tagline, description: tagline, "twitter:description": tagline,
      "og:url": `${LIVE}c/${id}`, "twitter:card": "summary_large_image", "og:image:width": "1200", "og:image:height": "630", "og:image:type": "image/png",
    };
    for (const [k, v] of Object.entries(want)) if (t.meta[k] !== v) fail(`${id}: ${k} is ${JSON.stringify(t.meta[k])}, not ${JSON.stringify(v)}`);
    if (t.title !== `${name} · Super Sketch Dudes`) fail(`${id}: title ${t.title}`);
    if (t.canonical !== `${LIVE}c/${id}`) fail(`${id}: canonical ${t.canonical}`);
    if (t.meta["og:image"] !== t.meta["twitter:image"] || !t.meta["og:image"].startsWith(`${LIVE}c/${id}/card.png?v=`)) fail(`${id}: og:image ${t.meta["og:image"]}`);
    const ld = JSON.parse(t.ld);
    if (ld["@type"] !== "CreativeWork" || ld.name !== name || ld.image !== t.meta["og:image"]) fail(`${id}: JSON-LD ${t.ld}`);
    const card = await fetch(t.meta["og:image"].replace(LIVE, `${site}/`));
    if (card.status !== 200 || card.headers.get("content-type") !== "image/png") fail(`${id}'s card: ${card.status} ${card.headers.get("content-type")}`);
    const png = Buffer.from(await card.arrayBuffer());
    const m = await sharp(png).metadata();
    if (m.width !== 1200 || m.height !== 630) fail(`${id}'s card is ${m.width}x${m.height}`);
    fs.writeFileSync(path.join(shots, `card-${id}.png`), png);
  }
  for (const id of ["gen-held-0", "gen-private-0", "gen-nobody"]) {
    const page = await fetch(`${site}/c/${id}`);
    const html = await page.text();
    if (page.status !== 404 || html.includes("og:image") || html.includes(id)) fail(`${id}: ${page.status}, a card or its id on the page`);
    if ((await fetch(`${site}/c/${id}/card.png`)).status !== 404) fail(`${id}'s card answers`);
  }
  console.log(`  4 pages with their tags and 1200x630 cards (${shots}/card-*.png); held, private and missing ones are 404 with no card`);

  browser = await chromium.launch();
  async function page(name, device, extra = {}) {
    const ctx = await browser.newContext({ ...device, ...extra });
    const p = await ctx.newPage();
    p.on("pageerror", (e) => errors.push(`${name}: ${e.message}`));
    // the 404 page's own status is the one console error it should have
    p.on("console", (m) => { if (m.type() === "error" && !(name === "404" && /status of 404/.test(m.text()))) errors.push(`${name} console: ${m.text()}`); });
    await p.addInitScript(SETTINGS);
    return p;
  }
  const missing = await page("404", DESKTOP);
  await missing.goto(`${site}/c/gen-held-0`);
  await missing.screenshot({ path: path.join(shots, "404.png") });
  await missing.click("a");
  await missing.waitForFunction(() => location.pathname === "/" && window.sketchbattle?.screen, null, { timeout: 30000 });
  console.log("  the 404 page's link goes to the game");

  console.log("2. a guest follows the link");
  const desk = await page("desktop", DESKTOP, { permissions: ["clipboard-read", "clipboard-write"] });
  const shared = "gen-maker2-0";
  await desk.goto(`${site}/c/${shared}?ref=share`);
  await onCharacter(desk, shared);
  const who = await desk.evaluate(() => JSON.parse(localStorage.getItem("sketchbattle.account")).player.id);
  if (!who.startsWith("guest-")) fail(`the visitor is ${who}, not a guest`);
  const visit = await desk.evaluate(() => JSON.parse(sessionStorage.getItem("sketchbattle.visit")));
  if (visit.ref !== "share" || visit.landing !== `/c/${shared}`) fail(`the session's arrival is ${JSON.stringify(visit)}`);
  await sleep(2500);
  await desk.screenshot({ path: path.join(shots, "desktop-1-character.png") });
  const save = await detailButton(desk, "save");
  if (!save || save.disabled) fail("a listed character's page has no SAVE");
  if (!(await detailButton(desk, "practice"))) fail("a character's page has no PRACTICE");
  if (await detailButton(desk, "share")) fail("someone else's character offers SHARE");
  if (await detailButton(desk, "fight")) fail("a character's page still has FIGHT IT");
  console.log(`  ${who} landed on ${shared}'s page: SAVE and PRACTICE, no SHARE on someone else's character`);
  await desk.goto(`${site}/robots.txt`);
  await sleep(1000);
  const events = fs.readFileSync(path.join(data, "events.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  if (!events.some((e) => e.kind === "session" && e.client?.player?.id === who && e.business.source?.first?.ref === "share")) fail("no session event with ref=share");

  console.log("3. a guest's character's link");
  await desk.goto(`${site}/c/gen-guest-0?ref=share`);
  await onCharacter(desk, "gen-guest-0");
  if (await detailButton(desk, "save")) fail("a guest's character offers SAVE (COMMUNITY doesn't list it)");
  console.log("  its page opens, without SAVE");

  console.log("4. the owner's own page: SHARE");
  const owner = await page("owner", DESKTOP, { permissions: ["clipboard-read", "clipboard-write"] });
  await owner.goto(`${site}/c/gen-maker0-0?dev=maker0`);
  await onCharacter(owner, "gen-maker0-0");
  const yours = await detailButton(owner, "save");
  if (!yours?.disabled) fail("your own character's SAVE isn't YOURS");
  await owner.keyboard.press("Escape");
  await owner.waitForFunction(() => window.sketchbattle.screen.constructor.name === "TitleScreen", null, { timeout: 10000 });
  await ownCharacter(owner);
  const libButton = (id) => owner.evaluate((id) => {
    const s = window.sketchbattle.screen;
    const b = s.selected && s.detailButtons(s.selected).find((x) => x.id === id);
    return b ? { x: b.x + b.w / 2, y: b.y + b.h / 2 } : null;
  }, id);
  await owner.waitForFunction(() => { const s = window.sketchbattle.screen; return s.selected && s.detailButtons(s.selected).some((b) => b.id === "share"); }, null, { timeout: 10000 });
  await sleep(2500);
  await owner.screenshot({ path: path.join(shots, "owner-1-library.png") });
  if (await libButton("feature")) fail("MY CHARACTERS still has the video opt-in");
  const ownShare = await libButton("share");
  await owner.mouse.click(...toCss(owner, ownShare.x, ownShare.y));
  await owner.waitForFunction(() => window.sketchbattle.screen.shareNote?.text === "link copied", null, { timeout: 5000 });
  if ((await owner.evaluate(() => navigator.clipboard.readText())) !== `${site}/c/gen-maker0-0?ref=share`) fail("your own SHARE copied something else");
  await owner.screenshot({ path: path.join(shots, "owner-2-copied.png") });
  const ownPhone = await page("owner phone", PHONE);
  await ownPhone.goto(`${site}/?dev=maker0`);
  await ownPhone.waitForFunction(() => window.sketchbattle?.screen?.constructor.name === "TitleScreen", null, { timeout: 30000 });
  await ownCharacter(ownPhone);
  await ownPhone.waitForFunction(() => { const s = window.sketchbattle.screen; return s.selected && s.detailButtons(s.selected).some((b) => b.id === "share"); }, null, { timeout: 10000 });
  await sleep(2500);
  await ownPhone.screenshot({ path: path.join(shots, "owner-3-phone-library.png") });
  console.log("  MY CHARACTERS: SHARE copies the link; no video opt-in");

  console.log("5. phones: the link opens the character's page");
  for (const [name, device] of [["phone", PHONE], ["upright", UPRIGHT]]) {
    const p = await page(name, device);
    await p.goto(`${site}/c/gen-maker1-0?ref=share`);
    await onCharacter(p, "gen-maker1-0");
    await sleep(2500);
    await p.screenshot({ path: path.join(shots, `${name}-1-character.png`) });
    // the page is the screen's width: nothing of the hidden about sections widens it
    const width = await p.evaluate(() => innerWidth);
    if (width !== device.viewport.width) fail(`${name}: the page is ${width} CSS pixels wide on a ${device.viewport.width} screen`);
    console.log(`  ${name}: gen-maker1-0's page, ${width} CSS pixels wide`);
  }

  if (errors.length) fail(`page errors:\n${errors.join("\n")}`);
  console.log(`sharecheck passed; screenshots in ${shots}`);
} catch (e) {
  if (errors.length) console.error(`page errors so far:\n${errors.join("\n")}`);
  let n = 0;
  for (const c of browser?.contexts() ?? []) for (const p of c.pages()) {
    await p.screenshot({ path: path.join(shots, `failed-${++n}.png`) }).catch(() => {});
    console.error(`failed-${n}.png: ${p.url()} on ${await screenName(p).catch(() => "?")}`);
  }
  throw e;
} finally {
  await browser?.close();
  server?.kill();
  fs.rmSync(data, { recursive: true, force: true });
}
