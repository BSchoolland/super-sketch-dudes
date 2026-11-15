// The game held upright on phones (client/src/turn.ts), on the built server: the stage turned a quarter so the game
// stays landscape, and every input mapped back through the turn. Where things are on the screen is worked out here
// (scripts/lib/view.mjs), not asked of the page.
//   1. An iPhone (WebKit) upright, bars out: the stage turned at the screen's full size, the SWIPE LEFT card turned
//      with it and its swipe left to the page; bars tucked: the turned title. Menus by tap, a text field over the turned
//      canvas where the canvas draws it, typed into. The about tab: the sections upright; PLAY: turned again.
//   2. An iPhone touch match upright: ATTACK by tap; turned sideways and back mid-match, the match carries on.
//   3. An Android phone (Chromium) upright: the draw pad's stroke lands under the finger; a touch match, the stick
//      pushed toward the game's right moves the fighter right, ATTACK jabs; turned mid-match, the stick still steers.
//   4. A desktop: nothing turned, nothing sized.
// Usage: node scripts/turncheck.mjs [--shots <dir>]   (screenshots default to /tmp/ssd-turn-shots; SERVER_PORT 4031)
import { chromium, webkit, devices } from "playwright";
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { viewToCss } from "./lib/view.mjs";

const SERVER_PORT = Number(process.env.SERVER_PORT ?? 4031);
const shotsAt = process.argv.indexOf("--shots");
const shots = shotsAt > 0 ? process.argv[shotsAt + 1] : "/tmp/ssd-turn-shots";
fs.mkdirSync(shots, { recursive: true });
const data = fs.mkdtempSync(path.join(os.tmpdir(), "turncheck-"));
const site = `http://localhost:${SERVER_PORT}`;
const fail = (message) => { throw new Error(message); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** iPhone 15 upright: 393x659 is Safari with its bars out; tucked, the viewport grows to near the screen's 852. */
const IPHONE_UP = devices["iPhone 15"];
const TUCKED_UP = { width: 393, height: 760 };
const SIDEWAYS = { width: 852, height: 393 };
const ANDROID_UP = devices["Pixel 7"];
const DESKTOP = { viewport: { width: 1280, height: 720 } };
/** The title's tab, in the 1920x1080 view (client/src/screens/title.ts). */
const TAB = { x: 1920 - 430 + 84, y: 1080 - 22 };
const SETTINGS = () => localStorage.setItem("sketchbattle.settings", JSON.stringify({ cpuTier: 1, volume: 0, music: 0 }));

const turnedNow = (p) => p.evaluate(() => document.documentElement.classList.contains("turned"));
/** A view point on this page's screen, turned when the viewport is upright (every page here but the desktop is handheld). */
const at = (p, vx, vy) => { const v = p.viewportSize(); return viewToCss(v, v.height > v.width, vx, vy); };
const screenName = (p) => p.evaluate(() => window.sketchbattle?.screen?.constructor.name);
const toTitle = (p) => p.waitForFunction(() => Array.isArray(window.sketchbattle?.screen?.items), null, { timeout: 30000 });
const toScreen = (p, name) => p.waitForFunction((n) => window.sketchbattle?.screen?.constructor.name === n, name, { timeout: 15000 }).catch(async () => fail(`wanted ${name}, on ${await screenName(p)}`));
/** The stage as the page laid it out: turned or not, its box on the screen, the canvas's backing store. */
const layout = (p) => p.evaluate(() => {
  const stage = document.getElementById("stage"), c = document.getElementById("game"), r = stage.getBoundingClientRect();
  return { turned: document.documentElement.classList.contains("turned"), style: stage.getAttribute("style"), box: [r.left, r.top, r.width, r.height].map(Math.round), canvas: [c.width, c.height], css: [c.clientWidth, c.clientHeight], inner: [innerWidth, innerHeight] };
});
/** Turned: the stage covers the screen exactly, the viewport's height wide. */
async function expectTurned(p, label) {
  const l = await layout(p);
  const [w, h] = l.inner;
  if (!l.turned) fail(`${label}: not turned (${JSON.stringify(l)})`);
  if (l.box.join() !== `0,0,${w},${h}` || l.css.join() !== `${h},${w}`) fail(`${label}: the turned stage isn't the screen: ${JSON.stringify(l)}`);
  return l;
}
async function expectUpright(p, label) {
  const l = await layout(p);
  if (l.turned || l.style) fail(`${label}: turned or sized: ${JSON.stringify(l)}`);
  if (l.css.join() !== l.inner.join()) fail(`${label}: the canvas isn't the window: ${JSON.stringify(l)}`);
  return l;
}
const fighter = (p, i = 0) => p.evaluate((i) => { const s = window.sketchbattle.screen, st = s.match.state, f = st.fighters[i]; return { x: f.x, action: f.action, move: f.move, grounded: f.grounded, stocks: f.stocks, frame: st.frame, paused: s.match.paused, live: window.sketchbattle.touch.live }; }, i);
/** Every move and action the fighter does from now, polled each 8 ms in the page. */
const watch = (p) => p.evaluate(() => { const seen = window.__seen = { moves: new Set(), actions: new Set() }; clearInterval(window.__watch); window.__watch = setInterval(() => { const f = window.sketchbattle.screen.match?.state.fighters[0]; if (f) { if (f.move) seen.moves.add(f.move); seen.actions.add(f.action); } }, 8); });
const seen = (p) => p.evaluate(() => ({ moves: [...window.__seen.moves], actions: [...window.__seen.actions] }));
const calmBot = (p) => p.evaluate(() => { const s = window.sketchbattle.screen; s.match.sources[1].cpu = 0; s.match.state.fighters[1].cpu = 0; });
const ready = (p) => p.waitForFunction(() => { const f = window.sketchbattle.screen.match.state.fighters[0]; return f.grounded && ["idle", "walk", "crouch"].includes(f.action); }, null, { timeout: 8000 });

/** Real touches (CDP), Chromium only: every event lists every finger still down. */
class Fingers {
  constructor(page, cdp) { this.page = page; this.cdp = cdp; this.down = new Map(); }
  static async on(page) { return new Fingers(page, await page.context().newCDPSession(page)); }
  send(type) { return this.cdp.send("Input.dispatchTouchEvent", { type, touchPoints: [...this.down.values()] }); }
  async press(id, x, y) { this.down.set(id, { id, x, y, radiusX: 4, radiusY: 4, force: 1 }); await this.send("touchStart"); }
  async move(id, x, y) { this.down.set(id, { ...this.down.get(id), x, y }); await this.send("touchMove"); }
  async lift(id) { this.down.delete(id); await this.send("touchEnd"); }
  async tap(x, y) { await this.press(9, x, y); await sleep(60); await this.lift(9); }
}

let server, chrome, safari;
try {
  execFileSync("npm", ["run", "build"], { stdio: "ignore" });
  server = spawn("node", ["dist/server.mjs"], { env: { ...process.env, PORT: String(SERVER_PORT), SKETCHBATTLE_DATA: data, DEV_LOGIN: "1", FORGE_TOKEN: "" }, stdio: "ignore" });
  for (let i = 0; !(await fetch(`${site}/api/health`).then((r) => r.ok, () => false)); i++) { if (i > 100) fail("the server never came up"); await sleep(100); }
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

  console.log("1. an iPhone upright");
  const ip = await page(safari, "iphone", IPHONE_UP);
  await ip.goto(`${site}/?dev=Uma`);
  await toTitle(ip);
  await sleep(800);
  await expectTurned(ip, "iphone, bars out");
  const card = await ip.evaluate(() => {
    const gate = document.getElementById("swipe");
    return { shown: !gate.hidden, words: gate.querySelector("b").textContent, turn: getComputedStyle(gate.firstElementChild).transform, box: [gate.getBoundingClientRect().width, gate.getBoundingClientRect().height] };
  });
  if (!card.shown || card.words !== "SWIPE LEFT TO PLAY" || card.turn === "none" || card.box.join() !== "393,659") fail(`the upright card: ${JSON.stringify(card)}`);
  const cardSwipe = await ip.evaluate(() => { const ev = new TouchEvent("touchmove", { bubbles: true, cancelable: true }); document.getElementById("swipe").dispatchEvent(ev); return ev.defaultPrevented; });
  if (cardSwipe) fail("a swipe on the upright card was cancelled");
  await ip.screenshot({ path: path.join(shots, "iphone-up-1-swipe-card.png") });
  console.log(`  bars out: the card, "${card.words}", its words turned, its box the screen's so the swipe scrolls the page`);
  await ip.evaluate(() => window.scrollTo({ top: 120, behavior: "instant" }));
  await ip.setViewportSize(TUCKED_UP);
  await sleep(700);
  if (await ip.evaluate(() => !document.getElementById("swipe").hidden)) fail("the bars tucked upright and the card stayed");
  const tl = await expectTurned(ip, "iphone, bars tucked");
  await ip.screenshot({ path: path.join(shots, "iphone-up-2-title.png") });
  console.log(`  bars tucked: the title turned, stage ${tl.css.join("x")} CSS px, canvas ${tl.canvas.join("x")}`);

  // menus by tap: SETTINGS, then CHANGE NAME
  const row = await ip.evaluate(() => window.sketchbattle.screen.items.findIndex((i) => i.id === "settings"));
  await ip.touchscreen.tap(...at(ip, 720, 350 + row * 96 + 44));
  await toScreen(ip, "SettingsScreen");
  await sleep(300);
  await ip.screenshot({ path: path.join(shots, "iphone-up-3-settings.png") });
  const nameButton = await ip.evaluate(() => window.sketchbattle.screen.buttons().find((b) => b.id === "name"));
  await ip.touchscreen.tap(...at(ip, nameButton.x + nameButton.w / 2, nameButton.y + nameButton.h / 2));
  await toScreen(ip, "RenameScreen");
  await sleep(400);
  // the field the canvas draws at (rename.ts FIELD, inset) is where the <input> is on the screen
  const field = { x: 960 - 400, y: 414, w: 800, h: 68 };
  const corners = [[field.x, field.y], [field.x + field.w, field.y], [field.x, field.y + field.h], [field.x + field.w, field.y + field.h]].map(([x, y]) => at(ip, x, y));
  const want = [Math.min(...corners.map((c) => c[0])), Math.min(...corners.map((c) => c[1])), Math.max(...corners.map((c) => c[0])), Math.max(...corners.map((c) => c[1]))];
  const got = await ip.evaluate(() => { const r = document.querySelector("#overlay input").getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom]; });
  if (got.some((v, i) => Math.abs(v - want[i]) > 1.5)) fail(`the name field is at ${got.map(Math.round)} on the screen, the canvas draws it at ${want.map(Math.round)}`);
  await ip.evaluate(() => document.querySelector("#overlay input").blur());
  await ip.touchscreen.tap(...at(ip, field.x + 100, field.y + field.h / 2));
  await sleep(200);
  if (!(await ip.evaluate(() => document.activeElement === document.querySelector("#overlay input")))) fail("a tap on the turned name field didn't focus it");
  await ip.keyboard.type("Zed");
  await sleep(300);
  const typed = await ip.evaluate(() => document.querySelector("#overlay input").value);
  if (!typed.includes("Zed")) fail(`typing into the turned field gave "${typed}"`);
  await ip.screenshot({ path: path.join(shots, "iphone-up-4-name-field.png") });
  console.log(`  menus by tap (SETTINGS, CHANGE NAME); the name field lies over the canvas's box (${got.map(Math.round)}), a tap focuses it, typing fills it`);
  await ip.evaluate(() => document.activeElement.blur());
  await ip.keyboard.press("Escape");
  await ip.goto(`${site}/?dev=Uma`);
  await toTitle(ip);
  await sleep(800);
  await expectTurned(ip, "iphone, reloaded");

  // the about tab: a web page, read upright
  await ip.touchscreen.tap(...at(ip, TAB.x, TAB.y));
  await ip.waitForFunction(() => document.documentElement.classList.contains("about"), null, { timeout: 5000 }).catch(() => fail("the turned tab didn't open the about sections"));
  await sleep(1200);
  await expectUpright(ip, "about open");
  const about = await ip.evaluate(() => { const r = document.querySelector("#about h1").getBoundingClientRect(); return { top: Math.round(r.top), width: Math.round(r.width), transform: getComputedStyle(document.getElementById("about")).transform }; });
  if (about.transform !== "none" || about.top > 200 || about.top < -10) fail(`the about sections: ${JSON.stringify(about)}`);
  await ip.screenshot({ path: path.join(shots, "iphone-up-5-about.png") });
  await ip.locator("#about .hero a.up").tap();
  await ip.waitForFunction(() => window.scrollY === 0 && !document.documentElement.classList.contains("about"), null, { timeout: 10000 });
  await sleep(500);
  await expectTurned(ip, "back from about");
  if ((await screenName(ip)) !== "TitleScreen") fail(`PLAY left ${await screenName(ip)}`);
  await ip.screenshot({ path: path.join(shots, "iphone-up-6-back-from-about.png") });
  console.log("  the about tab by tap: the sections upright, not turned; PLAY: the title turned again");

  await ip.setViewportSize(SIDEWAYS);
  await sleep(600);
  await expectUpright(ip, "iphone sideways");
  await ip.screenshot({ path: path.join(shots, "iphone-side-1-title.png") });
  console.log("  turned sideways: the title as it always was");

  console.log("2. an iPhone touch match upright");
  const im = await page(safari, "iphone match", IPHONE_UP);
  await im.goto(`${site}/?quick=1&p2=cpu&cpu=1&seed=3`);
  await im.setViewportSize(TUCKED_UP);
  await im.waitForFunction(() => window.sketchbattle?.screen?.match && window.sketchbattle.screen.countdown <= 0, null, { timeout: 30000 });
  await expectTurned(im, "iphone match");
  await im.touchscreen.tap(...at(im, 960, 300));
  await im.waitForFunction(() => window.sketchbattle.touch.live, null, { timeout: 5000 });
  await calmBot(im);
  const ilayout = await im.evaluate(() => window.sketchbattle.touch.layout);
  let jabbed = null;
  for (let attempt = 0; attempt < 3 && !jabbed; attempt++) {
    await ready(im);
    await watch(im);
    await im.touchscreen.tap(...at(im, ilayout.buttons.attack.x, ilayout.buttons.attack.y));
    await sleep(500);
    jabbed = (await seen(im)).moves.find((m) => m === "jab1");
  }
  if (!jabbed) fail(`ATTACK tapped where the turned canvas draws it didn't jab: ${JSON.stringify(await seen(im))}`);
  await im.screenshot({ path: path.join(shots, "iphone-up-7-match.png") });
  const before = await fighter(im);
  await im.setViewportSize(SIDEWAYS);
  await sleep(800);
  const side = await fighter(im);
  await expectUpright(im, "match turned sideways");
  if (side.paused || !side.live || side.frame <= before.frame || side.stocks !== before.stocks) fail(`turned sideways mid-match: ${JSON.stringify({ before, side })}`);
  await im.screenshot({ path: path.join(shots, "iphone-side-2-match.png") });
  await im.touchscreen.tap(...at(im, 960, 300));
  const slayout = await im.evaluate(() => window.sketchbattle.touch.layout);
  jabbed = null;
  for (let attempt = 0; attempt < 3 && !jabbed; attempt++) {
    await ready(im);
    await watch(im);
    await im.touchscreen.tap(...at(im, slayout.buttons.attack.x, slayout.buttons.attack.y));
    await sleep(500);
    jabbed = (await seen(im)).moves.find((m) => m === "jab1");
  }
  if (!jabbed) fail("sideways mid-match, ATTACK didn't jab");
  await im.setViewportSize(TUCKED_UP);
  await sleep(800);
  const back = await fighter(im);
  await expectTurned(im, "match upright again");
  if (back.paused || !back.live || back.frame <= side.frame) fail(`upright again mid-match: ${JSON.stringify(back)}`);
  await im.screenshot({ path: path.join(shots, "iphone-up-8-match-again.png") });
  console.log(`  ATTACK by tap jabs; sideways and back mid-match: frames ${before.frame} -> ${side.frame} -> ${back.frame}, never paused, controls live, ATTACK still jabs`);

  console.log("3. an Android phone upright");
  const an = await page(chrome, "android", ANDROID_UP);
  const af = await Fingers.on(an);
  await an.goto(`${site}/?dev=Ada`);
  await toTitle(an);
  await sleep(800);
  await expectTurned(an, "android title");
  await an.screenshot({ path: path.join(shots, "android-up-1-title.png") });
  const createRow = await an.evaluate(() => window.sketchbattle.screen.items.findIndex((i) => i.id === "create"));
  await af.tap(...at(an, 720, 350 + createRow * 96 + 44));
  await toScreen(an, "CreateScreen");
  // the menu's tap went fullscreen (bars.ts); emulation can't resize a fullscreen page, so leave it before any turn
  await an.waitForFunction(() => !!document.fullscreenElement, null, { timeout: 3000 }).catch(() => fail("the menu tap didn't go fullscreen"));
  await an.evaluate(() => document.exitFullscreen());
  await sleep(500);
  await expectTurned(an, "android draw pad");
  // a stroke from the pad's top left toward its middle, as a finger draws it
  const stroke = Array.from({ length: 25 }, (_, i) => [600 + i * 25, 200 + i * 15 + Math.round(Math.sin(i / 3) * 40)]);
  const first = at(an, ...stroke[0]);
  await af.press(1, ...first);
  for (const p of stroke.slice(1)) { await af.move(1, ...at(an, ...p)); await sleep(16); }
  await af.lift(1);
  await sleep(300);
  // under each point the finger passed: ink, in the pad's own drawing and on the screen
  const v = an.viewportSize();
  const check = await an.evaluate(({ points, screen, vw }) => {
    const pad = window.sketchbattle.screen.tools.pad;
    const c = document.getElementById("game"), g = c.getContext("2d"), k = c.width / innerHeight;
    const ink = ([r, gr, b]) => r + gr + b < 300;
    const inPad = points.map(([x, y]) => ink(pad.raster.pixel(Math.floor((x - pad.rect.x) * 768 / pad.rect.w), Math.floor((y - pad.rect.y) * 768 / pad.rect.h))));
    // the screen point (cx, cy) is the turned stage's (cy, width - cx)
    const onScreen = screen.map(([cx, cy]) => ink(g.getImageData(Math.round(cy * k), Math.round((vw - cx) * k), 1, 1).data));
    const away = pad.raster.pixel(700, 60);
    return { inPad, onScreen, away: ink(away), blank: pad.blank };
  }, { points: stroke, screen: stroke.map((p) => at(an, ...p)), vw: v.width });
  if (check.blank || check.inPad.some((x) => !x) || check.onScreen.some((x) => !x) || check.away) fail(`the stroke isn't under the finger: ${JSON.stringify(check)}`);
  await an.screenshot({ path: path.join(shots, "android-up-2-draw-pad.png") });
  console.log(`  draw pad: ${stroke.length} points, every one ink in the drawing and on the screen under the finger, the paper away from it clean`);

  const am = await page(chrome, "android match", ANDROID_UP);
  const mf = await Fingers.on(am);
  await am.goto(`${site}/?quick=1&p2=cpu&cpu=1&seed=3`);
  await am.waitForFunction(() => window.sketchbattle?.screen?.match && window.sketchbattle.screen.countdown <= 0, null, { timeout: 30000 });
  await expectTurned(am, "android match");
  await mf.tap(...at(am, 960, 300));
  await am.waitForFunction(() => window.sketchbattle.touch.live, null, { timeout: 5000 });
  await calmBot(am);
  /** Pushes the stick toward the game's right for `ms`, then lets go: how far the fighter went. */
  async function stickRight(p, fingers, label) {
    const l = await p.evaluate(() => window.sketchbattle.touch.layout);
    await ready(p);
    const x0 = (await fighter(p)).x;
    const home = at(p, l.stick.x, l.stick.y);
    await fingers.press(1, ...home);
    for (let i = 1; i <= 6; i++) { await fingers.move(1, ...at(p, l.stick.x + (l.stick.r * i) / 6, l.stick.y)); await sleep(16); }
    await sleep(450);
    await p.screenshot({ path: path.join(shots, `${label}-stick.png`) });
    await fingers.lift(1);
    const x1 = (await fighter(p)).x;
    if (x1 - x0 < 40) fail(`${label}: the stick pushed toward the game's right moved the fighter ${x1 - x0}`);
    return x1 - x0;
  }
  async function attack(p, fingers, label) {
    const l = await p.evaluate(() => window.sketchbattle.touch.layout);
    for (let attempt = 0; attempt < 3; attempt++) {
      await ready(p);
      await watch(p);
      await fingers.tap(...at(p, l.buttons.attack.x, l.buttons.attack.y));
      await sleep(500);
      if ((await seen(p)).moves.includes("jab1")) return;
    }
    fail(`${label}: ATTACK didn't jab: ${JSON.stringify(await seen(p))}`);
  }
  const moved = await stickRight(am, mf, "android-up-3");
  await attack(am, mf, "android upright");
  await am.screenshot({ path: path.join(shots, "android-up-4-attack.png") });
  console.log(`  a touch match: the stick toward the game's right moved the fighter ${Math.round(moved)} right, ATTACK jabbed`);
  const ab = await fighter(am);
  await am.setViewportSize({ width: v.height, height: v.width });
  await sleep(800);
  await expectUpright(am, "android match sideways");
  const as = await fighter(am);
  if (as.paused || !as.live || as.frame <= ab.frame) fail(`android turned sideways mid-match: ${JSON.stringify(as)}`);
  const movedSide = await stickRight(am, mf, "android-side-1");
  await am.setViewportSize(v);
  await sleep(800);
  await expectTurned(am, "android match upright again");
  const movedUp = await stickRight(am, mf, "android-up-5");
  await attack(am, mf, "android upright again");
  console.log(`  turned sideways and back mid-match: the stick still steers (${Math.round(movedSide)}, ${Math.round(movedUp)}), ATTACK still jabs`);

  console.log("4. a desktop");
  const desk = await page(chrome, "desktop", DESKTOP);
  await desk.goto(site);
  await toTitle(desk);
  await sleep(600);
  await expectUpright(desk, "desktop");
  if (await desk.evaluate(() => document.documentElement.className !== "")) fail("the desktop's page has a class");
  await desk.setViewportSize({ width: 600, height: 900 });
  await sleep(400);
  await expectUpright(desk, "a tall desktop window");
  console.log("  not turned, even in a window taller than wide");

  if (errors.length) fail(`page errors:\n${errors.join("\n")}`);
  console.log(`turncheck passed; screenshots in ${shots}`);
} finally {
  await chrome?.close();
  await safari?.close();
  if (server && server.exitCode === null) {
    const exited = new Promise((r) => server.once("exit", r));
    server.kill();
    await exited;
  }
  fs.rmSync(data, { recursive: true, force: true });
}
