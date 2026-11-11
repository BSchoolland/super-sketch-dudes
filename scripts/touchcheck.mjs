// The touch controls end to end, with real multi-touch (CDP Input.dispatchTouchEvent) on emulated phones. Starts its
// own fake Discord, server and Vite, then:
//   1. A phone held sideways taps its way to VS BOTS and plays it by touch alone: moves, jumps, attacks, smashes,
//      specials, shields, holds the stick and two buttons at once, pauses and resumes, and KOs the bot.
//   2. The phone turned upright mid-match: the match pauses under a "turn your phone sideways" prompt.
//   3. QUICK MATCH, the phone on touch against a desktop on the keyboard: both clients hash the same state.
//   4. The Discord Activity (stubbed) on the phone: the call room, played by touch against a desktop.
//   5. A tablet's match, and the settings page's touch view on the phone.
//   6. A desktop with no touchscreen never shows the controls.
//   7. The phone's page sessions say they played on touch.
// Usage: node scripts/touchcheck.mjs [--shots <dir>]   (screenshots default to /tmp/ssd-touch-shots)
import { chromium } from "playwright";
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startFakeDiscord } from "./fake-discord.mjs";
import { signIn } from "./menu-nav.mjs";

const SERVER_PORT = Number(process.env.SERVER_PORT ?? 3341), VITE_PORT = Number(process.env.VITE_PORT ?? 5541), SECRET = "touchcheck-secret";
const shotsAt = process.argv.indexOf("--shots");
const shots = shotsAt > 0 ? process.argv[shotsAt + 1] : "/tmp/ssd-touch-shots";
fs.mkdirSync(shots, { recursive: true });
const data = fs.mkdtempSync(path.join(os.tmpdir(), "touchcheck-"));
fs.writeFileSync(path.join(data, "staff.json"), "[]");
const base = `http://localhost:${VITE_PORT}/`;
const children = [];
const fail = (message) => { throw new Error(message); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function run(cmd, args, env) {
  const child = spawn(cmd, args, { env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"], detached: true });
  let log = "";
  child.stdout.on("data", (d) => (log += d));
  child.stderr.on("data", (d) => (log += d));
  children.push({ child, log: () => log });
  return child;
}
async function up(url, what) {
  for (let i = 0; i < 150; i++) {
    try { if ((await fetch(url)).ok) return; } catch { /* not listening yet */ }
    await sleep(200);
  }
  fail(`${what} never came up at ${url}`);
}

const PHONE = { viewport: { width: 844, height: 390 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36" };
const TABLET = { viewport: { width: 1180, height: 820 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const DESKTOP = { viewport: { width: 1280, height: 720 } };
// the weakest bots: a KO by touch shouldn't take all day
const SETTINGS = () => { if (location.protocol.startsWith("http")) localStorage.setItem("sketchbattle.settings", JSON.stringify({ cpuTier: 1, volume: 0, music: 0 })); };

/** Fingers on a page's screen: every event lists every finger still down, so the touches are really simultaneous. */
class Fingers {
  constructor(page, cdp) { this.page = page; this.cdp = cdp; this.down = new Map(); }
  static async on(page) { return new Fingers(page, await page.context().newCDPSession(page)); }
  async send(type) {
    await this.cdp.send("Input.dispatchTouchEvent", { type, touchPoints: [...this.down.values()] });
  }
  async press(id, x, y) { this.down.set(id, { id, x, y, radiusX: 8, radiusY: 8, force: 1 }); await this.send("touchStart"); }
  async move(id, x, y) { this.down.set(id, { ...this.down.get(id), x, y }); await this.send("touchMove"); }
  async lift(id) { this.down.delete(id); await this.send("touchEnd"); }
  async liftAll() { if (!this.down.size) return; this.down.clear(); await this.send("touchEnd"); }
  /** A tap at view coordinates (the 1920x1080 game view). */
  async tapView(vx, vy, hold = 60) {
    const [x, y] = await this.toCss(vx, vy);
    await this.press(90, x, y); await sleep(hold); await this.lift(90);
  }
  async toCss(vx, vy) {
    // the size is cached: a round trip per finger move would spread a flick over many ticks
    const { width: w, height: h } = this.page.viewportSize();
    const s = Math.min(w / 1920, h / 1080);
    return [(w - 1920 * s) / 2 + vx * s, (h - 1080 * s) / 2 + vy * s];
  }
}

/** The phone's thumbs on the controls as a match lays them out, in CSS pixels. */
class Thumbs {
  constructor(fingers) { this.f = fingers; }
  async layout() { this.l = await this.f.page.evaluate(() => window.sketchbattle.touch.layout); return this.l; }
  async at(c) { return this.f.toCss(c.x, c.y); }
  async stickDown() { const [x, y] = await this.at(this.l.stick); this.home = [x, y]; await this.f.press(1, x, y); }
  /** Pushes the stick to (dx, dy) of a full push: in one event (a flick) or over `ms`. */
  async push(dx, dy, ms = 0) {
    if (!this.f.down.has(1)) await this.stickDown();
    const [hx, hy] = this.home, s = (await this.f.toCss(this.l.stick.r, 0))[0] - (await this.f.toCss(0, 0))[0];
    const steps = ms ? Math.max(2, Math.round(ms / 16)) : 1;
    const from = this.f.down.get(1);
    for (let i = 1; i <= steps; i++) {
      const tx = hx + dx * s, ty = hy + dy * s;
      await this.f.move(1, from.x + ((tx - from.x) * i) / steps, from.y + ((ty - from.y) * i) / steps);
      if (ms) await sleep(16);
    }
  }
  async release() { if (this.f.down.has(1)) await this.f.lift(1); }
  async hold(button, id = 2) { const [x, y] = await this.at(this.l.buttons[button]); await this.f.press(id, x, y); }
  async letGo(id = 2) { await this.f.lift(id); }
  async tap(button, ms = 50, id = 2) { await this.hold(button, id); await sleep(ms); await this.letGo(id); }
  async pause() { const [x, y] = await this.at(this.l.pause); await this.f.press(3, x, y); await sleep(60); await this.f.lift(3); }
}

/** Records the local fighter's actions and moves every tick, and what the touch controls sent. */
const RECORD = () => {
  window.__seen = { actions: new Set(), moves: new Set(), inputs: [] };
  setInterval(() => {
    const s = window.sketchbattle?.screen, st = s?.match?.state;
    if (!st) return;
    const slot = s.session ? s.session.localSlot : 0;
    const f = st.fighters[slot];
    window.__seen.actions.add(f.action);
    if (f.move) window.__seen.moves.add(f.move);
    const i = s.match.lastInputs[slot];
    if (i && window.__seen.inputs.length < 20000) window.__seen.inputs.push(i);
  }, 8);
};
const seen = (p) => p.evaluate(() => ({ actions: [...window.__seen.actions], moves: [...window.__seen.moves] }));
const resetSeen = (p) => p.evaluate(() => { window.__seen.actions.clear(); window.__seen.moves.clear(); window.__seen.inputs.length = 0; });
const me = (p) => p.evaluate(() => { const s = window.sketchbattle.screen; const st = s.match.state; const slot = s.session ? s.session.localSlot : 0; const f = st.fighters[slot], o = st.fighters.find((x) => x.slot !== slot); return { x: f.x, y: f.y, vy: f.vy, action: f.action, move: f.move, grounded: f.grounded, facing: f.facing, jumps: f.jumpsLeft, stocks: f.stocks, ox: o.x, oy: o.y, ostocks: o.stocks, opct: o.percent, ended: st.ended, winner: st.winner, frame: st.frame }; });
const inMatch = (p) => p.waitForFunction(() => window.sketchbattle?.screen?.match && window.sketchbattle.screen.countdown <= 0 && window.sketchbattle.touch.live, null, { timeout: 30000 });

let browser;
const fake = await startFakeDiscord({ secret: SECRET });
try {
  run("npx", ["tsx", "server/index.ts"], { PORT: String(SERVER_PORT), SKETCHBATTLE_DATA: data, DEV_LOGIN: "1", DISCORD_API: fake.api, DISCORD_CLIENT_SECRET: SECRET, FORGE_TOKEN: "" });
  await up(`http://localhost:${SERVER_PORT}/api/health`, "server");
  run("npx", ["vite", "--config", "client/vite.config.ts", "--port", String(VITE_PORT), "--strictPort"], { SKETCHBATTLE_SERVER: `http://localhost:${SERVER_PORT}` });
  await up(base, "vite");
  browser = await chromium.launch();
  const errors = [];
  async function page(name, device) {
    const p = await (await browser.newContext(device)).newPage();
    p.on("pageerror", (e) => errors.push(`${name}: ${e.message}`));
    p.on("console", (m) => { if (m.type() === "error") errors.push(`${name} console: ${m.text()}`); });
    await p.addInitScript(SETTINGS);
    await p.addInitScript(RECORD);
    return p;
  }
  const screenName = (p) => p.evaluate(() => window.sketchbattle.screen.constructor.name);
  /** Title -> BATTLE -> `row` of the battle menu, by tapping the cards. */
  async function tapToBattle(p, fingers, row) {
    for (let tries = 0; (await screenName(p)) !== "BattleMenuScreen"; tries++) {
      if (tries > 4) fail(`tapping BATTLE left the phone on ${await screenName(p)}`);
      // a brawl fighter standing on the card takes the tap: try along it
      await fingers.tapView(720 + tries * 120, 394);
      await sleep(400);
      if ((await screenName(p)) !== "TitleScreen" && (await screenName(p)) !== "BattleMenuScreen") { await p.goBack().catch(() => {}); fail(`a tap on BATTLE opened ${await screenName(p)}`); }
    }
    await fingers.tapView(960, 220 + row * 150 + 65);
    await p.waitForFunction(() => window.sketchbattle.screen.constructor.name === "OnlineScreen", null, { timeout: 10000 });
  }
  async function pickAndStart(pages, fighters, setup) {
    for (const [i, p] of pages.entries()) await p.evaluate((id) => {
      window.sketchbattle.screen.pick({ id, name: id.toUpperCase(), bundleUrl: `/house/${id}/bundle.json?v=${window.sketchbattle.build}`, house: true, entry: null });
    }, fighters[i]);
    await Promise.all(pages.map((p) => p.waitForFunction(() => window.sketchbattle.screen.lobbyDebug()?.members.every((m) => m.fighter))));
    if (pages.length > 1) for (const p of pages) await p.evaluate(() => window.sketchbattle.screen.toggleReady());
    await pages[0].waitForFunction(() => window.sketchbattle.screen.canStart(), null, { timeout: 10000 });
    await pages[0].evaluate((setup) => window.sketchbattle.screen.startMatch(setup), setup);
  }
  async function hashesAgree(pages, label) {
    // both clients idle a moment so every input has landed everywhere, then the newest frame both still hold
    await sleep(800);
    const [a, b] = await Promise.all(pages.map((p) => p.evaluate(() => window.sketchbattle.screen.netDebug())));
    let frame = Math.min(a.frame, b.frame), hashes = [null, null];
    for (; frame > 0; frame--) {
      hashes = await Promise.all(pages.map((p) => p.evaluate((f) => window.sketchbattle.screen.netDebug(f).hash, frame)));
      if (hashes[0] !== null && hashes[1] !== null) break;
    }
    if (hashes[0] === null || hashes[0] !== hashes[1]) fail(`${label}: hashes at frame ${frame} were ${hashes.join(" vs ")}`);
    const desync = await Promise.all(pages.map((p) => p.evaluate(() => window.sketchbattle.screen.session.desync)));
    if (desync.some(Boolean)) fail(`${label}: desync ${JSON.stringify(desync)}`);
    console.log(`  ${label}: both clients hashed ${hashes[0]} at frame ${frame}`);
  }

  console.log("1. VS BOTS on a phone, by touch");
  const phone = await page("phone", PHONE);
  const pf = await Fingers.on(phone);
  await signIn(phone, base, "Tess");
  await tapToBattle(phone, pf, 3);
  await phone.waitForFunction(() => window.sketchbattle.screen.lobbyDebug?.(), null, { timeout: 10000 });
  await phone.waitForFunction(() => (window.sketchbattle.screen.context.room?.bots ?? []).length > 0, null, { timeout: 10000 });
  await pickAndStart([phone], ["rocket"], { stage: "proving", stocks: 2, time: 0, map: null });
  await phone.waitForFunction(() => window.sketchbattle.screen.constructor.name === "VersusScreen", null, { timeout: 20000 });
  await inMatch(phone);
  const t = new Thumbs(pf);
  await t.layout();
  await phone.screenshot({ path: path.join(shots, "phone-landscape-match.png") });
  // the bot stands still while each move is tried (its hits would cut them short), and fights for the KO
  const botLevel = await phone.evaluate(() => window.sketchbattle.screen.match.sources[1].cpu);
  const setBot = (level) => phone.evaluate((level) => { const s = window.sketchbattle.screen; s.match.sources[1].cpu = level; s.match.state.fighters[1].cpu = level; }, level);
  await setBot(0);
  const touch = await phone.evaluate(() => window.sketchbattle.touch);
  if (!touch.live || !touch.inUse) fail(`the controls aren't up on the phone: ${JSON.stringify(touch)}`);

  // move
  await resetSeen(phone);
  let before = await me(phone);
  await t.push(1, 0, 60); await sleep(500);
  let after = await me(phone);
  const ran = (await seen(phone)).actions;
  if (after.x - before.x < 20 || !ran.some((a) => a === "dash" || a === "run")) fail(`pushing right moved the fighter ${after.x - before.x} (${ran.join(", ")})`);
  await t.push(-0.4, 0, 120); await sleep(300);
  const walked = await seen(phone);
  await t.release(); await sleep(200);
  console.log(`  move: ${Math.round(after.x - before.x)} to the right, then ${walked.actions.filter((a) => ["walk", "dash", "run", "runTurn", "skid"].includes(a)).join(", ")}`);
  // jump, double jump, fast fall
  await sleep(300);
  await t.tap("jump", 150); await sleep(250);
  after = await me(phone);
  if (after.grounded) fail("JUMP didn't leave the ground");
  const jumps = after.jumps;
  await t.tap("jump", 60); await sleep(100);
  if ((await me(phone)).jumps !== jumps - 1) fail("a second JUMP in the air wasn't a double jump");
  await sleep(250);
  await t.push(0, 1, 0); await sleep(150);
  const ff = await phone.evaluate(() => window.sketchbattle.screen.match.state.fighters[0].fastFalling);
  await t.release();
  console.log(`  jump: off the ground, double jump, stick down fast-falls (${ff})`);
  if (!ff) fail("holding the stick down in the air didn't fast fall");
  await phone.waitForFunction(() => window.sketchbattle.screen.match.state.fighters[0].grounded, null, { timeout: 5000 });
  await sleep(300);
  // attack, tilt, smash by holding, smash by flicking, special, shield
  // headless Chrome delivers the touches late now and then (a 60 ms tap held for 200 ms is a smash): a move gets three tries
  async function move(label, act, want) {
    const misses = [];
    for (let attempt = 0; attempt < 3; attempt++) {
      await phone.waitForFunction(() => { const f = window.sketchbattle.screen.match.state.fighters[0]; return f.grounded && ["idle", "walk", "crouch", "run", "skid", "dash"].includes(f.action); }, null, { timeout: 8000 });
      await sleep(150);
      await resetSeen(phone);
      await act();
      await sleep(600);
      await t.release(); await pf.liftAll();
      const s = await seen(phone);
      const hit = want.find((w) => s.moves.includes(w) || s.actions.includes(w));
      await sleep(500);
      if (hit) { console.log(`  ${label}: ${hit}${misses.length ? ` (after ${misses.join("; ")})` : ""}`); return; }
      misses.push(`moves ${s.moves.join(",") || "none"} actions ${s.actions.join(",")}`);
    }
    fail(`${label}: wanted ${want.join(" or ")}, saw ${misses.join(" | ")}`);
  }
  await move("ATTACK", () => t.tap("attack"), ["jab1"]);
  await move("light push + ATTACK", async () => { await t.push(0, -0.5, 150); await sleep(80); await t.tap("attack", 60); }, ["utilt"]);
  await move("ATTACK held with a direction", async () => { await t.push(0, 0.5, 150); await sleep(80); await t.hold("attack"); await sleep(450); await t.letGo(); }, ["dsmash"]);
  await move("flick + ATTACK", async () => { await t.stickDown(); await sleep(50); await t.push(1, 0); await sleep(30); await t.tap("attack", 60); }, ["fsmash"]);
  await move("flick up + ATTACK", async () => { await t.stickDown(); await sleep(50); await t.push(0, -1); await sleep(30); await t.tap("attack", 60); }, ["usmash"]);
  await move("SPECIAL", () => t.tap("special"), ["nspecial"]);
  await move("up + SPECIAL", async () => { await t.push(0, -0.8, 100); await t.tap("special"); }, ["uspecial"]);
  await phone.waitForFunction(() => window.sketchbattle.screen.match.state.fighters[0].grounded, null, { timeout: 8000 });
  await move("SHIELD", async () => { await t.hold("shield", 4); await sleep(300); await phone.screenshot({ path: path.join(shots, "phone-landscape-shield.png") }); await pf.lift(4); }, ["shield"]);
  await move("SHIELD + flick sideways", async () => { await t.hold("shield", 4); await sleep(150); await t.stickDown(); await sleep(40); await t.push(-1, 0); await sleep(300); await pf.lift(4); }, ["roll"]);
  await move("SHIELD + flick down", async () => { await t.hold("shield", 4); await sleep(150); await t.stickDown(); await sleep(40); await t.push(0, 1); await sleep(300); await pf.lift(4); }, ["spotDodge"]);
  await move("JUMP + ATTACK together", async () => { await t.hold("jump", 5); await t.hold("attack", 2); await sleep(80); await pf.lift(2); await pf.lift(5); }, ["nair"]);
  // the stick and two buttons at once
  await sleep(500);
  await t.push(0.5, 0, 100);
  await t.hold("attack", 2);
  await t.hold("special", 4);
  await sleep(80);
  const chord = await phone.evaluate(() => window.sketchbattle.screen.match.lastInputs[0]);
  await phone.screenshot({ path: path.join(shots, "phone-landscape-multitouch.png") });
  await pf.liftAll();
  if (!(chord.b & 2) || !(chord.b & 4) || chord.x < 30) fail(`stick + ATTACK + SPECIAL read as ${JSON.stringify(chord)}`);
  console.log(`  stick + ATTACK + SPECIAL at once: x ${chord.x}, buttons ${chord.b}`);
  // pause by touch, resume by touch
  await sleep(600);
  await t.pause(); await sleep(150);
  if (!(await phone.evaluate(() => window.sketchbattle.screen.match.paused))) fail("the pause button didn't pause");
  if (await phone.evaluate(() => window.sketchbattle.touch.live)) fail("the controls stayed up on the pause menu");
  await phone.screenshot({ path: path.join(shots, "phone-landscape-paused.png") });
  await pf.tapView(960, 540 + 80 + 32);
  await sleep(150);
  if (await phone.evaluate(() => window.sketchbattle.screen.match.paused)) fail("tapping RESUME didn't resume");
  console.log("  pause button pauses, RESUME by tap resumes");

  // 2. turned upright mid-match
  console.log("2. the phone turned upright");
  await phone.setViewportSize({ width: 390, height: 844 });
  await sleep(300);
  const upright = await phone.evaluate(() => ({ sideways: window.sketchbattle.screen.sideways, paused: window.sketchbattle.screen.match.paused, live: window.sketchbattle.touch.live }));
  await phone.screenshot({ path: path.join(shots, "phone-portrait-prompt.png") });
  if (!upright.sideways || !upright.paused || upright.live) fail(`upright: ${JSON.stringify(upright)}`);
  await phone.setViewportSize(PHONE.viewport);
  await sleep(300);
  await pf.tapView(960, 540 + 80 + 32);
  await sleep(200);
  if (await phone.evaluate(() => window.sketchbattle.screen.match.paused)) fail("RESUME after turning back didn't resume");
  console.log("  upright: prompt up, match paused, controls down; sideways again and RESUME carries on");

  // 1, continued: KO the bot
  console.log("1. (continued) KO the bot by touch");
  await setBot(botLevel);
  await t.layout();
  const deadline = Date.now() + 300_000;
  let state = await me(phone), matches = 1;
  for (;;) {
    while (!state.ended && Date.now() < deadline) {
      const dx = state.ox - state.x, dy = state.oy - state.y;
      if (state.y > 20 || Math.abs(state.x) > 520) {
        // near or off the edge: head home, jump, then up special
        await t.release(); await t.push(state.x > 0 ? -1 : 1, 0); await t.tap("jump", 60); await sleep(250);
        state = await me(phone);
        if (state.y > -80 || Math.abs(state.x) > 560) { await t.push(state.x > 0 ? -0.6 : 0.6, -0.8); await t.tap("special", 60); await sleep(500); }
        await t.release();
      } else if (Math.abs(state.ox) > 560 && Math.abs(state.x) > 300) {
        // they're off the stage: wait for them nearer the middle
        await t.push(state.x > 0 ? -0.5 : 0.5, 0); await sleep(120); await t.release();
      } else if (Math.abs(dx) > 170) {
        await t.push(Math.sign(dx), 0); await sleep(100);
      } else if (dy < -120) {
        await t.release(); await sleep(40); await t.stickDown(); await sleep(30); await t.push(0, -1); await sleep(20);
        await t.hold("attack"); await sleep(250); await t.letGo(); await t.release(); await sleep(350);
      } else {
        // a flicked smash their way, charged more the more they've taken
        await t.release(); await sleep(40); await t.stickDown(); await sleep(30); await t.push(Math.sign(dx) || 1, 0); await sleep(20);
        await t.hold("attack"); await sleep(state.opct > 60 ? 380 : 120); await t.letGo(); await t.release(); await sleep(400);
      }
      state = await me(phone);
    }
    await t.release(); await pf.liftAll();
    if (state.winner === 0 || Date.now() >= deadline || matches >= 4) break;
    // lost: REMATCH, by tap
    console.log(`  match ${matches} went to the bot; REMATCH`);
    await sleep(1500);
    await pf.tapView(780, 825);
    await phone.waitForFunction(() => window.sketchbattle.screen.match && !window.sketchbattle.screen.match.state.ended && window.sketchbattle.touch.live && window.sketchbattle.screen.countdown <= 0, null, { timeout: 30000 });
    await t.layout();
    matches++;
    state = await me(phone);
  }
  await phone.screenshot({ path: path.join(shots, "phone-landscape-game.png") });
  if (!state.ended || state.winner !== 0) fail(`the bot wasn't KO'd: ${JSON.stringify(state)}`);
  console.log(`  KO: the bot is out of stocks at frame ${state.frame}, the phone won`);
  const inputs = await phone.evaluate(() => window.__seen.inputs.filter((i) => i.b & 16).length);
  if (!inputs) fail("none of the match's inputs came from the touch controls");
  // back to the menu by tapping MENU on the results
  await sleep(1500);
  await pf.tapView(960 + 30 + 150, 540 + 90 + 160 + 35);
  await phone.waitForFunction(() => window.sketchbattle.screen.constructor.name !== "VersusScreen", null, { timeout: 10000 });
  console.log(`  MENU tapped: back on ${await screenName(phone)}`);

  console.log("3. QUICK MATCH: the phone on touch against a desktop on the keyboard");
  await phone.goto(`${base}?dev=Tess`);
  await phone.waitForFunction(() => Array.isArray(window.sketchbattle?.screen?.items), null, { timeout: 15000 });
  const desk = await page("desk", DESKTOP);
  await signIn(desk, base, "Kit");
  await desk.evaluate(() => { const s = window.sketchbattle.screen; s.sel = s.items.findIndex((i) => i.id === "battle"); });
  await desk.keyboard.press("Enter");
  await desk.waitForFunction(() => window.sketchbattle.screen.constructor.name === "BattleMenuScreen");
  await sleep(200);
  await desk.keyboard.press("Enter");
  await tapToBattle(phone, pf, 0);
  await Promise.all([phone, desk].map((p) => p.waitForFunction(() => window.sketchbattle?.screen?.lobbyDebug?.()?.members.length === 2, null, { timeout: 20000 })));
  const host = (await desk.evaluate(() => window.sketchbattle.screen.context.room.host === window.sketchbattle.screen.context.id)) ? desk : phone;
  await pickAndStart(host === desk ? [desk, phone] : [phone, desk], host === desk ? ["wizard", "rocket"] : ["rocket", "wizard"], { stage: "proving", stocks: 3, time: 0, map: null });
  await Promise.all([phone, desk].map((p) => p.waitForFunction(() => typeof window.sketchbattle.screen.netDebug === "function", null, { timeout: 20000 })));
  await inMatch(phone);
  await t.layout();
  await phone.screenshot({ path: path.join(shots, "phone-landscape-online.png") });
  async function playBoth(rounds) {
    for (let round = 0; round < rounds; round++) {
      const dir = round % 2 ? -1 : 1;
      await Promise.all([
        (async () => { await t.push(dir, 0, 50); await sleep(250); await t.tap("jump", 40); await sleep(100); await t.tap("attack", 50); await t.release(); await t.stickDown(); await sleep(30); await t.push(-dir, 0); await t.tap("attack", 60); await t.release(); await sleep(150); })(),
        (async () => { const key = round % 2 ? "KeyA" : "KeyD"; await desk.keyboard.down(key); await sleep(400); await desk.keyboard.up(key); await desk.keyboard.press("Space"); await desk.keyboard.press("KeyF"); })(),
      ]);
    }
    await pf.liftAll();
    await sleep(500);
  }
  const startX = (await me(phone)).x;
  await resetSeen(phone);
  await playBoth(8);
  const moved = await seen(phone);
  if (Math.abs((await me(phone)).x - startX) < 1 && !moved.moves.length) fail("the phone's fighter never moved online");
  console.log(`  the phone's fighter did ${moved.moves.join(", ") || "no moves"} and ${moved.actions.slice(0, 8).join(", ")}`);
  if (await phone.evaluate(() => !!window.sketchbattle.touch.layout && window.sketchbattle.screen.match.sources[window.sketchbattle.screen.session.localSlot].device !== "kb1")) fail("the phone isn't playing as keyboard 1");
  await hashesAgree([phone, desk], "quick match");
  if (await desk.evaluate(() => window.sketchbattle.touch.shown || window.sketchbattle.touch.live)) fail("the desktop shows touch controls");

  console.log("4. the Discord Activity on the phone");
  const call = (as) => `${base}?activity=stub&instance=touch&as=${as}`;
  const ann = await page("Ann", PHONE);
  const af = await Fingers.on(ann);
  await ann.goto(call("Ann"));
  await ann.waitForFunction(() => window.sketchbattle?.screen?.lobbyDebug?.()?.members.length === 1, null, { timeout: 20000 });
  const bob = await page("Bob", DESKTOP);
  await bob.goto(call("Bob"));
  await Promise.all([ann, bob].map((p) => p.waitForFunction(() => window.sketchbattle?.screen?.lobbyDebug?.()?.members.length === 2, null, { timeout: 20000 })));
  // the phone's player taps the screen like anyone would on Discord mobile
  await af.tapView(960, 40);
  await ann.screenshot({ path: path.join(shots, "phone-activity-lobby.png") });
  await pickAndStart([ann, bob], ["rocket", "wizard"], { stage: "proving", stocks: 3, time: 0, map: null });
  await Promise.all([ann, bob].map((p) => p.waitForFunction(() => typeof window.sketchbattle.screen.netDebug === "function", null, { timeout: 20000 })));
  await inMatch(ann);
  const at = new Thumbs(af);
  await at.layout();
  for (let round = 0; round < 6; round++) {
    await Promise.all([
      (async () => { await at.push(round % 2 ? -1 : 1, 0, 50); await sleep(300); await at.tap("attack", 50); await at.tap("special", 50); await at.release(); await sleep(100); })(),
      (async () => { await bob.keyboard.down("KeyD"); await sleep(300); await bob.keyboard.up("KeyD"); await bob.keyboard.press("KeyF"); })(),
    ]);
  }
  await af.liftAll();
  await ann.screenshot({ path: path.join(shots, "phone-activity-match.png") });
  await sleep(500);
  await hashesAgree([ann, bob], "activity call room");

  console.log("5. a tablet, and the settings page's touch view");
  const tablet = await page("tablet", TABLET);
  const tf = await Fingers.on(tablet);
  await tablet.goto(`${base}?quick=1&p2=cpu&cpu=1&f=woodstove,slugbert&stage=rooftops`);
  await tablet.waitForFunction(() => window.sketchbattle?.screen?.match, null, { timeout: 20000 });
  await tf.tapView(960, 300);
  await inMatch(tablet);
  const tt = new Thumbs(tf);
  await tt.layout();
  await tt.push(0.8, -0.3, 80); await tt.hold("attack", 2); await sleep(120);
  await tablet.screenshot({ path: path.join(shots, "tablet-landscape-match.png") });
  await tf.liftAll();
  await tablet.setViewportSize({ width: 820, height: 1180 });
  await sleep(300);
  await tablet.screenshot({ path: path.join(shots, "tablet-portrait-prompt.png") });
  await phone.goto(`${base}?dev=Tess`);
  await phone.waitForFunction(() => Array.isArray(window.sketchbattle?.screen?.items), null, { timeout: 15000 });
  await phone.evaluate(() => { const s = window.sketchbattle.screen; s.sel = s.items.findIndex((i) => i.id === "settings"); });
  // the settings card, by tap
  const settingsRow = await phone.evaluate(() => window.sketchbattle.screen.items.findIndex((i) => i.id === "settings"));
  await pf.tapView(720, 350 + settingsRow * 96 + 44);
  await phone.waitForFunction(() => window.sketchbattle.screen.constructor.name === "SettingsScreen", null, { timeout: 5000 });
  const tabButton = await phone.evaluate(() => { const s = window.sketchbattle.screen; const b = s.buttons().find((x) => x.id === "tab"); return b; });
  await pf.tapView(tabButton.x + tabButton.w / 2, tabButton.y + tabButton.h / 2);
  await sleep(300);
  if ((await phone.evaluate(() => window.sketchbattle.screen.controls.view)) !== "touch") fail("the CONTROLS tab opened by touch isn't the touch view");
  await phone.screenshot({ path: path.join(shots, "phone-settings-touch.png") });
  // SIZE up twice by tapping its right half
  for (let i = 0; i < 2; i++) await pf.tapView(960 + 120 + 360, 860 + 40);
  await sleep(200);
  const size = await phone.evaluate(() => JSON.parse(localStorage.getItem("sketchbattle.settings")).touchSize);
  if (size !== 1.3) fail(`two taps on SIZE's right half made it ${size}`);
  await phone.screenshot({ path: path.join(shots, "phone-settings-touch-bigger.png") });
  console.log(`  tablet match and upright prompt shot; settings' touch view up by tap, SIZE stepped to ${size * 100}%`);

  console.log("6. a desktop with no touchscreen");
  const plain = await page("plain", DESKTOP);
  await plain.goto(`${base}?quick=1&p2=cpu&cpu=1&f=woodstove,slugbert&stage=proving`);
  await plain.waitForFunction(() => window.sketchbattle?.screen?.match, null, { timeout: 20000 });
  await plain.mouse.click(640, 360);
  await plain.keyboard.down("KeyD"); await sleep(400); await plain.keyboard.up("KeyD"); await plain.keyboard.press("Space");
  await sleep(300);
  const deskTouch = await plain.evaluate(() => window.sketchbattle.touch);
  await plain.screenshot({ path: path.join(shots, "desktop-match.png") });
  if (deskTouch.shown || deskTouch.live || deskTouch.inUse) fail(`the desktop's touch state: ${JSON.stringify(deskTouch)}`);
  const deskX = await plain.evaluate(() => window.sketchbattle.screen.match.state.fighters[0].x);
  console.log(`  no controls (${JSON.stringify(deskTouch).slice(0, 60)}…), and the keys still play (x ${Math.round(deskX)})`);
  // the keyboard takes the phone back from touch, and the next touch hands it over again
  await phone.goto(`${base}?quick=1&p2=cpu&cpu=1&f=rocket,slugbert&stage=proving`);
  await phone.waitForFunction(() => window.sketchbattle?.screen?.match, null, { timeout: 20000 });
  await pf.tapView(960, 300); await sleep(200);
  if (!(await phone.evaluate(() => window.sketchbattle.touch.live))) fail("a tap didn't bring the controls up");
  await phone.keyboard.press("KeyD"); await sleep(100);
  if (await phone.evaluate(() => window.sketchbattle.touch.live)) fail("a key didn't put the controls away");
  await pf.tapView(960, 300); await sleep(100);
  if (!(await phone.evaluate(() => window.sketchbattle.touch.live))) fail("the next tap didn't bring them back");
  console.log("  a key puts the controls away; the next touch brings them back");

  console.log("7. the page sessions");
  for (const p of [phone, desk, ann, bob, tablet, plain]) await p.goto("about:blank");
  await sleep(1500);
  const events = execFileSync("npx", ["tsx", "scripts/events.ts", "--data", data, "--kind", "session", "--json"], { encoding: "utf8" }).split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const touchOf = (name) => events.filter((e) => e.client?.player?.name === name).reduce((n, e) => n + (e.business.touch?.matches ?? 0), 0);
  if (touchOf("Tess") < 2) fail(`Tess's sessions record ${touchOf("Tess")} touch matches`);
  if (touchOf("Ann") < 1) fail("Ann's Activity session records no touch match");
  if (touchOf("Kit") || touchOf("Bob")) fail("a keyboard player's session says touch");
  console.log(`  Tess played ${touchOf("Tess")} matches on touch, Ann ${touchOf("Ann")}; Kit and Bob none`);

  if (errors.length) fail(`page errors:\n${errors.join("\n")}`);
  console.log(`PASS touchcheck (screenshots in ${shots})`);
} catch (error) {
  console.error("FAIL touchcheck");
  console.error(error instanceof Error ? error.stack : error);
  for (const { log } of children) console.error(log().split("\n").slice(-25).join("\n"));
  process.exitCode = 1;
} finally {
  await browser?.close();
  fake.close();
  for (const { child } of children) process.kill(-child.pid);
  fs.rmSync(data, { recursive: true, force: true });
}
