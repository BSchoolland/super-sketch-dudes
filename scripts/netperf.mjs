// Two browsers play an online match on the relay, one CPU-throttled (the potato), both holding keys and
// attacking. Prints each side's sim rate, time sync skips, stalls and rollbacks. Expects the dev servers,
// the server started with DEV_LOGIN=1. Usage: node scripts/netperf.mjs [base] [throttle=6] [seconds=20]
import { chromium } from "playwright";
const [base = "http://localhost:5175/sketch-battle/", throttle = "6", seconds = "20"] = process.argv.slice(2);
const browser = await chromium.launch();
const open = async (name) => {
  const p = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  p.on("pageerror", (e) => console.error(`${name}: ${e.message}`));
  await p.goto(`${base}?dev=${name}`);
  await p.waitForFunction(() => window.sketchbattle?.screen?.constructor.name === "TitleScreen", null, { timeout: 30000 });
  await p.keyboard.press("Enter"); await p.waitForTimeout(400);
  await p.keyboard.press("ArrowDown"); await p.waitForTimeout(200);
  await p.keyboard.press("Enter");
  await p.waitForFunction(() => "roomCode" in window.sketchbattle.screen);
  await p.waitForTimeout(500);
  return p;
};
const pick = (p, fighter) => p.evaluate((f) => window.sketchbattle.screen.context.transport.sendLobby({ t: "pick", fighter: f, bundleUrl: `${location.pathname}house/${f}/bundle.json`, ready: true }), fighter);
const [host, potato] = [await open("Host"), await open("Potato")];
await host.evaluate(() => window.sketchbattle.screen.create(false));
await host.waitForFunction(() => window.sketchbattle.screen.roomCode);
const code = await host.evaluate(() => window.sketchbattle.screen.roomCode);
await potato.evaluate((c) => window.sketchbattle.screen.join(c), code);
await potato.waitForFunction(() => window.sketchbattle.screen.roomCode);
await pick(host, "woodstove"); await pick(potato, "slugbert");
await host.waitForFunction(() => window.sketchbattle.screen.lobbyDebug()?.members.length === 2 && window.sketchbattle.screen.lobbyDebug().members.every((m) => m.ready));
await host.evaluate(() => window.sketchbattle.screen.startMatch({ stage: "rooftops", stocks: 99, time: 0 }));
await Promise.all([host, potato].map((p) => p.waitForFunction(() => !!window.sketchbattle.screen.session, null, { timeout: 30000 })));
const cdp = await potato.context().newCDPSession(potato);
await cdp.send("Emulation.setCPUThrottlingRate", { rate: +throttle });
await Promise.all([host, potato].map((p) => p.waitForFunction(() => window.sketchbattle.screen.session.state.frame > 120, null, { timeout: 60000 })));
const read = (p) => p.evaluate(() => { const s = window.sketchbattle.screen.session; return { frame: s.state.frame, t: performance.now(), stats: { ...s.stats }, lead: +s.frameLead().toFixed(2), canvas: document.getElementById("game").width }; });
for (const p of [host, potato]) await p.evaluate(() => {
  const scr = window.sketchbattle.screen, s = scr.session, adv = s.advance.bind(s);
  window.__c = { calls: 0, ok: 0, stalled: 0, skipped: 0, updates: 0, accMax: 0, dtSum: 0 };
  s.advance = (i) => { window.__c.calls++; const r = adv(i); if (r) window.__c.ok++; else if (s.waiting) window.__c.stalled++; else window.__c.skipped++; return r; };
  window.__c.slowSum = 0; window.__c.bigDt = 0;
  const up = scr.update.bind(scr); scr.update = (dt, m) => { window.__c.updates++; window.__c.dtSum += dt; if (s.state.slowmo > 0) window.__c.slowSum += dt * 0.75; if (dt >= 0.25) window.__c.bigDt++; const r = up(dt, m); window.__c.accMax = Math.max(window.__c.accMax, scr.acc); return r; };
});
const start = await Promise.all([host, potato].map(read));
if (process.env.PROFILE) { await cdp.send("Profiler.enable"); await cdp.send("Profiler.setSamplingInterval", { interval: 500 }); await cdp.send("Profiler.start"); }
await potato.evaluate(() => { window.__ft = []; let last = performance.now(); const loop = (t) => { window.__ft.push(t - last); last = t; requestAnimationFrame(loop); }; requestAnimationFrame(loop); });
const end = Date.now() + +seconds * 1000;
const keys = ["KeyA", "KeyD"];
while (Date.now() < end) {
  await Promise.all([host, potato].map(async (p, i) => { const k = keys[(i + Math.floor(Date.now() / 900)) % 2]; await p.keyboard.down(k); await p.waitForTimeout(250); await p.keyboard.up(k); await p.keyboard.press("KeyJ"); }));
}
const fin = await Promise.all([host, potato].map(read));
const counts = await Promise.all([host, potato].map((p) => p.evaluate(() => window.__c)));
if (process.env.DBG) for (const c of counts) console.log(JSON.stringify(c));
const ft = (await potato.evaluate(() => window.__ft)).sort((a, b) => a - b);
console.log(`potato rAF ms p50 ${ft[ft.length >> 1].toFixed(0)} p90 ${ft[Math.floor(ft.length * 0.9)].toFixed(0)} p99 ${ft[Math.floor(ft.length * 0.99)].toFixed(0)} max ${ft[ft.length - 1].toFixed(0)} · >250ms: ${ft.filter((x) => x > 250).length}`);
if (process.env.PROFILE) {
  const { profile } = await cdp.send("Profiler.stop");
  const self = new Map(), byId = new Map(profile.nodes.map((n) => [n.id, n])); let total = 0;
  profile.samples.forEach((id, i) => { const n = byId.get(id); const k = `${n.callFrame.functionName || "(anon)"} ${n.callFrame.url.split("/").pop().split("?")[0]}:${n.callFrame.lineNumber + 1}`; self.set(k, (self.get(k) ?? 0) + (profile.timeDeltas[i] ?? 0)); total += profile.timeDeltas[i] ?? 0; });
  for (const [k, v] of [...self].sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log(`${(100 * v / total).toFixed(1).padStart(5)}%  ${k}`);
}
["host", "potato"].forEach((name, i) => {
  const a = start[i], b = fin[i], d = (k) => b.stats[k] - a.stats[k];
  const secs = (b.t - a.t) / 1000;
  const c = counts[i], owed = (c.dtSum - c.slowSum) * 60;
  console.log(`${name.padEnd(6)} sim ${((b.frame - a.frame) / secs).toFixed(1)}/s, ${(60 * c.ok / owed).toFixed(1)}/s of real time outside KO slow-mo · timeSyncSkips ${d("timeSyncSkips")} · stalls ${d("stalls")} · rollbacks ${d("rollbacks")} (max depth ${b.stats.maxDepth}) · lead ${b.lead} · canvas ${b.canvas}px wide`);
});
await browser.close();
