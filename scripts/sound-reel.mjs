// Render every sound offline in headless Chromium and write WAVs plus one reel with gaps.
// Usage: node scripts/sound-reel.mjs [outDir=shots/sound-reel]
import { build } from "esbuild";
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const out = process.argv[2] ?? "shots/sound-reel";
fs.mkdirSync(out, { recursive: true });
const bundle = await build({ entryPoints: ["scripts/sound-reel.ts"], bundle: true, format: "iife", write: false, target: "es2022" });
const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent("<html><body></body></html>");
await page.addScriptTag({ content: bundle.outputFiles[0].text });
const cues = await page.evaluate(() => window.render());
await browser.close();

function wav(file, l, r) {
  const n = l.length, b = Buffer.alloc(44 + n * 4);
  b.write("RIFF", 0); b.writeUInt32LE(36 + n * 4, 4); b.write("WAVEfmt ", 8); b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); b.writeUInt16LE(2, 22); b.writeUInt32LE(48000, 24); b.writeUInt32LE(48000 * 4, 28);
  b.writeUInt16LE(4, 32); b.writeUInt16LE(16, 34); b.write("data", 36); b.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) {
    b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, l[i])) * 32767), 44 + i * 4);
    b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, r[i])) * 32767), 46 + i * 4);
  }
  fs.writeFileSync(file, b);
}
const L = [], R = [], gap = new Array(Math.round(48000 * 0.35)).fill(0);
cues.forEach((c, i) => {
  let peak = 0, sq = 0;
  for (let j = 0; j < c.l.length; j++) { peak = Math.max(peak, Math.abs(c.l[j]), Math.abs(c.r[j])); sq += c.l[j] ** 2; }
  console.log(`${String(i + 1).padStart(2)} ${c.name.padEnd(18)} peak ${(20 * Math.log10(peak || 1e-9)).toFixed(1).padStart(6)} dBFS  rms ${(10 * Math.log10(sq / c.l.length || 1e-12)).toFixed(1).padStart(6)} dB`);
  wav(path.join(out, `${String(i + 1).padStart(2, "0")}-${c.name.replace(/\W+/g, "-")}.wav`), c.l, c.r);
  for (const x of c.l) L.push(x); for (const x of gap) L.push(x);
  for (const x of c.r) R.push(x); for (const x of gap) R.push(x);
});
wav(path.join(out, "reel.wav"), L, R);
console.log(`wrote ${cues.length} sounds and reel.wav to ${out}`);
