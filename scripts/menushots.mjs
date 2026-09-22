import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
const base = process.argv[2] ?? "http://localhost:5175/ringout/";
const out = process.argv[3] ?? "shots";
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
await page.goto(base);
await page.waitForTimeout(700);
await page.screenshot({ path: `${out}/m0-title.png` });
await page.keyboard.press("KeyJ"); await page.waitForTimeout(400);
await page.screenshot({ path: `${out}/m1-select-empty.png` });
await page.keyboard.press("KeyJ"); await page.waitForTimeout(300); // join slot 0
await page.keyboard.press("KeyK"); await page.waitForTimeout(300); // add CPU to slot 1
await page.screenshot({ path: `${out}/m2-select.png` });
await page.keyboard.press("KeyJ"); await page.waitForTimeout(600); // ready
await page.keyboard.press("KeyJ"); await page.waitForTimeout(500); // start
await page.screenshot({ path: `${out}/m3-stage.png` });
await page.keyboard.press("KeyJ"); await page.waitForTimeout(900);
await page.screenshot({ path: `${out}/m4-countdown.png` });
await page.waitForTimeout(3200);
await page.keyboard.down("KeyD"); await page.waitForTimeout(400); await page.keyboard.up("KeyD");
await page.keyboard.press("KeyJ"); await page.waitForTimeout(300);
await page.screenshot({ path: `${out}/m5-fight.png` });
await page.keyboard.press("Escape"); await page.waitForTimeout(300);
await page.screenshot({ path: `${out}/m6-pause.png` });
if (errors.length) { console.error("page errors:\n" + errors.join("\n")); process.exitCode = 1; }
await browser.close();
