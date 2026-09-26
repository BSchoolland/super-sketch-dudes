// Plays a whole 1-round DRAW BATTLE in two browsers against a local server (DEV_LOGIN=1) +
// scripts/fake-forge.mjs, screenshotting every screen into shots/draw/.
//   node scripts/drawshots.mjs [base=http://localhost:5177/sketch-battle/] [out=shots/draw]
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const base = process.argv[2] ?? "http://localhost:5177/sketch-battle/";
const out = process.argv[3] ?? "shots/draw";
mkdirSync(out, { recursive: true });
const W = 1600, H = 900;
// FAST=1: Bob presses DONE instead of waiting out the clock
const fast = process.env.FAST === "1";
const scale = Math.min(W / 1920, H / 1080), offX = (W - 1920 * scale) / 2, offY = (H - 1080 * scale) / 2;
const at = (x, y) => [offX + x * scale, offY + y * scale];

const browser = await chromium.launch();
const errors = [];
async function player(label, init, hasTouch = false) {
  const name = label[0].toUpperCase() + label.slice(1);
  const context = await browser.newContext({ viewport: { width: W, height: H }, hasTouch });
  await context.addInitScript(init);
  const page = await context.newPage();
  // the bad room code is on purpose
  page.on("console", (m) => { if (m.type() === "error" && !m.text().includes("no such room")) errors.push(`${label}: ${m.text()}`); });
  page.on("pageerror", (e) => errors.push(`${label}: ${e.message}`));
  await page.goto(`${base}?dev=${name}`);
  await page.waitForFunction(() => window.sketchbattle?.screen);
  return page;
}
const shot = async (page, name) => { await page.waitForTimeout(250); await page.screenshot({ path: `${out}/${name}.png` }); console.log(`shot ${name}`); };
// Bob's browser has a touchscreen: his button presses are real touch taps
const tap = async (page, x, y) => { if (page === b) await page.touchscreen.tap(...at(x, y)); else await page.mouse.click(...at(x, y)); await page.waitForTimeout(120); };
const room = (page) => page.evaluate(() => window.__draw?.session.room ?? null);
const view = (page) => page.evaluate(() => window.__draw.drawDebug.view);
async function until(page, what, pred, ms = 20000) {
  const t0 = Date.now();
  for (;;) {
    const r = await room(page);
    if (pred(r)) return r;
    if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}; phase ${r?.phase} note "${r?.note}"`);
    await page.waitForTimeout(150);
  }
}
async function stroke(page, points) {
  await page.mouse.move(...at(...points[0]));
  await page.mouse.down();
  for (const p of points.slice(1)) await page.mouse.move(...at(...p), { steps: 4 });
  await page.mouse.up();
}
const circle = (cx, cy, r, n = 28) => Array.from({ length: n + 1 }, (_, i) => [cx + Math.cos((i / n) * Math.PI * 2) * r, cy + Math.sin((i / n) * Math.PI * 2) * r]);

// Ann starts fresh; Bob has played before (password remembered)
const a = await player("ann", () => localStorage.clear());
const b = await player("bob", () => localStorage.setItem("sketchbattle.drawPassword", "sketch"), true);
await b.route("**/bundle.json", async (route) => { await new Promise((r) => setTimeout(r, 4000)); await route.continue(); });
await shot(a, "00-title");
for (const page of [a, b]) { await tap(page, 440, 474); await page.waitForFunction(() => window.sketchbattle.screen?.drawDebug); await page.evaluate(() => { window.__draw = window.sketchbattle.screen; }); }

await shot(a, "01-password");
await a.keyboard.type("nope"); await a.keyboard.press("Enter"); await a.waitForTimeout(400);
await shot(a, "02-wrong-password");
await a.fill("#overlay input", "sketch"); await a.keyboard.press("Enter"); await a.waitForTimeout(400);
await shot(a, "04-entry");
await shot(b, "04b-entry-remembered");
await tap(a, 960, 395);
const code = (await until(a, "a room", (r) => !!r)).code;
await shot(a, "05-lobby-alone");

const field = async (page) => { try { await page.waitForSelector("#overlay input", { timeout: 5000 }); } catch (e) { console.log("no text field; view:", await view(page), "errors:", errors); await page.screenshot({ path: `${out}/nofield.png` }); throw e; } };
await tap(b, 960, 565); await field(b);
await b.keyboard.type("ZZZZ"); await shot(b, "06-join-code"); await b.keyboard.press("Enter"); await b.waitForTimeout(500);
await shot(b, "06b-join-error");
await tap(b, 960, 565); await field(b); await b.keyboard.type(code); await b.keyboard.press("Enter");
await until(a, "bob in the lobby", (r) => r.players.length === 2);
await shot(a, "07-lobby-host");
await shot(b, "08-lobby-guest");

// host: 1 drawing (rounds starts focused), 45 seconds, start
for (let i = 0; i < 2; i++) { await a.keyboard.press("ArrowLeft"); await a.waitForTimeout(100); }
await tap(a, 1100, 768); await tap(a, 1100, 768);
await shot(a, "09-lobby-settings");
await tap(a, 960, 915);
await until(a, "draw phase", (r) => r.phase === "draw");

// Ann draws a lamp in black and colours; Bob scribbles, undoes, and lets the clock submit for him
await stroke(a, circle(960, 380, 120));
await stroke(a, [[960, 500], [960, 760]]);
await stroke(a, [[960, 600], [820, 520], [760, 560]]);
await stroke(a, [[960, 600], [1100, 660], [1160, 620]]);
await stroke(a, [[960, 760], [860, 930]]); await stroke(a, [[960, 760], [1060, 930]]);
await tap(a, 90 + 42 + 21, 100 + 32);
await stroke(a, [[900, 340], [940, 360], [980, 330], [1020, 380], [940, 420], [890, 400]]);
await tap(a, 90 + 5 * 42 + 21, 100 + 32); await tap(a, 90 + 2 * 116 + 52, 467);
await stroke(a, [[600, 960], [1320, 960]]);
await tap(b, 90 + 4 * 42 + 21, 100 + 32);
await stroke(b, circle(900, 500, 200));
await stroke(b, [[700, 300], [1200, 800]]);
await shot(b, "10-draw-bob-before-undo");
await tap(b, 90 + 170, 590 + 42);
await tap(b, 90 + 21, 100 + 32);
await stroke(b, [[820, 460], [860, 470]]); await stroke(b, [[940, 460], [980, 470]]); await stroke(b, [[820, 580], [900, 620], [980, 580]]);
await shot(a, "11-draw-ann");
await shot(b, "12-draw-bob");
await tap(a, 1490 + 170, 830 + 65);
await shot(a, "13-draw-ann-submitted");
if (fast) await tap(b, 1490 + 170, 830 + 65);
const drawn = await room(b);
if (!fast) console.log(`waiting for Bob's clock (${Math.ceil((drawn.deadline - Date.now()) / 1000)} s left on the server)`);
await until(b, "reveal", (r) => r.phase === "reveal", 70000);
await shot(a, "14-reveal-queued");
await until(a, "forging", (r) => r.players.some((p) => p.characters[0].status === "generating"));
await a.waitForTimeout(1500);
await shot(a, "15-reveal-forging");
await until(a, "both forged", (r) => r.players.every((p) => p.characters[0].status === "ready"), Number(process.env.FORGE_MS ?? 30000));
await a.waitForTimeout(800);
await shot(a, "16-reveal-ready");
await tap(a, 960, 1080 - 72);
await shot(b, "17-reveal-ann-ready");
await tap(b, 960, 1080 - 72);
await until(a, "loading", (r) => r.phase === "loading" || r.phase === "battle", 10000);
await shot(a, "18-loading");
await a.waitForFunction(() => window.sketchbattle.screen !== window.__draw, null, { timeout: 20000 });
await a.waitForTimeout(3600);
await shot(a, "19-battle");

// Ann walks off the stage until she's out of stocks
const t0 = Date.now();
const battleState = (page) => page.evaluate(() => {
  const s = window.sketchbattle.screen.session;
  return s?.state ? { frame: s.state.frame, confirmed: s.confirmedThrough, ended: s.state.ended, winner: s.state.winner, fighters: s.state.fighters.map((f) => `${f.stocks}@${Math.round(f.x)},${Math.round(f.y)} ${f.action}`) } : null;
});
// the match takes the device Ann last used in a menu (the arrows, in the lobby: keyboard layout 2)
const device = await a.evaluate(() => window.__draw.device);
const [right, down] = device === "kb1" ? ["KeyD", "KeyS"] : device === "kb2" ? ["ArrowRight", "ArrowDown"] : [null, null];
if (!right) throw new Error(`Ann is on ${device}`);
let endShot = false;
while ((await room(a)).phase === "battle") {
  const st = await battleState(a);
  console.log(JSON.stringify(st));
  if (st?.ended && !endShot) { await shot(a, "20-battle-end"); endShot = true; }
  if (Date.now() - t0 > 120000) throw new Error("battle never ended");
  await a.keyboard.down(right); await a.waitForTimeout(1400); await a.keyboard.up(right);
  await a.keyboard.press(down); await a.waitForTimeout(300);
}
await until(a, "between or over", (r) => r.phase === "between" || r.phase === "over", 10000);
await a.waitForFunction(() => window.sketchbattle.screen === window.__draw, null, { timeout: 10000 });
await shot(a, "21-between");
await until(a, "over", (r) => r.phase === "over", 20000);
await shot(a, "22-over-ann");
await shot(b, "23-over-bob");
await tap(b, 960, 1080 - 76);
await shot(b, "24-back-to-title");
console.log(`final view: ${await view(a)}`);

await browser.close();
if (errors.length) { console.error(`console errors:\n${errors.join("\n")}`); process.exitCode = 1; }
