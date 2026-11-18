// Records a CPU-vs-CPU match with the game's own sound: the canvas and the audio mix into one file.
// Usage: node scripts/record-fight.mjs <base> <out.mp4> [seconds=45] [query="f=rocket,wizard&stage=rooftops&seed=3&stocks=2"]
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import fs from "node:fs";

const [base, out, seconds = "45", query = "f=rocket,wizard&stage=rooftops&seed=3&stocks=2"] = process.argv.slice(2);
if (!base || !out) { console.error("usage: node scripts/record-fight.mjs <base> <out.mp4> [seconds] [query]"); process.exit(2); }

const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.addInitScript(() => {
  const taps = new WeakMap();
  const connect = AudioNode.prototype.connect;
  AudioNode.prototype.connect = function (dest, ...rest) {
    if (dest instanceof AudioDestinationNode) {
      let tap = taps.get(dest.context);
      if (!tap) { tap = dest.context.createMediaStreamDestination(); taps.set(dest.context, tap); window.__tap = tap; }
      connect.call(this, tap);
    }
    return connect.call(this, dest, ...rest);
  };
});
await page.goto(`${base}?quick=1&p1=cpu&p2=cpu&cpu=9&${query}`);
await page.waitForFunction(() => window.sketchbattle?.screen);
await page.evaluate(() => window.dispatchEvent(new KeyboardEvent("keydown", { code: "F13" })));
await page.waitForFunction(() => window.__tap);
const webm = await page.evaluate(async (ms) => {
  const stream = document.querySelector("canvas").captureStream(60);
  stream.addTrack(window.__tap.stream.getAudioTracks()[0]);
  const rec = new MediaRecorder(stream, { mimeType: "video/webm;codecs=vp9,opus", videoBitsPerSecond: 6_000_000, audioBitsPerSecond: 192_000 });
  const chunks = [];
  rec.ondataavailable = (e) => chunks.push(e.data);
  const done = new Promise((r) => { rec.onstop = r; });
  rec.start(1000);
  await new Promise((r) => setTimeout(r, ms));
  rec.stop();
  await done;
  const bytes = new Uint8Array(await new Blob(chunks).arrayBuffer());
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}, Number(seconds) * 1000);
await browser.close();
if (errors.length) throw new Error(errors.join("\n"));
const raw = out.replace(/\.mp4$/, ".webm");
fs.writeFileSync(raw, Buffer.from(webm, "base64"));
execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", raw, "-c:v", "libx264", "-crf", "24", "-preset", "medium", "-pix_fmt", "yuv420p", "-r", "60", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", out]);
fs.rmSync(raw);
console.log(`wrote ${out}`);
