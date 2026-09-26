// Contact sheets of every move, drawn by the real renderer: what a player would see.
// Usage: npx tsx forge/tools/preview.ts <fighter.js> <cellsDir> [--out <dir>] [--moves a,b,c]
// Writes <out>/sheet-N.png (six moves per sheet, five frames per move: windup, first active,
// middle, last active, recovery) and prints one line per move. <out> defaults to <cellsDir>/../preview.
import fs from "node:fs";
import path from "node:path";
import { createServer, type Plugin } from "vite";
import { chromium } from "playwright";
import { bundleOf } from "./gate";

const args = process.argv.slice(2);
const opt = (k: string): string | null => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : null; };
const [js, cellsDir] = args.filter((a, i) => !a.startsWith("--") && (i === 0 || !args[i - 1].startsWith("--")));
if (!js || !cellsDir) { console.error("usage: npx tsx forge/tools/preview.ts <fighter.js> <cellsDir> [--out dir] [--moves a,b,c]"); process.exit(2); }
const out = opt("out") ?? path.join(path.dirname(path.resolve(cellsDir)), "preview");
const only = opt("moves")?.split(",").filter(Boolean) ?? null;
fs.mkdirSync(out, { recursive: true });

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const BASE = "/sketch-battle/";
const ID = "gen-preview";
const { bundle } = bundleOf(path.resolve(js), path.resolve(cellsDir));
bundle.id = ID;
bundle.sprite.cells = Object.fromEntries(Object.keys(bundle.sprite.cells).map((c) => [c, `${BASE}gen/preview/${c}.png`]));

/** Serves the candidate's bundle and cells from memory / the cells folder, ahead of vite's proxy. */
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

const server = await createServer({ configFile: path.join(root, "client/vite.config.ts"), root: path.join(root, "client"), plugins: [serveCandidate], logLevel: "silent", server: { port: 5400 + Math.floor(Math.random() * 100), strictPort: false, host: "127.0.0.1" } });
await server.listen();
const url = server.resolvedUrls!.local[0];

const CELL_W = 520, CELL_H = 400, SCALE = 0.6, PER_SHEET = 6, VIEW_W = 1920, VIEW_H = 1080;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
await page.goto(`${url}?quick=1&preview=1&p1=cpu&cpu=0&gen=${BASE}gen/preview/bundle.json&f=${ID},tank&stage=proving&seed=1`);
await page.waitForFunction(() => (window as any).sketchbattle?.preview, null, { timeout: 30000 });
await page.waitForTimeout(400);

type MoveInfo = { total: number; first: number | null; last: number | null; aerial: boolean };
const moves = await page.evaluate(() => (window as any).sketchbattle.preview.moves(0) as Record<string, MoveInfo>);
const ids = Object.keys(moves).filter((m) => !only || only.includes(m));
const paint = () => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

interface Shot { frame: number; png: string; note: string }
const rows: { id: string; info: MoveInfo; shots: Shot[]; hookErr: string | null; ended: number | null }[] = [];
for (const id of ids) {
  const info = moves[id];
  const targets = info.first !== null && info.last !== null
    ? [Math.max(1, info.first - 2), info.first, Math.floor((info.first + info.last) / 2), info.last, Math.min(info.total, info.last + 3)]
    : [1, Math.floor(info.total * 0.25), Math.floor(info.total * 0.5), Math.floor(info.total * 0.75), info.total - 1];
  const wanted = [...new Set(targets)];
  await page.evaluate(({ id, aerial }) => {
    const p = (window as any).sketchbattle.preview, s = p.stage();
    p.pose(0, s.cx - 80, aerial ? s.floorY - 170 : s.floorY, 1, aerial);
    p.pose(1, s.cx + 120, s.floorY, -1, false);
    p.start(0, id);
  }, { id, aerial: info.aerial });
  const shots: Shot[] = [];
  let hookErr: string | null = null, ended: number | null = null;
  for (let k = 0; k <= info.total + 3 && shots.length < wanted.length; k++) {
    if (k > 0) await page.evaluate(() => (window as any).sketchbattle.preview.step(1));
    const f = await page.evaluate(() => (window as any).sketchbattle.preview.fighter(0));
    if (f.hookErr && !hookErr) hookErr = f.hookErr;
    if (f.action !== "attack" && ended === null && k > 0) ended = k;
    if (!wanted.includes(k) && !(ended === k)) continue;
    await paint();
    // the game draws a 1920x1080 view letterboxed into the canvas; map the view point to page pixels
    const sc = Math.min(1280 / VIEW_W, 720 / VIEW_H), ox = (1280 - VIEW_W * sc) / 2, oy = (720 - VIEW_H * sc) / 2;
    const cx = ox + f.sx * sc, cy = oy + f.sy * sc;
    const clip = { x: Math.max(0, Math.min(1280 - CELL_W, cx - CELL_W / 2)), y: Math.max(0, Math.min(720 - CELL_H, cy - CELL_H * 0.72)), width: CELL_W, height: CELL_H };
    const png = (await page.screenshot({ clip })).toString("base64");
    shots.push({ frame: k, png, note: `${f.action}${f.action === "attack" ? ` f${f.frame}` : ""}` });
    if (ended === k) break;
  }
  rows.push({ id, info, shots, hookErr, ended });
  const act = info.first !== null ? `active ${info.first}-${info.last}` : "no hitboxes";
  console.log(`${id.padEnd(12)} total ${String(info.total).padStart(3)}  ${act}${info.aerial ? "  aerial" : ""}${ended !== null && ended < info.total ? `  ended early at f${ended} (${shots[shots.length - 1]?.note})` : ""}${hookErr ? `  HOOK ERROR: ${hookErr}` : ""}`);
}

// compose the sheets in a blank page: rows of moves, columns of frames, labels in the margin
const sheet = await browser.newPage({ viewport: { width: Math.round(CELL_W * SCALE * 5 + 160), height: Math.round(CELL_H * SCALE * PER_SHEET) } });
for (let s = 0; s * PER_SHEET < rows.length; s++) {
  const chunk = rows.slice(s * PER_SHEET, (s + 1) * PER_SHEET);
  await sheet.setContent(`<body style="margin:0;background:#f4efe4"><canvas id=c width=${Math.round(CELL_W * SCALE * 5 + 160)} height=${Math.round(CELL_H * SCALE * chunk.length)}></canvas></body>`);
  await sheet.evaluate(async ({ chunk, CELL_W, CELL_H, SCALE }) => {
    const c = document.getElementById("c") as HTMLCanvasElement, g = c.getContext("2d")!;
    g.fillStyle = "#f4efe4"; g.fillRect(0, 0, c.width, c.height);
    // no named inner functions here: the evaluated source must not need esbuild's __name helper
    for (let r = 0; r < chunk.length; r++) {
      const row = chunk[r], y = r * CELL_H * SCALE;
      g.fillStyle = "#292722"; g.font = "bold 20px sans-serif"; g.fillText(row.id, 10, y + 30);
      g.font = "13px sans-serif"; g.fillStyle = "#777267";
      g.fillText(`${row.info.total}f`, 10, y + 52);
      if (row.info.first !== null) g.fillText(`hits ${row.info.first}-${row.info.last}`, 10, y + 70);
      if (row.info.aerial) g.fillText("aerial", 10, y + 88);
      if (row.hookErr) { g.fillStyle = "#c0392b"; g.fillText("HOOK ERROR", 10, y + 106); }
      for (let k = 0; k < row.shots.length; k++) {
        const sh = row.shots[k], x = 160 + k * CELL_W * SCALE;
        const img = new Image(); img.src = `data:image/png;base64,${sh.png}`; await img.decode();
        g.drawImage(img, x, y, CELL_W * SCALE, CELL_H * SCALE);
        g.strokeStyle = "#d8d2c4"; g.strokeRect(x + 0.5, y + 0.5, CELL_W * SCALE - 1, CELL_H * SCALE - 1);
        g.fillStyle = "#292722"; g.font = "13px sans-serif"; g.fillText(`f${sh.frame} ${sh.note}`, x + 6, y + CELL_H * SCALE - 8);
      }
    }
  }, { chunk, CELL_W, CELL_H, SCALE });
  const file = path.join(out, `sheet-${s + 1}.png`);
  await sheet.locator("#c").screenshot({ path: file });
  console.log(`wrote ${file} (${chunk.map((r) => r.id).join(", ")})`);
}
if (errors.length) console.log(`page errors:\n  ${errors.join("\n  ")}`);
await browser.close();
await server.close();
