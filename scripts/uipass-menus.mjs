// The menus on phones, in screenshots: every menu screen at every device size, upright (the game turned,
// client/src/turn.ts) and sideways, with a desktop at 1280x720 and 1920x1080 as the baseline. Starts its own server
// (DEV_LOGIN=1, a scratch data dir with made-up community characters and a player with a library) and Vite, so the
// screens can be opened straight from the page's own modules. On phones everything is reached by real taps (WebKit's
// touchscreen, Chromium's CDP touches) where it's a tap a player would make, and the lists are scrolled by finger.
// Screenshots to <out>/<device>/<screen>.png.
//   node scripts/uipass-menus.mjs [--out /tmp/ssd-uipass/menus] [--devices iphone-se-up,desktop-1280] [--screens title,battle]
// Ports: SERVER_PORT 4241, VITE_PORT 6341.
import { chromium, webkit, devices } from "playwright";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { viewToCss, viewScale } from "./lib/view.mjs";

const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : fallback; };
const OUT = arg("out", "/tmp/ssd-uipass/menus");
const ONLY_DEVICES = arg("devices", "")?.split(",").filter(Boolean);
const ONLY_SCREENS = arg("screens", "")?.split(",").filter(Boolean);
const SERVER_PORT = Number(process.env.SERVER_PORT ?? 4241), VITE_PORT = Number(process.env.VITE_PORT ?? 6341);
const base = `http://localhost:${VITE_PORT}/`;
const data = fs.mkdtempSync(path.join(os.tmpdir(), "uipass-menus-"));
fs.writeFileSync(path.join(data, "seo-characters.json"), "[]");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fail = (message) => { throw new Error(message); };

/**
 * Phones as Playwright has them, the screen pinned (WebKit's emulation makes it whatever the viewport was last set to).
 * Upright an iPhone's viewport is the tucked one (bars swiped away, client/src/bars.ts), sideways too; an Android's is
 * the profile's.
 */
const PHONES = [
  { name: "iphone-se", engine: "webkit", profile: "iPhone SE (3rd gen)", screen: { width: 375, height: 667 } },
  { name: "iphone-15", engine: "webkit", profile: "iPhone 15", screen: { width: 393, height: 852 } },
  { name: "iphone-15-pro-max", engine: "webkit", profile: "iPhone 15 Pro Max", screen: { width: 430, height: 932 } },
  { name: "pixel-7", engine: "chromium", profile: "Pixel 7", screen: { width: 412, height: 915 } },
  { name: "galaxy-s9", engine: "chromium", profile: "Galaxy S9+", screen: { width: 320, height: 658 } },
];
const DEVICES = [
  { name: "desktop-1280", engine: "chromium", options: { viewport: { width: 1280, height: 720 } } },
  { name: "desktop-1920", engine: "chromium", options: { viewport: { width: 1920, height: 1080 } } },
];
for (const p of PHONES) {
  const d = devices[p.profile];
  const iphone = p.engine === "webkit";
  const up = iphone ? { width: p.screen.width, height: p.screen.height - 92 } : d.viewport;
  const side = iphone ? { width: p.screen.height, height: p.screen.width - 20 } : devices[`${p.profile} landscape`].viewport;
  DEVICES.push({ name: `${p.name}-up`, engine: p.engine, phone: true, screen: p.screen, options: { ...d, viewport: up } });
  DEVICES.push({ name: `${p.name}-side`, engine: p.engine, phone: true, screen: p.screen, options: { ...d, viewport: side } });
}

/** Made-up community characters (drawn like the house fighters), and Pat's library: ready ones, one being made, one failed. */
function seed() {
  fs.mkdirSync(path.join(data, "players"), { recursive: true });
  fs.mkdirSync(path.join(data, "gen", "drawings"), { recursive: true });
  const house = ["rocket", "slugbert", "wizard", "woodstove"];
  const names = ["TEAPOT TITAN", "SIR SLUG", "MOON WIZ", "STOVE BOY", "ROCKO", "CAPTAIN CRAYON", "THE ERASER", "MISTER MUSTARD", "BUBBLE BOB", "LADY LIGHTNING", "PENCIL PETE", "SNORKEL", "GRUMPY CLOUD", "DINO DAVE", "SPAGHETTI KNIGHT", "ZIPPY"];
  const character = (owner, id, i, extra = {}) => {
    const dir = path.join(data, "gen", id, "0badf00d");
    fs.mkdirSync(dir, { recursive: true });
    const from = path.join("client/public/house", house[i % house.length]);
    for (const f of fs.readdirSync(from)) fs.copyFileSync(path.join(from, f), path.join(dir, f));
    // the bundle names the fighter it registers
    const bundle = JSON.parse(fs.readFileSync(path.join(dir, "bundle.json"), "utf8"));
    fs.writeFileSync(path.join(dir, "bundle.json"), JSON.stringify({ ...bundle, id, name: names[i % names.length] }));
    fs.copyFileSync(path.join(from, "idle.png"), path.join(data, "gen", "drawings", `${id}.png`));
    return { id, owner, status: "ready", stage: "", error: null, name: names[i % names.length], tagline: "Pours scalding justice on anyone who looks at it funny.", description: "d", drawingUrl: `/gen/drawings/${id}.png`, bundleUrl: `/gen/${id}/0badf00d/bundle.json`, sheetUrl: null, createdAt: 1000 + i, origin: "creator", public: true, ...extra };
  };
  names.forEach((_, i) => {
    const owner = `dev-maker${i}`;
    fs.writeFileSync(path.join(data, "players", `${owner}.json`), JSON.stringify({ player: { id: owner, name: `Maker ${i}`, avatar: null }, lastPlayed: null, characters: [character(owner, `gen-maker${i}-0`, i)], saved: [] }));
  });
  const pat = "dev-pat";
  const mine = Array.from({ length: 9 }, (_, i) => character(pat, `gen-pat-${i}`, i + 3));
  mine.push({ ...character(pat, "gen-pat-q", 2), status: "queued", stage: "queued", bundleUrl: null, stageAt: Date.now() });
  mine.push({ ...character(pat, "gen-pat-f", 1), status: "failed", error: "the drawing came out blank", bundleUrl: null, retryable: true });
  fs.writeFileSync(path.join(data, "players", `${pat}.json`), JSON.stringify({ player: { id: pat, name: "Pat", avatar: null }, lastPlayed: null, characters: mine, saved: [] }));
}

const children = [];
function run(cmd, args, env) {
  const child = spawn(cmd, args, { env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"], detached: true });
  let log = "";
  child.stdout.on("data", (d) => (log += d));
  child.stderr.on("data", (d) => (log += d));
  children.push({ child, log: () => log });
}
async function up(url, what) {
  for (let i = 0; i < 150; i++) {
    try { if ((await fetch(url)).ok) return; } catch { /* not listening yet */ }
    await sleep(200);
  }
  fail(`${what} never came up at ${url}`);
}

/** CDP touches, Chromium only: real touch events with real drags. */
class Fingers {
  constructor(cdp) { this.cdp = cdp; }
  point(x, y) { return [{ id: 1, x, y, radiusX: 6, radiusY: 6, force: 1 }]; }
  async tap(x, y) {
    await this.cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: this.point(x, y) });
    await sleep(60);
    await this.cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  }
  async drag(x, y, dx, dy, steps = 12) {
    await this.cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: this.point(x, y) });
    for (let i = 1; i <= steps; i++) { await this.cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: this.point(x + (dx * i) / steps, y + (dy * i) / steps) }); await sleep(16); }
    await sleep(80);
    await this.cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  }
}

/** One device's page and the ways to drive it. */
class Device {
  constructor(spec, page, fingers) { this.spec = spec; this.page = page; this.fingers = fingers; this.dir = path.join(OUT, spec.name); fs.mkdirSync(this.dir, { recursive: true }); }
  get turned() { const v = this.page.viewportSize(); return !!this.spec.phone && v.height > v.width; }
  css(vx, vy) { return viewToCss(this.page.viewportSize(), this.turned, vx, vy); }
  /** CSS pixels per view pixel. */
  get scale() { return viewScale(this.page.viewportSize(), this.turned); }
  /** A tap at a view point: a finger on a phone, the mouse on a desktop. */
  async tap(vx, vy) {
    const [x, y] = this.css(vx, vy);
    if (!this.spec.phone) { await this.page.mouse.click(x, y); await this.page.mouse.move(2, 2); }
    else if (this.fingers) await this.fingers.tap(x, y);
    else await this.page.touchscreen.tap(x, y);
    await sleep(250);
  }
  async tapRect(r) { await this.tap(r.x + r.w / 2, r.y + r.h / 2); }
  /** A finger (or the wheel, on a desktop) scrolling the view by `dy` view pixels, starting at a view point. */
  async drag(vx, vy, dy) {
    const [x, y] = this.css(vx, vy), [x2, y2] = this.css(vx, vy + dy);
    if (!this.spec.phone) { await this.page.mouse.move(x, y); await this.page.mouse.wheel(0, -dy * this.scale); await sleep(400); await this.page.mouse.move(2, 2); return true; }
    if (!this.fingers) return false;
    await this.fingers.drag(x, y, x2 - x, y2 - y);
    await sleep(500);
    return true;
  }
  name() { return this.page.evaluate(() => window.sketchbattle?.screen?.constructor.name); }
  async on(name, ms = 15000) {
    await this.page.waitForFunction((n) => window.sketchbattle?.screen?.constructor.name === n, name, { timeout: ms }).catch(async () => fail(`${this.spec.name}: wanted ${name}, on ${await this.name()}`));
  }
  /** Opens a screen straight from the page's modules: `make` runs in the page with them and returns the screen. */
  async open(make, name) {
    await this.page.evaluate(async (src) => {
      const mods = {
        flow: await import("/src/screens/flow.ts"), ui: await import("/src/screens/ui.ts"), online: await import("/src/screens/online.ts"),
        classtime: await import("/src/screens/classtime.ts"), signin: await import("/src/screens/signin.ts"), settings: await import("/src/screens/settings.ts"),
      };
      const nav = mods.flow.menus();
      // eslint-disable-next-line no-new-func
      const screen = new Function("m", "nav", `return (${src})(m, nav)`)(mods, nav);
      // what leaving it would release (a text field over the canvas, a room)
      window.sketchbattle.screen.abandon?.();
      mods.ui.goTo(screen);
    }, make.toString());
    await this.on(name);
  }
  screen(fn, arg) { return this.page.evaluate(fn, arg); }
  async shot(screen, ms = 900) {
    await sleep(ms);
    // a loaded machine steps the canvas's resolution down (render/pacing.ts): a blurrier shot isn't a change
    const full = () => this.page.evaluate(() => { const c = document.getElementById("game"); return c.width >= Math.floor(c.clientWidth * Math.min(2, devicePixelRatio)); });
    for (let i = 0; i < 40 && !(await full()); i++) await sleep(250);
    if (!(await full())) problems.push(`${this.spec.name} ${screen}: shot at a stepped-down resolution`);
    const file = path.join(this.dir, `${screen}.png`);
    await this.page.screenshot({ path: file });
    shots.push(file);
  }
}

const shots = [];
const problems = [];
const want = (screen) => !ONLY_SCREENS.length || ONLY_SCREENS.includes(screen);

/** A guest's screens: the title with SIGN IN, the way in, email, the birth date. */
async function guestPass(d) {
  await d.page.goto(base);
  await d.on("TitleScreen", 30000);
  if (want("title-guest")) await d.shot("title-guest", 2500);
  if (want("signin") || want("signin-email") || want("signin-age")) {
    // the guest's SIGN IN, top right
    await d.tapRect(await d.screen(() => ({ x: 1920 - 260, y: 30, w: 220, h: 76 })));
    await d.on("SignInScreen");
    await d.shot("signin");
    const email = await d.screen(() => window.sketchbattle.screen.buttons().find((b) => b.id === "email"));
    await d.tapRect(email);
    await d.shot("signin-email");
    const sw = await d.screen(() => window.sketchbattle.screen.buttons().find((b) => b.id === "switch"));
    await d.page.evaluate(() => document.activeElement?.blur());
    await d.tapRect(sw);
    await d.page.evaluate(() => document.activeElement?.blur());
    await d.shot("signin-age");
    await d.page.evaluate(() => { const f = document.querySelector("#overlay input"); f.value = "2001"; f.dispatchEvent(new Event("input")); });
    await d.tapRect(await d.screen(() => window.sketchbattle.screen.buttons().find((b) => b.id === "next")));
    await d.shot("signin-month");
  }
}

async function signedInPass(d) {
  await d.page.goto(`${base}?dev=Pat`);
  await d.on("TitleScreen", 30000);
  await d.page.waitForFunction(() => window.sketchbattle.screen.items.length > 0);
  if (want("title")) await d.shot("title", 2500);
  if (want("whats-new")) {
    await d.page.evaluate(async () => {
      (await import("/src/account.ts")).unseenReleases.push({ version: "0.2.0", title: "COMMUNITY CHARACTERS UPDATE", fresh: [], note: [
        "Hey Dudes!",
        "This is the first big update to the game! You've all been hard at work making characters, and there are now {made} player-made characters in the game. That's a lot!",
        "To let you try them all, there's now a community characters page where you can see what other people have made and do battle with those characters as well as your own.",
        "The more people who save a character and play matches with it, the higher it will appear on the list!",
      ] });
    });
    await d.open((m, nav) => nav.title(), "TitleScreen");
    await d.shot("whats-new", 2500);
    // its LET'S GO!
    await d.tap(960, (1080 - 880) / 2 + 880 - 130 + 48);
    await d.shot("whats-new-closed", 300);
  }
  // BATTLE by tap from the title
  if (want("battle") || want("lobby-bots") || want("stage")) {
    await d.open((m, nav) => nav.title(), "TitleScreen");
    await sleep(500);
    const row = await d.screen(() => window.sketchbattle.screen.items.findIndex((i) => i.id === "battle"));
    await d.tapRect(await d.screen((i) => window.sketchbattle.screen.rowRect(i), row));
    await d.on("BattleMenuScreen");
    if (want("battle")) await d.shot("battle");
    // VS BOTS, the fourth card
    const bots = await d.screen(() => { const s = window.sketchbattle.screen; return s.cardRects ? s.cardRects()[3] : { x: 600, y: 220 + 3 * 150, w: 720, h: 130 }; });
    await d.tapRect(bots);
    await d.on("OnlineScreen");
    await d.page.waitForFunction(() => window.sketchbattle.screen.phase === "lobby" && window.sketchbattle.screen.lobbyDebug(), null, { timeout: 15000 });
    if (want("lobby-bots")) await d.shot("lobby-bots", 2500);
    if (want("lobby-bots")) {
      // the bot by tap: its token up, then a fighter; its level's ▶; a second bot's ×
      const where = () => d.screen(() => window.sketchbattle.screen.select.where());
      const bots = () => d.screen(() => window.sketchbattle.screen.context.room.bots);
      const cpu = (await where()).seats[1];
      await d.tap(cpu.token.x, cpu.token.y);
      const tile = (await where()).tiles.find((t) => t.id && t.shown);
      await d.tapRect(tile);
      if ((await bots())[0].fighter !== tile.id) problems.push(`${d.spec.name}: tapping the CPU's token, then ${tile.id}, left it on "${(await bots())[0].fighter}"`);
      // its token back up, so the level can be stepped (with every slot picked, FIGHT! covers the cards)
      const placed = (await where()).seats[1];
      await d.tap(placed.token.x, placed.token.y);
      const was = (await bots())[0].level;
      const level = await d.screen(() => window.sketchbattle.screen.select.where().levelArrows(1));
      await d.tap(level.right.x, level.right.y);
      await sleep(400);
      if ((await bots())[0].level === was && was < 9) problems.push(`${d.spec.name}: a tap on the bot's level ▶ left it at ${was}`);
      await d.screen(() => window.sketchbattle.screen.addBot());
      await d.page.waitForFunction(() => window.sketchbattle.screen.context.room.bots.length === 2);
      const card = (await where()).seats[2].card;
      await d.tap(card.x + card.w - 26, card.y + 30);
      await sleep(500);
      if ((await bots()).length !== 1) problems.push(`${d.spec.name}: a tap on the bot's × left ${(await bots()).length} bots`);
      await d.screen(() => window.sketchbattle.screen.addBot());
      await d.screen(() => window.sketchbattle.screen.toggleTeams());
      await d.shot("lobby-bots-teams", 2500);
      await d.screen(() => window.sketchbattle.screen.toggleTeams());
    }
    if (want("stage")) {
      await d.screen(() => { const s = window.sketchbattle.screen, f = s.select.grid.fighters; s.pick(f[0]); s.context.room.bots.forEach((b, i) => s.pickBot(i, f[1])); });
      await d.page.waitForFunction(() => window.sketchbattle.screen.canFight());
      await d.screen(() => window.sketchbattle.screen.openStagePick());
      await d.shot("stage", 2000);
      // STOCKS ▶ by tap
      const small = await d.page.evaluate(async () => (await import("/src/screens/ui.ts")).small());
      const stocks = () => d.screen(() => window.sketchbattle.screen.picker.stocks);
      const was = await stocks();
      if (small) await d.tap(960 - 190 + 100, 690 + 60); else await d.tap(960 + 190 + 80, 690 + 45);
      if ((await stocks()) !== Math.min(10, was + 1)) problems.push(`${d.spec.name}: a tap on STOCKS ▶ took ${was} to ${await stocks()}`);
    }
  }
  if (want("lobby-create")) {
    await d.open((m) => new m.online.OnlineScreen(() => m.flow.menus().title(), "create", null), "OnlineScreen");
    await d.shot("lobby-create");
  }
  if (want("lobby-join")) {
    await d.open((m) => new m.online.OnlineScreen(() => m.flow.menus().title(), "join", null), "OnlineScreen");
    await d.shot("lobby-join", 2600);
    // a phone types the code: a tap on the boxes raises the keyboard (an <input> over them), the letters fill them, JOIN joins
    if (d.spec.phone) {
      const code = await helper.evaluate(() => window.sketchbattle.screen.roomCode);
      const codeY = await d.page.evaluate(async () => ((await import("/src/screens/ui.ts")).small() ? 170 + 4 * 116 + 60 : 170 + 5 * 84 + 60));
      await d.tap(960 - 330 + 50, codeY + 60);
      const focused = await d.page.evaluate(() => document.activeElement?.tagName === "INPUT");
      if (!focused) problems.push(`${d.spec.name}: a tap on the room code didn't focus a field`);
      await d.page.keyboard.type(code.toLowerCase(), { delay: 40 });
      await sleep(300);
      const typed = await d.screen(() => window.sketchbattle.screen.code.join(""));
      if (typed !== code) problems.push(`${d.spec.name}: typing ${code} into the room code gave "${typed}"`);
      await d.shot("lobby-join-typed", 300);
      await d.page.evaluate(() => document.activeElement?.blur());
      await d.tap(960 + 200 + 90, codeY + 60);
      await d.page.waitForFunction((c) => window.sketchbattle.screen.roomCode === c, code, { timeout: 8000 }).catch(() => problems.push(`${d.spec.name}: JOIN with the typed code didn't land in room ${code}`));
    }
  }
  if (want("lobby-room")) {
    await d.open((m) => new m.online.OnlineScreen(() => m.flow.menus().title(), "quick", null), "OnlineScreen");
    await d.page.waitForFunction(() => window.sketchbattle.screen.phase === "lobby", null, { timeout: 15000 });
    await d.shot("lobby-room", 2500);
  }
  if (want("lobby-error")) {
    await d.open((m) => { const s = new m.online.OnlineScreen(() => m.flow.menus().title(), "create", null); s.phase = "error"; s.error = "COULD NOT CONNECT"; return s; }, "OnlineScreen");
    await d.shot("lobby-error", 400);
  }
  if (want("library")) {
    await d.open((m, nav) => nav.library(), "LibraryScreen");
    await d.shot("library", 2500);
    if (await d.drag(960, 700, -500)) await d.shot("library-scrolled", 1200);
    const cell = await d.screen(() => window.sketchbattle.screen.gridButtons().find((b) => b.id === "c0" && b.y > 0));
    if (cell) {
      await d.tapRect(cell);
      await d.shot("library-detail", 2500);
    }
  }
  if (want("community")) {
    await d.open((m, nav) => nav.community(), "CommunityScreen");
    await d.page.waitForFunction(() => window.sketchbattle.screen.items?.length > 0, null, { timeout: 10000 });
    await d.shot("community", 2500);
    const scrolled = await d.drag(960, 700, -500);
    if (scrolled) {
      const offset = await d.screen(() => window.sketchbattle.screen.scroll.offset);
      if (offset < 100) problems.push(`${d.spec.name}: a finger drag on COMMUNITY scrolled it ${Math.round(offset)}`);
      await d.shot("community-scrolled", 1200);
      await d.drag(960, 400, 900);
    }
    const cell = await d.screen(() => window.sketchbattle.screen.gridButtons().find((b) => b.id === "c0" && b.y > 0));
    await d.tapRect(cell);
    await d.shot("community-detail", 2500);
  }
  if (want("settings")) {
    await d.open((m, nav) => nav.title(), "TitleScreen");
    await sleep(400);
    const row = await d.screen(() => window.sketchbattle.screen.items.findIndex((i) => i.id === "settings"));
    await d.tapRect(await d.screen((i) => window.sketchbattle.screen.rowRect(i), row));
    await d.on("SettingsScreen");
    await d.shot("settings");
    // SOUND VOLUME's right side by tap
    const sound = await d.screen(() => window.sketchbattle.screen.buttons().find((b) => b.id === "sound"));
    await d.tap(sound.stepAt + 80, sound.y + sound.h / 2);
    const volume = await d.page.evaluate(() => JSON.parse(localStorage.getItem("sketchbattle.settings")).volume);
    if (volume !== 0.1) problems.push(`${d.spec.name}: a tap on SOUND VOLUME's right side made it ${volume}`);
    await d.tapRect(await d.screen(() => window.sketchbattle.screen.buttons().find((b) => b.id === "tab")));
    await d.shot("settings-controls");
    await d.tapRect(await d.screen(() => window.sketchbattle.screen.buttons().find((b) => b.id === "tab")));
    await d.tapRect(await d.screen(() => window.sketchbattle.screen.buttons().find((b) => b.id === "name")));
    await d.on("RenameScreen");
    await d.page.evaluate(() => document.activeElement?.blur());
    await d.shot("rename", 1200);
  }
  if (want("feedback")) {
    await d.open((m, nav) => new m.classtime.FeedbackScreen(() => nav.title()), "FeedbackScreen");
    await d.page.evaluate(() => document.activeElement?.blur());
    await d.shot("feedback", 1200);
  }
  if (want("class")) {
    await d.open((m, nav) => nav.title(), "TitleScreen");
    await d.page.evaluate(async () => { (await import("/src/classtime.ts")).classTime.blocked = true; });
    await d.on("ClassScreen");
    await d.shot("class", 1200);
    await d.page.evaluate(async () => { (await import("/src/classtime.ts")).classTime.blocked = false; });
  }
}

let chrome, safari, helper;
try {
  seed();
  run("npx", ["tsx", "server/index.ts"], { PORT: String(SERVER_PORT), SKETCHBATTLE_DATA: data, DEV_LOGIN: "1", FORGE_TOKEN: "" });
  await up(`http://localhost:${SERVER_PORT}/api/health`, "server");
  run("npx", ["vite", "--config", "client/vite.config.ts", "--port", String(VITE_PORT), "--strictPort"], { SKETCHBATTLE_SERVER: `http://localhost:${SERVER_PORT}` });
  await up(base, "vite");
  chrome = await chromium.launch();
  safari = await webkit.launch();
  const errors = [];
  const settings = () => { localStorage.setItem("sketchbattle.settings", JSON.stringify({ volume: 0, music: 0 })); localStorage.setItem("sketchbattle.mobileNote", "1"); };

  // someone's public lobby, for JOIN ROOM's list and QUICK MATCH to land in
  helper = await (await chrome.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  await helper.addInitScript(settings);
  await helper.goto(`${base}?dev=Hana`);
  await helper.waitForFunction(() => window.sketchbattle?.screen?.constructor.name === "TitleScreen", null, { timeout: 30000 });
  await helper.evaluate(async () => {
    const online = await import("/src/screens/online.ts"), flow = await import("/src/screens/flow.ts"), ui = await import("/src/screens/ui.ts");
    ui.goTo(new online.OnlineScreen(() => flow.menus().title(), "create", null));
  });
  await helper.waitForFunction(() => window.sketchbattle.screen.phase === "create");
  await helper.evaluate(() => window.sketchbattle.screen.create(true));
  await helper.waitForFunction(() => window.sketchbattle.screen.phase === "lobby", null, { timeout: 15000 });

  for (const spec of DEVICES) {
    if (ONLY_DEVICES.length && !ONLY_DEVICES.includes(spec.name)) continue;
    console.log(spec.name);
    const browser = spec.engine === "webkit" ? safari : chrome;
    for (const pass of [guestPass, signedInPass]) {
      const context = await browser.newContext(spec.options);
      const page = await context.newPage();
      page.on("pageerror", (e) => errors.push(`${spec.name}: ${e.message}`));
      page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|WebSocket/.test(m.text())) errors.push(`${spec.name} console: ${m.text()}`); });
      await page.addInitScript(settings);
      if (spec.screen) await page.addInitScript(([w, h]) => {
        Object.defineProperty(Screen.prototype, "width", { get: () => w });
        Object.defineProperty(Screen.prototype, "height", { get: () => h });
      }, [spec.screen.width, spec.screen.height]);
      const fingers = spec.phone && spec.engine === "chromium" ? new Fingers(await context.newCDPSession(page)) : null;
      const d = new Device(spec, page, fingers);
      try { await pass(d); } catch (e) { problems.push(`${spec.name} ${pass.name}: ${e.message.split("\n")[0]}`); await page.screenshot({ path: path.join(d.dir, `failed-${pass.name}.png`) }).catch(() => {}); }
      // Android: a menu tap goes fullscreen (bars.ts); leave it so the next context starts clean
      await context.close();
    }
  }
  console.log(`${shots.length} screenshots in ${OUT}`);
  if (errors.length) console.log(`page errors:\n  ${[...new Set(errors)].join("\n  ")}`);
  if (problems.length) { console.log(`problems:\n  ${problems.join("\n  ")}`); process.exitCode = 1; }
} finally {
  await chrome?.close();
  await safari?.close();
  for (const { child } of children) { try { process.kill(-child.pid, "SIGTERM"); } catch { /* gone */ } }
  fs.rmSync(data, { recursive: true, force: true });
}
