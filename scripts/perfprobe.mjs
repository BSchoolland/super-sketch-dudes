// Frame-time and CPU profile of a 4-CPU local match in a throttled Chrome (a stand-in for a slow laptop).
// Expects the dev servers. Usage: node scripts/perfprobe.mjs [base] [throttle=6] [seconds=10] [w=1366] [h=768] [dpr=1]
import { chromium } from "playwright";
import fs from "node:fs";
const [base = "http://localhost:5175/sketch-battle/", throttle = "6", seconds = "10", w = "1366", h = "768", dpr = "1"] = process.argv.slice(2);
const browser = await chromium.launch({ args: ["--disable-gpu-vsync", "--disable-frame-rate-limit"].slice(0, 0) });
const ctx = await browser.newContext({ viewport: { width: +w, height: +h }, deviceScaleFactor: +dpr });
const page = await ctx.newPage();
page.on("pageerror", (e) => console.error("pageerror", e.message));
await page.goto(`${base}?quick=1&p1=cpu&cpu=9&f=woodstove,slugbert,rocket,wizard&stage=rooftops&stocks=99`);
await page.waitForFunction(() => window.sketchbattle?.screen?.match);
await page.waitForTimeout(1500);
const cdp = await ctx.newCDPSession(page);
await cdp.send("Emulation.setCPUThrottlingRate", { rate: +throttle });
await cdp.send("Profiler.enable");
await cdp.send("Profiler.setSamplingInterval", { interval: 200 });
await page.evaluate(() => {
  window.__ft = []; let last = performance.now();
  const loop = (t) => { window.__ft.push(t - last); last = t; if (window.__ft.length < 100000) requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
  window.__f0 = window.sketchbattle.screen.match.state.frame;
});
await cdp.send("Profiler.start");
await page.waitForTimeout(+seconds * 1000);
const { profile } = await cdp.send("Profiler.stop");
const r = await page.evaluate(() => ({ ft: window.__ft, frames: window.sketchbattle.screen.match.state.frame - window.__f0, canvas: `${document.getElementById("game").width}x${document.getElementById("game").height}` }));
const ft = r.ft.slice(2).sort((a, b) => a - b);
const pct = (p) => ft[Math.min(ft.length - 1, Math.floor(ft.length * p))].toFixed(1);
console.log(`throttle ${throttle}x ${w}x${h}@${dpr}: ${ft.length} rAFs in ${seconds}s (${(ft.length / +seconds).toFixed(1)} fps), sim frames ${r.frames} (${(r.frames / +seconds).toFixed(1)}/s of 60), canvas ${r.canvas} · frame ms p50 ${pct(0.5)} p90 ${pct(0.9)} p99 ${pct(0.99)} max ${ft[ft.length - 1].toFixed(1)}`);
// self time by function
const self = new Map(); const byId = new Map(profile.nodes.map((n) => [n.id, n]));
const dt = profile.timeDeltas; let total = 0;
profile.samples.forEach((id, i) => { const n = byId.get(id); const k = `${n.callFrame.functionName || "(anon)"} ${n.callFrame.url.split("/").pop()}:${n.callFrame.lineNumber + 1}`; self.set(k, (self.get(k) ?? 0) + (dt[i] ?? 0)); total += dt[i] ?? 0; });
const top = [...self].sort((a, b) => b[1] - a[1]).slice(0, 30);
for (const [k, v] of top) console.log(`${(100 * v / total).toFixed(1).padStart(5)}%  ${k}`);
fs.writeFileSync("/tmp/perfprobe.cpuprofile", JSON.stringify(profile));
await browser.close();
