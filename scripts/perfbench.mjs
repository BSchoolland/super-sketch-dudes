// Frame-time bench: a CPU-vs-CPU match in headless Chromium at a chosen CPU throttle and pixel ratio, sampling
// requestAnimationFrame gaps and counting draws and sim frames. Run it before and after a renderer change.
// Needs Vite in front of a server (see wide-events-check.mjs); the quick-match URL needs no sign-in.
// Usage: node scripts/perfbench.mjs [--base http://localhost:5199/sketch-battle/] [--throttle 4] [--seconds 12] [--dpr 1.25] [--stage rooftops] [--fighters rocket,wizard]
import { chromium } from "playwright";

const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : dflt; };
const base = opt("base", "http://localhost:5199/sketch-battle/");
const throttle = Number(opt("throttle", 4)), seconds = Number(opt("seconds", 12)), dpr = Number(opt("dpr", 1.25));
const stage = opt("stage", "rooftops"), fighters = opt("fighters", "rocket,wizard"), players = opt("players", "cpu"), chrome = opt("chrome", "on") !== "off";

const browser = await chromium.launch();
try {
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: dpr });
  const page = await context.newPage();
  page.on("pageerror", (e) => console.error("page error:", e.message));
  const cdp = await context.newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: throttle });
  await page.goto(`${base}?quick=1&p1=${players === "cpu" ? "cpu" : "kb1"}&p2=${players === "cpu" ? "cpu" : "kb2"}&cpu=9&f=${fighters}&stage=${stage}&stocks=99&seed=7`);
  await page.waitForFunction(() => !!window.sketchbattle?.screen?.renderer, null, { timeout: 30000 });
  await page.waitForTimeout(1500);
  const result = await page.evaluate(async ([seconds, chrome]) => {
    const screen = window.sketchbattle.screen;
    const renderer = screen.renderer;
    renderer.chrome = chrome;
    const draw = renderer.draw.bind(renderer);
    let draws = 0, drawMs = 0, updates = 0, updateMs = 0;
    renderer.draw = (...a) => { const t = performance.now(); draw(...a); drawMs += performance.now() - t; draws++; };
    const update = screen.update.bind(screen);
    screen.update = (...a) => { const t = performance.now(); const r = update(...a); updateMs += performance.now() - t; updates++; return r; };
    const gaps = [];
    const frame0 = screen.match.state.frame;
    const t0 = performance.now();
    await new Promise((done) => {
      let last = t0;
      const tick = (now) => { gaps.push(now - last); last = now; if (now - t0 < seconds * 1000) requestAnimationFrame(tick); else done(); };
      requestAnimationFrame(tick);
    });
    const elapsed = (performance.now() - t0) / 1000;
    gaps.sort((a, b) => a - b);
    const q = (p) => gaps[Math.min(gaps.length - 1, Math.floor(gaps.length * p))];
    return {
      elapsed: +elapsed.toFixed(1), rafPerSec: +(gaps.length / elapsed).toFixed(1), drawsPerSec: +(draws / elapsed).toFixed(1),
      simFps: +((screen.match.state.frame - frame0) / elapsed).toFixed(1), drawJsMs: +(drawMs / draws).toFixed(2), updateJsMs: +(updateMs / updates).toFixed(2),
      gapP50: +q(0.5).toFixed(1), gapP95: +q(0.95).toFixed(1), gapMax: +gaps[gaps.length - 1].toFixed(1),
      over20ms: +((gaps.filter((g) => g > 20).length / gaps.length) * 100).toFixed(1),
      canvas: { w: renderer && document.querySelector("canvas").width, h: document.querySelector("canvas").height },
      particles: renderer.fx.particles.length,
    };
  }, [seconds, chrome]);
  console.log(JSON.stringify({ throttle, dpr, stage, fighters, ...result }));
} finally {
  await browser.close();
}
