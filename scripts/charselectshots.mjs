// The lobby's character select, driven the way players drive it, with screenshots: VS BOTS on two desktops by mouse
// (a token dragged, a token tapped up and down, FIGHT! by a click) and by keyboard, a two-person room (a guest's FIGHT!
// opening the host's stage screen) with and without teams, SAME KEYBOARD with a friend on keyboard 2, and phones by
// touch (WebKit iPhone 15 sideways and upright, the game turned; Chromium Pixel 7). Starts its own server (DEV_LOGIN=1,
// a scratch data dir with a library of 23 characters drawn like the house fighters) and Vite.
//   node scripts/charselectshots.mjs [--out /tmp/ssd-charselect] [--only desktop-1920,room,keyboard,phones]
// Ports: SERVER_PORT 4541, VITE_PORT 6641.
import { chromium, webkit, devices } from "playwright";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { viewToCss } from "./lib/view.mjs";

const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : fallback; };
const OUT = arg("out", "/tmp/ssd-charselect");
const ONLY = arg("only", "")?.split(",").filter(Boolean);
const want = (part) => !ONLY.length || ONLY.includes(part);
const SERVER_PORT = Number(process.env.SERVER_PORT ?? 4541), VITE_PORT = Number(process.env.VITE_PORT ?? 6641);
const base = `http://localhost:${VITE_PORT}/`;
const data = fs.mkdtempSync(path.join(os.tmpdir(), "charselect-"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const problems = [];
const check = (ok, what) => { if (!ok) problems.push(what); console.log(`  ${ok ? "ok" : "PROBLEM"}: ${what}`); };
fs.mkdirSync(OUT, { recursive: true });

/** Pat's and Sam's libraries: 23 ready characters each, house art under made-up names. */
function seed() {
  fs.mkdirSync(path.join(data, "players"), { recursive: true });
  fs.mkdirSync(path.join(data, "gen", "drawings"), { recursive: true });
  const house = ["rocket", "slugbert", "wizard", "woodstove"];
  const names = ["TREEBEARD", "THE LORD OF FIRE", "DEATH STAR", "JEFF", "67", "SPONGEBOBERT", "NUKE CAR", "STATIONARY RAILGUN", "GRUG", "KING BOB", "MECH GUY", "LEGDAY SKIPPER", "ARTIST'S PENCIL", "DECIMATOR", "FAT SURGE", "TANK", "YOSHI 2", "TURTLE WITH JETPACK", "KUNGFUPANDA", "SANIC", "ATST WALKER", "PIKAYOU", "PAC-MAN"];
  for (const who of ["Pat", "Sam"]) {
    const owner = `dev-${who.toLowerCase()}`;
    const characters = names.map((name, i) => {
      const id = `gen-${who.toLowerCase()}-${i}`, dir = path.join(data, "gen", id, "0badf00d"), from = path.join("client/public/house", house[i % house.length]);
      fs.mkdirSync(dir, { recursive: true });
      for (const f of fs.readdirSync(from)) fs.copyFileSync(path.join(from, f), path.join(dir, f));
      // the bundle (and the fighter it registers) names the character
      const bundle = JSON.parse(fs.readFileSync(path.join(dir, "bundle.json"), "utf8"));
      fs.writeFileSync(path.join(dir, "bundle.json"), JSON.stringify({ ...bundle, id, name, source: bundle.source.split(`name: "${bundle.name}"`).join(`name: ${JSON.stringify(name)}`) }));
      fs.copyFileSync(path.join(from, "idle.png"), path.join(data, "gen", "drawings", `${id}.png`));
      return { id, owner, status: "ready", stage: "", error: null, name, tagline: "t", description: "d", drawingUrl: `/gen/drawings/${id}.png`, bundleUrl: `/gen/${id}/0badf00d/bundle.json`, sheetUrl: null, createdAt: 1e5 - i, origin: "creator", public: true };
    });
    fs.writeFileSync(path.join(data, "players", `${owner}.json`), JSON.stringify({ player: { id: owner, name: who, avatar: null }, lastPlayed: null, characters, saved: [] }));
  }
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
  throw new Error(`${what} never came up at ${url}`);
}

/** A page and the ways to drive it in view coordinates: the mouse on a desktop, a finger on a phone. */
class Player {
  constructor(name, page, phone) { this.name = name; this.page = page; this.phone = phone; }
  get turned() { const v = this.page.viewportSize(); return this.phone && v.height > v.width; }
  css(x, y) { return viewToCss(this.page.viewportSize(), this.turned, x, y); }
  screen(fn, a) { return this.page.evaluate(fn, a); }
  where() { return this.screen(() => window.sketchbattle.screen.select.where()); }
  room() { return this.screen(() => window.sketchbattle.screen.context.room); }
  async tap(x, y) {
    const [cx, cy] = this.css(x, y);
    if (this.phone) await this.page.touchscreen.tap(cx, cy);
    else { await this.page.mouse.click(cx, cy); }
    await sleep(350);
  }
  async tile(id) { const t = (await this.where()).tiles.find((x) => x.id === id); if (!t) throw new Error(`${this.name}: no tile ${id}`); return t; }
  async tapTile(id) { const t = await this.tile(id); await this.tap(t.x + t.w / 2, t.y + t.h / 2); }
  async seat(tag) { const s = (await this.where()).seats.find((x) => x.tag === tag); if (!s) throw new Error(`${this.name}: no ${tag}`); return s; }
  async tapToken(tag) { const s = await this.seat(tag); await this.tap(s.token.x, s.token.y); }
  /** Presses `tag`'s token and carries it over `id`'s tile; `drop` lets go there. */
  async carry(tag, id, drop) {
    const s = await this.seat(tag), t = await this.tile(id);
    const [x0, y0] = this.css(s.token.x, s.token.y), [x1, y1] = this.css(t.x + t.w * 0.62, t.y + t.h * 0.55);
    await this.page.mouse.move(x0, y0);
    await this.page.mouse.down();
    for (let i = 1; i <= 12; i++) { await this.page.mouse.move(x0 + ((x1 - x0) * i) / 12, y0 + ((y1 - y0) * i) / 12); await sleep(25); }
    await sleep(500);
    if (drop) { await this.page.mouse.up(); await sleep(400); }
  }
  async keys(...keys) { for (const k of keys) { await this.page.keyboard.press(k); await sleep(110); } }
  async shot(file, ms = 900) {
    await sleep(ms);
    await this.page.screenshot({ path: path.join(OUT, file) });
    console.log(`  ${file}`);
  }
  /** Signed in as `name`, on BATTLE's `row` (0 QUICK MATCH, 1 CREATE ROOM, 2 JOIN ROOM, 3 VS BOTS) or a SAME KEYBOARD room. */
  async into(entry) {
    await this.page.goto(`${base}?dev=${this.name}`);
    await this.page.waitForFunction(() => window.sketchbattle?.screen?.constructor.name === "TitleScreen" && window.sketchbattle.screen.items.length, null, { timeout: 30000 });
    if (!this.phone) await this.page.mouse.move(2, 2);
    await this.screen(async (entry) => {
      const online = await import("/src/screens/online.ts"), flow = await import("/src/screens/flow.ts"), ui = await import("/src/screens/ui.ts"), fighters = await import("/src/fighters.ts");
      await fighters.refreshLibrary();
      ui.goTo(new online.OnlineScreen(() => flow.menus().battle(), entry, null));
    }, entry);
    await this.page.waitForFunction(() => ["lobby", "create", "join"].includes(window.sketchbattle.screen.phase), null, { timeout: 15000 });
  }
  async waitRoom(pred, what, arg) {
    await this.page.waitForFunction(pred, arg, { timeout: 8000 }).catch(() => problems.push(`${this.name}: ${what}`));
  }
}

const SETTINGS = () => { localStorage.setItem("sketchbattle.settings", JSON.stringify({ volume: 0, music: 0 })); localStorage.setItem("sketchbattle.mobileNote", "1"); };
async function player(browser, name, options, phone = false, screen = null) {
  const context = await browser.newContext(options);
  const page = await context.newPage();
  page.on("pageerror", (e) => problems.push(`${name}: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|WebSocket/.test(m.text())) problems.push(`${name} console: ${m.text()}`); });
  await page.addInitScript(SETTINGS);
  if (screen) await page.addInitScript(([w, h]) => {
    Object.defineProperty(Screen.prototype, "width", { get: () => w });
    Object.defineProperty(Screen.prototype, "height", { get: () => h });
  }, [screen.width, screen.height]);
  return new Player(name, page, phone);
}

const bots = (p) => p.screen(() => window.sketchbattle.screen.context.room.bots.map((b) => b.fighter));
const mine = (p) => p.screen(() => { const s = window.sketchbattle.screen; return s.context.room.members.find((m) => m.id === s.context.id).fighter; });
const picking = (p) => p.screen(() => !!window.sketchbattle.screen.context.room.picking);

/** VS BOTS by mouse on a desktop: mid-pick (P1 placed, the CPU's token carried), everyone picked, then FIGHT! by a click. */
async function desktopBots(browser, w, h) {
  console.log(`VS BOTS ${w}x${h}`);
  const p = await player(browser, "Pat", { viewport: { width: w, height: h } });
  await p.into("bots");
  await p.waitRoom(() => window.sketchbattle.screen.context.room?.bots?.length === 1, "VS BOTS opened without its bot");
  await sleep(1500);
  check((await bots(p))[0] === "" && (await mine(p)) === "", `${w}: everyone starts with their token in hand`);
  await p.tapTile("gen-pat-1");
  check((await mine(p)) === "gen-pat-1", `${w}: a click on a fighter with nothing in hand puts P1 there`);
  if (w === 1920) {
    // the bot's level ◀ ▶, as today
    const was = (await p.room()).bots[0].level;
    const arrowsAt = await p.screen(() => window.sketchbattle.screen.select.where().levelArrows(1));
    await p.tap(arrowsAt.right.x, arrowsAt.right.y);
    check((await p.room()).bots[0].level === Math.min(was + 1, 9), `${w}: the CPU's level ▶ steps it`);
    await p.tap(arrowsAt.left.x, arrowsAt.left.y);
    check((await p.room()).bots[0].level === was, `${w}: and ◀ steps it back`);
    // + ADD BOT: a second bot, its token in hand, then its ×
    const add = (await p.where()).addBot;
    await p.tap(add.x + add.w / 2, add.y + add.h / 2);
    check((await bots(p)).length === 2 && (await bots(p))[1] === "", `${w}: + ADD BOT adds a bot with its token in hand`);
    const card = (await p.where()).seats[2].card;
    await p.tap(card.x + card.w - 24, card.y + 24);
    check((await bots(p)).length === 1, `${w}: the bot's × removes it`);
  }
  await p.carry("CPU", "gen-pat-8", false);
  await p.shot(`desktop-${w}-vsbots-midpick.png`, 300);
  await p.page.mouse.up();
  await sleep(500);
  check((await bots(p))[0] === "gen-pat-8", `${w}: the CPU's token dragged onto GRUG picks it`);
  await p.page.mouse.move(2, 2);
  await p.shot(`desktop-${w}-vsbots-allpicked.png`, 1200);
  // pick a placed token up by a click, then click a fighter: the band goes, then comes back
  await p.tapToken("CPU");
  check((await bots(p))[0] === "", `${w}: clicking a placed token picks it up and clears the pick`);
  await p.tapTile("gen-pat-5");
  check((await bots(p))[0] === "gen-pat-5", `${w}: then a click on a fighter puts it there`);
  await p.page.mouse.move(2, 2);
  await sleep(800);
  await p.tap(960, 540);
  await p.waitRoom(() => !!window.sketchbattle.screen.context.room.picking, `${w}: a click on FIGHT! didn't open the stage screen`);
  check(await picking(p), `${w}: a click anywhere on FIGHT! opens the stage screen`);
  await p.page.context().close();
}

/** VS BOTS by keyboard: P1's highlight over the roster, the CPU's token taken from its card, Enter on FIGHT!. */
async function keyboardBots(browser) {
  console.log("VS BOTS by keyboard");
  const p = await player(browser, "Pat", { viewport: { width: 1280, height: 720 } });
  await p.into("bots");
  await p.waitRoom(() => window.sketchbattle.screen.context.room?.bots?.length === 1, "VS BOTS opened without its bot");
  await sleep(1200);
  await p.keys("KeyD", "KeyD", "Enter");
  check((await mine(p)) === "gen-pat-1", "keyboard: right right Enter puts P1 on the second fighter");
  await p.keys("KeyD", "KeyS");
  await p.shot("keyboard-highlight.png", 400);
  // down off the roster's last row: the CPU's card
  for (let i = 0; i < 6 && (await p.screen(() => window.sketchbattle.screen.select.focus)) === "grid"; i++) await p.keys("KeyS");
  check((await p.screen(() => window.sketchbattle.screen.select.focus)) === "seat:b0", `keyboard: down off the roster lands on the CPU's card (${await p.screen(() => window.sketchbattle.screen.select.focus)})`);
  // its level, as today: down to it, right; back up to the card
  await p.keys("KeyS");
  const was = (await p.room()).bots[0].level;
  await p.keys("KeyD");
  check((await p.room()).bots[0].level === Math.min(was + 1, 9), "keyboard: the CPU's level steps with left/right");
  // Enter on the card takes its token; the highlight carries it
  await p.keys("KeyW", "Enter");
  await p.shot("keyboard-cpu-token.png", 400);
  await p.keys("KeyD", "Enter");
  const bot = (await bots(p))[0];
  check(bot !== "", `keyboard: Enter puts the CPU's token down (${bot})`);
  await sleep(600);
  await p.keys("Enter");
  await p.waitRoom(() => !!window.sketchbattle.screen.context.room.picking, "keyboard: Enter on FIGHT! didn't open the stage screen");
  check(await picking(p), "keyboard: Enter on FIGHT! opens the stage screen");
  await p.keys("Escape");
  await sleep(600);
  check(!(await picking(p)), "keyboard: Esc on the stage screen comes back to the lobby");
  // FIGHT! up again; an arrow takes P1's token back
  await sleep(500);
  await p.keys("KeyA");
  check((await mine(p)) === "", "keyboard: an arrow with FIGHT! up picks your token back up");
  await p.page.context().close();
}

/** A room with two people: the guest's FIGHT! opens the host's stage screen; and with teams on. */
async function twoPeople(browser) {
  console.log("a room with two people");
  const a = await player(browser, "Pat", { viewport: { width: 1920, height: 1080 } });
  const b = await player(browser, "Sam", { viewport: { width: 1920, height: 1080 } });
  await a.into("create");
  await a.screen(() => window.sketchbattle.screen.create(false));
  await a.page.waitForFunction(() => window.sketchbattle.screen.roomCode, null, { timeout: 10000 });
  const code = await a.screen(() => window.sketchbattle.screen.roomCode);
  await b.into("join");
  await b.screen((code) => window.sketchbattle.screen.join(code), code);
  for (const p of [a, b]) await p.waitRoom(() => window.sketchbattle.screen.context.room?.members.length === 2, "both in the room");
  await sleep(1200);
  await b.tapTile("gen-sam-3");
  await a.waitRoom(() => window.sketchbattle.screen.context.room.members[1].fighter === "gen-sam-3", "the host seeing the guest's pick");
  await a.shot("room-two-midpick.png", 800);
  await b.shot("room-two-midpick-guest.png", 0);
  await a.tapTile("gen-pat-1");
  await b.waitRoom(() => window.sketchbattle.screen.canFight(), "the guest seeing everyone picked");
  await b.page.mouse.move(2, 2);
  await b.shot("room-two-allpicked-guest.png", 1000);
  // the guest's click
  await b.tap(960, 540);
  for (const p of [a, b]) await p.waitRoom(() => !!window.sketchbattle.screen.picker, `${p.name}: a guest's FIGHT! didn't open the stage screen`);
  check(await a.screen(() => !!window.sketchbattle.screen.picker && window.sketchbattle.screen.context.room.host === window.sketchbattle.screen.context.id), "a guest's FIGHT! opens the host's stage screen");
  await a.shot("room-two-stage.png", 600);
  // back to the lobby, teams on, a token lifted
  await a.keys("Escape");
  await a.waitRoom(() => !window.sketchbattle.screen.picker, "the host's BACK from the stage screen");
  await a.screen(() => window.sketchbattle.screen.toggleTeams());
  await b.tapToken("P2");
  await a.waitRoom(() => window.sketchbattle.screen.context.room.teams && window.sketchbattle.screen.context.room.members[1].fighter === "", "teams on with the guest's token lifted");
  await b.page.mouse.move(2, 2);
  await a.page.mouse.move(2, 2);
  await a.shot("room-teams.png", 1000);
  await b.tapTile("gen-sam-6");
  await a.waitRoom(() => window.sketchbattle.screen.canFight(), "teams: everyone picked on two sides");
  await a.shot("room-teams-allpicked.png", 1000);
  for (const p of [a, b]) await p.page.context().close();
}

/** SAME KEYBOARD: keyboard 1 and a friend on keyboard 2 (arrows, . to confirm), each with a highlight. */
async function sameKeyboard(browser) {
  console.log("SAME KEYBOARD");
  const p = await player(browser, "Pat", { viewport: { width: 1920, height: 1080 } });
  await p.into("local");
  await p.waitRoom(() => window.sketchbattle.screen.context.room?.bots?.[0]?.device === "kb2", "SAME KEYBOARD opened without the friend on keyboard 2");
  await sleep(1200);
  await p.keys("KeyD", "KeyD", "Enter");
  await p.keys("ArrowRight", "ArrowDown", "ArrowRight");
  await p.shot("same-keyboard-midpick.png", 500);
  await p.keys("Period");
  check((await bots(p))[0] !== "", `the friend's . puts their token down (${(await bots(p))[0]})`);
  await p.shot("same-keyboard-allpicked.png", 1000);
  await p.keys("Period");
  await p.waitRoom(() => !!window.sketchbattle.screen.context.room.picking, "the friend's button on FIGHT! didn't open the stage screen");
  check(await picking(p), "a friend's button on FIGHT! opens the stage screen");
  await p.page.context().close();
}

/** A phone by touch: tap the CPU's token up (mid-pick), tap a fighter (everyone picked), tap FIGHT!. */
async function phone(browser, name, options, screen) {
  console.log(name);
  const p = await player(browser, "Pat", options, true, screen);
  await p.into("bots");
  await p.waitRoom(() => window.sketchbattle.screen.context.room?.bots?.length === 1, "VS BOTS opened without its bot");
  await sleep(1500);
  await p.tapTile("gen-pat-1");
  check((await mine(p)) === "gen-pat-1", `${name}: a tap on a fighter puts P1 there`);
  await p.tapToken("CPU");
  await p.shot(`${name}-midpick.png`, 600);
  const tiles = (await p.where()).tiles.filter((t) => t.shown && t.id);
  await p.tapTile(tiles[5].id);
  check((await bots(p))[0] === tiles[5].id, `${name}: tap the CPU's token, tap a fighter: it's there`);
  await p.shot(`${name}-allpicked.png`, 1200);
  await p.tap(960, 540);
  await p.waitRoom(() => !!window.sketchbattle.screen.context.room.picking, `${name}: a tap on FIGHT! didn't open the stage screen`);
  check(await picking(p), `${name}: a tap on FIGHT! opens the stage screen`);
  await p.page.context().close();
}

let chrome, safari;
try {
  seed();
  run("npx", ["tsx", "server/index.ts"], { PORT: String(SERVER_PORT), SKETCHBATTLE_DATA: data, DEV_LOGIN: "1", FORGE_TOKEN: "" });
  await up(`http://localhost:${SERVER_PORT}/api/health`, "server");
  run("npx", ["vite", "--config", "client/vite.config.ts", "--port", String(VITE_PORT), "--strictPort"], { SKETCHBATTLE_SERVER: `http://localhost:${SERVER_PORT}` });
  await up(base, "vite");
  chrome = await chromium.launch();
  safari = await webkit.launch();
  if (want("desktop-1920")) await desktopBots(chrome, 1920, 1080);
  if (want("desktop-1280")) await desktopBots(chrome, 1280, 720);
  if (want("keyboard")) await keyboardBots(chrome);
  if (want("room")) await twoPeople(chrome);
  if (want("same-keyboard")) await sameKeyboard(chrome);
  if (want("phones")) {
    const iphone = devices["iPhone 15"], pixel = devices["Pixel 7"];
    const screen = { width: 393, height: 852 };
    await phone(safari, "iphone-15-side", { ...iphone, viewport: { width: 852, height: 373 } }, screen);
    await phone(safari, "iphone-15-up", { ...iphone, viewport: { width: 393, height: 760 } }, screen);
    await phone(chrome, "pixel-7-side", devices["Pixel 7 landscape"], { width: 412, height: 915 });
  }
  if (problems.length) { console.log(`problems:\n  ${problems.join("\n  ")}`); process.exitCode = 1; }
  else console.log(`PASS charselectshots: screenshots in ${OUT}`);
} finally {
  await chrome?.close();
  await safari?.close();
  for (const { child } of children) { try { process.kill(-child.pid, "SIGTERM"); } catch { /* gone */ } }
  fs.rmSync(data, { recursive: true, force: true });
}
