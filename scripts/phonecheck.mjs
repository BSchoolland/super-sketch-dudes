// The phone card (client/src/phone.ts) on the built server. Builds, starts dist/server.mjs on a scratch data dir, then:
//   1. A WebKit iPhone and a Chromium Android phone, upright and sideways: the card instead of the game, all of it on
//      the first screen; none of the game loads (its bundle, fighters, music); the about tab and the page scroll down to
//      the about sections; a pinch zooms them (Chromium); SHARE THE LINK copies the address and says so (no
//      navigator.share in emulation), or hands it to navigator.share where there is one.
//   2. The session event says the card was shown.
//   3. A gamepad connecting while the card is up starts the game, and the pad moves the title's menu; the session
//      event says a gamepad came through.
//   4. A desktop, and a touchscreen laptop (a fine and a coarse pointer, touch events): the game as before, no card;
//      a finger tap on the laptop's title opens the about tab.
// Usage: node scripts/phonecheck.mjs [--shots <dir>]   (screenshots default to /tmp/ssd-desktoponly-shots; SERVER_PORT 4131)
import { chromium, webkit, devices } from "playwright";
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const SERVER_PORT = Number(process.env.SERVER_PORT ?? 4131);
const shotsAt = process.argv.indexOf("--shots");
const shots = shotsAt > 0 ? process.argv[shotsAt + 1] : "/tmp/ssd-desktoponly-shots";
fs.mkdirSync(shots, { recursive: true });
const data = fs.mkdtempSync(path.join(os.tmpdir(), "phonecheck-"));
const site = `http://localhost:${SERVER_PORT}`;
const SITE = "https://supersketchdudes.com/";
const fail = (message) => { throw new Error(message); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PHONES = [
  ["iphone", webkit, devices["iPhone 15"]],
  ["iphone-sideways", webkit, devices["iPhone 15 landscape"]],
  ["android", chromium, devices["Pixel 7"]],
  ["android-sideways", chromium, devices["Pixel 7 landscape"]],
];
/** The game's own downloads, none of which a phone on the card may fetch. */
const HEAVY = /^\/assets\/app-|\.mp3$|^\/house\/|^\/gen\/|^\/fighters\//;
/** The title's tab, in the 1920x1080 view (client/src/screens/title.ts). */
const TAB = { x: 1920 - 430 + 84, y: 1080 - 22 };
const SETTINGS = () => localStorage.setItem("sketchbattle.settings", JSON.stringify({ cpuTier: 1, volume: 0, music: 0, touch: "always", touchSize: 1.3 }));
/** A standard gamepad the page can't see until `__connectPad()` (navigator.getGamepads lists only connected pads). */
const FAKE_PAD = () => {
  const pad = { id: "Fake Pad (STANDARD GAMEPAD)", index: 0, connected: true, mapping: "standard", axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })), timestamp: 0 };
  let connected = false;
  navigator.getGamepads = () => [connected ? pad : null, null, null, null];
  window.__pad = pad;
  window.__connectPad = () => {
    connected = true;
    const e = new Event("gamepadconnected");
    Object.defineProperty(e, "gamepad", { value: pad });
    window.dispatchEvent(e);
  };
};

const toTitle = (p) => p.waitForFunction(() => Array.isArray(window.sketchbattle?.screen?.items), null, { timeout: 30000 });
function toCss(page, vx, vy) {
  const { width: w, height: h } = page.viewportSize();
  const s = Math.min(w / 1920, h / 1080);
  return [(w - 1920 * s) / 2 + vx * s, (h - 1080 * s) / 2 + vy * s];
}
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
/** The newest snapshot of each page session in the server's store. */
function sessions() {
  const file = path.join(data, "events.jsonl");
  if (!fs.existsSync(file)) return [];
  const byId = new Map();
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (!line) continue;
    const e = JSON.parse(line);
    if (e.kind === "session" && (!byId.has(e.id) || byId.get(e.id).seq < e.seq)) byId.set(e.id, e);
  }
  return [...byId.values()];
}
async function sessionOf(trace, done) {
  for (let i = 0; i < 100; i++) {
    const s = sessions().find((e) => e.trace === trace);
    if (s && done(s)) return s;
    await sleep(200);
  }
  fail(`session ${trace} never reached the store as wanted: ${JSON.stringify(sessions().find((e) => e.trace === trace)?.business ?? null)}`);
}
const traceOf = (p) => p.evaluate(() => JSON.parse(sessionStorage.getItem("sketchbattle.visit") ?? "null")?.session ?? null);

let server;
const browsers = [];
try {
  execFileSync("npm", ["run", "build"], { stdio: "ignore" });
  server = spawn("node", ["dist/server.mjs"], { env: { ...process.env, PORT: String(SERVER_PORT), SKETCHBATTLE_DATA: data, DEV_LOGIN: "1", FORGE_TOKEN: "" }, stdio: "ignore" });
  for (let i = 0; !(await fetch(`${site}/api/health`).then((r) => r.ok, () => false)); i++) { if (i > 100) fail("the server never came up"); await sleep(100); }
  const launched = new Map();
  const browserFor = async (type, args = []) => {
    const key = `${type.name()} ${args.join(" ")}`;
    if (!launched.has(key)) { const b = await type.launch({ args }); browsers.push(b); launched.set(key, b); }
    return launched.get(key);
  };
  const errors = [];
  async function page(name, type, device, opts = {}) {
    const context = await (await browserFor(type, opts.args)).newContext(device);
    if (type === chromium) await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: site });
    const p = await context.newPage();
    p.on("pageerror", (e) => errors.push(`${name}: ${e.message}`));
    p.on("console", (m) => { if (m.type() === "error") errors.push(`${name} console: ${m.text()}`); });
    await p.addInitScript(SETTINGS);
    await p.addInitScript(FAKE_PAD);
    if (opts.share) await p.addInitScript(() => { window.__shared = []; navigator.share = (d) => { window.__shared.push(d); return Promise.resolve(); }; });
    const fetched = [];
    p.on("request", (r) => fetched.push(new URL(r.url()).pathname));
    return { p, fetched };
  }

  console.log("1. phones get the card");
  const cardTraces = [];
  for (const [name, type, device] of PHONES) {
    const { p, fetched } = await page(name, type, device);
    await p.goto(site);
    await p.waitForSelector("#phone-card");
    await sleep(2500);
    const s = await p.evaluate(() => {
      const card = document.getElementById("phone-card"), about = document.getElementById("about");
      const box = (el) => { const r = el.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.right), Math.round(r.bottom)]; };
      return {
        cls: document.documentElement.className, game: !!window.sketchbattle, canvas: getComputedStyle(document.getElementById("game")).display,
        text: card.innerText.replace(/\s+/g, " ").trim(), parts: ["h1", "p", "button"].map((q) => box(card.querySelector(q))),
        w: innerWidth, h: innerHeight, scrollW: document.documentElement.scrollWidth, cardH: card.offsetHeight,
        about: getComputedStyle(about).display, aboutTop: about.offsetTop, pageH: document.documentElement.scrollHeight,
        viewport: document.querySelector('meta[name="viewport"]').content,
      };
    });
    if (!s.cls.split(" ").includes("phone") || s.game || s.canvas !== "none") fail(`${name}: the game is up: ${JSON.stringify(s)}`);
    for (const words of ["SUPER", "SKETCH DUDES", "Super Sketch Dudes is played with a keyboard or controller. Open it on a computer.", "SHARE THE LINK", "about"]) {
      if (!s.text.includes(words)) fail(`${name}: the card doesn't say "${words}": ${s.text}`);
    }
    if (/forge/i.test(s.text)) fail(`${name}: the card says forge`);
    for (const [l, t, r, b] of s.parts) if (l < 0 || t < 0 || r > s.w || b > s.h) fail(`${name}: the card's ${JSON.stringify(s.parts)} don't fit ${s.w}x${s.h}`);
    if (s.scrollW > s.w) fail(`${name}: the page is ${s.scrollW} wide on a ${s.w} screen`);
    if (s.about !== "block" || s.aboutTop < s.cardH || s.pageH <= s.h * 2) fail(`${name}: the about sections aren't under the card: ${JSON.stringify(s)}`);
    if (/maximum-scale|user-scalable/.test(s.viewport)) fail(`${name}: the page can't be zoomed: ${s.viewport}`);
    const heavy = fetched.filter((u) => HEAVY.test(u));
    if (heavy.length) fail(`${name}: the card fetched the game's ${heavy.join(", ")}`);
    await p.screenshot({ path: path.join(shots, `${name}-1-card.png`) });

    await p.click("#phone-card button");
    await p.waitForFunction(() => document.querySelector("#phone-card output").textContent !== "");
    const said = await p.textContent("#phone-card output");
    if (said !== "link copied") fail(`${name}: SHARE THE LINK said "${said}"`);
    if (type === chromium) {
      const copied = await p.evaluate(() => navigator.clipboard.readText());
      if (copied !== SITE) fail(`${name}: the clipboard has "${copied}"`);
    }
    await p.screenshot({ path: path.join(shots, `${name}-2-copied.png`) });

    await p.click("#phone-card .more");
    const at = await settled(p);
    const aboutTop = await p.evaluate(() => document.getElementById("about").offsetTop);
    if (Math.abs(at - Math.min(aboutTop, s.pageH - s.h)) > 2) fail(`${name}: the about tab scrolled to ${at}, the sections are at ${aboutTop}`);
    await p.screenshot({ path: path.join(shots, `${name}-3-about.png`) });
    await p.evaluate(() => window.scrollBy(0, window.innerHeight * 2));
    const further = await settled(p);
    if (further <= at) fail(`${name}: the about sections don't scroll (${at} -> ${further})`);
    await p.screenshot({ path: path.join(shots, `${name}-4-about-more.png`) });
    if (name === "android") {
      const cdp = await p.context().newCDPSession(p);
      const at2 = (d) => [{ id: 1, x: 200 - d, y: 300, radiusX: 8, radiusY: 8, force: 1 }, { id: 2, x: 200 + d, y: 300, radiusX: 8, radiusY: 8, force: 1 }];
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: at2(20) });
      for (let d = 30; d <= 160; d += 10) { await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: at2(d) }); await sleep(16); }
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await sleep(400);
      const zoom = await p.evaluate(() => window.visualViewport.scale);
      if (zoom <= 1) fail(`${name}: a pinch on the about sections didn't zoom (${zoom})`);
      await p.screenshot({ path: path.join(shots, `${name}-5-zoomed.png`) });
      console.log(`  ${name}: a pinch zooms the about sections to ${zoom.toFixed(2)}`);
    }
    await p.locator("#about .hero a.up").click();
    await p.waitForFunction(() => window.scrollY === 0, null, { timeout: 10000 });
    const late = fetched.filter((u) => HEAVY.test(u));
    if (late.length) fail(`${name}: reading the about sections fetched the game's ${late.join(", ")}`);
    cardTraces.push([name, await traceOf(p)]);
    console.log(`  ${name} ${s.w}x${s.h}: the card (${s.cardH}px), nothing of the game fetched; the link copied; the about sections under it at ${aboutTop}`);
    await p.context().close();
  }
  {
    const { p } = await page("android share", chromium, devices["Pixel 7"], { share: true });
    await p.goto(site);
    await p.click("#phone-card button");
    const shared = await p.evaluate(() => window.__shared);
    if (shared.length !== 1 || shared[0].url !== SITE) fail(`navigator.share got ${JSON.stringify(shared)}`);
    if ((await p.textContent("#phone-card output")) !== "") fail("sharing through navigator.share also said something");
    console.log(`  where there's navigator.share, the button hands it ${JSON.stringify(shared[0])}`);
    await p.context().close();
  }

  console.log("2. the session says so");
  for (const [name, trace] of cardTraces) {
    if (!trace) fail(`${name}: no session trace in sessionStorage`);
    const s = await sessionOf(trace, (e) => !!e.business.phoneCard);
    if (s.business.phoneCard.gamepad !== null || s.business.screens) fail(`${name}: the session is ${JSON.stringify(s.business)}`);
    console.log(`  ${name}: ${trace} phoneCard ${JSON.stringify(s.business.phoneCard)} · ${s.business.summary?.message ?? "(no summary yet)"}`);
  }

  console.log("3. a gamepad through the card");
  for (const [name, type, device] of [PHONES[0], PHONES[3]]) {
    const { p, fetched } = await page(`${name} pad`, type, device);
    await p.goto(site);
    await p.waitForSelector("#phone-card");
    await p.evaluate(() => window.__connectPad());
    await toTitle(p);
    const s = await p.evaluate(() => ({ card: !!document.getElementById("phone-card"), cls: document.documentElement.className, y: window.scrollY, canvas: [document.getElementById("game").clientWidth, document.getElementById("game").clientHeight, innerWidth, innerHeight] }));
    if (s.card || s.cls.split(" ").includes("phone") || s.y !== 0 || s.canvas[0] !== s.canvas[2] || s.canvas[1] !== s.canvas[3]) fail(`${name}: the game didn't take the page: ${JSON.stringify(s)}`);
    if (!fetched.some((u) => /^\/assets\/app-/.test(u))) fail(`${name}: the game's bundle never loaded`);
    await sleep(800);
    const before = await p.evaluate(() => window.sketchbattle.screen.sel);
    await p.evaluate(() => { window.__pad.buttons[13].pressed = true; window.__pad.buttons[13].value = 1; });
    await sleep(150);
    await p.evaluate(() => { window.__pad.buttons[13].pressed = false; window.__pad.buttons[13].value = 0; });
    await sleep(150);
    const after = await p.evaluate(() => window.sketchbattle.screen.sel);
    if (after === before) fail(`${name}: the pad's d-pad didn't move the title menu (${before})`);
    await p.screenshot({ path: path.join(shots, `${name}-6-gamepad.png`) });
    const trace = await traceOf(p);
    const e = await sessionOf(trace, (x) => !!x.business.phoneCard?.gamepad && !!x.business.screens);
    console.log(`  ${name}: the title, the pad moves its menu (${before} -> ${after}); session ${JSON.stringify(e.business.phoneCard)}, screens ${JSON.stringify(e.business.screens)}`);
    await p.context().close();
  }

  console.log("4. computers get the game");
  const LAPTOP = ["--blink-settings=availablePointerTypes=6,primaryPointerType=2,availableHoverTypes=6,primaryHoverType=2", "--touch-events=enabled"];
  for (const [name, args] of [["desktop", []], ["touch-laptop", LAPTOP]]) {
    const { p } = await page(name, chromium, { viewport: { width: 1366, height: 768 } }, { args });
    await p.goto(site);
    await toTitle(p);
    const s = await p.evaluate(() => ({
      card: !!document.getElementById("phone-card"), cls: document.documentElement.className, fine: matchMedia("(any-pointer: fine)").matches, coarse: matchMedia("(any-pointer: coarse)").matches,
      scrollable: document.documentElement.scrollHeight > innerHeight, canvas: [document.getElementById("game").clientWidth, document.getElementById("game").clientHeight, innerWidth, innerHeight],
    }));
    if (s.card || s.cls.split(" ").includes("phone") || s.scrollable || s.canvas[0] !== s.canvas[2] || s.canvas[1] !== s.canvas[3]) fail(`${name}: not the game as before: ${JSON.stringify(s)}`);
    if (name === "touch-laptop" && !(s.fine && s.coarse)) fail(`${name}: the emulation didn't give both pointers: ${JSON.stringify(s)}`);
    await sleep(800);
    await p.screenshot({ path: path.join(shots, `${name}-title.png`) });
    if (name === "touch-laptop") {
      const cdp = await p.context().newCDPSession(p);
      const [x, y] = toCss(p, TAB.x, TAB.y);
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ id: 1, x, y, radiusX: 4, radiusY: 4, force: 1 }] });
      await sleep(60);
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await p.waitForFunction(() => document.documentElement.classList.contains("about"), null, { timeout: 5000 });
      await settled(p);
      await p.screenshot({ path: path.join(shots, `${name}-about.png`) });
    }
    console.log(`  ${name} (fine ${s.fine}, coarse ${s.coarse}): the title, no card${name === "touch-laptop" ? "; a finger on the about tab opens it" : ""}`);
    await p.context().close();
  }

  if (errors.length) fail(`page errors:\n${errors.join("\n")}`);
  console.log(`phonecheck passed; screenshots in ${shots}`);
} finally {
  for (const b of browsers) await b.close();
  server?.kill();
  fs.rmSync(data, { recursive: true, force: true });
}
