// Screenshots of the game for eyes that aren't in a browser. Usage: node scripts/shots.mjs [url] [outdir]
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { down as btnDown, up as btnUp, press as btnPress } from "./lib/keys.mjs";
const url = process.argv[2] ?? "http://localhost:5175/sketch-battle/?quick=1&p2=cpu&cpu=9&seed=3";
const out = process.argv[3] ?? "shots";
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
await page.goto(url);
await page.waitForFunction(() => window.sketchbattle?.screen, null, { timeout: 20000 });
await page.waitForTimeout(800);
await page.screenshot({ path: `${out}/00-start.png` });
// let the CPU fight P1 (idle) for a bit, then drive P1 with keys
for (let i = 1; i <= 4; i++) {
  await page.keyboard.down("KeyD"); await page.waitForTimeout(250); await page.keyboard.up("KeyD");
  await btnPress(page, "Mouse0"); await page.waitForTimeout(400);
  await page.keyboard.down("KeyW"); await page.waitForTimeout(80); await page.keyboard.up("KeyW");
  await page.waitForTimeout(150);
  await btnPress(page, "Mouse0");
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${out}/0${i}-play.png` });
}
await page.keyboard.press("F2");
await page.keyboard.down("KeyA"); await page.waitForTimeout(120); await page.keyboard.up("KeyA");
await page.keyboard.down("KeyU"); await page.keyboard.down("KeyD"); await btnPress(page, "Mouse0"); await page.waitForTimeout(220);
await page.screenshot({ path: `${out}/05-boxes.png` });
await page.keyboard.up("KeyU"); await page.keyboard.up("KeyD");
await page.waitForTimeout(3000);
await page.screenshot({ path: `${out}/06-later.png` });
const info = await page.evaluate(() => { const s = (window).sketchbattle.screen.match.state; return { frame: s.frame, fighters: s.fighters.map((f) => ({ action: f.action, x: Math.round(f.x), y: Math.round(f.y), percent: f.percent, stocks: f.stocks })) }; });
console.log(JSON.stringify(info));
if (errors.length) { console.error("page errors:\n" + errors.join("\n")); process.exitCode = 1; }
await browser.close();
