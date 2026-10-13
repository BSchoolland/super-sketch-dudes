// A deploy outside a match: a VS BOTS game and a two-person lobby, each through a server restart (SIGINT, a fresh
// process on the same data dir), in real pages. Matches through a restart: netlab/run.mjs --at "<sec>:restart".
// Usage: npm run build && node scripts/handoffcheck.mjs [--headed]
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import { openOnline } from "./menu-nav.mjs";

const PORT = 3091;
const url = `http://localhost:${PORT}/sketch-battle/`;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "sb-handoffcheck-"));
const log = (...a) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a);
let server = null;

async function boot() {
  server = spawn("node", ["dist/server.mjs"], { env: { ...process.env, PORT: String(PORT), SKETCHBATTLE_DATA: dataDir, DEV_LOGIN: "1", SKETCHBATTLE_BASE: "/sketch-battle/" }, stdio: "ignore" });
  for (let i = 0; i < 100; i++) {
    if (await fetch(`${url}api/health`).then((r) => r.ok, () => false)) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("the server didn't come up");
}
async function restart() {
  const t0 = Date.now();
  await new Promise((resolve) => { server.once("exit", resolve); server.kill("SIGINT"); });
  await boot();
  log(`server restarted in ${Date.now() - t0} ms`);
}
const screenOf = (page) => page.evaluate(() => { const s = window.sketchbattle.screen; return { screen: s.constructor.name, phase: s.phase ?? null, error: s.error ?? null, room: s.context?.room ? { code: s.context.room.code, started: s.context.room.started, members: s.context.room.members.map((m) => [m.name, m.fighter, m.ready]) } : null }; });
const waitScreen = (page, pred, what, ms = 20000) => page.waitForFunction(pred, null, { timeout: ms }).catch(async (e) => { throw new Error(`${what}: ${JSON.stringify(await screenOf(page))} (${e.message.split("\n")[0]})`); });
function check(ok, what) { if (!ok) throw new Error(`FAILED: ${what}`); log(`ok: ${what}`); }

const browser = await chromium.launch({ headless: !process.argv.includes("--headed") });
try {
  await boot();
  const bots = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  await openOnline(bots, url, "Ann");
  await bots.evaluate(() => { window.sketchbattle.screen.sel = 3; });
  await bots.keyboard.press("Enter");
  await waitScreen(bots, () => window.sketchbattle.screen.context?.room?.bots?.length === 1, "VS BOTS room with its bot");
  // a fresh data dir has no characters: play a house fighter
  await bots.evaluate(() => { const s = window.sketchbattle.screen; s.mine = { id: "slugbert", name: "SLUGBERT", bundleUrl: "/house/slugbert/bundle.json", house: true, entry: null }; });
  await bots.evaluate(() => window.sketchbattle.screen.startMatch({ stage: "proving", stocks: 3, time: 0, map: null }));
  await waitScreen(bots, () => window.sketchbattle.screen.constructor.name === "VersusScreen" && window.sketchbattle.screen.countdown <= 0, "the local match running");
  log("VS BOTS match running; restarting the server under it");
  await restart();
  await bots.waitForTimeout(3000);
  check((await screenOf(bots)).screen === "VersusScreen", "the local match plays on through the restart");
  await bots.evaluate(() => { const s = window.sketchbattle.screen; s.match.paused = true; s.pauseSel = 1; });
  await bots.keyboard.press("Enter");
  await waitScreen(bots, () => window.sketchbattle.screen.phase === "lobby" && window.sketchbattle.screen.context.room?.started === false, "back in the VS BOTS room after quitting");
  check(!(await screenOf(bots)).error, "the room is still there, not CONNECTION LOST");

  const [a, b] = await Promise.all([0, 1].map(async () => (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage()));
  await openOnline(a, url, "Bea");
  await a.evaluate(() => { window.sketchbattle.screen.sel = 1; });
  await a.keyboard.press("Enter");
  await waitScreen(a, () => window.sketchbattle.screen.phase === "create", "the create prompt");
  await a.evaluate(() => window.sketchbattle.screen.create(true));
  await waitScreen(a, () => window.sketchbattle.screen.roomCode, "a room code");
  const code = await a.evaluate(() => window.sketchbattle.screen.roomCode);
  await openOnline(b, url, "Cal");
  await b.evaluate(() => { window.sketchbattle.screen.sel = 2; });
  await b.keyboard.press("Enter");
  await waitScreen(b, () => window.sketchbattle.screen.phase === "join", "the join prompt");
  await b.evaluate((c) => window.sketchbattle.screen.join(c), code);
  await waitScreen(a, () => window.sketchbattle.screen.context.room?.members.length === 2, "both in the lobby");
  log(`lobby ${code} with two people; restarting the server under it`);
  await restart();
  await a.waitForTimeout(3000);
  for (const [name, page] of [["Bea", a], ["Cal", b]]) {
    const s = await screenOf(page);
    check(s.phase === "lobby" && !s.error && s.room?.code === code, `${name} is still in lobby ${code} (${s.screen}/${s.phase})`);
  }
  await b.evaluate(() => window.sketchbattle.screen.context.transport.sendLobby({ t: "pick", fighter: "slugbert", bundleUrl: "/house/slugbert/bundle.json", ready: true }));
  await waitScreen(a, () => window.sketchbattle.screen.context.room?.members[1]?.ready === true, "Bea seeing Cal ready up after the restart");
  check(true, "the lobby works after the restart");
} finally {
  await browser.close();
  server?.kill("SIGKILL");
  fs.rmSync(dataDir, { recursive: true, force: true });
}
