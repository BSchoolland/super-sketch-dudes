// Two real (headed) browsers play on the relay; then the guest's tab is hidden behind another tab for six
// seconds. The hidden player must keep ticking (its sim frame keeps advancing, inputs keep flowing) and the
// host must not stall on it. Needs a real desktop display with a window manager: under bare Xvfb no tab is
// ever hidden and the check reports SKIP. Usage: node scripts/hidden-tab-check.mjs [base], with a DEV_LOGIN
// server behind Vite (see wide-events-check.mjs).
import { chromium } from "playwright";
import { openOnline } from "./menu-nav.mjs";

const base = process.argv[2] ?? "http://localhost:5199/sketch-battle/";
const press = async (p, key, n = 1) => { for (let i = 0; i < n; i++) { await p.keyboard.press(key); await p.waitForTimeout(110); } };
const browser = await chromium.launch({ headless: false });
try {
  const hostContext = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const guestContext = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const host = await hostContext.newPage(), guest = await guestContext.newPage();
  await openOnline(host, base, "Ann");
  await press(host, "ArrowDown"); await press(host, "Enter"); await press(host, "Enter");
  await host.waitForFunction(() => typeof window.sketchbattle.screen.roomCode === "string");
  const code = await host.evaluate(() => window.sketchbattle.screen.roomCode);
  await openOnline(guest, base, "Bob");
  await press(guest, "ArrowDown", 2); await press(guest, "Enter");
  await guest.keyboard.type(code, { delay: 40 }); await press(guest, "Enter");
  const pages = [host, guest];
  await Promise.all(pages.map((p) => p.waitForFunction(() => window.sketchbattle.screen.lobbyDebug?.()?.members.length === 2)));
  for (const [i, p] of pages.entries()) await p.evaluate((id) => {
    window.sketchbattle.screen.pick({ id, name: id.toUpperCase(), bundleUrl: `/sketch-battle/house/${id}/bundle.json?v=${window.sketchbattle.build}`, house: true, entry: null });
  }, ["rocket", "wizard"][i]);
  await Promise.all(pages.map((p) => p.waitForFunction(() => window.sketchbattle.screen.lobbyDebug().members.every((m) => m.fighter))));
  for (const p of pages) await p.evaluate(() => window.sketchbattle.screen.toggleReady());
  await host.waitForFunction(() => window.sketchbattle.screen.canStart());
  await host.evaluate(() => window.sketchbattle.screen.startMatch({ stage: "rooftops", stocks: 3, time: 0, map: null }));
  await Promise.all(pages.map((p) => p.waitForFunction(() => typeof window.sketchbattle.screen.netDebug === "function", null, { timeout: 20000 })));
  await host.waitForTimeout(4000);

  const snap = (p) => p.evaluate(() => { const s = window.sketchbattle.screen.session; return { frame: s.state.frame, waiting: s.waiting, stalls: s.stats.stalls, visibility: document.visibilityState }; });
  // a tab the game page opens in its own window takes the front: the game tab is hidden and its rAF stops
  // (a page from newPage() would be another window, and nothing is hidden under Xvfb)
  const [cover] = await Promise.all([guestContext.waitForEvent("page"), guest.evaluate(() => { window.open("about:blank", "_blank"); })]);
  await cover.bringToFront();
  await host.waitForTimeout(500);
  const [h0, g0] = await Promise.all(pages.map(snap));
  await host.waitForTimeout(6000);
  const [h1, g1] = await Promise.all(pages.map(snap));
  await cover.close();
  await guest.bringToFront();
  await host.waitForTimeout(1000);
  const [h2, g2] = await Promise.all(pages.map(snap));
  const guestAdvanced = g1.frame - g0.frame, hostAdvanced = h1.frame - h0.frame, hostStalls = h1.stalls - h0.stalls;
  console.log(`guest tab was ${g0.visibility}; in 6 s hidden: guest sim +${guestAdvanced} frames, host +${hostAdvanced} frames, host stalls +${hostStalls}, host waiting at end: ${h1.waiting}`);
  console.log(`after unhiding: guest +${g2.frame - g1.frame}, host +${h2.frame - h1.frame} in 1 s; guest visibility ${g2.visibility}`);
  const ok = guestAdvanced >= 300 && hostAdvanced >= 300 && hostStalls < 30 && !h1.waiting;
  // a bare X server (Xvfb, no window manager) never hides a tab: the rAF stop can't be reproduced there
  if (g0.visibility !== "hidden") console.log("SKIP hidden-tab-check: the tab never became hidden on this display; run it on a desktop session");
  else console.log(ok ? "PASS hidden-tab-check" : "FAIL hidden-tab-check");
  process.exitCode = g0.visibility !== "hidden" ? 2 : ok ? 0 : 1;
} catch (e) { console.error("FAIL hidden-tab-check", e); process.exitCode = 1; } finally { await browser.close(); }
