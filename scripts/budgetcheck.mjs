// The forge budget as players meet it, in a real browser: a server with a tiny budget (forge-budget.json), Vite,
// and scripts/fake-forge.mjs as the worker. Screenshots every player-facing state into the out dir.
//   1. Ann sees her count on the title and beside the pad, uses it up, and meets the wall before drawing.
//   2. Bob's forge spends the week. Cat sees the forge resting up front, draws anyway; her drawing waits, and a
//      second one is walled.
//   3. The budget reopens (a restart with the week's anchor moved to now): Cat's drawing is forged.
//   4. A failed forge is tried again for free; the kill switch pauses everything; guests meet their walls.
// Usage: node scripts/budgetcheck.mjs [outdir=/tmp/ssd-budget-shots]
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const SERVER_PORT = 3150, VITE_PORT = 5350, TOKEN = "budgetcheck";
const out = process.argv[2] ?? "/tmp/ssd-budget-shots";
fs.mkdirSync(out, { recursive: true });
const data = fs.mkdtempSync(path.join(os.tmpdir(), "budgetcheck-"));
const base = `http://localhost:${VITE_PORT}/sketch-battle/`;
const server = `http://localhost:${SERVER_PORT}`;
const children = new Set();
const fail = (message) => { throw new Error(message); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function run(cmd, args, env) {
  const child = spawn(cmd, args, { env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"], detached: true });
  let log = "";
  child.stdout.on("data", (d) => (log += d));
  child.stderr.on("data", (d) => (log += d));
  const entry = { child, log: () => log };
  children.add(entry);
  child.on("exit", () => children.delete(entry));
  return entry;
}
async function up(url, what) {
  for (let i = 0; i < 150; i++) {
    try { if ((await fetch(url)).ok) return; } catch { /* not listening yet */ }
    await sleep(200);
  }
  fail(`${what} never came up at ${url}`);
}
const budget = (over) => fs.writeFileSync(path.join(data, "forge-budget.json"), JSON.stringify({
  perWeek: 3, weekStartsAt: new Date(Date.now() - 3_600_000).toISOString(), paused: null, perPlayerPerDay: 2, waitingPerPlayer: 1, guest: { lifetime: 1, perIpPerDay: 2 }, ...over,
}));
let api = null;
/** A page that fetches while the server restarts logs a failed request; that's expected then, and only then. */
let restarting = false;
async function startServer() {
  api = run("npx", ["tsx", "server/index.ts"], { PORT: String(SERVER_PORT), SKETCHBATTLE_DATA: data, DEV_LOGIN: "1", FORGE_TOKEN: TOKEN });
  await up(`${server}/api/health`, "server");
  // the fake forge gives up when the server goes away; the real worker keeps polling
  if (forge && forge.child.exitCode !== null) startForge();
  await sleep(2500);
  restarting = false;
}
async function stopServer() {
  restarting = true;
  const { child } = api;
  const gone = new Promise((r) => child.once("exit", r));
  process.kill(-child.pid, "SIGINT");
  await gone;
}
let forge = null;
const startForge = () => { forge = run("node", ["scripts/fake-forge.mjs", server, TOKEN], {}); };
async function stopForge() {
  if (forge.child.exitCode !== null) return;
  const gone = new Promise((r) => forge.child.once("exit", r));
  process.kill(-forge.child.pid, "SIGTERM");
  await gone;
}

let browser;
try {
  budget({});
  await startServer();
  startForge();
  run("npx", ["vite", "--config", "client/vite.config.ts", "--port", String(VITE_PORT), "--strictPort"], { SKETCHBATTLE_SERVER: server });
  await up(base, "vite");
  browser = await chromium.launch();
  const errors = [];

  const open = async (who) => {
    const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
    const problem = (text) => { if (restarting) return; errors.push(`${who}: ${text}`); console.error(`page error, ${who}: ${text}`); };
    page.on("pageerror", (e) => problem(e.stack ?? String(e)));
    page.on("console", (m) => { if (m.type() === "error") problem(m.text()); });
    return page;
  };
  // the canvas is 1920x1080 drawn at 1600x900
  const k = 1600 / 1920;
  const click = async (page, x, y) => { await page.mouse.click(x * k, y * k); await page.waitForTimeout(250); };
  const screen = (page) => page.evaluate(() => window.sketchbattle.screen.constructor.name);
  const until = async (page, name, ms = 15000) => page.waitForFunction((n) => window.sketchbattle?.screen?.constructor.name === n, name, { timeout: ms });
  const forgeOf = (page) => page.evaluate(async () => {
    const { session } = JSON.parse(localStorage.getItem("sketchbattle.account"));
    return (await (await fetch("api/library", { headers: { "x-session": session } })).json()).forge;
  });
  const shot = async (page, name, ms = 600) => { await page.waitForTimeout(ms); await page.screenshot({ path: path.join(out, `${name}.png`) }); console.log(`shot ${name}`); };
  const signIn = async (page, name) => {
    await page.goto(`${base}?dev=${name}`);
    await page.waitForFunction(() => Array.isArray(window.sketchbattle?.screen?.items), null, { timeout: 20000 });
    await page.mouse.move(2, 2);
    await page.waitForTimeout(800);
  };
  const titleTo = async (page, id) => {
    await page.evaluate((i) => { const s = window.sketchbattle.screen; s.sel = s.items.findIndex((it) => it.id === i); }, id);
    await page.waitForTimeout(200);
  };
  const scribble = async (page, n = 0) => {
    await page.mouse.move((700 + n * 40) * k, 300 * k); await page.mouse.down();
    for (const [x, y] of [[900, 500], [700, 700], [1100, 600], [800, 350]]) await page.mouse.move((x + n * 40) * k, y * k, { steps: 8 });
    await page.mouse.up();
  };
  /** From the title: NEW CHARACTER, draw, DONE DRAWING, CREATE CHARACTER; lands on the library. */
  const drawOne = async (page, n, shots = {}) => {
    if (await screen(page) !== "TitleScreen") await toTitle(page);
    await titleTo(page, "create"); await page.keyboard.press("Enter");
    await until(page, "CreateScreen");
    await page.waitForTimeout(500);
    if (shots.create) await shot(page, shots.create);
    await scribble(page, n);
    await click(page, 1660, 765);
    await until(page, "DescribeScreen");
    if (shots.describe) await shot(page, shots.describe);
    await click(page, 1160, 855);
    await until(page, "LibraryScreen");
    await page.waitForTimeout(800);
  };
  const toTitle = async (page) => { await page.goto(base); await page.waitForFunction(() => Array.isArray(window.sketchbattle?.screen?.items), null, { timeout: 20000 }); await page.mouse.move(2, 2); await page.waitForTimeout(800); };
  const status = async (owner) => (JSON.parse(fs.readFileSync(path.join(data, "forge-jobs.json"), "utf8"))).filter((j) => j.owner === owner).map((j) => j.status);
  const waitFor = async (what, check, ms = 20000) => { for (let t = 0; t < ms; t += 250) { if (await check()) return; await sleep(250); } fail(`timed out waiting for ${what}`); };

  // 1. Ann: her count, then the wall before the pad
  const ann = await open("ann");
  await signIn(ann, "Ann");
  await titleTo(ann, "create");
  await shot(ann, "01-title-count");
  await drawOne(ann, 0, { create: "02-create-count" });
  await shot(ann, "03-library-one-left", 900);
  await drawOne(ann, 1);
  await waitFor("Ann's two forged", async () => (await status("dev-ann")).every((s) => s === "done"));
  await shot(ann, "04-library-none-left", 3500);
  if ((await forgeOf(ann)).wall !== "day") fail("Ann isn't walled after two");
  await toTitle(ann);
  await titleTo(ann, "create");
  await shot(ann, "05-title-none-left");
  await ann.keyboard.press("Enter");
  await until(ann, "CreateScreen");
  await shot(ann, "06-create-wall-day");
  await click(ann, 1490 + 170, 765);
  await until(ann, "CommunityScreen");

  // 2. Bob spends the week; Cat finds the forge resting
  const bob = await open("bob");
  await signIn(bob, "Bob");
  await drawOne(bob, 2);
  await waitFor("Bob's forged", async () => (await status("dev-bob")).every((s) => s === "done"));
  const cat = await open("cat");
  await signIn(cat, "Cat");
  if (!(await forgeOf(cat)).resting) fail("the forge isn't resting after three");
  await titleTo(cat, "create");
  await shot(cat, "07-title-resting");
  await drawOne(cat, 3, { create: "08-create-resting", describe: "09-describe-resting" });
  await shot(cat, "10-library-waiting", 900);
  await sleep(2000);
  if ((await status("dev-cat"))[0] !== "queued") fail("Cat's drawing was forged while the forge rested");
  await click(cat, 210, 315);
  await until(cat, "ForgeScreen");
  await shot(cat, "11-forging-waiting");
  await toTitle(cat);
  await titleTo(cat, "create");
  await cat.keyboard.press("Enter");
  await until(cat, "CreateScreen");
  await shot(cat, "12-create-wall-waiting");

  // 3. the week rolls over (a restart with the anchor moved to now): Cat's drawing is forged, on her open forge screen
  await toTitle(cat);
  await titleTo(cat, "library"); await cat.keyboard.press("Enter");
  await until(cat, "LibraryScreen");
  await cat.waitForTimeout(800);
  await click(cat, 210, 315);
  await until(cat, "ForgeScreen");
  await stopServer();
  budget({ weekStartsAt: new Date().toISOString() });
  await startServer();
  await waitFor("Cat's forged once the budget reopened", async () => (await status("dev-cat"))[0] === "done");
  await cat.waitForFunction(() => window.sketchbattle.screen.entry?.status === "ready", null, { timeout: 15000 });
  await shot(cat, "13-forging-done-after-reopen", 2500);

  // 4a. a forge that fails is tried again, free
  await stopForge();
  const dee = await open("dee");
  await signIn(dee, "Dee");
  await drawOne(dee, 4);
  const claimed = await (await fetch(`${server}/api/forge/jobs/next`, { headers: { "x-forge-token": TOKEN } })).json();
  await fetch(`${server}/api/forge/jobs/${claimed.id}/fail`, { method: "POST", headers: { "x-forge-token": TOKEN, "content-type": "application/json" }, body: JSON.stringify({ error: "The forge couldn't make this one work. Sorry!" }) });
  await dee.waitForTimeout(3500);
  const left = (await forgeOf(dee)).left;
  await click(dee, 210, 315);
  await shot(dee, "14-library-failed-retry");
  const retry = await dee.evaluate(() => { const s = window.sketchbattle.screen; const b = s.detailButtons(s.selected); return b.find((x) => x.id === "retry"); });
  if (!retry) fail("no TRY AGAIN on a failed character");
  await click(dee, retry.x + retry.w / 2, retry.y + retry.h / 2);
  await until(dee, "ForgeScreen");
  startForge();
  await dee.waitForFunction(() => window.sketchbattle.screen.entry?.status === "ready", null, { timeout: 20000 });
  if ((await forgeOf(dee)).left !== left) fail("the retry used up one of Dee's forges");

  // 4b. the kill switch
  await stopServer();
  budget({ weekStartsAt: new Date().toISOString(), paused: "The forge is getting a tune-up. Back soon!" });
  // 4c. guests come from another change: their sessions are fixtures, written while the server is down
  const sessions = JSON.parse(fs.readFileSync(path.join(data, "sessions.json"), "utf8"));
  const guests = ["one", "two", "three"].map((g) => ({ session: `budgetcheck-guest-${g}`, player: { id: `guest-${g}`, name: "Guest", avatar: null } }));
  for (const g of guests) sessions.push([g.session, { player: g.player, at: Date.now() }]);
  fs.writeFileSync(path.join(data, "sessions.json"), JSON.stringify(sessions));
  await startServer();
  const eve = await open("eve");
  await signIn(eve, "Eve");
  await titleTo(eve, "create");
  await shot(eve, "15-title-paused");
  await eve.keyboard.press("Enter");
  await until(eve, "CreateScreen");
  await shot(eve, "16-create-paused");

  await stopServer();
  budget({ weekStartsAt: new Date().toISOString() });
  await startServer();
  for (const [i, g] of guests.entries()) {
    const page = await open(`guest-${g.player.id}`);
    await page.goto(base);
    await page.evaluate((acc) => localStorage.setItem("sketchbattle.account", JSON.stringify(acc)), g);
    await toTitle(page);
    if (i === 0) {
      await drawOne(page, 5, { create: "17-create-guest" });
      await toTitle(page);
      await titleTo(page, "create"); await page.keyboard.press("Enter");
      await until(page, "CreateScreen");
      await shot(page, "18-create-wall-guest");
    } else if (i === 1) await drawOne(page, 6);
    else {
      await titleTo(page, "create"); await page.keyboard.press("Enter");
      await until(page, "CreateScreen");
      if ((await forgeOf(page)).wall !== "network") fail("the third guest on one network isn't walled");
      await shot(page, "19-create-wall-network");
    }
  }
  if (errors.length) fail(`page errors:\n${errors.join("\n")}`);
  console.log(`budgetcheck: ok, shots in ${out}`);
} catch (e) {
  for (const { log } of children) console.error(log().slice(-3000));
  throw e;
} finally {
  await browser?.close();
  for (const { child } of [...children]) { try { process.kill(-child.pid, "SIGTERM"); } catch (e) { if (e.code !== "ESRCH") throw e; } }
  fs.rmSync(data, { recursive: true, force: true });
}
