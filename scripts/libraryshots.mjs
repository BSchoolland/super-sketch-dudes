// Walks the account game in real browsers against a local server + scripts/fake-forge.mjs:
// sign-in, NEW CHARACTER (draw, DONE, forged), MY CHARACTERS, BATTLE: VS BOTS, then a public lobby
// found through JOIN ROOM and QUICK MATCH by two signed-in players. Screenshots into shots/library/.
//   node scripts/libraryshots.mjs [base=http://localhost:5178/sketch-battle/] [out=shots/library]
// Server: PORT=3012 DEV_LOGIN=1 FORGE_TOKEN=devtoken npx tsx server/index.ts, plus scripts/fake-forge.mjs
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { down as btnDown, up as btnUp, press as btnPress } from "./lib/keys.mjs";

const base = process.argv[2] ?? "http://localhost:5178/sketch-battle/";
const out = process.argv[3] ?? "shots/library";
mkdirSync(out, { recursive: true });
const W = 1600, H = 900;
const scale = Math.min(W / 1920, H / 1080), offX = (W - 1920 * scale) / 2, offY = (H - 1080 * scale) / 2;
const at = (x, y) => [offX + x * scale, offY + y * scale];

const browser = await chromium.launch();
const errors = [];
async function open(label, query = "") {
  const context = await browser.newContext({ viewport: { width: W, height: H } });
  const page = await context.newPage();
  page.on("console", (m) => { if (m.type() === "error") errors.push(`${label}: ${m.text()}`); });
  page.on("pageerror", (e) => errors.push(`${label}: ${e.message}`));
  await page.goto(base + query);
  await page.waitForFunction(() => window.sketchbattle?.screen);
  return page;
}
const shot = async (page, name) => { await page.waitForTimeout(300); await page.screenshot({ path: `${out}/${name}.png` }); console.log(`shot ${name}`); };
const tap = async (page, x, y) => { await page.mouse.click(...at(x, y)); await page.waitForTimeout(150); };
const screenName = (page) => page.evaluate(() => window.sketchbattle.screen.constructor.name);
async function until(page, what, fn, arg, ms = 20000) {
  try { await page.waitForFunction(fn, arg, { timeout: ms, polling: 100 }); }
  catch (e) { await page.screenshot({ path: `${out}/timeout.png` }); throw new Error(`timed out waiting for ${what} (on ${await screenName(page)}): ${e.message}`); }
}
const onScreen = (page, name, ms) => until(page, name, (n) => window.sketchbattle.screen.constructor.name === n, name, ms);
async function stroke(page, points) {
  await page.mouse.move(...at(...points[0]));
  await page.mouse.down();
  for (const p of points.slice(1)) await page.mouse.move(...at(...p), { steps: 4 });
  await page.mouse.up();
}
const circle = (cx, cy, r, n = 28) => Array.from({ length: n + 1 }, (_, i) => [cx + Math.cos((i / n) * Math.PI * 2) * r, cy + Math.sin((i / n) * Math.PI * 2) * r]);

// title menu rows: BATTLE, MY CHARACTERS, NEW CHARACTER, SETTINGS
const menu = (i) => [960, 350 + i * 96 + 44];
// BATTLE's rows: QUICK MATCH, CREATE LOBBY, JOIN ROOM, VS BOTS
const battle = (i) => [960, 220 + i * 170 + 65];

/** NEW CHARACTER from the title: a stick figure with a red hat, DONE, and wait for the fake forge. */
async function createCharacter(page, prefix) {
  await tap(page, ...menu(2));
  await onScreen(page, "CreateScreen");
  await stroke(page, circle(960, 330, 90));
  await stroke(page, [[960, 420], [960, 700]]);
  await stroke(page, [[960, 520], [820, 460]]); await stroke(page, [[960, 520], [1110, 600]]);
  await stroke(page, [[960, 700], [860, 950]]); await stroke(page, [[960, 700], [1060, 950]]);
  await tap(page, 90 + 42 + 21, 100 + 32);
  await stroke(page, [[870, 250], [1050, 250], [1000, 180], [920, 180], [870, 250]]);
  if (prefix) await shot(page, `${prefix}-create`);
  await tap(page, 1490 + 170, 700 + 65);
  await onScreen(page, "DescribeScreen");
  await page.fill("#overlay input", "BIG BOB");
  await page.fill("#overlay textarea", "a stick guy with a red hat. he kicks and his hat is a boomerang.");
  if (prefix) await shot(page, `${prefix}-describe`);
  await tap(page, 960 + 200, 760 + 55);
  await onScreen(page, "ForgeScreen");
  if (prefix) { await page.waitForTimeout(1200); await shot(page, `${prefix}-forging`); }
  await until(page, "forged", () => window.sketchbattle.screen.entry?.status === "ready", null, Number(process.env.FORGE_MS ?? 40000));
  if (prefix) await shot(page, `${prefix}-forged`);
}

async function playFor(page, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    await page.keyboard.down("KeyD"); await page.waitForTimeout(250); await page.keyboard.up("KeyD");
    await btnPress(page, "Mouse0"); await page.waitForTimeout(200);
    await btnPress(page, "Mouse2"); await page.waitForTimeout(300);
  }
}

// the door
const door = await open("door");
await shot(door, "00-sign-in");
await door.context().close();

// Ann: title, the creator, the forge
const a = await open("ann", "?dev=Ann");
await onScreen(a, "TitleScreen");
await a.waitForTimeout(1500);
await shot(a, "01-title-house-parade");
await createCharacter(a, "02");

// BACK -> MY CHARACTERS, the character big, DELETE armed, FIGHT
await tap(a, 960 + 20 + 220, 930 + 55);
await onScreen(a, "LibraryScreen");
await a.waitForTimeout(800);
await shot(a, "03-library");
await tap(a, 145 + 125, 160 + 125);
await shot(a, "04-library-detail");
await tap(a, 960, 985);
await shot(a, "05-library-delete-armed");
await tap(a, 960 - 540 - 30 + 180, 985);
await onScreen(a, "BattleMenuScreen");
await shot(a, "06-battle-menu");

// VS BOTS: the shelf, you vs a CPU slot, stage, fight
await tap(a, ...battle(3));
await onScreen(a, "BotsScreen");
await a.waitForTimeout(1200);
await shot(a, "07-bots");
await a.keyboard.press("ArrowDown"); await a.keyboard.press("ArrowRight");
await a.waitForTimeout(600);
await shot(a, "07b-bots-other-cpu");
await tap(a, 960, 864 + 42);
await onScreen(a, "StageScreen");
await shot(a, "08-stage");
await a.keyboard.press("Enter");
await onScreen(a, "VersusScreen");
await a.waitForTimeout(3500);
await playFor(a, 3000);
await shot(a, "09-vs-bots");
const fighters = await a.evaluate(() => window.sketchbattle.screen.match.state.fighters.map((f) => f.id));
console.log(`vs bots fighters: ${fighters.join(" vs ")}`);

// ONLINE: Bob makes his own character; Ann opens a public lobby, Bob sees it in JOIN ROOM, then QUICK MATCH lands him in it
const b = await open("bob", "?dev=Bob");
await onScreen(b, "TitleScreen");
await createCharacter(b, "");
for (const page of [a, b]) {
  await page.goto(base);
  await onScreen(page, "TitleScreen");
  await page.waitForTimeout(500);
  await tap(page, ...menu(0));
  await onScreen(page, "BattleMenuScreen");
}
await tap(a, ...battle(1));
await until(a, "the public/private choice", () => window.sketchbattle.screen.phase === "create");
await shot(a, "10-create-lobby");
await tap(a, 960, 280 + 70);
await until(a, "a room", () => !!window.sketchbattle.screen.roomCode);
await tap(b, ...battle(2));
await until(b, "ann's lobby listed", () => window.sketchbattle.screen.rooms?.length > 0);
await b.waitForTimeout(300);
await shot(b, "11-join-room-list");
await b.keyboard.press("Escape");
await onScreen(b, "BattleMenuScreen");
await tap(b, ...battle(0));
await until(a, "bob in the room", () => window.sketchbattle.screen.lobbyDebug()?.members.length === 2);
await a.waitForTimeout(1500);
await shot(a, "12-online-room-host");
await shot(b, "13-online-room-guest");
await tap(b, 982 + 85, 120 + 85);
await b.waitForTimeout(400);
for (const page of [b, a]) { await page.keyboard.press("Enter"); await page.waitForTimeout(400); }
await until(a, "everyone ready", () => window.sketchbattle.screen.lobbyDebug()?.members.every((m) => m.ready));
await shot(a, "14-online-room-ready");
// START takes the room to the stage screen: Ann picks, Bob watches her pick land
await a.keyboard.press("Enter");
await until(b, "bob on the stage screen", () => !!window.sketchbattle.screen.context?.room?.picking);
await a.keyboard.press("ArrowRight");
await until(b, "ann's stage pick mirrored", () => window.sketchbattle.screen.context.room.picking.stage === "proving");
await a.waitForTimeout(300);
await shot(a, "14b-stage-host");
await shot(b, "14c-stage-guest");
await a.keyboard.press("Enter");
for (const page of [a, b]) await until(page, "the online match", () => !!window.sketchbattle.screen.session, null, 20000);
await a.waitForTimeout(3500);
await playFor(a, 2500);
await shot(a, "15-online-match-ann");
await shot(b, "16-online-match-bob");
const net = await Promise.all([a, b].map((p) => p.evaluate(() => { const s = window.sketchbattle.screen.session; return { frame: s.state.frame, fighters: s.state.fighters.map((f) => f.id), desync: !!s.desync }; })));
console.log(`online: ${JSON.stringify(net)}`);

await browser.close();
if (errors.length) { console.error(`console errors:\n${errors.join("\n")}`); process.exitCode = 1; }
