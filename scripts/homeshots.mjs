// The landing page's pictures: screenshots, the drawing → fighter → KO clip, the share image. Writes client/public/home/.
// Starts its own server (DEV_LOGIN, a scratch data dir), Vite and scripts/fake-forge.mjs, whose fighter is the
// sword-guy exemplar, so the clip draws a stick figure with a sword.
//   node scripts/homeshots.mjs   (SERVER_PORT, VITE_PORT override 3651 / 5851; needs ffmpeg and cwebp)
import { chromium } from "playwright";
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const SERVER_PORT = Number(process.env.SERVER_PORT ?? 3651), VITE_PORT = Number(process.env.VITE_PORT ?? 5851), TOKEN = "devtoken";
const base = `http://localhost:${VITE_PORT}/sketch-battle/`;
const out = path.resolve("client/public/home");
const work = fs.mkdtempSync(path.join(os.tmpdir(), "homeshots-"));
const data = path.join(work, "data");
const children = [];

function run(cmd, args, env) {
  const child = spawn(cmd, args, { env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"], detached: true });
  let log = "";
  child.stdout.on("data", (d) => (log += d));
  child.stderr.on("data", (d) => (log += d));
  child.on("exit", (code) => { if (code && !child.killed) console.error(`${cmd} ${args.join(" ")} exited ${code}:\n${log}`); });
  children.push(child);
}
async function up(url, what) {
  for (let i = 0; i < 120; i++) {
    const ok = await fetch(url).then((r) => r.ok, () => false);
    if (ok) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`${what} never came up at ${url}`);
}
const webp = (png, name, width) => execFileSync("cwebp", ["-quiet", "-q", "78", "-resize", String(width), "0", png, "-o", path.join(out, name)]);

let browser;
try {
  fs.mkdirSync(data);
  run("npx", ["tsx", "server/index.ts"], { PORT: String(SERVER_PORT), SKETCHBATTLE_DATA: data, DEV_LOGIN: "1", FORGE_TOKEN: TOKEN });
  await up(`http://localhost:${SERVER_PORT}/api/health`, "server");
  run("npx", ["vite", "--config", "client/vite.config.ts", "--port", String(VITE_PORT), "--strictPort"], { SKETCHBATTLE_SERVER: `http://localhost:${SERVER_PORT}` });
  await up(base, "vite");
  run("node", ["scripts/fake-forge.mjs", `http://localhost:${SERVER_PORT}`, TOKEN]);

  browser = await chromium.launch();
  const W = 1280, H = 720;
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, recordVideo: { dir: work, size: { width: W, height: H } } });
  const p = await ctx.newPage();
  const t0 = Date.now();
  const marks = {};
  const mark = (name) => { marks[name] = (Date.now() - t0) / 1000; };
  const errors = [];
  p.on("pageerror", (e) => errors.push(e.message));
  const on = (name, ms = 30000) => p.waitForFunction((n) => window.sketchbattle?.screen?.constructor.name === n, name, { timeout: ms });
  const s = Math.min(W / 1920, H / 1080);
  const at = (x, y) => [(W - 1920 * s) / 2 + x * s, (H - 1080 * s) / 2 + y * s];
  const press = async (key) => { await p.keyboard.press(key); await p.waitForTimeout(120); };
  const button = async (id) => {
    const b = await p.evaluate((id) => window.sketchbattle.screen.buttons().find((b) => b.id === id), id);
    if (!b) throw new Error(`no ${id} button`);
    await p.mouse.click(...at(b.x + b.w / 2, b.y + b.h / 2));
  };
  const shot = async (name, width = 960) => { const png = path.join(work, `${name}.png`); await p.screenshot({ path: png }); webp(png, `shots/${name}.webp`, width); };

  await p.goto(base);
  await on("TitleScreen");
  await p.waitForFunction(() => window.sketchbattle.screen.items.some((i) => i.id === "maps"), null, { timeout: 10000 });
  await p.evaluate(() => { const s = window.sketchbattle.screen; s.sel = s.items.findIndex((i) => i.id === "create"); });
  await press("Enter");
  await on("CreateScreen");
  await p.waitForTimeout(600);

  // a stick figure with a sword over its head, like the exemplar the fake forge hands back
  mark("draw");
  const stroke = async (pts) => {
    await p.mouse.move(...at(...pts[0])); await p.mouse.down();
    for (const q of pts.slice(1)) await p.mouse.move(...at(...q), { steps: 3 });
    await p.mouse.up(); await p.waitForTimeout(60);
  };
  await stroke(Array.from({ length: 25 }, (_, i) => [930 + Math.cos(i / 24 * Math.PI * 2) * 62, 400 + Math.sin(i / 24 * Math.PI * 2) * 62]));
  await stroke([[930, 462], [930, 680]]);
  await stroke([[930, 520], [830, 560], [800, 640]]);
  await stroke([[930, 520], [1040, 500], [1080, 470]]);
  await stroke([[930, 680], [850, 860]]);
  await stroke([[930, 680], [1010, 860]]);
  await stroke([[1060, 490], [1110, 450]]);
  await stroke([[1080, 470], [1010, 340], [960, 250], [1030, 330], [1100, 450]]);
  mark("drawn");
  await shot("draw");
  await button("done");
  await on("DescribeScreen");
  await p.fill("#overlay input", "SWORD GUY");
  await p.waitForTimeout(500);
  await button("send");
  await on("LibraryScreen");
  mark("forging");
  await p.waitForFunction(() => (window.sketchbattle.screen.entries ?? []).some((e) => e.status === "ready"), null, { timeout: 90000 });
  mark("ready");
  await p.waitForTimeout(1500);
  // the fake forge's tagline is about a desk lamp; the real one writes a line about the drawing
  const made = await p.evaluate(() => { const e = window.sketchbattle.screen.entries.find((e) => e.status === "ready"); e.tagline = "One sword. Big swings."; return e; });
  await press("Enter");
  await p.waitForTimeout(2500);
  mark("detail");
  await shot("alive");
  await p.waitForTimeout(1500);
  mark("detailEnd");

  // the fight: the new fighter against WOODSTOVE, both CPU; WOODSTOVE starts close to a KO so the clip has one
  const fight = (f) => p.goto(`${base}?quick=1&gen=${encodeURIComponent(made.bundleUrl)}&f=${made.id},${f}&p1=cpu&cpu=9&stocks=2&stage=rooftops`)
    .then(() => p.waitForFunction(() => window.sketchbattle?.screen?.match?.state, null, { timeout: 30000 }));
  await fight("woodstove");
  mark("fight");
  await p.evaluate(() => { window.sketchbattle.screen.match.state.fighters[1].percent = 150; });
  const stocks = await p.evaluate(() => window.sketchbattle.screen.match.state.fighters.reduce((n, f) => n + f.stocks, 0));
  await p.waitForFunction((n) => window.sketchbattle.screen.match.state.fighters.reduce((a, f) => a + f.stocks, 0) < n, stocks, { timeout: 40000 });
  mark("ko");
  await p.waitForTimeout(1800);
  mark("end");
  await fight("woodstove,slugbert,rocket");
  await p.waitForTimeout(3500);
  await shot("fight");
  await p.close();
  await ctx.close();
  const video = await p.video().path();
  console.log("marks", JSON.stringify(marks));
  if (errors.length) throw new Error(`page errors:\n${errors.join("\n")}`);

  // drawing at double speed, a beat of forging to ready, the fighter's card, then the fight up to and past the KO
  const fightFrom = Math.max(marks.fight + 0.5, marks.ko - 4);
  // the drawing plays in about three seconds, however long the browser took over it
  const drawSpeed = Math.max(1, (marks.drawn - marks.draw) / 3);
  const parts = [[marks.draw + 0.3, marks.drawn + 0.4, drawSpeed], [marks.ready - 1.5, marks.ready + 0.6, 1], [marks.detail - 0.8, marks.detailEnd, 1], [fightFrom, marks.end, 1]];
  const filter = parts.map(([a, b, speed], i) => `[0:v]trim=${a.toFixed(2)}:${b.toFixed(2)},setpts=(PTS-STARTPTS)/${speed},scale=960:540:flags=lanczos,fps=24[v${i}]`).join(";")
    + `;${parts.map((_, i) => `[v${i}]`).join("")}concat=n=${parts.length}:v=1:a=0[v]`;
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", video, "-filter_complex", filter, "-map", "[v]", "-an", "-c:v", "libx264", "-profile:v", "high", "-pix_fmt", "yuv420p", "-crf", "30", "-preset", "slow", "-movflags", "+faststart", path.join(out, "clip.mp4")]);
  const poster = path.join(work, "poster.png");
  // the finished drawing
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-ss", ((marks.drawn - marks.draw) / drawSpeed - 0.2).toFixed(2), "-i", path.join(out, "clip.mp4"), "-frames:v", "1", poster]);
  webp(poster, "clip.webp", 960);

  // the share image: the name over the fight
  const og = await (await browser.newContext({ viewport: { width: 1200, height: 630 } })).newPage();
  const fightPng = path.join(work, "fight.png");
  await og.setContent(`<style>
@font-face { font-family: P; src: url("data:font/woff2;base64,${fs.readFileSync(path.join(out, "patrick-hand.woff2")).toString("base64")}"); }
body { margin: 0; width: 1200px; height: 630px; background: #f4efe4; font-family: P; color: #292722; position: relative; overflow: hidden; }
img { position: absolute; left: 0; top: 0; width: 1200px; height: 675px; object-fit: cover; }
h1 { position: absolute; left: 40px; top: 26px; margin: 0; font-weight: normal; font-size: 104px; line-height: .9; background: #f4efe4; padding: 14px 28px 20px; border: 3px solid #292722; box-shadow: 8px 9px 0 rgba(41,39,34,.12); transform: rotate(-1deg); }
h1 span { display: block; font-size: 46px; margin-left: 6px; }
</style><img src="data:image/png;base64,${fs.readFileSync(fightPng).toString("base64")}"><h1><span>SUPER</span>SKETCH DUDES</h1>`);
  await og.waitForTimeout(300);
  const ogPng = path.join(work, "og.png");
  await og.screenshot({ path: ogPng });
  execFileSync("convert", [ogPng, "-quality", "84", path.join(out, "og.jpg")]);
  for (const f of ["clip.mp4", "clip.webp", "og.jpg", "shots/draw.webp", "shots/alive.webp", "shots/fight.webp"]) console.log(`${f}: ${(fs.statSync(path.join(out, f)).size / 1024).toFixed(0)} KB`);
} finally {
  await browser?.close();
  for (const c of children) { try { process.kill(-c.pid); } catch (e) { if (e.code !== "ESRCH") throw e; } }
}
