// One action shot per fighter on a given stage. Usage: node scripts/fightershots.mjs [base] [outdir]
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
const base = process.argv[2] ?? "http://localhost:5175/sketch-battle/";
const out = process.argv[3] ?? "shots/fighters";
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
const combos = [["brick", "wick", "rooftops"], ["pilot", "sable", "kessler"], ["wick", "pilot", "proving"], ["brick", "sable", "rooftops"]];
for (const [a, b, stage] of combos) {
  await page.goto(`${base}?quick=1&p2=cpu&cpu=9&f=${a},${b}&stage=${stage}&seed=11`);
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${out}/${a}-${b}-${stage}-0.png` });
  await page.keyboard.down("KeyD"); await page.waitForTimeout(300); await page.keyboard.up("KeyD");
  await page.keyboard.press("KeyK"); await page.waitForTimeout(250);
  await page.screenshot({ path: `${out}/${a}-${b}-${stage}-1.png` });
  await page.keyboard.press("KeyW"); await page.waitForTimeout(120);
  await page.keyboard.press("KeyJ"); await page.waitForTimeout(200);
  await page.screenshot({ path: `${out}/${a}-${b}-${stage}-2.png` });
  await page.keyboard.down("KeyS"); await page.keyboard.press("KeyK"); await page.waitForTimeout(400); await page.keyboard.up("KeyS");
  await page.screenshot({ path: `${out}/${a}-${b}-${stage}-3.png` });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${out}/${a}-${b}-${stage}-4.png` });
}
if (errors.length) { console.error("page errors:\n" + errors.join("\n")); process.exitCode = 1; }
await browser.close();
