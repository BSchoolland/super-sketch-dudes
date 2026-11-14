// The browser's bars on phones (client/src/bars.ts), on the built server. Emulated: a real iPhone's toolbar never
// collapses here, so "the bars" are a viewport shorter than the screen and "tucked" is the viewport grown to it.
//   1. A desktop is untouched: no handheld class, no manifest, no card, the page doesn't scroll.
//   2. An iPhone (WebKit) sideways with its bars out: the SWIPE UP card; after 6 s, "tap to play anyway".
//      The bars tucked: the card goes, the page is taller than the screen but no touch on the game can move it;
//      the bars back: the card again, scrolled to the top. The way past it works.
//   3. The iPhone's about tab: the sections scroll and the card stays down; PLAY comes back.
//   4. An iPhone touch match, with the bars tucked: the controls, and touches move nothing.
//   5. An iPhone upright: no card. Inside an iframe: nothing at all.
//   6. An Android phone (Chromium): a tap on the title goes fullscreen; the about tab leaves it; a touch match.
// Usage: node scripts/barscheck.mjs [--shots <dir>]   (screenshots default to /tmp/ssd-bars-shots; SERVER_PORT 3931)
import { chromium, webkit, devices } from "playwright";
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const SERVER_PORT = Number(process.env.SERVER_PORT ?? 3931);
const shotsAt = process.argv.indexOf("--shots");
const shots = shotsAt > 0 ? process.argv[shotsAt + 1] : "/tmp/ssd-bars-shots";
fs.mkdirSync(shots, { recursive: true });
const data = fs.mkdtempSync(path.join(os.tmpdir(), "barscheck-"));
const site = `http://localhost:${SERVER_PORT}`;
const fail = (message) => { throw new Error(message); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** iPhone 15 sideways: 734x343 is Safari with its bars out, 852x393 the whole screen. */
const IPHONE = devices["iPhone 15 landscape"];
const TUCKED = { width: 852, height: 393 };
const IPHONE_UP = devices["iPhone 15"];
const ANDROID = devices["Pixel 7 landscape"];
const DESKTOP = { viewport: { width: 1280, height: 720 } };
/** The title's tab, in the 1920x1080 view (client/src/screens/title.ts). */
const TAB = { x: 1920 - 430 + 84, y: 1080 - 22 };
const SETTINGS = () => localStorage.setItem("sketchbattle.settings", JSON.stringify({ cpuTier: 1, volume: 0, music: 0 }));

function toCss(page, vx, vy) {
  const { width: w, height: h } = page.viewportSize();
  const s = Math.min(w / 1920, h / 1080);
  return [(w - 1920 * s) / 2 + vx * s, (h - 1080 * s) / 2 + vy * s];
}
const state = (p) => p.evaluate(() => {
  const gate = document.getElementById("swipe");
  const c = document.getElementById("game");
  return {
    cls: document.documentElement.className, manifest: !!document.querySelector('link[rel="manifest"]'),
    gate: gate ? !gate.hidden : null, through: gate ? !gate.querySelector("button").hidden : null,
    y: window.scrollY, scrollable: document.documentElement.scrollHeight > window.innerHeight,
    canvas: [c.clientWidth, c.clientHeight, window.innerWidth, window.innerHeight],
  };
});
/** A cancelable touchmove on `selector` (WebKit here has no real touch drags): whether the page cancelled it. */
const touchmoveHeld = (p, selector) => p.evaluate((sel) => {
  const el = document.querySelector(sel);
  const ev = new TouchEvent("touchmove", { bubbles: true, cancelable: true });
  el.dispatchEvent(ev);
  return ev.defaultPrevented;
}, selector);
const toTitle = (p) => p.waitForFunction(() => Array.isArray(window.sketchbattle?.screen?.items), null, { timeout: 30000 });
const screenName = (p) => p.evaluate(() => window.sketchbattle?.screen?.constructor.name);
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
function same(label, s, want) {
  for (const [k, v] of Object.entries(want)) if (JSON.stringify(s[k]) !== JSON.stringify(v)) fail(`${label}: ${k} is ${JSON.stringify(s[k])}, not ${JSON.stringify(v)} (${JSON.stringify(s)})`);
  if (s.canvas[0] !== s.canvas[2] || s.canvas[1] !== s.canvas[3]) fail(`${label}: the canvas isn't the viewport: ${s.canvas}`);
}

let server, chrome, safari;
try {
  execFileSync("npm", ["run", "build"], { stdio: "ignore" });
  server = spawn("node", ["dist/server.mjs"], { env: { ...process.env, PORT: String(SERVER_PORT), SKETCHBATTLE_DATA: data, DEV_LOGIN: "1", FORGE_TOKEN: "" }, stdio: "ignore" });
  for (let i = 0; !(await fetch(`${site}/api/health`).then((r) => r.ok, () => false)); i++) { if (i > 100) fail("the server never came up"); await sleep(100); }
  const manifest = await fetch(`${site}/manifest.webmanifest`);
  if (!manifest.ok) fail(`manifest.webmanifest: ${manifest.status}`);
  if ((await manifest.json()).display !== "fullscreen") fail("the manifest isn't fullscreen");
  chrome = await chromium.launch();
  safari = await webkit.launch();
  const errors = [];
  async function page(browser, name, device) {
    const p = await (await browser.newContext(device)).newPage();
    p.on("pageerror", (e) => errors.push(`${name}: ${e.message}`));
    p.on("console", (m) => { if (m.type() === "error") errors.push(`${name} console: ${m.text()}`); });
    await p.addInitScript(SETTINGS);
    // WebKit's emulation makes the screen whatever the viewport was last set to; a phone's screen stays put
    if (device.screen) await p.addInitScript(([w, h]) => {
      Object.defineProperty(Screen.prototype, "width", { get: () => w });
      Object.defineProperty(Screen.prototype, "height", { get: () => h });
    }, [device.screen.width, device.screen.height]);
    return p;
  }

  console.log("1. a desktop");
  const desk = await page(chrome, "desktop", DESKTOP);
  await desk.goto(site);
  await toTitle(desk);
  await sleep(1000);
  same("desktop title", await state(desk), { cls: "", manifest: false, gate: null, y: 0, scrollable: false });
  const css = await desk.evaluate(() => { const s = getComputedStyle(document.getElementById("game")); return [s.width, s.height, getComputedStyle(document.documentElement).overflowY]; });
  if (css.join() !== "1280px,720px,hidden") fail(`desktop canvas/page style: ${css}`);
  await desk.screenshot({ path: path.join(shots, "desktop-title.png") });
  console.log("  no handheld class, no manifest, no card, no scrolling");

  console.log("2. an iPhone sideways, bars out");
  const ip = await page(safari, "iphone", IPHONE);
  await ip.goto(site);
  await toTitle(ip);
  await sleep(800);
  same("iphone bars out", await state(ip), { cls: "handheld swipe", manifest: true, gate: true, through: false, y: 0, scrollable: true });
  if (await touchmoveHeld(ip, "#swipe")) fail("a swipe on the card was cancelled");
  await ip.screenshot({ path: path.join(shots, "iphone-1-card.png") });
  await sleep(6500);
  same("iphone after 6 s", await state(ip), { gate: true, through: true });
  await ip.screenshot({ path: path.join(shots, "iphone-2-card-escape.png") });
  console.log("  the card, its swipe left alone, and the way past it after 6 s");

  await ip.evaluate(() => window.scrollTo({ top: 120, behavior: "instant" }));
  await ip.setViewportSize(TUCKED);
  await sleep(700);
  same("iphone tucked", await state(ip), { gate: false, through: false, y: 120, scrollable: true });
  for (const sel of ["#game", "body", "html"]) if (!(await touchmoveHeld(ip, sel))) fail(`bars tucked: a touchmove on ${sel} could scroll the page`);
  await ip.screenshot({ path: path.join(shots, "iphone-3-tucked-title.png") });
  console.log("  bars tucked: the card goes, the title shows, no touch can scroll the page");

  await ip.setViewportSize(IPHONE.viewport);
  await sleep(700);
  same("iphone bars back", await state(ip), { gate: true, y: 0 });
  await sleep(6500);
  await ip.tap("#swipe button");
  await sleep(700);
  same("iphone gave up", await state(ip), { gate: false });
  if (!(await touchmoveHeld(ip, "#game"))) fail("after the way past the card, a touchmove on the game could scroll the page");
  await ip.screenshot({ path: path.join(shots, "iphone-4-played-anyway.png") });
  console.log("  bars back: the card again, at the top; tap to play anyway takes it down for good");

  console.log("3. the iPhone's about tab");
  const ia = await page(safari, "iphone about", IPHONE);
  await ia.goto(site);
  await toTitle(ia);
  await ia.setViewportSize(TUCKED);
  await sleep(700);
  same("about: tucked title", await state(ia), { gate: false });
  await ia.touchscreen.tap(...toCss(ia, TAB.x, TAB.y));
  await ia.waitForFunction(() => document.documentElement.classList.contains("about"));
  await settled(ia);
  if (await touchmoveHeld(ia, "#about")) fail("the about sections can't be scrolled by touch");
  await ia.screenshot({ path: path.join(shots, "iphone-5-about.png") });
  // the bars come back while reading: a web page, no card
  await ia.setViewportSize(IPHONE.viewport);
  await sleep(700);
  same("about open, bars out", await state(ia), { gate: false });
  await ia.evaluate(() => window.scrollBy(0, window.innerHeight * 2));
  await settled(ia);
  await ia.screenshot({ path: path.join(shots, "iphone-6-about-more.png") });
  await ia.locator("#about .hero a.up").scrollIntoViewIfNeeded();
  await ia.locator("#about .hero a.up").tap();
  await ia.waitForFunction(() => window.scrollY === 0 && !document.documentElement.classList.contains("about"), null, { timeout: 10000 });
  await sleep(700);
  same("about closed, bars out", await state(ia), { gate: true });
  if ((await screenName(ia)) !== "TitleScreen") fail(`PLAY left ${await screenName(ia)}`);
  console.log("  the sections scroll by touch, no card over them; PLAY comes back to the title (and the card, the bars being out)");

  console.log("4. an iPhone touch match");
  const im = await page(safari, "iphone match", IPHONE);
  await im.goto(`${site}/?quick=1&p2=cpu&cpu=1&seed=3`);
  await im.setViewportSize(TUCKED);
  await im.waitForFunction(() => window.sketchbattle?.screen?.match && window.sketchbattle.screen.countdown <= 0, null, { timeout: 30000 });
  await im.touchscreen.tap(...toCss(im, 1500, 900));
  await im.waitForFunction(() => window.sketchbattle.touch.shown, null, { timeout: 5000 });
  same("iphone match", await state(im), { gate: false });
  if (!(await touchmoveHeld(im, "#game"))) fail("a touchmove in the match could scroll the page");
  await sleep(1200);
  await im.screenshot({ path: path.join(shots, "iphone-7-touch-match.png") });
  console.log(`  ${await screenName(im)}: the controls show, touches move nothing`);

  console.log("5. an iPhone upright, and inside an iframe");
  const iu = await page(safari, "iphone upright", IPHONE_UP);
  await iu.goto(site);
  await toTitle(iu);
  await sleep(800);
  same("iphone upright", await state(iu), { cls: "handheld swipe", gate: false });
  await iu.screenshot({ path: path.join(shots, "iphone-8-upright.png") });
  const fr = await page(safari, "iphone iframe", IPHONE);
  await fr.goto(`${site}/robots.txt`);
  await fr.setContent(`<iframe src="${site}/" style="border:0;width:100vw;height:100vh"></iframe>`);
  const inner = fr.frames()[1];
  await inner.waitForFunction(() => Array.isArray(window.sketchbattle?.screen?.items), null, { timeout: 30000 });
  const framed = await inner.evaluate(() => [document.documentElement.className, !!document.getElementById("swipe"), !!document.querySelector('link[rel="manifest"]')]);
  if (framed.join() !== ",false,false") fail(`inside an iframe the page did something: ${framed}`);
  console.log("  upright: no card; in an iframe: no class, card or manifest");

  console.log("6. an Android phone");
  const an = await page(chrome, "android", ANDROID);
  await an.goto(site);
  await toTitle(an);
  await sleep(800);
  same("android title", await state(an), { cls: "handheld", manifest: true, gate: null, scrollable: false });
  await an.screenshot({ path: path.join(shots, "android-1-title.png") });
  await an.touchscreen.tap(...toCss(an, 960, 160));
  await an.waitForFunction(() => !!document.fullscreenElement, null, { timeout: 5000 }).catch(() => fail("a tap on the title didn't go fullscreen"));
  console.log("  a tap on the title goes fullscreen");
  await an.touchscreen.tap(...toCss(an, TAB.x, TAB.y));
  await an.waitForFunction(() => document.documentElement.classList.contains("about") && !document.fullscreenElement, null, { timeout: 5000 }).catch(() => fail("the about tab didn't leave fullscreen"));
  await settled(an);
  const off = await an.evaluate(() => Math.abs(document.getElementById("about").getBoundingClientRect().top));
  if (off > 2) fail(`out of fullscreen, the sections are ${off}px from the top`);
  await an.screenshot({ path: path.join(shots, "android-2-about.png") });
  await an.locator("#about .hero a.up").tap();
  await an.waitForFunction(() => window.scrollY === 0 && !document.documentElement.classList.contains("about"), null, { timeout: 10000 });
  await an.touchscreen.tap(...toCss(an, TAB.x, TAB.y));
  await an.waitForFunction(() => document.documentElement.classList.contains("about"));
  await sleep(600);
  if (await an.evaluate(() => !!document.fullscreenElement)) fail("the tap that opened the about sections went fullscreen");
  console.log("  the about tab leaves fullscreen (a reader can zoom), and a tap that opens it doesn't enter it");
  const am = await page(chrome, "android match", ANDROID);
  await am.goto(`${site}/?quick=1&p2=cpu&cpu=1&seed=3`);
  await am.waitForFunction(() => window.sketchbattle?.screen?.match && window.sketchbattle.screen.countdown <= 0, null, { timeout: 30000 });
  await am.touchscreen.tap(...toCss(am, 1500, 900));
  await am.waitForFunction(() => window.sketchbattle.touch.shown, null, { timeout: 5000 });
  if (await am.evaluate(() => !!document.fullscreenElement)) fail("a tap mid-match went fullscreen");
  await sleep(1200);
  await am.screenshot({ path: path.join(shots, "android-3-touch-match.png") });
  console.log("  a touch match: the controls show, a tap mid-match leaves the screen alone");

  if (errors.length) fail(`page errors:\n${errors.join("\n")}`);
  console.log(`barscheck passed; screenshots in ${shots}`);
} finally {
  await chrome?.close();
  await safari?.close();
  server?.kill();
  fs.rmSync(data, { recursive: true, force: true });
}
