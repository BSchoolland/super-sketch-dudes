// Fighting on phones, looked at: every phone plays real touch matches against a bot, upright (turned) and sideways,
// with several fingers down at once, and the match's screens are photographed: the countdown, the fight with thumbs
// down, a shield, a smash, the pause menu, a KO, the results, a rematch, and an online match against a desktop. A
// desktop at 1280x720 plays the same match on the keyboard as the baseline. Along the way it measures what a designer
// would: the controls' sizes in CSS pixels, how much of the fight and the HUD they cover, whether the page scrolled,
// zoomed or selected text, and whether the phone note or the swipe card came up over a match.
//
// Chromium phones get real multi-touch (CDP Input.dispatchTouchEvent). WebKit has no touch injection with several
// fingers, so the iPhones get touch pointer events dispatched on the canvas with every finger's id (the game reads
// pointer events, so this is the game's own input path), plus single real taps (page.touchscreen) for the menus.
//
// Usage: node scripts/uipass-fighting.mjs [--devices iphone-se,pixel-7,...] [--out /tmp/ssd-uipass/fighting] [--quick]
//   --quick: one match per device, no rematch or online part.
import { chromium, webkit, devices } from "playwright";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startFakeDiscord } from "./fake-discord.mjs";
import { signIn } from "./menu-nav.mjs";
import { viewToCss, viewScale } from "./lib/view.mjs";

const arg = (name, dflt) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : dflt; };
const OUT = arg("--out", "/tmp/ssd-uipass/fighting");
const QUICK = process.argv.includes("--quick");
const SERVER_PORT = Number(process.env.SERVER_PORT ?? 4431), VITE_PORT = Number(process.env.VITE_PORT ?? 6531), SECRET = "uipass-secret";
const base = `http://localhost:${VITE_PORT}/`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fail = (message) => { throw new Error(message); };

/** Safari's bars tucked (the swipe card's job, which emulation can't do): the viewport the game really gets. */
const tucked = (screen, upright) => upright ? { width: screen.width, height: screen.height - 92 } : { width: screen.height, height: screen.width };
const PHONES = {
  "iphone-se": { profile: "iPhone SE (3rd gen)", browser: "webkit", screen: { width: 375, height: 667 } },
  "iphone-15": { profile: "iPhone 15", browser: "webkit", screen: { width: 393, height: 852 } },
  "iphone-15-pro-max": { profile: "iPhone 15 Pro Max", browser: "webkit", screen: { width: 430, height: 932 } },
  "pixel-7": { profile: "Pixel 7", browser: "chromium", screen: { width: 412, height: 915 } },
  "galaxy-s9": { profile: "Galaxy S9+", browser: "chromium", screen: { width: 320, height: 658 } },
};
const ALL = [...Object.keys(PHONES).flatMap((k) => [`${k}-sideways`, `${k}-upright`]), "desktop"];
const wanted = arg("--devices", "") ? arg("--devices").split(",").flatMap((d) => ALL.filter((a) => a === d || a.startsWith(`${d}-`))) : ALL;

const SETTINGS = () => { localStorage.setItem("sketchbattle.settings", JSON.stringify({ cpuTier: 1, volume: 0, music: 0 })); localStorage.setItem("sketchbattle.mobileNote", "1"); };

/** Fingers on the screen in CSS pixels. Every event carries every finger still down. */
class Fingers {
  constructor(page, kind, cdp) { this.page = page; this.kind = kind; this.cdp = cdp; this.down = new Map(); }
  static async on(page, kind) {
    if (kind === "cdp") return new Fingers(page, kind, await page.context().newCDPSession(page));
    // a dispatched pointer event isn't a real pointer: capturing it throws, and the game captures every press
    await page.evaluate(() => {
      const capture = Element.prototype.setPointerCapture;
      Element.prototype.setPointerCapture = function (id) { if (id < 100) capture.call(this, id); };
      window.__finger = (type, id, x, y) => {
        const target = document.elementFromPoint(x, y) ?? document.getElementById("game");
        const init = { pointerId: 100 + id, pointerType: "touch", isPrimary: false, clientX: x, clientY: y, bubbles: true, cancelable: true, button: 0, buttons: type === "pointerup" ? 0 : 1, width: 16, height: 16, pressure: type === "pointerup" ? 0 : 0.5 };
        target.dispatchEvent(new PointerEvent(type, init));
        // the browser's own gestures, which the game must cancel in a match
        if (type !== "pointermove" || Math.random() < 0.2) {
          const ev = new TouchEvent(type === "pointerdown" ? "touchstart" : type === "pointerup" ? "touchend" : "touchmove", { bubbles: true, cancelable: true });
          target.dispatchEvent(ev);
          const s = window.sketchbattle?.screen;
          if (!ev.defaultPrevented && target.id === "game" && s?.match) (window.__uncancelled ??= []).push(`${ev.type}@${s.match.state.ended ? "results" : s.match.paused ? "paused" : s.countdown > 0 ? "countdown" : "fight"}`);
        }
      };
    });
    return new Fingers(page, kind, null);
  }
  async send(type, id) {
    if (this.kind === "cdp") return this.cdp.send("Input.dispatchTouchEvent", { type, touchPoints: [...this.down.values()] });
    const p = this.down.get(id) ?? this.lifted;
    return this.page.evaluate(([t, i, x, y]) => window.__finger(t, i, x, y), [{ touchStart: "pointerdown", touchMove: "pointermove", touchEnd: "pointerup" }[type], id, p.x, p.y]);
  }
  async press(id, x, y) { this.down.set(id, { id, x, y, radiusX: 8, radiusY: 8, force: 1 }); await this.send("touchStart", id); }
  async move(id, x, y) { this.down.set(id, { ...this.down.get(id), x, y }); await this.send("touchMove", id); }
  async lift(id) { this.lifted = this.down.get(id); this.down.delete(id); await this.send("touchEnd", id); }
  async liftAll() { for (const id of [...this.down.keys()]) await this.lift(id); }
  css(vx, vy) { const v = this.page.viewportSize(); return viewToCss(v, v.height > v.width, vx, vy); }
  async tapView(vx, vy, hold = 60) { const [x, y] = this.css(vx, vy); await this.press(90, x, y); await sleep(hold); await this.lift(90); }
}

/** The thumbs on the controls as the match lays them out. */
class Thumbs {
  constructor(f) { this.f = f; }
  async layout() { this.l = await this.f.page.evaluate(() => window.sketchbattle.touch.layout); return this.l; }
  async stickDown(dx = 0, dy = 0) { const s = this.l.stick; const [x, y] = this.f.css(s.x + dx * s.r, s.y + dy * s.r); await this.f.press(1, x, y); this.home = this.f.down.get(1); }
  async push(dx, dy, ms = 0) {
    if (!this.f.down.has(1)) await this.stickDown();
    const s = this.l.stick, from = this.f.down.get(1);
    const home = this.f.css(s.x, s.y);
    // the stick is where the thumb landed: aim from there
    const o = this.home ?? { x: home[0], y: home[1] };
    const scale = viewScale(this.f.page.viewportSize(), this.f.page.viewportSize().height > this.f.page.viewportSize().width);
    const turned = this.f.page.viewportSize().height > this.f.page.viewportSize().width;
    const [ddx, ddy] = turned ? [-dy * s.r * scale, dx * s.r * scale] : [dx * s.r * scale, dy * s.r * scale];
    const tx = o.x + ddx, ty = o.y + ddy;
    const steps = ms ? Math.max(2, Math.round(ms / 16)) : 1;
    for (let i = 1; i <= steps; i++) {
      await this.f.move(1, from.x + ((tx - from.x) * i) / steps, from.y + ((ty - from.y) * i) / steps);
      if (ms) await sleep(16);
    }
  }
  async release() { if (this.f.down.has(1)) await this.f.lift(1); this.home = null; }
  async hold(button, id = 2) { const c = this.l.buttons[button]; const [x, y] = this.f.css(c.x, c.y); await this.f.press(id, x, y); }
  async letGo(id = 2) { if (this.f.down.has(id)) await this.f.lift(id); }
  async tap(button, ms = 50, id = 2) { await this.hold(button, id); await sleep(ms); await this.letGo(id); }
  async pause() { const p = this.l.pause; const [x, y] = this.f.css(p.x, p.y); await this.f.press(3, x, y); await sleep(70); await this.f.lift(3); }
}

const me = (p) => p.evaluate(() => {
  const s = window.sketchbattle.screen, st = s.match.state, slot = s.session ? s.session.localSlot : 0;
  const f = st.fighters[slot], o = st.fighters.find((x) => x.slot !== slot);
  return { x: f.x, y: f.y, action: f.action, move: f.move, grounded: f.grounded, stocks: f.stocks, pct: f.percent, ox: o.x, oy: o.y, ostocks: o.stocks, opct: o.percent, ended: st.ended, winner: st.winner, frame: st.frame, paused: s.match.paused };
});
const WATCH = () => {
  window.__seen = { moves: new Set(), actions: new Set() };
  setInterval(() => { const s = window.sketchbattle?.screen, st = s?.match?.state; if (!st) return; const f = st.fighters[s.session ? s.session.localSlot : 0]; if (f.move) window.__seen.moves.add(f.move); window.__seen.actions.add(f.action); }, 8);
};
const seen = (p) => p.evaluate(() => { const s = { moves: [...window.__seen.moves], actions: [...window.__seen.actions] }; window.__seen.moves.clear(); window.__seen.actions.clear(); return s; });

/** What a designer measures on the page: the page didn't move, nothing is selected, the cards are where they are. */
const pageState = (p) => p.evaluate(() => ({
  scroll: [scrollX, scrollY], zoom: visualViewport ? visualViewport.scale : 1, selected: String(getSelection()),
  note: !!document.getElementById("mobile-note"), swipe: !(document.getElementById("swipe")?.hidden ?? true),
  uncancelled: (window.__uncancelled ?? []).join(" ") || "none",
}));

const report = [];
function note(device, what) { report.push(`${device}: ${what}`); console.log(`  ${what}`); }

/** The controls' geometry on this screen in CSS pixels and against the view, for the report. */
async function measure(p, device) {
  const m = await p.evaluate(() => {
    const t = window.sketchbattle.touch, l = t.layout;
    const s = window.sketchbattle.screen;
    return { l, scale: null, band: s.renderer?.hudBand ?? null };
  });
  const v = p.viewportSize(), up = v.height > v.width, s = viewScale(v, up);
  const b = m.l.buttons, px = (r) => Math.round(r * s * 2);
  note(device, `viewport ${v.width}x${v.height}${up ? " (turned)" : ""}, ${s.toFixed(3)} css/view px; buttons ATTACK ${px(b.attack.r)} SPECIAL ${px(b.special.r)} JUMP ${px(b.jump.r)} SHIELD ${px(b.shield.r)} css px across, stick travel ${Math.round(m.l.stick.r * s)}, pause ${px(m.l.pause.r)}; HUD band ${m.band ? `${Math.round(m.band.left)}-${Math.round(m.band.right)}` : "full"}`);
}

async function shot(p, dir, name) { await p.screenshot({ path: path.join(dir, `${name}.png`) }); }

/** A fight to the end: the touchcheck bot-fighting loop, with the screenshots a designer wants along the way. */
async function fight(p, t, dir, device, { minutes = 3 } = {}) {
  const deadline = Date.now() + minutes * 60_000;
  let s = await me(p), shots = 0, lastShot = 0;
  while (!s.ended && Date.now() < deadline) {
    const dx = s.ox - s.x, dy = s.oy - s.y;
    if (s.y > 20 || Math.abs(s.x) > 520) {
      await t.release(); await t.push(s.x > 0 ? -1 : 1, 0); await t.tap("jump", 60); await sleep(250);
      s = await me(p);
      if (s.y > -80 || Math.abs(s.x) > 560) { await t.push(s.x > 0 ? -0.6 : 0.6, -0.8); await t.tap("special", 60); await sleep(500); }
      await t.release();
    } else if (Math.abs(s.ox) > 560 && Math.abs(s.x) > 300) {
      await t.push(s.x > 0 ? -0.5 : 0.5, 0); await sleep(120); await t.release();
    } else if (Math.abs(dx) > 170) {
      await t.push(Math.sign(dx), 0); await sleep(100);
    } else if (dy < -120) {
      await t.release(); await sleep(40); await t.stickDown(); await sleep(30); await t.push(0, -1); await sleep(20);
      await t.hold("attack"); await sleep(250); await t.letGo(); await t.release(); await sleep(350);
    } else {
      await t.release(); await sleep(40); await t.stickDown(); await sleep(30); await t.push(Math.sign(dx) || 1, 0); await sleep(20);
      await t.hold("attack");
      if (Date.now() - lastShot > 15000 && shots < 3) { await sleep(90); await shot(p, dir, `fight-smash-${++shots}`); lastShot = Date.now(); }
      await sleep(s.opct > 60 ? 380 : 120); await t.letGo(); await t.release(); await sleep(400);
    }
    s = await me(p);
  }
  await t.release(); await t.f.liftAll();
  return s;
}

/** The moves a desktop player has, each by touch; what came out. */
async function moves(p, t, device) {
  const ready = () => p.waitForFunction(() => { const f = window.sketchbattle.screen.match.state.fighters[0]; return f.grounded && ["idle", "walk", "crouch"].includes(f.action); }, null, { timeout: 8000 }).catch(() => {});
  const tries = [
    ["jab", ["jab1"], () => t.tap("attack")],
    ["forward tilt", ["ftilt"], async () => { await t.push(0.5, 0, 120); await t.tap("attack", 50); }],
    ["up tilt", ["utilt"], async () => { await t.push(0, -0.5, 120); await t.tap("attack", 50); }],
    ["down tilt", ["dtilt"], async () => { await t.push(0, 0.5, 120); await t.tap("attack", 50); }],
    ["forward smash (flick)", ["fsmash"], async () => { await t.stickDown(); await sleep(40); await t.push(1, 0); await sleep(30); await t.tap("attack", 60); }],
    ["up smash (flick)", ["usmash"], async () => { await t.stickDown(); await sleep(40); await t.push(0, -1); await sleep(30); await t.tap("attack", 60); }],
    ["down smash (held)", ["dsmash"], async () => { await t.push(0, 0.5, 120); await t.hold("attack"); await sleep(450); await t.letGo(); }],
    ["neutral special", ["nspecial"], () => t.tap("special")],
    ["side special", ["sspecial"], async () => { await t.push(0.8, 0, 80); await t.tap("special"); }],
    ["down special", ["dspecial"], async () => { await t.push(0, 0.8, 80); await t.tap("special"); }],
    ["up special", ["uspecial"], async () => { await t.push(0, -0.8, 80); await t.tap("special"); }],
    ["short hop air", ["nair"], async () => { await t.hold("jump", 5); await t.hold("attack", 2); await sleep(80); await t.letGo(2); await t.letGo(5); }],
    ["forward air", ["fair"], async () => { await t.tap("jump", 120); await sleep(150); await t.push(0.6, 0, 50); await t.tap("attack", 50); }],
    ["shield", ["shield"], async () => { await t.hold("shield", 4); await sleep(300); await t.letGo(4); }],
    ["roll", ["roll"], async () => { await t.hold("shield", 4); await sleep(150); await t.stickDown(); await sleep(40); await t.push(-1, 0); await sleep(300); await t.letGo(4); }],
    ["spot dodge", ["spotDodge"], async () => { await t.hold("shield", 4); await sleep(150); await t.stickDown(); await sleep(40); await t.push(0, 1); await sleep(300); await t.letGo(4); }],
    ["air dodge", ["airDodge"], async () => { await t.tap("jump", 120); await sleep(150); await t.tap("shield", 60, 4); }],
  ];
  const got = [], missed = [];
  for (const [name, want, act] of tries) {
    let hit = null;
    for (let attempt = 0; attempt < 3 && !hit; attempt++) {
      await ready(); await sleep(120); await seen(p);
      await act(); await sleep(550); await t.release(); await t.f.liftAll();
      const s = await seen(p);
      hit = want.find((w) => s.moves.includes(w) || s.actions.includes(w));
      if (!hit && attempt === 2) missed.push(`${name} (saw ${s.moves.join(",") || "-"} / ${s.actions.join(",")})`);
      await sleep(350);
    }
    if (hit) got.push(name);
  }
  note(device, `moves by touch: ${got.length}/${tries.length}${missed.length ? `; missed ${missed.join("; ")}` : ""}`);
  return missed;
}

/** The devices that also try the SIZE setting's ends and the once-per-device note. */
const EXTRAS = new Set(["iphone-se-sideways", "galaxy-s9-upright", "pixel-7-sideways"]);
async function extras(ctx, kind, dir, device) {
  for (const size of [0.6, 1.5]) {
    const p = await ctx.newPage();
    await p.addInitScript((size) => localStorage.setItem("sketchbattle.settings", JSON.stringify({ cpuTier: 1, volume: 0, music: 0, touchSize: size })), size);
    await p.goto(`${base}?quick=1&p2=cpu&cpu=1&f=rocket,wizard&stocks=2&seed=7`);
    await p.waitForFunction(() => window.sketchbattle?.screen?.match, null, { timeout: 30000 });
    const f = await Fingers.on(p, kind);
    await f.tapView(960, 200);
    await p.waitForFunction(() => window.sketchbattle.touch.live, null, { timeout: 5000 });
    const t = new Thumbs(f); await t.layout();
    await t.push(0.8, 0, 60); await t.hold("special"); await sleep(150);
    await shot(p, dir, `size-${Math.round(size * 100)}`);
    await f.liftAll();
    await measure(p, `${device} SIZE ${Math.round(size * 100)}%`);
    await p.close();
  }
  // practice on touch: no practice key, so the pause menu has its helpers
  {
    const p = await ctx.newPage();
    await p.goto(`${base}?quick=1&training=1&f=rocket,wizard&seed=7`);
    await p.waitForFunction(() => window.sketchbattle?.screen?.match, null, { timeout: 30000 });
    const f = await Fingers.on(p, kind);
    await f.tapView(960, 200);
    await p.waitForFunction(() => window.sketchbattle.touch.live, null, { timeout: 5000 });
    const t = new Thumbs(f); await t.layout();
    await p.evaluate(() => { window.sketchbattle.screen.countdown = 2; });
    await sleep(300); await shot(p, dir, "practice-countdown");
    await p.waitForFunction(() => window.sketchbattle.screen.countdown <= 0);
    await t.push(1, 0, 60); await sleep(600); await t.release();
    const moved = (await me(p)).x;
    await t.pause(); await sleep(300);
    await shot(p, dir, "practice-paused");
    // RESET POSITIONS: the second item, top right of the two-by-two
    await f.tapView(960 + 9 + 300, 540 + 80 + 56); await sleep(300);
    const after = await me(p);
    note(device, `practice: the pause menu's RESET POSITIONS put P1 from x ${Math.round(moved)} to ${Math.round(after.x)}${after.paused ? " PROBLEM: still paused" : ""}`);
    await p.close();
  }
  // the note, never read: on the title, over everything, gone for good on GOT IT
  const p = await ctx.newPage();
  await p.addInitScript(() => localStorage.removeItem("sketchbattle.mobileNote"));
  await signIn(p, base, "Noa");
  await sleep(500);
  const shown = await p.evaluate(() => !!document.getElementById("mobile-note"));
  await shot(p, dir, "note");
  note(device, `the phone note on a first visit: ${shown ? "on the title" : "PROBLEM: missing"}`);
  if (shown) {
    const box = await p.evaluate(() => { const r = document.querySelector("#mobile-note button").getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2, r.width, r.height]; });
    note(device, `GOT IT is ${Math.round(box[2])}x${Math.round(box[3])} css px`);
    await p.touchscreen.tap(box[0], box[1]);
    await sleep(300);
    if (await p.evaluate(() => !!document.getElementById("mobile-note"))) note(device, "PROBLEM: GOT IT didn't close the note");
  }
  await p.close();
}

const children = [];
function run(cmd, args, env) {
  const child = spawn(cmd, args, { env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"], detached: true });
  let log = ""; child.stdout.on("data", (d) => (log += d)); child.stderr.on("data", (d) => (log += d));
  children.push({ child, log: () => log });
}
async function up(url, what) {
  for (let i = 0; i < 150; i++) { try { if ((await fetch(url)).ok) return; } catch { /* not yet */ } await sleep(200); }
  fail(`${what} never came up at ${url}`);
}

const data = fs.mkdtempSync(path.join(os.tmpdir(), "uipass-fighting-"));
fs.writeFileSync(path.join(data, "seo-characters.json"), "[]");
fs.writeFileSync(path.join(data, "staff.json"), "[]");
const browsers = {};
const errors = [];
const fake = await startFakeDiscord({ secret: SECRET });
try {
  run("npx", ["tsx", "server/index.ts"], { PORT: String(SERVER_PORT), SKETCHBATTLE_DATA: data, DEV_LOGIN: "1", DISCORD_API: fake.api, DISCORD_CLIENT_SECRET: SECRET, FORGE_TOKEN: "" });
  await up(`http://localhost:${SERVER_PORT}/api/health`, "server");
  run("npx", ["vite", "--config", "client/vite.config.ts", "--port", String(VITE_PORT), "--strictPort"], { SKETCHBATTLE_SERVER: `http://localhost:${SERVER_PORT}` });
  await up(base, "vite");
  const browser = async (kind) => (browsers[kind] ??= await (kind === "webkit" ? webkit : chromium).launch());

  async function open(device) {
    if (device === "desktop") {
      const ctx = await (await browser("chromium")).newContext({ viewport: { width: 1280, height: 720 } });
      return { ctx, kind: "keys" };
    }
    const key = device.replace(/-(sideways|upright)$/, ""), upright = device.endsWith("upright"), phone = PHONES[key];
    const profile = devices[phone.profile];
    const ctx = await (await browser(phone.browser)).newContext({ ...profile, viewport: tucked(phone.screen, upright), screen: phone.screen });
    // WebKit's emulation makes the screen whatever the viewport was; a phone's stays put
    await ctx.addInitScript(([w, h]) => {
      Object.defineProperty(Screen.prototype, "width", { get: () => w });
      Object.defineProperty(Screen.prototype, "height", { get: () => h });
    }, [phone.screen.width, phone.screen.height]);
    return { ctx, kind: phone.browser === "webkit" ? "synth" : "cdp" };
  }

  for (const device of wanted) {
    console.log(device);
    const dir = path.join(OUT, device);
    fs.mkdirSync(dir, { recursive: true });
    const { ctx, kind } = await open(device);
    await ctx.addInitScript(SETTINGS);
    await ctx.addInitScript(WATCH);
    const p = await ctx.newPage();
    p.on("pageerror", (e) => errors.push(`${device}: ${e.message}`));
    p.on("console", (m) => { if (m.type() === "error") errors.push(`${device} console: ${m.text()}`); });

    // VS BOTS from the menus' end: a quick match with the countdown the lobby's start gives
    await p.goto(`${base}?quick=1&p2=cpu&cpu=1&f=rocket,wizard&stocks=2&seed=7`);
    await p.waitForFunction(() => window.sketchbattle?.screen?.match, null, { timeout: 30000 });
    const f = kind === "keys" ? null : await Fingers.on(p, kind);
    // the first touch is what hands keyboard 1 to the screen: in a lobby that's the READY tap
    if (f) {
      await f.tapView(960, 200); await p.waitForFunction(() => window.sketchbattle.touch.live, null, { timeout: 5000 });
      // the tap that put the phone on touch isn't the match's: from here every touch on the game must be held
      await p.evaluate(() => { window.__uncancelled = []; });
    }
    await p.evaluate(() => { window.sketchbattle.screen.countdown = 3.2; });
    await sleep(400); await shot(p, dir, "01-countdown-3");
    await sleep(2300); await shot(p, dir, "02-countdown-go");
    await p.waitForFunction(() => window.sketchbattle.screen.countdown <= 0);
    const ps = await pageState(p);
    if (ps.note || ps.swipe) note(device, `over the match: ${ps.note ? "the phone note " : ""}${ps.swipe ? "the swipe card" : ""}`);

    if (!f) {
      // the baseline: the keyboard against the bot
      await shot(p, dir, "03-fight");
      for (let i = 0; i < 6; i++) { await p.keyboard.down("KeyD"); await sleep(300); await p.keyboard.up("KeyD"); await p.keyboard.press("KeyF"); await sleep(200); }
      await shot(p, dir, "04-fight-moving");
      await p.keyboard.press("Escape"); await sleep(300); await shot(p, dir, "06-paused");
      await p.keyboard.press("Escape"); await sleep(200);
      await p.evaluate(() => { const st = window.sketchbattle.screen.match.state; st.fighters[1].stocks = 1; st.fighters[1].percent = 250; });
      for (let i = 0; i < 40 && !(await me(p)).ended; i++) {
        const s = await me(p); const dir = s.ox > s.x ? "KeyD" : "KeyA";
        await p.keyboard.down(dir); await sleep(150); await p.keyboard.up(dir); await p.keyboard.down("KeyF"); await sleep(300); await p.keyboard.up("KeyF"); await sleep(200);
      }
      await sleep(2000); await shot(p, dir, "08-results");
      await ctx.close();
      continue;
    }

    const t = new Thumbs(f);
    await t.layout();
    await measure(p, device);
    await p.evaluate(() => { const s = window.sketchbattle.screen; s.match.sources[1].cpu = 0; s.match.state.fighters[1].cpu = 0; });
    await shot(p, dir, "03-fight-idle");
    // both thumbs down: running right and holding SPECIAL
    await t.push(0.9, 0, 80); await t.hold("attack", 2); await sleep(120);
    await shot(p, dir, "04-fight-thumbs");
    await t.f.liftAll(); await t.release(); await sleep(300);
    await t.hold("shield", 4); await sleep(250); await shot(p, dir, "05-shield"); await t.letGo(4);
    await moves(p, t, device);

    // the pause menu, by touch
    await sleep(400);
    await t.pause(); await sleep(300);
    if (!(await me(p)).paused) note(device, "PROBLEM: the pause button didn't pause");
    await shot(p, dir, "06-paused");
    await f.tapView(960, 540 + 80 + 40); await sleep(250);
    if ((await me(p)).paused) note(device, "PROBLEM: RESUME by tap didn't resume");

    // the fight, to the end
    await p.evaluate(() => { const s = window.sketchbattle.screen; s.match.sources[1].cpu = 1; s.match.state.fighters[1].cpu = 1; });
    let s = await fight(p, t, dir, device, { minutes: QUICK ? 2 : 4 });
    if (!s.ended) {
      note(device, `no KO by touch in time (me ${s.stocks} stocks ${s.pct}%, bot ${s.ostocks} stocks ${s.opct}%): finishing it`);
      await p.evaluate(() => { const st = window.sketchbattle.screen.match.state; st.fighters[1].stocks = 1; st.fighters[1].percent = 300; });
      s = await fight(p, t, dir, device, { minutes: 1 });
    }
    await sleep(500); await shot(p, dir, "07-game");
    await sleep(1600); await shot(p, dir, "08-results");
    const end = await pageState(p);
    note(device, `match over (${s.winner === 0 ? "the phone won" : s.winner >= 0 ? "the bot won" : "draw"}); page scroll ${end.scroll.join(",")}, zoom ${end.zoom}, selection "${end.selected}", uncancelled touches ${end.uncancelled}`);
    if (!QUICK) {
      // REMATCH by tap
      const ends = await p.evaluate(() => window.sketchbattle.screen.endButtons);
      const r = await p.evaluate(() => window.sketchbattle.screen.endButtonRects().rematch);
      await sleep(500);
      await f.tapView(r.x + r.w / 2, r.y + r.h / 2);
      await p.waitForFunction(() => window.sketchbattle.screen.match && !window.sketchbattle.screen.match.state.ended, null, { timeout: 10000 }).catch(() => note(device, `PROBLEM: REMATCH by tap didn't rematch (endButtons ${ends})`));
      await sleep(500); await shot(p, dir, "09-rematch-countdown");
    }
    if (EXTRAS.has(device)) await extras(ctx, kind, dir, device);
    await ctx.close();
  }
  const text = `REPORT\n${report.join("\n")}${errors.length ? `\n\nERRORS\n${errors.join("\n")}` : ""}\n`;
  console.log(`\n${text}`);
  fs.writeFileSync(path.join(OUT, "report.txt"), text);
} catch (error) {
  console.error(error);
  for (const { log } of children) console.error(log().slice(-1500));
  process.exitCode = 1;
} finally {
  for (const b of Object.values(browsers)) await b.close().catch(() => {});
  for (const { child } of children) { try { process.kill(-child.pid, "SIGTERM"); } catch { /* gone */ } }
  await fake.close?.();
  await sleep(500);
  fs.rmSync(data, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
}
