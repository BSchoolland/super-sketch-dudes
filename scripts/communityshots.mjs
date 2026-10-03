// COMMUNITY in a real browser: the grid sorted by popular, then the first character big with SAVE.
//   node scripts/communityshots.mjs [base=http://localhost:5178/sketch-battle/] [out=shots/community]
// Server: PORT=3012 DEV_LOGIN=1 npx tsx server/index.ts, with players and their bundles in server-data/
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const base = process.argv[2] ?? "http://localhost:5178/sketch-battle/";
const out = process.argv[3] ?? "shots/community";
mkdirSync(out, { recursive: true });
const W = 1600, H = 900;
const scale = Math.min(W / 1920, H / 1080), offX = (W - 1920 * scale) / 2, offY = (H - 1080 * scale) / 2;
const at = (x, y) => [offX + x * scale, offY + y * scale];

const browser = await chromium.launch();
const errors = [];
const page = await (await browser.newContext({ viewport: { width: W, height: H } })).newPage();
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page.on("pageerror", (e) => errors.push(e.message));
await page.goto(`${base}?dev=Ben`);
await page.waitForFunction(() => window.sketchbattle?.screen?.constructor.name === "TitleScreen");
const tap = async (x, y) => { await page.mouse.click(...at(x, y)); await page.waitForTimeout(200); };
const shot = async (name) => { await page.screenshot({ path: `${out}/${name}.png` }); console.log(`shot ${out}/${name}.png`); };

// title rows: BATTLE, MY CHARACTERS, NEW CHARACTER, COMMUNITY
await tap(960, 350 + 3 * 96 + 44);
await page.waitForFunction(() => window.sketchbattle.screen.constructor.name === "CommunityScreen" && window.sketchbattle.screen.items?.length > 0);
// every visible cell's bundle loading in turns the drawing into the fighter
await page.mouse.move(...at(960, 1060));
await page.waitForTimeout(Number(process.env.LOAD_MS ?? 6000));
await shot("1-popular");

await tap(145 + 125, 160 + 125);
await page.mouse.move(...at(960, 1060));
await page.waitForTimeout(Number(process.env.LOAD_MS ?? 6000));
await shot("2-detail");

await browser.close();
if (errors.length) { console.error(`console errors:\n${errors.join("\n")}`); process.exitCode = 1; }
