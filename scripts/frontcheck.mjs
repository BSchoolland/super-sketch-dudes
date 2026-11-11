// The front page end to end on the built server (it renders the about sections into the built index.html). Builds,
// starts dist/server.mjs on a scratch data dir with made-up community fighters, then:
//   1. A desktop boots to the title without fetching anything of the about sections; the page doesn't scroll, not
//      even by the wheel.
//   2. The title's tab opens the sections: the page scrolls to them, the keys scroll the page and not the menu, the
//      pictures load; PLAY scrolls back up to the game, which takes the keys again; so does scrolling back up.
//   3. A match: no tab, no scrolling.
//   4. A phone, sideways and upright: the tab by touch, PLAY by touch; a touch match never scrolls the page.
//   5. The addresses: /play/... redirects, /play/gen/ and /gen/ both serve fighters, robots.txt and sitemap.xml.
// Usage: node scripts/frontcheck.mjs [--shots <dir>]   (screenshots default to /tmp/ssd-front-shots; SERVER_PORT 3731)
import { chromium } from "playwright";
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const SERVER_PORT = Number(process.env.SERVER_PORT ?? 3731);
const shotsAt = process.argv.indexOf("--shots");
const shots = shotsAt > 0 ? process.argv[shotsAt + 1] : "/tmp/ssd-front-shots";
fs.mkdirSync(shots, { recursive: true });
const data = fs.mkdtempSync(path.join(os.tmpdir(), "frontcheck-"));
const site = `http://localhost:${SERVER_PORT}`;
const fail = (message) => { throw new Error(message); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PHONE = { viewport: { width: 844, height: 390 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36" };
const UPRIGHT = { ...PHONE, viewport: { width: 390, height: 844 } };
const DESKTOP = { viewport: { width: 1280, height: 720 } };
/** The title's tab, in the 1920x1080 view (client/src/screens/title.ts). */
const TAB = { x: 1920 - 430 + 84, y: 1080 - 22 };
const SETTINGS = () => localStorage.setItem("sketchbattle.settings", JSON.stringify({ cpuTier: 1, volume: 0, music: 0 }));

/** Made-up players, each with one listed character drawn like a house fighter. */
function seed() {
  fs.mkdirSync(path.join(data, "players"));
  const house = ["rocket", "slugbert", "wizard", "woodstove"];
  const made = [["TEAPOT TITAN", "Pours scalding justice."], ["SIR SLUG", "Slow, sticky, unstoppable."], ["MOON WIZ", "Casts the tides at you."], ["STOVE BOY", "Hot hands, warm heart."], ["ROCKO", "Launches first, asks later."]];
  made.forEach(([name, tagline], i) => {
    const owner = `dev-maker${i}`, id = `gen-maker${i}-0`;
    const dir = path.join(data, "gen", id, "0badf00d");
    fs.mkdirSync(dir, { recursive: true });
    const from = path.join("client/public/house", house[i % house.length]);
    for (const f of fs.readdirSync(from)) fs.copyFileSync(path.join(from, f), path.join(dir, f));
    // stored the way the data had it under the old base: the server serves both until the migration
    const c = { id, owner, status: "ready", stage: "", error: null, name, tagline, description: "d", drawingUrl: `/play/gen/drawings/${id}.png`, bundleUrl: `/play/gen/${id}/0badf00d/bundle.json`, sheetUrl: null, createdAt: 1000 + i, origin: "creator" };
    fs.writeFileSync(path.join(data, "players", `${owner}.json`), JSON.stringify({ player: { id: owner, name: `Maker ${i}`, avatar: null }, lastPlayed: null, characters: [c], saved: [] }));
  });
}

/** Fingers on a page's screen (CDP touch events, so they are real touches with real gestures). */
class Fingers {
  constructor(page, cdp) { this.page = page; this.cdp = cdp; }
  static async on(page) { return new Fingers(page, await page.context().newCDPSession(page)); }
  touch(type, x, y) { return this.cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ id: 1, x, y, radiusX: 8, radiusY: 8, force: 1 }] }); }
  async tap(x, y) { await this.touch("touchStart", x, y); await sleep(60); await this.touch("touchEnd"); }
  /** Two fingers spread apart around (x, y), as a zoom would be. */
  async pinch(x, y) {
    const at = (d) => [{ id: 1, x: x - d, y, radiusX: 8, radiusY: 8, force: 1 }, { id: 2, x: x + d, y, radiusX: 8, radiusY: 8, force: 1 }];
    await this.cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: at(20) });
    for (let d = 30; d <= 160; d += 10) { await this.cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: at(d) }); await sleep(16); }
    await this.cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  }
  /** A finger dragged from (x, y) by dy, as a scroll would be. */
  async drag(x, y, dy) {
    await this.touch("touchStart", x, y);
    for (let i = 1; i <= 10; i++) { await this.touch("touchMove", x, y + (dy * i) / 10); await sleep(16); }
    await this.touch("touchEnd");
  }
}

/** A view point in CSS pixels on a page of this size. */
function toCss(page, vx, vy) {
  const { width: w, height: h } = page.viewportSize();
  const s = Math.min(w / 1920, h / 1080);
  return [(w - 1920 * s) / 2 + vx * s, (h - 1080 * s) / 2 + vy * s];
}

const scrollState = (p) => p.evaluate(() => ({
  y: window.scrollY, open: document.documentElement.classList.contains("about"),
  scrollable: document.documentElement.scrollHeight > window.innerHeight, scrollbar: window.innerWidth - document.documentElement.clientWidth,
  canvas: [document.getElementById("game").clientWidth, document.getElementById("game").clientHeight, window.innerWidth, window.innerHeight],
  about: document.getElementById("about").offsetTop,
}));
async function locked(p, label) {
  const s = await scrollState(p);
  const zoom = await p.evaluate(() => window.visualViewport.scale);
  if (zoom !== 1) fail(`${label}: the page is zoomed to ${zoom}`);
  if (s.y !== 0 || s.open || s.scrollable || s.scrollbar) fail(`${label}: the page can scroll: ${JSON.stringify(s)}`);
  if (s.canvas[0] !== s.canvas[2] || s.canvas[1] !== s.canvas[3]) fail(`${label}: the canvas isn't the viewport: ${s.canvas}`);
}
/** Waits for a smooth scroll to stop. */
async function settled(p) {
  let last = -1;
  for (let i = 0; i < 100; i++) {
    const y = await p.evaluate(() => window.scrollY);
    if (y === last) return y;
    last = y;
    await sleep(120);
  }
  fail("the page never stopped scrolling");
}
const screenName = (p) => p.evaluate(() => window.sketchbattle?.screen?.constructor.name);
const toTitle = (p) => p.waitForFunction(() => Array.isArray(window.sketchbattle?.screen?.items), null, { timeout: 30000 });
const sel = (p) => p.evaluate(() => window.sketchbattle.screen.sel);

let server, browser;
try {
  execFileSync("npm", ["run", "build"], { stdio: "ignore" });
  seed();
  server = spawn("node", ["dist/server.mjs"], { env: { ...process.env, PORT: String(SERVER_PORT), SKETCHBATTLE_DATA: data, DEV_LOGIN: "1", FORGE_TOKEN: "" }, stdio: "ignore" });
  for (let i = 0; !(await fetch(`${site}/api/health`).then((r) => r.ok, () => false)); i++) { if (i > 100) fail("the server never came up"); await sleep(100); }
  browser = await chromium.launch();
  const errors = [];
  async function page(name, device) {
    const p = await (await browser.newContext(device)).newPage();
    p.on("pageerror", (e) => errors.push(`${name}: ${e.message}`));
    p.on("console", (m) => { if (m.type() === "error") errors.push(`${name} console: ${m.text()}`); });
    await p.addInitScript(SETTINGS);
    return p;
  }

  console.log("1. booting to the title");
  const desk = await page("desktop", DESKTOP);
  const fetched = [];
  desk.on("request", (r) => fetched.push(new URL(r.url()).pathname));
  const t0 = Date.now();
  await desk.goto(site);
  await toTitle(desk);
  console.log(`  title after ${Date.now() - t0} ms, ${(await (await fetch(site)).text()).length} bytes of HTML`);
  await desk.mouse.move(2, 2);
  await sleep(1500);
  const early = fetched.filter((u) => /^\/(screenshots|fighters)\/|^\/clip\./.test(u));
  if (early.length) fail(`the title fetched the about sections' ${early.join(", ")}`);
  await locked(desk, "desktop title");
  await desk.mouse.move(640, 360);
  await desk.mouse.wheel(0, 1200);
  await sleep(500);
  await locked(desk, "desktop title after the wheel");
  await desk.screenshot({ path: path.join(shots, "desktop-1-title.png") });
  console.log("  nothing of the about sections fetched, the page doesn't scroll, not by the wheel either");

  console.log("2. the tab, the sections, PLAY");
  await desk.mouse.click(...toCss(desk, TAB.x, TAB.y));
  await desk.waitForFunction(() => document.documentElement.classList.contains("about"));
  const at = await settled(desk);
  const s = await scrollState(desk);
  if (Math.abs(at - s.about) > 2) fail(`the tab scrolled to ${at}, the sections are at ${s.about}`);
  await desk.screenshot({ path: path.join(shots, "desktop-2-about.png") });
  const before = await sel(desk);
  await desk.keyboard.press("PageDown");
  await desk.keyboard.press("ArrowDown");
  await desk.keyboard.press("ArrowDown");
  const keyed = await settled(desk);
  if (keyed <= at) fail(`the keys didn't scroll the page (${at} -> ${keyed})`);
  if ((await sel(desk)) !== before) fail("the keys moved the menu under the sections");
  await desk.keyboard.press("End");
  await settled(desk);
  await desk.waitForFunction(() => [...document.querySelectorAll("#about img")].every((i) => i.complete && i.naturalWidth > 0), null, { timeout: 10000 });
  const pictures = await desk.evaluate(() => document.querySelectorAll("#about img").length);
  if (pictures !== 3 + 5) fail(`${pictures} pictures in the sections, not 3 screenshots and 5 fighters`);
  await desk.waitForFunction(() => document.querySelector("#about video").currentTime > 0, null, { timeout: 10000 });
  await desk.screenshot({ path: path.join(shots, "desktop-3-about-end.png") });
  console.log(`  the tab scrolled to the sections at ${at}; the keys scrolled the page and left the menu alone; ${pictures} pictures and the clip play`);
  await desk.click("#about .where a.up");
  await desk.waitForFunction(() => window.scrollY === 0 && !document.documentElement.classList.contains("about"), null, { timeout: 10000 });
  await locked(desk, "back at the title");
  await desk.mouse.move(2, 2);
  await desk.keyboard.press("ArrowDown");
  await sleep(200);
  if ((await sel(desk)) === before) fail("back at the title, the keys don't move the menu");
  await desk.screenshot({ path: path.join(shots, "desktop-4-back.png") });
  await desk.mouse.click(...toCss(desk, TAB.x, TAB.y));
  await settled(desk);
  await desk.mouse.move(640, 300);
  for (let i = 0; i < 20 && (await desk.evaluate(() => window.scrollY)) > 0; i++) { await desk.mouse.wheel(0, -600); await sleep(150); }
  await settled(desk);
  await locked(desk, "scrolled back up by the wheel");
  console.log("  PLAY and the wheel both bring the game back, which has the keys again");

  console.log("3. a match");
  await desk.goto(`${site}/?quick=1&p2=cpu&cpu=1&seed=3`);
  await desk.waitForFunction(() => window.sketchbattle?.screen?.match, null, { timeout: 30000 });
  await sleep(1500);
  await desk.mouse.click(...toCss(desk, TAB.x, TAB.y));
  await desk.mouse.wheel(0, 1200);
  await sleep(500);
  await locked(desk, "desktop match");
  await desk.screenshot({ path: path.join(shots, "desktop-5-match.png") });
  console.log(`  ${await screenName(desk)}: no tab, no scrolling`);

  console.log("4. a phone");
  for (const [name, device] of [["phone", PHONE], ["upright", UPRIGHT]]) {
    const p = await page(name, device);
    const f = await Fingers.on(p);
    await p.goto(site);
    await toTitle(p);
    await sleep(1500);
    await locked(p, `${name} title`);
    await f.drag(...toCss(p, 960, 700), -300);
    await f.pinch(...toCss(p, 960, 540));
    await sleep(400);
    await locked(p, `${name} title after a swipe and a pinch`);
    await p.screenshot({ path: path.join(shots, `${name}-1-title.png`) });
    await f.tap(...toCss(p, TAB.x, TAB.y));
    await p.waitForFunction(() => document.documentElement.classList.contains("about"));
    await settled(p);
    await p.screenshot({ path: path.join(shots, `${name}-2-about.png`) });
    await p.evaluate(() => window.scrollBy(0, window.innerHeight * 2));
    await settled(p);
    await p.screenshot({ path: path.join(shots, `${name}-3-about-more.png`) });
    if (name === "phone") {
      const [x, y] = await p.evaluate(() => { const r = document.querySelector("#about .facts").getBoundingClientRect(); return [r.left + r.width / 2, Math.max(40, r.top + 20)]; });
      await f.pinch(x, Math.min(y, 300));
      await sleep(400);
      const zoom = await p.evaluate(() => window.visualViewport.scale);
      console.log(`  a pinch on the about text zooms it to ${zoom.toFixed(2)}`);
      if (zoom <= 1) fail("the about sections can't be zoomed");
      await p.evaluate(() => document.querySelector("#about .hero a.up").click());
      await p.waitForFunction(() => window.scrollY === 0, null, { timeout: 10000 });
      // zoom back out, as a reader would, before the title is checked
      const cdp = await p.context().newCDPSession(p);
      await cdp.send("Emulation.setPageScaleFactor", { pageScaleFactor: 1 });
      await sleep(300);
      await f.tap(...toCss(p, TAB.x, TAB.y));
      await settled(p);
    }
    await p.locator("#about .hero a.up").scrollIntoViewIfNeeded();
    await settled(p);
    await p.locator("#about .hero a.up").tap();
    await p.waitForFunction(() => window.scrollY === 0 && !document.documentElement.classList.contains("about"), null, { timeout: 10000 });
    await locked(p, `${name} back at the title`);
    if ((await screenName(p)) !== "TitleScreen") fail(`${name}: PLAY left ${await screenName(p)}`);
    await p.screenshot({ path: path.join(shots, `${name}-4-back.png`) });
    console.log(`  ${name}: the tab and PLAY by touch`);
  }
  const phone = await page("phone match", PHONE);
  const pf = await Fingers.on(phone);
  await phone.goto(`${site}/?quick=1&p2=cpu&cpu=1&seed=3`);
  await phone.waitForFunction(() => window.sketchbattle?.screen?.match && window.sketchbattle.screen.countdown <= 0, null, { timeout: 30000 });
  await pf.tap(...toCss(phone, 1500, 900));
  await phone.waitForFunction(() => window.sketchbattle.touch.shown, null, { timeout: 5000 });
  for (const dy of [-250, 250, -250]) await pf.drag(...toCss(phone, 960, 540), dy);
  await pf.pinch(...toCss(phone, 960, 540));
  await sleep(400);
  await locked(phone, "touch match");
  await phone.screenshot({ path: path.join(shots, "phone-5-touch-match.png") });
  console.log("  a touch match: the controls show, swipes and pinches never scroll or zoom the page");

  console.log("5. the addresses");
  const head = (u) => fetch(`${site}${u}`, { redirect: "manual" });
  for (const [from, to] of [["/play", "/"], ["/play/", "/"], ["/play/?ref=x", "/?ref=x"], ["/play/privacy", "/privacy"], ["/play/house/rocket/bundle.json", "/house/rocket/bundle.json"]]) {
    const r = await head(from);
    if (r.status !== 301 || r.headers.get("location") !== to) fail(`${from}: ${r.status} to ${r.headers.get("location")}, not 301 to ${to}`);
  }
  for (const u of ["/gen/gen-maker0-0/0badf00d/idle.png", "/play/gen/gen-maker0-0/0badf00d/idle.png", "/fighters/gen-maker0-0.png", "/robots.txt", "/sitemap.xml", "/og.jpg", "/favicon.ico", "/apple-touch-icon.png", "/screenshots/draw.webp", "/clip.mp4", "/api/health", "/play/api/health"]) {
    const r = await head(u);
    if (r.status !== 200) fail(`${u}: ${r.status}`);
  }
  console.log("  /play/... redirects to the same path; fighters, the API, robots.txt, sitemap.xml and the pictures answer");

  if (errors.length) fail(`page errors:\n${errors.join("\n")}`);
  console.log(`frontcheck passed; screenshots in ${shots}`);
} finally {
  await browser?.close();
  server?.kill();
  fs.rmSync(data, { recursive: true, force: true });
}
