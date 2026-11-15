// The drawing flow on phones and desktops, end to end in real browsers: NEW CHARACTER's pad, the describe page, the
// character being created, the first-fighter tour's cards and the daily limit's wall. iPhones in WebKit, Androids in
// Chromium, each upright (the game turned, client/src/turn.ts) and sideways, and two desktops. A local server and
// Vite on a scratch data dir; this script is the worker (it claims each job, posts progress and completes it with the
// exemplar from scripts/fake-forge.mjs), so no drawing goes anywhere else.
//   On Chromium the pad is drawn with real touches (CDP Input.dispatchTouchEvent, many points per stroke); WebKit has
//   no touch-move in Playwright, so there the strokes are a mouse's pointer events through the same mapping.
//   Per device: tool buttons tapped (each changes what it should; their size on the screen measured), a near-empty
//   DONE DRAWING, BACK on a drawing, strokes along every edge of the pad, starting just outside it and running out
//   of it, a pinch on the pad (Chromium), then the drawing that reaches the server's POST is decoded and checked
//   under every point the finger passed.
// Usage: node scripts/uipass-drawing.mjs [--survey] [--only <device>[,<device>]] [--shots <dir>]
//   --survey reports problems without failing (a run on code from before the pass). Screenshots default to
//   /tmp/ssd-uipass/drawing/<device>/<screen>.png. Ports: SERVER_PORT 4351, VITE_PORT 4352.
import { chromium, webkit, devices } from "playwright";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { viewToCss, viewScale } from "./lib/view.mjs";
import { completeJob } from "./fake-forge.mjs";

const SERVER_PORT = Number(process.env.SERVER_PORT ?? 4351), VITE_PORT = Number(process.env.VITE_PORT ?? 4352), TOKEN = "uipass-drawing";
const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; };
const survey = process.argv.includes("--survey");
const only = arg("--only")?.split(",") ?? null;
const shotsRoot = arg("--shots") ?? "/tmp/ssd-uipass/drawing";
const data = fs.mkdtempSync(path.join(os.tmpdir(), "uipass-drawing-"));
fs.writeFileSync(path.join(data, "forge-budget.json"), JSON.stringify({
  perWeek: 1000, weekStartsAt: new Date(Date.now() - 3_600_000).toISOString(), paused: null, perPlayerPerDay: 1, waitingPerPlayer: 1, guest: { lifetime: 1, perIpPerDay: 50 },
}));
const server = `http://localhost:${SERVER_PORT}`, base = `http://localhost:${VITE_PORT}/`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const children = [];
const problems = [];
/** A finding: fails the run at the end unless --survey. */
const problem = (device, text) => { problems.push(`${device}: ${text}`); console.log(`  PROBLEM ${text}`); };

/** iPhones as their browser shows the page with the bars out; Androids as Chrome does without fullscreen. */
const DEVICES = [
  ["iphone-se-up", "webkit", devices["iPhone SE (3rd gen)"]],
  ["iphone-se-side", "webkit", devices["iPhone SE (3rd gen) landscape"]],
  ["iphone-15-up", "webkit", devices["iPhone 15"]],
  ["iphone-15-side", "webkit", devices["iPhone 15 landscape"]],
  ["iphone-15-pro-max-up", "webkit", devices["iPhone 15 Pro Max"]],
  ["iphone-15-pro-max-side", "webkit", devices["iPhone 15 Pro Max landscape"]],
  ["pixel-7-up", "chromium", devices["Pixel 7"]],
  ["pixel-7-side", "chromium", devices["Pixel 7 landscape"]],
  ["galaxy-s9-up", "chromium", devices["Galaxy S9+"]],
  ["galaxy-s9-side", "chromium", devices["Galaxy S9+ landscape"]],
  // the Android player's own viewports from the report (session telemetry): upright, and sideways with Chrome's bars out
  ["android-360-up", "chromium", { ...devices["Galaxy S8"], viewport: { width: 360, height: 714 }, deviceScaleFactor: 2 }],
  ["android-770-side", "chromium", { ...devices["Galaxy S8"], viewport: { width: 770, height: 280 }, deviceScaleFactor: 2 }],
  ["desktop-1280", "chromium", { viewport: { width: 1280, height: 720 } }],
  ["desktop-1920", "chromium", { viewport: { width: 1920, height: 1080 } }],
];

function run(cmd, args, env) {
  const child = spawn(cmd, args, { env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"], detached: true });
  let log = ""; child.stdout.on("data", (d) => (log += d)); child.stderr.on("data", (d) => (log += d));
  children.push({ child, log: () => log });
}
async function up(url, what) {
  for (let i = 0; i < 300; i++) { try { if ((await fetch(url)).ok) return; } catch { /* not listening yet */ } await sleep(200); }
  throw new Error(`${what} never came up at ${url}`);
}
const forgeApi = async (p, body) => {
  const res = await fetch(`${server}/api/forge/${p}`, { method: body ? "POST" : "GET", headers: { "x-forge-token": TOKEN, "content-type": "application/json" }, body: body && JSON.stringify(body) });
  if (res.status >= 400) throw new Error(`forge ${p}: HTTP ${res.status} ${await res.text()}`);
  return res;
};

/** RGBA or RGB, 8-bit, non-interlaced: what the pad's encoder (client/src/screens/png.ts) writes. */
function decodePng(buf) {
  let pos = 8, w = 0, h = 0, ch = 4;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos), type = buf.toString("ascii", pos + 4, pos + 8), d = buf.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") { w = d.readUInt32BE(0); h = d.readUInt32BE(4); ch = d[9] === 6 ? 4 : d[9] === 2 ? 3 : 0; if (!ch || d[8] !== 8 || d[12]) throw new Error("unexpected PNG format"); }
    if (type === "IDAT") idat.push(d);
    pos += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat)), stride = w * ch, out = Buffer.alloc(stride * h);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? out[y * stride + x - ch] : 0, b = y ? out[(y - 1) * stride + x] : 0, c = x >= ch && y ? out[(y - 1) * stride + x - ch] : 0;
      const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      out[y * stride + x] = (line[x] + [0, a, b, (a + b) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? b : c][f]) & 255;
    }
  }
  return { w, h, ink: (x, y) => { const k = (y * w + x) * ch; return out[k] + out[k + 1] + out[k + 2] < 300; } };
}

/** Points every `step` view px along a polyline. */
function along(points, step = 12) {
  const out = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const [ax, ay] = points[i - 1], [bx, by] = points[i], n = Math.max(1, Math.round(Math.hypot(bx - ax, by - ay) / step));
    for (let k = 1; k <= n; k++) out.push([ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n]);
  }
  return out;
}

/**
 * The strokes, in view px, for a pad at `r`: a stick figure, one along each edge just inside it, one starting just
 * outside each edge and running in, and one running out over the bottom edge.
 */
function strokes(r) {
  const X = (f) => r.x + r.w * f, Y = (f) => r.y + r.h * f, inset = 0.03, out = 28;
  const head = Array.from({ length: 17 }, (_, i) => [X(0.5) + Math.cos((i / 16) * Math.PI * 2) * r.w * 0.09, Y(0.22) + Math.sin((i / 16) * Math.PI * 2) * r.w * 0.09]);
  return {
    figure: [head, [[X(0.5), Y(0.31)], [X(0.5), Y(0.62)]], [[X(0.32), Y(0.42)], [X(0.68), Y(0.42)]], [[X(0.5), Y(0.62)], [X(0.36), Y(0.85)]], [[X(0.5), Y(0.62)], [X(0.64), Y(0.85)]]],
    edges: [
      [[X(0.1), Y(inset)], [X(0.9), Y(inset)]],
      [[X(1 - inset), Y(0.1)], [X(1 - inset), Y(0.9)]],
      [[X(0.9), Y(1 - inset)], [X(0.1), Y(1 - inset)]],
      [[X(inset), Y(0.9)], [X(inset), Y(0.1)]],
    ],
    inward: [
      [[r.x - out, Y(0.7)], [X(0.15), Y(0.7)]],
      [[X(0.25), r.y + r.h + out], [X(0.25), Y(0.88)]],
      [[r.x + r.w + out, Y(0.3)], [X(0.85), Y(0.3)]],
      [[X(0.75), r.y - out], [X(0.75), Y(0.12)]],
    ],
    outward: [[[X(0.8), Y(0.7)], [X(0.8), r.y + r.h + 80]]],
  };
}

/** Real touches (CDP) on Chromium: every event lists every finger still down. WebKit: the mouse's pointer events. */
class Hand {
  constructor(page, cdp, screen) { this.page = page; this.cdp = cdp; this.screen = screen; this.down = new Map(); }
  static async on(page, engine, hasTouch) { return new Hand(page, engine === "chromium" && hasTouch ? await page.context().newCDPSession(page) : null, hasTouch); }
  get touch() { return !!this.cdp; }
  send(type) { return this.cdp.send("Input.dispatchTouchEvent", { type, touchPoints: [...this.down.values()] }); }
  async press(id, x, y) { if (!this.cdp) return this.page.mouse.move(x, y).then(() => this.page.mouse.down()); this.down.set(id, { id, x, y, radiusX: 6, radiusY: 6, force: 1 }); await this.send("touchStart"); }
  async move(id, x, y) { if (!this.cdp) return this.page.mouse.move(x, y); this.down.set(id, { ...this.down.get(id), x, y }); await this.send("touchMove"); }
  async lift(id) { if (!this.cdp) return this.page.mouse.up(); this.down.delete(id); await this.send("touchEnd"); }
  async tap(x, y) { if (!this.cdp && this.screen) return this.page.touchscreen.tap(x, y); await this.press(9, x, y); await sleep(50); await this.lift(9); }
}

async function device(browsers, [name, engine, profile], index) {
  console.log(`\n== ${name} (${engine}, ${profile.viewport.width}x${profile.viewport.height})`);
  const shots = path.join(shotsRoot, name);
  fs.mkdirSync(shots, { recursive: true });
  const ctx = await browsers[engine].newContext(profile);
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.stack ?? String(e)));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  await page.addInitScript(() => {
    localStorage.setItem("sketchbattle.mobileNote", "1");
    localStorage.setItem("sketchbattle.settings", JSON.stringify({ cpuTier: 1, volume: 0, music: 0 }));
  });
  if (profile.screen) await page.addInitScript(([w, h]) => {
    Object.defineProperty(Screen.prototype, "width", { get: () => w });
    Object.defineProperty(Screen.prototype, "height", { get: () => h });
  }, [profile.screen.width, profile.screen.height]);
  const hand = await Hand.on(page, engine, !!profile.hasTouch);
  const v = page.viewportSize();
  const handheld = v.width < 1000;
  const turned = handheld && v.height > v.width;
  const css = (x, y) => viewToCss(v, turned, x, y);
  const k = viewScale(v, turned);
  const shot = async (screen, ms = 400) => { await sleep(ms); await page.screenshot({ path: path.join(shots, `${screen}.png`) }); };
  const screenName = () => page.evaluate(() => window.sketchbattle?.screen?.constructor.name);
  const until = (n, ms = 15000) => page.waitForFunction((s) => window.sketchbattle?.screen?.constructor.name === s, n, { timeout: ms }).catch(async () => { throw new Error(`wanted ${n}, on ${await screenName()}`); });
  const buttons = () => page.evaluate(() => (window.sketchbattle.tourCard ?? window.sketchbattle.screen.buttons()).map(({ id, x, y, w, h, disabled }) => ({ id, x, y, w, h, disabled: !!disabled })));
  const button = async (id) => (await buttons()).find((b) => b.id === id);
  const tapAt = async (vx, vy) => { await hand.tap(...css(vx, vy)); await sleep(180); };
  const tap = async (id) => { const b = await button(id); if (!b) throw new Error(`no ${id} button on ${await screenName()}: ${(await buttons()).map((x) => x.id)}`); await tapAt(b.x + b.w / 2, b.y + b.h / 2); };
  const padRect = () => page.evaluate(() => ({ ...window.sketchbattle.screen.tools.pad.rect }));
  const pad = (expr) => page.evaluate(`(() => { const pad = window.sketchbattle.screen.tools.pad; return ${expr}; })()`);
  async function draw(stroke) {
    const pts = along(stroke);
    await hand.press(1, ...css(...pts[0]));
    for (const p of pts.slice(1)) { await hand.move(1, ...css(...p)); await sleep(8); }
    await hand.lift(1);
    await sleep(60);
  }

  // the gate on an iPhone with its bars out (bars.ts) waits a while before offering a way past
  await page.goto(`${base}?dev=Draw${index}`);
  await page.waitForFunction(() => Array.isArray(window.sketchbattle?.screen?.items), null, { timeout: 30000 });
  if (await page.evaluate(() => { const g = document.getElementById("swipe"); return !!g && !g.hidden; })) {
    await page.waitForFunction(() => !document.querySelector("#swipe button").hidden, null, { timeout: 9000 });
    await page.locator("#swipe button").tap();
  }
  await page.mouse.move(1, 1);
  await sleep(500);
  if (await page.evaluate(() => !!document.fullscreenElement)) await page.evaluate(() => document.exitFullscreen());

  // NEW CHARACTER, from the title's menu (the title is another pass's screen: its keys, not its layout)
  await page.evaluate(() => { const s = window.sketchbattle.screen; s.sel = s.items.findIndex((i) => i.id === "create"); });
  await page.keyboard.press("Enter");
  await until("CreateScreen");
  await page.waitForFunction(() => window.sketchbattle.screen.words !== null, null, { timeout: 8000 }).catch(() => {});
  await shot("1-create-empty", 700);
  const r = await padRect();
  const padCss = r.w * k;
  console.log(`  pad ${r.w}x${r.h} view px at ${r.x},${r.y}: ${padCss.toFixed(0)} CSS px on a ${v.width}x${v.height} screen (${turned ? "turned" : "not turned"})`);
  const short = Math.min(v.width, v.height);
  if (handheld && padCss < short * 0.85) problem(name, `the pad is ${padCss.toFixed(0)} CSS px, ${Math.round((padCss / short) * 100)}% of the screen's ${short} px`);
  // every tool's size on the screen
  const sizes = (await buttons()).map((b) => ({ id: b.id, w: b.w * k, h: b.h * k }));
  // a phone under 300 px tall (Chrome sideways with its bars out) can only shrink the 1920x1080 view further
  const least = short >= 300 ? 30 : 26;
  const small = sizes.filter((b) => Math.min(b.w, b.h) < least);
  console.log(`  buttons on the screen, smallest side in CSS px: ${sizes.map((b) => `${b.id} ${Math.round(Math.min(b.w, b.h))}`).join(", ")}`);
  if (handheld && small.length) problem(name, `buttons under ${least} CSS px: ${small.map((b) => `${b.id} ${Math.round(b.w)}x${Math.round(b.h)}`).join(", ")}`);
  for (const b of await buttons()) {
    const [x1, y1] = css(b.x, b.y), [x2, y2] = css(b.x + b.w, b.y + b.h);
    if (Math.min(x1, x2) < -1 || Math.min(y1, y2) < -1 || Math.max(x1, x2) > v.width + 1 || Math.max(y1, y2) > v.height + 1) problem(name, `${b.id} is off the screen`);
  }

  // the tools by tap: each does what it says
  const toolState = () => pad("({ kind: pad.tool.kind, color: pad.tool.color, size: pad.size })");
  await tap("color4"); const green = await toolState();
  await tap("size0"); const thin = await toolState();
  await tap("eraser"); const eraser = await toolState();
  await tap("fill"); const fill = await toolState();
  await tap("pencil"); await tap("color0"); await tap("size2");
  const back = await toolState();
  const toolsOk = green.color === "#329854" && thin.size === 0 && eraser.kind === "eraser" && fill.kind === "fill" && back.kind === "pen" && back.size === 2 && back.color !== "#329854";
  if (!toolsOk) problem(name, `tool taps: ${JSON.stringify({ green, thin, eraser, fill, back })}`);
  else console.log("  colour, size, eraser, fill, pencil: each tap took");

  // ADVANCED: the wheel picks a colour by a drag on its ring, the eyedropper's card is there; off again
  await tap("advanced");
  const wheel = await page.evaluate(() => { const w = window.sketchbattle.screen.tools.wheel; return { cx: w.cx, cy: w.cy, r: w.r }; });
  const ring = wheel.r * 0.9;
  await draw([[wheel.cx + ring, wheel.cy], [wheel.cx, wheel.cy + ring], [wheel.cx - ring, wheel.cy]]);
  const picked = await toolState();
  const pick = await button("pick");
  await shot("1b-create-advanced", 200);
  if (!pick || picked.kind !== "pen" || ["#262421", "#329854"].includes(picked.color) || picked.color === back.color) problem(name, `ADVANCED: ${JSON.stringify({ pick: !!pick, picked })}`);
  else console.log(`  ADVANCED: the wheel picked ${picked.color} by a drag on its ring`);
  const wheelOff = await page.evaluate(() => window.sketchbattle.screen.tools.pad.blank);
  if (!wheelOff) problem(name, "dragging on the wheel drew on the pad");
  await tap("advanced");
  await tap("color0");

  // two stray strokes, then DONE DRAWING: a near-empty drawing must not go straight on
  const s = strokes(r);
  await draw(s.figure[3]);
  await draw(s.figure[4]);
  await tap("done");
  await sleep(300);
  const afterNearEmpty = await screenName();
  const confirm = await page.evaluate(() => window.sketchbattle.screen.confirming ?? null);
  await shot("2-done-near-empty", 200);
  if (afterNearEmpty !== "CreateScreen" || confirm !== "send") problem(name, `DONE DRAWING on two strokes went to ${afterNearEmpty} (confirm: ${confirm})`);
  else {
    console.log("  DONE DRAWING on two strokes asks first");
    await tap("keep");
    if ((await screenName()) !== "CreateScreen" || await page.evaluate(() => window.sketchbattle.screen.confirming)) problem(name, "KEEP DRAWING didn't go back to the pad");
  }
  if (afterNearEmpty === "DescribeScreen") { await tap("back"); await until("CreateScreen"); }

  // BACK on a drawing: asks before throwing it away
  await tap("back");
  await sleep(250);
  const afterBack = await screenName();
  if (afterBack !== "CreateScreen" || (await page.evaluate(() => window.sketchbattle.screen.confirming)) !== "leave") problem(name, `BACK on a drawing went to ${afterBack}`);
  else { await shot("3-back-on-drawing", 100); await tap("keep"); console.log("  BACK on a drawing asks first"); }
  if (afterBack !== "CreateScreen") {
    await page.evaluate(() => { const s = window.sketchbattle.screen; s.sel = s.items.findIndex((i) => i.id === "create"); });
    await page.keyboard.press("Enter");
    await until("CreateScreen");
  }

  // UNDO, REDO, CLEAR by tap
  if (await pad("pad.blank")) { await draw(s.figure[3]); }
  const rev0 = await pad("pad.revision");
  await tap("undo"); const undone = await pad("pad.revision");
  await tap("redo"); const redone = await pad("pad.canRedo");
  await tap("clear"); const cleared = await pad("pad.blank");
  if (!(undone > rev0) || redone || !cleared) problem(name, `undo/redo/clear: ${JSON.stringify({ rev0, undone, redone, cleared })}`);
  else console.log("  UNDO, REDO, CLEAR by tap");

  // the whole drawing: a figure, every edge, strokes coming in from outside and one running out
  for (const st of [...s.figure, ...s.edges, ...s.inward, ...s.outward]) await draw(st);
  // a pinch on the pad must not zoom or move the page
  if (hand.touch) {
    const c = [r.x + r.w / 2, r.y + r.h / 2];
    await hand.press(1, ...css(c[0] - 40, c[1])); await hand.press(2, ...css(c[0] + 40, c[1]));
    for (let i = 1; i <= 8; i++) { await hand.move(1, ...css(c[0] - 40 - i * 20, c[1] - i * 6)); await hand.move(2, ...css(c[0] + 40 + i * 20, c[1] + i * 6)); await sleep(16); }
    await hand.lift(2); await hand.lift(1);
    await sleep(200);
    const view = await page.evaluate(() => ({ scale: visualViewport.scale, x: scrollX, y: scrollY, vx: visualViewport.offsetLeft, vy: visualViewport.offsetTop }));
    if (view.scale !== 1 || view.x || view.y || view.vx || view.vy) problem(name, `a pinch on the pad moved the page: ${JSON.stringify(view)}`);
    else console.log("  a pinch on the pad: the page didn't zoom or move");
    // the pinch's first finger drew a line, as a finger would: take it off
    await tap("undo");
  }
  const page0 = await page.evaluate(() => ({ x: scrollX, y: scrollY }));
  if (page0.x || page0.y) problem(name, `drawing scrolled the page to ${JSON.stringify(page0)}`);
  await shot("4-create-drawn", 300);

  // what the pad holds under every point the finger passed inside it
  const inside = (p) => p[0] > r.x + 4 && p[0] < r.x + r.w - 4 && p[1] > r.y + 4 && p[1] < r.y + r.h - 4;
  const groups = { figure: s.figure, edges: s.edges, inward: s.inward, outward: s.outward };
  const samples = Object.fromEntries(Object.entries(groups).map(([g, list]) => [g, list.flatMap((st) => along(st, 8)).filter(inside)]));
  const toPad = ([x, y]) => [Math.min(767, Math.floor(((x - r.x) * 768) / r.w)), Math.min(767, Math.floor(((y - r.y) * 768) / r.h))];
  const inPad = await page.evaluate((g) => {
    const pad = window.sketchbattle.screen.tools.pad;
    return Object.fromEntries(Object.entries(g).map(([n, pts]) => [n, pts.filter(([x, y]) => { const [a, b, c] = pad.raster.pixel(x, y); return a + b + c >= 300; }).length]));
  }, Object.fromEntries(Object.entries(samples).map(([g, pts]) => [g, pts.map(toPad)])));
  const missing = Object.entries(inPad).filter(([, n]) => n);
  if (missing.length) problem(name, `points under the finger with no ink in the pad: ${missing.map(([g, n]) => `${g} ${n}/${samples[g].length}`).join(", ")}`);
  else console.log(`  the pad has ink under all ${Object.values(samples).flat().length} points the finger passed inside it, at every edge`);

  // DONE DRAWING: no question for a real drawing
  await tap("done");
  await until("DescribeScreen");
  await shot("5-describe", 500);
  const fields = await page.evaluate(() => [...document.querySelectorAll("#overlay input, #overlay textarea")].map((el) => { const b = el.getBoundingClientRect(); return { tag: el.tagName, focused: document.activeElement === el, box: [b.left, b.top, b.right, b.bottom].map(Math.round), font: parseFloat(getComputedStyle(el).fontSize) }; }));
  console.log(`  describe fields: ${JSON.stringify(fields)}`);
  for (const f of fields) {
    if (f.box[0] < -1 || f.box[1] < -1 || f.box[2] > v.width + 1 || f.box[3] > v.height + 1) problem(name, `${f.tag} is off the screen: ${f.box}`);
  }
  const nameField = page.locator("#overlay input");
  await (profile.hasTouch ? nameField.tap() : nameField.click());
  await page.keyboard.type("Stick Kid");
  await sleep(200);
  // the on-screen keyboard: emulation can't raise a real one, so the visual viewport is made to shrink as a phone's
  // does (the window stays the size it was) and the focused field must be on what's left of the screen
  const keyboard = async (on) => {
    await page.evaluate((on) => {
      if (!on) { delete window.visualViewport; window.dispatchEvent(new Event("resize")); return; }
      const h = Math.round(innerHeight * (innerHeight > innerWidth ? 0.58 : 0.42));
      Object.defineProperty(window, "visualViewport", { configurable: true, value: { width: innerWidth, height: h, offsetLeft: 0, offsetTop: 0, scale: 1, addEventListener() {}, removeEventListener() {} } });
    }, on);
    await sleep(250);
  };
  const fieldOnScreen = () => page.evaluate(() => {
    const el = document.activeElement, b = el.getBoundingClientRect(), vv = window.visualViewport;
    return { tag: el.tagName, box: [b.left, b.top, b.right, b.bottom].map(Math.round), visible: [vv.width, vv.height], ok: b.left >= -1 && b.top >= -1 && b.right <= vv.width + 1 && b.bottom <= vv.height + 1 && Math.max(b.width, b.height) > 40 && Math.min(b.width, b.height) > 20 };
  });
  if (handheld) {
    await keyboard(true);
    const kb = await fieldOnScreen();
    console.log(`  keyboard up: focused ${kb.tag} at ${kb.box}, ${kb.visible.join("x")} still on the screen`);
    if (!kb.ok) problem(name, `the focused name field is under the keyboard: ${JSON.stringify(kb)}`);
  }
  await shot("6-describe-typing", 300);
  if (handheld) await keyboard(false);
  const desc = page.locator("#overlay textarea");
  await (profile.hasTouch ? desc.tap() : desc.click());
  if (handheld) await keyboard(true);
  await page.keyboard.type("a stick figure who kicks");
  if (handheld) {
    const kb = await fieldOnScreen();
    if (!kb.ok) problem(name, `the focused description is under the keyboard: ${JSON.stringify(kb)}`);
  }
  await shot("6b-describe-typing-description", 300);
  if (handheld) await keyboard(false);
  await page.evaluate(() => document.activeElement?.blur());
  await sleep(300);
  await shot("7-describe-filled", 200);

  // CREATE CHARACTER: the drawing that reaches the server
  const sent = page.waitForRequest((q) => q.url().endsWith("/api/characters") && q.method() === "POST", { timeout: 15000 });
  await tap("send");
  const body = JSON.parse((await sent).postData());
  const png = decodePng(Buffer.from(body.png.slice(body.png.indexOf(",") + 1), "base64"));
  const sentMissing = Object.entries(samples).map(([g, pts]) => [g, pts.filter((p) => !png.ink(...toPad(p))).length, pts.length]).filter(([, n]) => n);
  if (png.w !== 768 || sentMissing.length) problem(name, `the drawing sent (${png.w}x${png.h}) is missing ink under the finger: ${sentMissing.map(([g, n, of]) => `${g} ${n}/${of}`).join(", ")}`);
  else console.log(`  the drawing sent (${png.w}x${png.h}) has ink under every point the finger passed, the edges included`);
  fs.writeFileSync(path.join(shots, "sent.png"), Buffer.from(body.png.slice(body.png.indexOf(",") + 1), "base64"));
  await until("LibraryScreen");
  await sleep(600);
  // the tour's first card, over MY CHARACTERS
  await shot("8-tour-intro", 400);
  const card = await page.evaluate(() => window.sketchbattle.tourCard?.map((b) => b.id) ?? null);
  if (!card) problem(name, "no tour card after a first drawing");
  else await tap("skip");

  // the character being created: waiting in line, then a stage with its bar
  await page.evaluate(() => { const s = window.sketchbattle.screen; const e = window.sketchbattle.screen.entries.find((x) => x.status === "queued"); s.next = s.nav.forge(e); });
  await until("ForgeScreen");
  await shot("9-waiting-in-line", 700);
  let job = null;
  for (let i = 0; i < 40 && !job; i++) { const res = await forgeApi("jobs/next"); if (res.status === 200) job = await res.json(); else await sleep(250); }
  if (!job) throw new Error("the job never reached the queue");
  await forgeApi(`jobs/${job.id}/progress`, { stage: "reading the drawing" });
  await forgeApi(`jobs/${job.id}/progress`, { stage: "designing the moves" });
  await sleep(2600);
  await shot("10-creating", 600);
  await tap("back");
  await until("LibraryScreen");
  await completeJob(server, TOKEN, job, "STICK KID");
  await page.waitForFunction(() => window.sketchbattle.tourCard?.some((b) => b.id === "go"), null, { timeout: 20000 }).catch(() => problem(name, "the tour's ready card never came"));
  await shot("11-tour-ready", 1200);
  if (await page.evaluate(() => !!window.sketchbattle.tourCard)) await tap("skip");

  // the daily limit: one a day here, so NEW CHARACTER is the wall now
  await page.evaluate(() => { window.sketchbattle.screen.next = window.sketchbattle.screen.nav.create(); });
  await until("CreateScreen");
  await sleep(800);
  await shot("12-create-wall", 300);
  const walled = await page.evaluate(() => window.sketchbattle.screen.walled);
  if (!walled) problem(name, "a second drawing on a one-a-day limit wasn't walled");
  if (errors.length) problem(name, `page errors: ${errors.join(" | ")}`);
  await ctx.close();
}

let browsers = {};
try {
  for (const url of [`${server}/api/health`, base]) if (await fetch(url).then(() => true, () => false)) throw new Error(`something is already listening at ${url} (a run that didn't clean up?)`);
  run("npx", ["tsx", "server/index.ts"], { PORT: String(SERVER_PORT), SKETCHBATTLE_DATA: data, DEV_LOGIN: "1", FORGE_TOKEN: TOKEN });
  await up(`${server}/api/health`, "server");
  run("npx", ["vite", "--config", "client/vite.config.ts", "--port", String(VITE_PORT), "--strictPort"], { SKETCHBATTLE_SERVER: server });
  await up(base, "vite");
  browsers = { chromium: await chromium.launch(), webkit: await webkit.launch() };
  for (const [i, d] of DEVICES.entries()) {
    if (only && !only.includes(d[0])) continue;
    try { await device(browsers, d, i); } catch (error) { problem(d[0], `stopped: ${error.stack ?? error}`); }
  }
  console.log(`\n${problems.length ? `${problems.length} problem(s):\n${problems.join("\n")}` : "no problems"}`);
  if (problems.length && !survey) process.exitCode = 1;
} catch (error) {
  console.error(error);
  for (const c of children) console.error(c.log().slice(-2000));
  process.exitCode = 1;
} finally {
  for (const b of Object.values(browsers)) await b.close();
  for (const { child } of children) { try { process.kill(-child.pid, "SIGTERM"); } catch { /* gone */ } }
  await sleep(500);
  fs.rmSync(data, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
