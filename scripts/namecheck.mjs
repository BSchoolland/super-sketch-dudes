// Typed names go past the moderator before anyone sees them, end to end in real pages:
//   1. a listed word is refused on the spot
//   2. a name asked for while the judges are away waits, and says so
//   3. the judges (scripts/fake-name-judge.mjs: "mean" is refused) refuse it: the player is told, and nobody else ever sees it
//   4. another name is checked, approved, and is the name a second player sees in a lobby
//   5. a page claiming a name over the lobby socket is shown by its session's name instead
// Starts its own server (DEV_LOGIN, a scratch data dir) and Vite.
// Usage: node scripts/namecheck.mjs [--shots <dir>]   (SERVER_PORT, VITE_PORT override 3561 / 5761)
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { signIn } from "./menu-nav.mjs";

const SERVER_PORT = Number(process.env.SERVER_PORT ?? 3561), VITE_PORT = Number(process.env.VITE_PORT ?? 5761), TOKEN = "devtoken";
const shotsAt = process.argv.indexOf("--shots");
const shots = shotsAt > 0 ? process.argv[shotsAt + 1] : null;
const data = fs.mkdtempSync(path.join(os.tmpdir(), "namecheck-"));
const server = `http://localhost:${SERVER_PORT}`;
const base = `http://localhost:${VITE_PORT}/`;
const children = [];
const fail = (message) => { throw new Error(message); };
const REFUSED = "Captain Mean", APPROVED = "Turbo Pancake";

function run(cmd, args, env) {
  const child = spawn(cmd, args, { env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"], detached: true });
  let log = "";
  child.stdout.on("data", (d) => (log += d));
  child.stderr.on("data", (d) => (log += d));
  children.push({ child, log: () => log, what: `${cmd} ${args.join(" ")}` });
  return child;
}
async function up(url, what) {
  for (let i = 0; i < 150; i++) {
    try { if ((await fetch(url)).ok) return; } catch { /* not listening yet */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  fail(`${what} never came up at ${url}`);
}

let browser;
const errors = [];
try {
  run("npx", ["tsx", "server/index.ts"], { PORT: String(SERVER_PORT), SKETCHBATTLE_DATA: data, DEV_LOGIN: "1", FORGE_TOKEN: TOKEN });
  await up(`${server}/api/health`, "server");
  run("npx", ["vite", "--config", "client/vite.config.ts", "--port", String(VITE_PORT), "--strictPort"], { SKETCHBATTLE_SERVER: server });
  await up(base, "vite");

  browser = await chromium.launch();
  async function page(name) {
    const p = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
    p.on("pageerror", (e) => errors.push(`${name}: ${e.message}`));
    // a refused name is the server saying no, which the screen shows and logs
    p.on("console", (m) => { if (m.type() === "error" && !/asking for a name failed|status of 400/.test(m.text())) errors.push(`${name} console: ${m.text()}`); });
    return p;
  }
  const shot = async (p, name) => { if (shots) { fs.mkdirSync(shots, { recursive: true }); await p.waitForTimeout(300); await p.screenshot({ path: path.join(shots, `${name}.png`) }); } };
  const screen = (p) => p.evaluate(() => window.sketchbattle.screen.constructor.name);
  const on = (p, name, ms = 20000) => p.waitForFunction((n) => window.sketchbattle?.screen?.constructor.name === n, name, { timeout: ms }).catch(async () => fail(`waited for ${name}, on ${await screen(p)}`));
  const press = async (p, key, n = 1) => { for (let i = 0; i < n; i++) { await p.keyboard.press(key); await p.waitForTimeout(120); } };
  const tap = async (p, x, y) => {
    const v = p.viewportSize(), s = Math.min(v.width / 1920, v.height / 1080);
    await p.mouse.click((v.width - 1920 * s) / 2 + x * s, (v.height - 1080 * s) / 2 + y * s);
    await p.waitForTimeout(150);
  };
  const button = async (p, id) => {
    const b = await p.evaluate((id) => window.sketchbattle.screen.buttons().find((b) => b.id === id), id);
    if (!b) fail(`no ${id} button on ${await screen(p)}`);
    await tap(p, b.x + b.w / 2, b.y + b.h / 2);
  };
  /** A title menu row, once MAPS (every player on a DEV_LOGIN server) has joined the rows. */
  const choose = async (p, id) => {
    await p.waitForFunction(() => window.sketchbattle.screen.items.some((i) => i.id === "maps"), null, { timeout: 10000 });
    // menus select whatever the pointer hovers
    await p.mouse.move(2, 2);
    await p.evaluate((id) => { const s = window.sketchbattle.screen; s.sel = s.items.findIndex((i) => i.id === id); }, id);
    await press(p, "Enter");
  };
  const request = (p) => p.evaluate(() => window.sketchbattle.screen.standing?.request ?? null);
  const until = (p, fn, arg, what, ms = 20000) => p.waitForFunction(fn, arg, { timeout: ms }).catch(() => fail(`waited for ${what}`));
  async function ask(p, name) {
    await p.focus("#overlay input");
    await p.keyboard.press("Control+A");
    await p.keyboard.type(name, { delay: 20 });
    await button(p, "save");
  }

  const avery = await page("avery"), blake = await page("blake");
  await signIn(avery, base, "Avery");
  await signIn(blake, base, "Blake");

  console.log("1. a listed word is refused on the spot");
  await choose(avery, "settings");
  await on(avery, "SettingsScreen");
  await shot(avery, "0-settings");
  await button(avery, "name");
  await on(avery, "RenameScreen");
  await until(avery, () => !!window.sketchbattle.screen.standing, null, "the rename screen to load");
  await ask(avery, "sh1t lord");
  await until(avery, () => !!window.sketchbattle.screen.error, null, "the filter's refusal");
  const said = await avery.evaluate(() => window.sketchbattle.screen.error);
  if (!/isn't allowed/.test(said)) fail(`the filter said "${said}"`);
  await shot(avery, "1-filter-refused");
  console.log(`  "${said}"`);

  console.log("2. the judges are away: it waits");
  await ask(avery, REFUSED);
  await until(avery, () => window.sketchbattle.screen.standing?.request?.status === "waiting", null, "the name to wait");
  if (await avery.evaluate(() => window.sketchbattle.screen.standing.checkerUp)) fail("the checker looks up with no worker running");
  await shot(avery, "2-waiting-checker-away");
  await button(avery, "back");
  await on(avery, "SettingsScreen");
  await until(avery, () => window.sketchbattle.screen.nameRequest?.status === "waiting", null, "SETTINGS to show the waiting name");
  await shot(avery, "2b-settings-waiting");
  await button(avery, "name");
  await on(avery, "RenameScreen");
  const res = await fetch(`${server}/api/forge/names/next`, { headers: { "x-forge-token": TOKEN } });
  if (res.status !== 200) fail(`the waiting name isn't offered to the worker: HTTP ${res.status}`);
  const claimed = await res.json();
  // as if the worker's judges couldn't run: back to waiting
  if ((await fetch(`${server}/api/forge/names/${claimed.id}/release`, { method: "POST", headers: { "x-forge-token": TOKEN, "content-type": "application/json" }, body: JSON.stringify({ error: "namecheck: judges away" }) })).status !== 204) fail("release failed");

  console.log("3. the judges refuse it");
  run("node", ["scripts/fake-name-judge.mjs", server, TOKEN]);
  await until(avery, () => window.sketchbattle.screen.standing?.request?.status === "refused", null, "the refusal", 30000);
  const refused = await request(avery);
  console.log(`  ${JSON.stringify(refused)}`);
  await shot(avery, "3-refused");

  console.log("4. another one is approved, and a second player sees it in a lobby");
  await ask(avery, APPROVED);
  await until(avery, () => window.sketchbattle.screen.standing?.request?.status === "waiting", null, "the name to wait");
  await shot(avery, "4-checking");
  const t0 = Date.now();
  await until(avery, (n) => window.sketchbattle.screen.approved === n, APPROVED, "the approval", 30000);
  console.log(`  approved ${((Date.now() - t0) / 1000).toFixed(1)} s after it was asked for (the fake judge takes 1.5 s)`);
  await shot(avery, "5-approved");
  await button(avery, "back");
  await on(avery, "SettingsScreen");
  await avery.waitForTimeout(500);
  await shot(avery, "6-settings-after");
  await press(avery, "Escape");
  await on(avery, "TitleScreen");

  await choose(avery, "battle");
  await on(avery, "BattleMenuScreen");
  await press(avery, "ArrowDown");
  await press(avery, "Enter");
  // CREATE asks public or private; Enter takes the default
  await press(avery, "Enter");
  await until(avery, () => typeof window.sketchbattle.screen.roomCode === "string", null, "a room");
  const code = await avery.evaluate(() => window.sketchbattle.screen.roomCode);
  await choose(blake, "battle");
  await on(blake, "BattleMenuScreen");
  await press(blake, "ArrowDown", 2);
  await press(blake, "Enter");
  await blake.waitForTimeout(200);
  await blake.keyboard.type(code, { delay: 40 });
  await blake.keyboard.press("Enter");
  const members = (p) => p.evaluate(() => window.sketchbattle.screen.context.room?.members.map((m) => m.name) ?? []);
  await until(blake, () => window.sketchbattle.screen.context?.room?.members.length === 2, null, "both in the room");
  await until(blake, (n) => window.sketchbattle.screen.context.room.members.some((m) => m.name === n), APPROVED, `Blake to see ${APPROVED}`);
  const seen = await members(blake);
  console.log(`  Blake's lobby: ${seen.join(", ")}`);
  if (seen.includes(REFUSED)) fail("Blake sees the refused name");
  await shot(blake, "7-lobby-blake");

  console.log("5. a page claiming a name over the socket");
  await blake.evaluate((n) => window.sketchbattle.screen.context.transport.sendLobby({ t: "name", name: n }), REFUSED);
  await blake.evaluate(() => window.sketchbattle.screen.context.transport.sendLobby({ t: "name", session: "not-a-session" }));
  await avery.waitForTimeout(1000);
  const after = await members(avery);
  if (after.includes(REFUSED) || !after.includes("Blake")) fail(`after Blake claimed a name, Avery sees ${after.join(", ")}`);
  console.log(`  Avery still sees: ${after.join(", ")}`);
  await shot(avery, "8-lobby-avery");

  // the refused name is only in the moderator's own records
  const holding = [];
  const walk = (dir) => { for (const f of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, f.name); if (f.isDirectory()) walk(p); else if (fs.readFileSync(p, "utf8").includes(REFUSED)) holding.push(path.relative(data, p)); } };
  walk(data);
  const allowed = ["name-requests.json", "moderation.jsonl", "events.jsonl"];
  const leaks = holding.filter((f) => !allowed.includes(f));
  if (leaks.length) fail(`the refused name is in ${leaks.join(", ")}`);
  const leakedEvents = fs.readFileSync(path.join(data, "events.jsonl"), "utf8").split("\n").filter((l) => l.includes(REFUSED) && !l.includes("/me/name") && !l.includes("/forge/names"));
  if (leakedEvents.length) fail(`the refused name is in events outside the name requests: ${leakedEvents[0].slice(0, 300)}`);
  console.log(`  the refused name is only in ${holding.join(", ")}`);

  if (errors.length) fail(`page errors:\n${errors.join("\n")}`);
  console.log("namecheck: OK");
} catch (error) {
  console.error(error);
  for (const c of children) console.error(`--- ${c.what}\n${c.log().slice(-3000)}`);
  process.exitCode = 1;
} finally {
  await browser?.close();
  for (const { child } of children) { try { process.kill(-child.pid, "SIGTERM"); } catch (e) { if (e.code !== "ESRCH") throw e; } }
  fs.rmSync(data, { recursive: true, force: true });
}
