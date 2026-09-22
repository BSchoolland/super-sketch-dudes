// Pose contact sheets for every fighter: node scripts/posesheets.mjs [base] [outdir]
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
const base = process.argv[2] ?? "http://localhost:5175/sketch-battle/";
const out = process.argv[3] ?? "shots/sheets";
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
for (const f of ["sable", "brick", "wick", "pilot"]) for (const p of [0, 1]) {
  await page.goto(`${base}?sheet=${f}&page=${p}`);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${out}/${f}-${p}.png` });
}
await browser.close();
