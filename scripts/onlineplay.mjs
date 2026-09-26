// Two real browsers play online with one of them CPU-throttled 6x: both fighters must move and frames must keep
// flowing without long WAITING stalls. Expects the dev servers. Usage: node scripts/onlineplay.mjs [base]
import { chromium } from "playwright";
import { openOnline as signInOnline } from "./menu-nav.mjs";
const base = process.argv[2] ?? "http://localhost:5175/sketch-battle/";
const browser = await chromium.launch();
const page = async () => (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
const pages = [await page(), await page()];
const errors = [];
for (const [i, p] of pages.entries()) p.on("pageerror", (e) => errors.push(`page${i}: ${e}`));
const press = async (p, k) => { await p.keyboard.press(k); await p.waitForTimeout(90); };
let players = 0;
const openOnline = (p) => signInOnline(p, base, `Player${++players}`);
try {
  const [host, guest] = pages;
  await openOnline(host); await press(host, "ArrowDown"); await press(host, "Enter");
  await host.waitForFunction(() => window.sketchbattle.screen.roomCode !== null);
  const code = await host.evaluate(() => window.sketchbattle.screen.roomCode);
  await openOnline(guest); await press(guest, "ArrowDown"); await press(guest, "ArrowDown"); await press(guest, "Enter");
  await guest.keyboard.type(code, { delay: 40 }); await press(guest, "Enter");
  await Promise.all(pages.map((p) => p.waitForFunction(() => window.sketchbattle.screen.lobbyDebug?.()?.members.length === 2)));
  // ready both, then the host starts
  for (const p of pages) { await p.waitForTimeout(200); await p.keyboard.press("KeyJ"); }
  await Promise.all(pages.map((p) => p.waitForFunction(() => window.sketchbattle.screen.lobbyDebug?.()?.members.every((m) => m.ready))));
  await host.waitForTimeout(300);
  await host.evaluate(() => window.sketchbattle.screen.startMatch?.());
  await Promise.all(pages.map((p) => p.waitForFunction(() => typeof window.sketchbattle.screen.netDebug === "function")));
  // throttle the guest hard so its frame rate drops
  const cdp = await guest.context().newCDPSession(guest);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 6 });
  await host.waitForTimeout(4000); // countdown
  const start = await Promise.all(pages.map((p) => p.evaluate(() => { const s = window.sketchbattle.screen.session.state; return { frame: s.frame, x: s.fighters.map((f) => f.x) }; })));
  // both players hold right, then left, with jumps and attacks
  for (let round = 0; round < 6; round++) {
    const key = round % 2 ? "KeyA" : "KeyD";
    await Promise.all(pages.map(async (p) => { await p.keyboard.down(key); await p.waitForTimeout(700); await p.keyboard.up(key); await p.keyboard.press("KeyW"); await p.keyboard.press("KeyJ"); }));
  }
  await host.waitForTimeout(1500);
  const end = await Promise.all(pages.map((p) => p.evaluate(() => { const scr = window.sketchbattle.screen; const s = scr.session.state; return { frame: s.frame, x: s.fighters.map((f) => f.x), waiting: scr.session.waiting, lead: scr.session.frameLead() }; })));
  const moved = end.map((e, i) => Math.abs(e.x[i] - start[i].x[i]));
  const framesRun = end.map((e, i) => e.frame - start[i].frame);
  console.log(JSON.stringify({ start, end, moved, framesRun }));
  const ok = moved.every((m) => m > 40) && framesRun.every((f) => f > 200) && Math.abs(end[0].frame - end[1].frame) < 60 && !end.some((e) => e.waiting);
  console.log(ok ? "PASS onlineplay" : "FAIL onlineplay");
  if (errors.length) console.error(errors.join("\n"));
  process.exitCode = ok ? 0 : 1;
} catch (e) { console.error("FAIL onlineplay", e); process.exitCode = 1; } finally { await browser.close(); }
