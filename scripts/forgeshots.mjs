// The forge screen's progress as a player sees it, in a real browser: a local server and Vite, this script as the
// worker (it claims the job and posts each stage itself). Screenshots every step, and checks that leaving the
// screen and coming back shows the bar and the ETA where they were.
// Usage: node scripts/forgeshots.mjs [outdir=/tmp/ssd-forge-shots]
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { FORGE_STEPS } from "../shared/forge-steps.ts";

const SERVER_PORT = 3160, VITE_PORT = 5360, TOKEN = "forgeshots";
const out = process.argv[2] ?? "/tmp/ssd-forge-shots";
fs.mkdirSync(out, { recursive: true });
const data = fs.mkdtempSync(path.join(os.tmpdir(), "forgeshots-"));
const base = `http://localhost:${VITE_PORT}/`, server = `http://localhost:${SERVER_PORT}`;
const children = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fail = (m) => { throw new Error(m); };
const run = (cmd, args, env) => {
  const child = spawn(cmd, args, { env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"], detached: true });
  let log = ""; child.stdout.on("data", (d) => (log += d)); child.stderr.on("data", (d) => (log += d));
  children.push({ child, log: () => log });
};
async function up(url, what) {
  for (let i = 0; i < 300; i++) { try { if ((await fetch(url)).ok) return; } catch { /* not listening yet */ } await sleep(200); }
  fail(`${what} never came up at ${url}`);
}
const forge = (p, body) => fetch(`${server}/api/forge/${p}`, { method: body ? "POST" : "GET", headers: { "x-forge-token": TOKEN, "content-type": "application/json" }, body: body && JSON.stringify(body) });

let browser;
try {
  run("npx", ["tsx", "server/index.ts"], { PORT: String(SERVER_PORT), SKETCHBATTLE_DATA: data, DEV_LOGIN: "1", FORGE_TOKEN: TOKEN });
  await up(`${server}/api/health`, "server");
  run("npx", ["vite", "--config", "client/vite.config.ts", "--port", String(VITE_PORT), "--strictPort"], { SKETCHBATTLE_SERVER: server });
  await up(base, "vite");
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.stack ?? String(e)));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  const k = 1600 / 1920;
  const click = async (x, y) => { await page.mouse.click(x * k, y * k); await page.waitForTimeout(250); };
  const until = (name) => page.waitForFunction((n) => window.sketchbattle?.screen?.constructor.name === n, name, { timeout: 20000 });
  const shot = async (name, ms = 800) => { await page.waitForTimeout(ms); await page.screenshot({ path: path.join(out, `${name}.png`) }); console.log(`shot ${name}`); };
  const bar = () => page.evaluate(() => window.sketchbattle.screen.shown);

  await page.goto(`${base}?dev=Ann`);
  await page.waitForFunction(() => Array.isArray(window.sketchbattle?.screen?.items), null, { timeout: 30000 });
  await page.mouse.move(2, 2);
  await page.evaluate(() => { const s = window.sketchbattle.screen; s.sel = s.items.findIndex((it) => it.id === "create"); });
  await page.keyboard.press("Enter");
  await until("CreateScreen");
  await page.waitForTimeout(500);
  await page.mouse.move(700 * k, 300 * k); await page.mouse.down();
  for (const [x, y] of [[900, 500], [700, 700], [1100, 600], [800, 350]]) await page.mouse.move(x * k, y * k, { steps: 8 });
  await page.mouse.up();
  await click(1660, 765);
  await until("DescribeScreen");
  await click(1160, 855);
  await until("LibraryScreen");
  await page.waitForTimeout(800);
  await click(210, 315);
  await until("ForgeScreen");
  await shot("00-waiting-in-line");

  const job = await (await forge("jobs/next")).json();
  for (const [i, step] of FORGE_STEPS.entries()) {
    if (step.s === 0 || step.stage === "reading the drawing") continue;
    const r = await forge(`jobs/${job.id}/progress`, { stage: step.stage });
    if (!r.ok) fail(`progress ${step.stage}: HTTP ${r.status}`);
    await shot(`${String(i).padStart(2, "0")}-${step.stage.replace(/\W+/g, "-")}`, 3500);
    if (step.stage === "designing the moves") {
      // leave and come back: the bar and the ETA pick up where they were, not from the start of the step
      const before = await bar();
      await page.keyboard.press("Escape");
      await until("LibraryScreen");
      await page.waitForTimeout(3000);
      await click(210, 315);
      await until("ForgeScreen");
      await page.waitForTimeout(300);
      const after = await bar();
      console.log(`bar ${before.toFixed(4)} before leaving, ${after.toFixed(4)} on coming back`);
      if (!(after >= before)) fail(`coming back put the bar back from ${before} to ${after}`);
      await shot("revisit");
    }
  }
  if (errors.length) fail(`page errors:\n${errors.join("\n")}`);
  console.log(`forgeshots: ok, shots in ${out}`);
} catch (e) {
  for (const { log } of children) console.error(log().slice(-3000));
  throw e;
} finally {
  await browser?.close();
  await Promise.all(children.map(({ child }) => {
    if (child.exitCode !== null) return;
    const gone = new Promise((r) => child.once("exit", r));
    process.kill(-child.pid, "SIGTERM");
    return gone;
  }));
  fs.rmSync(data, { recursive: true, force: true });
}
