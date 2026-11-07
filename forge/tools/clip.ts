// Every attack drawn by the real renderer one sim frame at a time.
// Writes a sheet of every frame of each strike to <out>-frames/: <move>.png as played, <move>-hitboxes.png with
// the hitboxes drawn over it. Default also writes <out>: a video, as played on the left and with hitboxes on the
// right, each move at full speed then at a third.
// --fast: only the sheets, and only the strike (a few frames before the first hitbox to ten after the last).
// Usage: npx tsx forge/tools/clip.ts <fighter.js> <cellsDir> [--out <file.mp4>] [--moves a,b,c] [--fast]
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createServer, type Plugin } from "vite";
import { chromium } from "playwright";
import { bundleOf } from "./gate";

const args = process.argv.slice(2);
const opt = (k: string): string | null => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : null; };
const [js, cellsDir] = args.filter((a, i) => !a.startsWith("--") && (i === 0 || !args[i - 1].startsWith("--")));
if (!js || !cellsDir) { console.error("usage: npx tsx forge/tools/clip.ts <fighter.js> <cellsDir> [--out file.mp4] [--moves a,b,c]"); process.exit(2); }
const out = path.resolve(opt("out") ?? path.join(path.dirname(path.resolve(cellsDir)), "moves.mp4"));
const only = opt("moves")?.split(",").filter(Boolean) ?? null;
const fast = args.includes("--fast");
const work = fs.mkdtempSync(path.join(os.tmpdir(), "clip-"));
const sheets = out.replace(/\.mp4$/, "") + "-frames";
fs.mkdirSync(sheets, { recursive: true });

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const FONT = path.join(root, "client/public/fonts/PatrickHand-Regular.ttf");
const BASE = "/sketch-battle/";
const ID = "gen-preview";
const { bundle } = bundleOf(path.resolve(js), path.resolve(cellsDir));
bundle.id = ID;
bundle.sprite.cells = Object.fromEntries(Object.keys(bundle.sprite.cells).map((c) => [c, `${BASE}gen/preview/${c}.png`]));

const serveCandidate: Plugin = {
  name: "preview-candidate",
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      const url = (req.url ?? "").split("?")[0];
      const prefix = `${BASE}gen/preview/`;
      if (!url.startsWith(prefix)) return next();
      const file = url.slice(prefix.length);
      if (file === "bundle.json") { res.setHeader("content-type", "application/json"); res.end(JSON.stringify(bundle)); return; }
      const p = path.join(path.resolve(cellsDir), path.basename(file));
      if (!fs.existsSync(p)) { res.statusCode = 404; res.end(); return; }
      res.setHeader("content-type", "image/png"); res.end(fs.readFileSync(p));
    });
  },
};

const server = await createServer({ configFile: path.join(root, "client/vite.config.ts"), root: path.join(root, "client"), plugins: [serveCandidate], logLevel: "silent", server: { port: 5500 + Math.floor(Math.random() * 100), strictPort: false, host: "127.0.0.1" } });
await server.listen();
const url = server.resolvedUrls!.local[0];

const VIEW_W = 1920, VIEW_H = 1080, W = 400, H = 360, SCALE = 2, PAGES = 4;
const browser = await chromium.launch();
const errors: string[] = [];
const run = promisify(execFile);
type MoveInfo = { total: number; first: number | null; last: number | null; aerial: boolean };
type P = Awaited<ReturnType<typeof browser.newPage>>;

async function openGame(): Promise<P> {
  // the page's own canvas at the same scale as the shots, so both reuse one cached paper texture
  const page = await browser.newPage({ viewport: { width: VIEW_W, height: VIEW_H }, deviceScaleFactor: SCALE });
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error" && !/HTTP 500|status of 500|class-time/.test(m.text())) errors.push(m.text()); });
  await page.goto(`${url}?quick=1&preview=1&p1=cpu&cpu=0&gen=${BASE}gen/preview/bundle.json&f=${ID},woodstove&stage=proving&seed=1`);
  await page.waitForFunction(() => (window as any).sketchbattle?.preview, null, { timeout: 30000 })
    .catch((e) => { throw new Error(`the game never came up with this fighter: ${errors.join(" | ") || e.message}`); });
  return page;
}

/** Plays one move a frame at a time and writes its frames: a%03d.jpg as played, b%03d.jpg with hitboxes. */
async function capture(page: P, id: string, info: MoveInfo, dir: string): Promise<{ n: number; from: number; count: number }> {
  await page.evaluate(({ aerial }) => {
    const p = (window as any).sketchbattle.preview, s = p.stage();
    p.pose(0, s.cx - 80, aerial ? s.floorY - 170 : s.floorY, 1, aerial);
    p.pose(1, s.cx + 90, s.floorY, -1, false);
    p.step(1);
  }, { aerial: info.aerial });
  // let the camera settle on the new spot before framing it
  await page.waitForTimeout(700);
  // fast: just the strike, as played; otherwise the whole move twice over (as played, with hitboxes)
  const from = fast ? Math.max(0, (info.first ?? 1) - 3) : 0;
  const to = fast ? Math.min(info.total + 2, (info.last ?? info.total) + 10) : info.total + 8;
  const shots = await page.evaluate(({ id, from, to, total, W, H, SCALE, VIEW_W, VIEW_H, boxes }) => {
    const p = (window as any).sketchbattle.preview;
    p.start(0, id);
    const f0 = p.fighter(0);
    const x = Math.max(0, Math.min(VIEW_W - W, f0.sx - W / 2 + 40)), y = Math.max(0, Math.min(VIEW_H - H, f0.sy - H * 0.74));
    const out: { a: string; b: string | null }[] = [];
    let err: string | null = null;
    for (let k = 0; k <= to; k++) {
      if (k > 0) p.step(1);
      const f = p.fighter(0);
      if (f.hookErr && !err) err = f.hookErr;
      if (k >= from) out.push({ a: p.shot(x, y, W, H, SCALE, false, 1 / 60), b: boxes ? p.shot(x, y, W, H, SCALE, true, 0) : null });
      if (k > total && f.action !== "attack") break;
    }
    return { out, err };
  }, { id, from, to, total: info.total, W, H, SCALE, VIEW_W, VIEW_H, boxes: true });
  if (shots.err) throw new Error(`${id}: ${shots.err}`);
  fs.mkdirSync(dir);
  const write = (name: string, data: string) => fs.writeFileSync(path.join(dir, name), Buffer.from(data.slice(data.indexOf(",") + 1), "base64"));
  shots.out.forEach((s, k) => { write(`a${String(k).padStart(3, "0")}.jpg`, s.a); if (s.b) write(`b${String(k).padStart(3, "0")}.jpg`, s.b); });
  const first = (info.first ?? 1) - 3 - from;
  return { n: shots.out.length, from: Math.max(0, first), count: Math.min(shots.out.length - Math.max(0, first), (info.last ?? info.total) - (info.first ?? 1) + 14) };
}

const first = await openGame();
const moves = await first.evaluate(() => (window as any).sketchbattle.preview.moves(0) as Record<string, MoveInfo>);
const ids = only ?? Object.keys(moves).filter((m) => moves[m].first !== null && !/grab|throw|pummel/i.test(m));
for (const id of ids) if (!moves[id]) throw new Error(`no move ${id}`);
const pages = [first, ...await Promise.all(Array.from({ length: Math.min(PAGES, ids.length) - 1 }, openGame))];
const segments = new Map<string, string[]>();
const label = (txt: string, x: number) => `drawtext=fontfile=${FONT}:text='${txt}':x=${x}:y=14:fontsize=48:fontcolor=0x292722`;

async function finish(id: string, dir: string, got: { n: number; from: number; count: number }, tFrom: number): Promise<void> {
  const frameNo = fast ? `%{eif\\:n+${tFrom + got.from}\\:d}` : `%{eif\\:n+${got.from}\\:d}`;
  const sheet = (pane: string, file: string) => run("ffmpeg", ["-v", "error", "-y", "-start_number", String(got.from), "-i", path.join(dir, `${pane}%03d.jpg`), "-frames:v", "1",
    "-vf", `select='lt(n\\,${got.count})',scale=400:-1,drawtext=fontfile=${FONT}:text='${frameNo}':x=10:y=10:fontsize=26:fontcolor=0x292722,tile=6x${Math.ceil(got.count / 6)}`, path.join(sheets, file)]);
  const jobs: Promise<unknown>[] = [sheet("a", `${id}.png`), sheet("b", `${id}-hitboxes.png`)];
  if (!fast) {
    const segs: string[] = [];
    for (const [speed, fps] of [["", 60], [" (1/3 speed)", 20]] as const) {
      const seg = path.join(work, `${id}-${fps}.mp4`);
      segs.push(seg);
      jobs.push(run("ffmpeg", ["-v", "error", "-y", "-framerate", String(fps), "-i", path.join(dir, "a%03d.jpg"), "-framerate", String(fps), "-i", path.join(dir, "b%03d.jpg"),
        "-filter_complex", `[0][1]hstack,${label(id.toUpperCase() + speed, 20)},${label("hitboxes", W * SCALE + 20)},fps=60,tpad=stop_mode=clone:stop_duration=0.4,format=yuv420p`,
        "-c:v", "libx264", "-crf", "22", seg]));
    }
    segments.set(id, segs);
  }
  await Promise.all(jobs);
}

const queue = [...ids], pending: Promise<void>[] = [];
await Promise.all(pages.map(async (page) => {
  for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
    const info = moves[id], dir = path.join(work, id);
    const got = await capture(page, id, info, dir);
    const tFrom = fast ? Math.max(0, (info.first ?? 1) - 3) : 0;
    pending.push(finish(id, dir, got, tFrom));
    console.log(`${id.padEnd(12)} ${got.n} frames`);
  }
}));
await Promise.all(pending);
console.log(`frame sheets in ${sheets}`);
if (!fast) {
  fs.writeFileSync(path.join(work, "list.txt"), ids.flatMap((id) => segments.get(id)!).map((s) => `file '${s}'`).join("\n"));
  await run("ffmpeg", ["-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", path.join(work, "list.txt"), "-c", "copy", out]);
  console.log(`wrote ${out}`);
}
if (errors.length) { console.log(`page errors:\n  ${errors.join("\n  ")}`); process.exitCode = 1; }
await browser.close();
await server.close();
