// Two browsers play an online match on bundle A; bundle B is pushed and the room switched
// mid-match; both must carry on, on B, in sync. Records Ann's browser.
// Usage: node scripts/hotswap.mjs [base=http://localhost:5177/sketch-battle/] [site=http://localhost:3010] [out=/tmp/tf/hotswap]
import { chromium } from "playwright";
import { execSync } from "node:child_process";
import { mkdirSync, readdirSync, renameSync } from "node:fs";
const base = process.argv[2] ?? "http://localhost:5177/sketch-battle/";
const site = process.argv[3] ?? "http://localhost:3010";
const out = process.argv[4] ?? "/tmp/tf/hotswap";
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const errors = [];
async function player(name, record) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, ...(record ? { recordVideo: { dir: out, size: { width: 1280, height: 720 } } } : {}) });
  await context.addInitScript((n) => localStorage.setItem("sketchbattle.settings", JSON.stringify({ name: n })), name);
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(`${name}: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error") errors.push(`${name}: ${m.text()}`); });
  page.on("response", (r) => { if (r.status() >= 400) errors.push(`${name}: HTTP ${r.status()} ${r.url()}`); });
  await page.goto(`${base}shell.html`);
  await page.waitForFunction(() => window.sketchbattle?.screen, null, { timeout: 15000 });
  return page;
}
const info = (page) => page.evaluate(() => {
  const s = window.sketchbattle.screen;
  const session = s?.session;
  return { hash: window.sketchbattle.hash, build: window.sketchbattle.build, screen: s?.constructor?.name, frame: session?.state?.frame ?? null, confirmed: session?.confirmedThrough ?? null, desync: session?.desync ?? null, waiting: session?.waiting ?? null, code: s?.roomCode ?? null };
});
const until = async (page, what, pred, ms = 15000) => { const t0 = Date.now(); for (;;) { const i = await info(page); if (pred(i)) return i; if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}: ${JSON.stringify(i)}`); await page.waitForTimeout(100); } };
const key = async (page, k, n = 1) => { for (let i = 0; i < n; i++) { await page.keyboard.press(k); await page.waitForTimeout(150); } };

const a = await player("Ann", true);
const b = await player("Bob", false);
const A0 = (await info(a)).hash;
console.log("both on bundle", A0);
// Ann: ONLINE -> CREATE ROOM
await key(a, "ArrowDown"); await key(a, "Enter"); await key(a, "ArrowDown"); await key(a, "Enter");
const { code } = await until(a, "a room", (i) => !!i.code);
console.log("room", code);
// Bob: ONLINE -> JOIN, type the code
await key(b, "ArrowDown"); await key(b, "Enter"); await key(b, "ArrowDown", 2); await key(b, "Enter");
for (const ch of code) await b.keyboard.press(`Key${ch.toUpperCase()}`).catch(() => b.keyboard.press(`Digit${ch}`));
await b.waitForTimeout(150); await key(b, "Enter");
await until(b, "bob in the room", (i) => i.code === code);
// ready up, host starts
await key(b, "Enter"); await a.waitForTimeout(300); await key(a, "Enter"); await a.waitForTimeout(400); await key(a, "Enter");
await until(a, "the match", (i) => i.frame > 30, 20000);
await until(b, "bob's match", (i) => i.frame > 30);
// play a bit
await a.keyboard.down("KeyD"); await a.waitForTimeout(600); await a.keyboard.up("KeyD"); await a.keyboard.press("KeyJ");
await b.keyboard.down("KeyA"); await b.waitForTimeout(400); await b.keyboard.up("KeyA"); await b.keyboard.press("KeyJ");
await a.waitForTimeout(1500);
const before = [await info(a), await info(b)];
console.log("before swap", JSON.stringify(before));
// push bundle B (bluer paper) and switch the room
const hashB = execSync(`VITE_PAPER=#e2ecf5 SITE=${site} FORGE_TOKEN=devtoken scripts/push-game.sh --room ${code}`, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }).trim().split("\n").pop();
console.log("pushed", JSON.stringify(hashB));
// keep playing through the swap
const hold = async (page, k, ms) => { await page.keyboard.down(k); await page.waitForTimeout(ms); await page.keyboard.up(k); };
await Promise.all([hold(a, "KeyA", 2500), hold(b, "KeyD", 2500)]);
try { await until(a, "ann on B", (i) => i.hash === hashB, 15000); } catch (e) { console.log(String(e)); console.log("errors so far:\n" + errors.join("\n")); await a.screenshot({ path: `${out}/stuck.png` }); process.exit(1); }
console.log("a right after:", JSON.stringify(await info(a))); await a.waitForTimeout(1000); console.log("a 1s later:", JSON.stringify(await info(a)));
await until(b, "bob on B", (i) => i.hash === hashB, 15000);
const atSwap = [await info(a), await info(b)];
console.log("after swap", JSON.stringify(atSwap));
await Promise.all([hold(a, "KeyD", 1500), hold(b, "KeyA", 1500)]);
await a.keyboard.press("KeyJ"); await b.keyboard.press("KeyJ");
await a.waitForTimeout(3000);
const after = [await info(a), await info(b)];
console.log("later", JSON.stringify(after));
// same confirmed state on both sides
const f = Math.min(after[0].confirmed, after[1].confirmed) - 2;
const [ha, hb] = await Promise.all([a, b].map((p) => p.evaluate((fr) => window.sketchbattle.screen.session.stateHashAt(fr), f)));
console.log("hash at", f, ha, hb, ha === hb ? "EQUAL" : "DIFFERENT");
const ok = after.every((i) => i.hash === hashB && !i.desync && i.frame > atSwap[0].frame) && ha === hb && ha !== null;
await a.screenshot({ path: `${out}/after.png` });
await a.context().close(); await b.context().close(); await browser.close();
const webm = readdirSync(out).find((fn) => fn.endsWith(".webm")); if (webm) renameSync(`${out}/${webm}`, `${out}/hotswap.webm`);
if (errors.length) console.log("page errors:\n" + errors.join("\n"));
console.log(ok ? "HOT SWAP OK" : "HOT SWAP FAILED");
process.exit(ok ? 0 : 1);
