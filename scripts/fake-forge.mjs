// A stand-in forge for local DRAW BATTLE testing: claims every job and completes it with the
// LAMPJACK exemplar after a few seconds and a couple of progress posts.
//   node scripts/fake-forge.mjs [server=http://localhost:3010] [token=devtoken]
// The 3x3 sheet is composed from the exemplar's cells with a tiny PNG codec (no image deps).
import fs from "node:fs";
import zlib from "node:zlib";

const server = process.argv[2] ?? "http://localhost:3010";
const token = process.argv[3] ?? "devtoken";
const CELLS = ["idle", "walk", "jump", "atk-fwd", "atk-up", "atk-down", "hit", "launched", "block"];
const NAMES = ["LAMPJACK", "WICKLAMP", "BULBOUS", "SHADE", "FILAMENT"];
const root = new URL("..", import.meta.url);
const source = fs.readFileSync(new URL("forge/exemplar/lampjack.fighter.js", root), "utf8");
const cellFiles = Object.fromEntries(CELLS.map((c) => [c, fs.readFileSync(new URL(`test/fixtures/lampjack/${c}.png`, root))]));
const cells = Object.fromEntries(CELLS.map((c) => [c, cellFiles[c].toString("base64")]));

function decodeRgba(buf) {
  let pos = 8, width = 0, height = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos), type = buf.toString("ascii", pos + 4, pos + 8), data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      if (data[8] !== 8 || data[9] !== 6 || data[12] !== 0) throw new Error("fake forge only reads 8-bit RGBA non-interlaced PNGs");
    }
    if (type === "IDAT") idat.push(data);
    pos += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * 4, out = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)], line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= 4 ? out[y * stride + x - 4] : 0, b = y ? out[(y - 1) * stride + x] : 0, c = x >= 4 && y ? out[(y - 1) * stride + x - 4] : 0;
      const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      const pred = [0, a, b, (a + b) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? b : c][filter];
      if (pred === undefined) throw new Error(`bad PNG filter ${filter}`);
      out[y * stride + x] = (line[x] + pred) & 255;
    }
  }
  return { width, height, data: out };
}

const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) {
  const head = Buffer.alloc(8); head.writeUInt32BE(data.length, 0); head.write(type, 4, "ascii");
  const tail = Buffer.alloc(4); tail.writeUInt32BE(crc(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, tail]);
}
function encodeRgb(width, height, rgb) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) rgb.copy(raw, y * (width * 3 + 1) + 1, y * width * 3, (y + 1) * width * 3);
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

function composeSheet() {
  const cellPx = 256, size = cellPx * 3, paper = [0xf4, 0xef, 0xe4];
  const rgb = Buffer.alloc(size * size * 3);
  for (let i = 0; i < rgb.length; i++) rgb[i] = paper[i % 3];
  CELLS.forEach((name, i) => {
    const img = decodeRgba(cellFiles[name]);
    const ox = (i % 3) * cellPx, oy = Math.floor(i / 3) * cellPx, k = img.width / cellPx;
    for (let y = 0; y < cellPx; y++) for (let x = 0; x < cellPx; x++) {
      const s = (Math.floor(y * k) * img.width + Math.floor(x * k)) * 4, a = img.data[s + 3] / 255, d = ((oy + y) * size + ox + x) * 3;
      for (let ch = 0; ch < 3; ch++) rgb[d + ch] = Math.round(img.data[s + ch] * a + rgb[d + ch] * (1 - a));
    }
  });
  return encodeRgb(size, size, rgb).toString("base64");
}
const sheet = composeSheet();

const headers = { "x-forge-token": token, "content-type": "application/json" };
const api = async (path, body) => {
  const res = await fetch(`${server}/api${path}`, body === undefined ? { headers } : { method: "POST", headers, body: JSON.stringify(body) });
  if (res.status >= 400) throw new Error(`${path}: HTTP ${res.status} ${await res.text()}`);
  return res;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function work(job, n) {
  console.log(`job ${job.id}: ${job.fighterId} for ${job.playerName} round ${job.round}`);
  const drawing = await api(`/forge/jobs/${job.id}/drawing.png`);
  console.log(`  drawing ${(await drawing.arrayBuffer()).byteLength} bytes`);
  for (const stage of ["reading the drawing", "drawing the sheet", "balance testing"]) {
    await api(`/forge/jobs/${job.id}/progress`, { stage });
    await sleep(1200);
  }
  const name = NAMES[n % NAMES.length];
  await api(`/forge/jobs/${job.id}/complete`, {
    name, tagline: `${job.playerName}'s desk lamp with a grudge and a very long cord`, description: "A floating desk lamp that whips its cord.",
    card: ["ATTACK  cord whip, aim it", "SPECIAL  hold: bulb flash burst", "UP+SPECIAL  propeller lift", "GRAB  plug hook, toss"],
    source, sprite: { px: 512, feetPx: 448, heightPx: 360, anims: {} }, cells, sheet,
  });
  console.log(`  done: ${name}`);
}

let n = 0;
for (;;) {
  const res = await api("/forge/jobs/next");
  if (res.status === 204) { await sleep(700); continue; }
  const job = await res.json();
  void work(job, n++).catch((error) => { console.error(`job ${job.id} failed:`, error); process.exitCode = 1; });
}
