// Walks the account game in real browsers against a local server + scripts/fake-forge.mjs:
// sign-in, NEW CHARACTER (draw, DONE, forged), MY CHARACTERS, BATTLE vs CPU, LOCAL 2P, and ONLINE
// with two signed-in players on library fighters. Screenshots into shots/library/.
//   node scripts/libraryshots.mjs [base=http://localhost:5178/sketch-battle/] [out=shots/library]
// Server: PORT=3012 DEV_LOGIN=1 FORGE_TOKEN=devtoken npx tsx server/index.ts
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

// title menu rows (x 180..700, from y 430 every 104)
const menu = (i) => [960, 350 + i * 96 + 44];

/** NEW CHARACTER from the title: a stick figure with a red hat, DONE, and wait for the fake forge. */
async function createCharacter(page, prefix) {
  await tap(page, ...menu(1));
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
await onScreen(a, "ModeScreen");
await shot(a, "06-mode");

// VS CPU: opponent, level, stage, fight
await tap(a, 1060 + 320, 290);
await onScreen(a, "CpuSetupScreen");
await a.waitForTimeout(1200);
await shot(a, "07-cpu-setup");
await tap(a, 960 + 40 + 240, 845);
await onScreen(a, "StageScreen");
await shot(a, "08-stage");
await a.keyboard.press("Enter");
await onScreen(a, "VersusScreen");
await a.waitForTimeout(3500);
await playFor(a, 3000);
await shot(a, "09-vs-cpu");
const fighters = await a.evaluate(() => window.sketchbattle.screen.match.state.fighters.map((f) => f.id));
console.log(`vs cpu fighters: ${fighters.join(" vs ")}`);

// LOCAL 2P from the title: COUCH CO-OP, your first fighter, LOCAL 2P, player 2 joins on the arrows keyboard
await a.goto(base);
await onScreen(a, "TitleScreen");
await a.waitForTimeout(800);
await shot(a, "10-title-own-parade");
await tap(a, ...menu(4));
await onScreen(a, "PickFighterScreen");
await a.waitForTimeout(1500);
await shot(a, "11-pick-fighter");
await tap(a, 250 + 100, 190 + 100);
await onScreen(a, "ModeScreen");
await tap(a, 1060 + 320, 470);
await onScreen(a, "LocalSetupScreen");
await a.waitForTimeout(600);
await shot(a, "12-local-one-player");
await a.keyboard.press("Numpad1");
await a.waitForTimeout(200);
await a.keyboard.press("ArrowRight"); await a.waitForTimeout(150);
await a.keyboard.press("Numpad1");
await a.waitForTimeout(600);
await shot(a, "13-local-both-ready");
await a.keyboard.press("Enter");
await onScreen(a, "StageScreen");
await a.keyboard.press("Enter");
await onScreen(a, "VersusScreen");
await a.waitForTimeout(3500);
await shot(a, "14-local-match");
const local = await a.evaluate(() => window.sketchbattle.screen.match.sources.map((s) => s.device ?? `cpu${s.cpu}`));
console.log(`local devices: ${local.join(", ")}`);

// ONLINE: Bob makes his own character, then Ann hosts a room and Bob joins it
const b = await open("bob", "?dev=Bob");
await onScreen(b, "TitleScreen");
await createCharacter(b, "");
await b.goto(base);
await a.goto(base);
for (const page of [a, b]) {
  await onScreen(page, "TitleScreen");
  await page.waitForTimeout(500);
  await tap(page, ...menu(3));
  await onScreen(page, "PickFighterScreen");
  await page.waitForTimeout(500);
  await tap(page, 250 + 100, 190 + 100);
  await onScreen(page, "OnlineScreen");
}
await tap(a, 960, 230 + 180 + 65);
await until(a, "a room", () => !!window.sketchbattle.screen.roomCode);
const code = await a.evaluate(() => window.sketchbattle.screen.roomCode);
await tap(b, 960, 230 + 360 + 65);
await b.keyboard.type(code);
await b.keyboard.press("Enter");
await until(a, "bob in the room", () => window.sketchbattle.screen.lobbyDebug()?.members.length === 2);
await a.waitForTimeout(1500);
await shot(a, "15-online-room-host");
await shot(b, "16-online-room-guest");
for (const page of [b, a]) { await page.keyboard.press("Enter"); await page.waitForTimeout(400); }
await until(a, "everyone ready", () => window.sketchbattle.screen.lobbyDebug()?.members.every((m) => m.ready));
await a.keyboard.press("Enter");
for (const page of [a, b]) await until(page, "the online match", () => !!window.sketchbattle.screen.session, null, 20000);
await a.waitForTimeout(3500);
await playFor(a, 2500);
await shot(a, "17-online-match-ann");
await shot(b, "18-online-match-bob");
const net = await Promise.all([a, b].map((p) => p.evaluate(() => { const s = window.sketchbattle.screen.session; return { frame: s.state.frame, fighters: s.state.fighters.map((f) => f.id), desync: !!s.desync }; })));
console.log(`online: ${JSON.stringify(net)}`);

await browser.close();
if (errors.length) { console.error(`console errors:\n${errors.join("\n")}`); process.exitCode = 1; }
