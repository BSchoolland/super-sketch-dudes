// Records GEARSHIFT's choreography in a real match: mech, transform, drive, boost, transform back.
// Usage: node scripts/record-gearshift.mjs [base] [outdir]
import { chromium } from "playwright";
import { mkdirSync, readdirSync, renameSync } from "node:fs";
const base = process.argv[2] ?? "http://localhost:5177/sketch-battle/";
const out = process.argv[3] ?? "/tmp/tf/video";
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, recordVideo: { dir: out, size: { width: 1280, height: 720 } } });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
await page.goto(`${base}?quick=1&p2=cpu&cpu=3&f=gearshift,brick&stage=proving&seed=3&gen=/sketch-battle/gen/gearshift/bundle.json`);
await page.waitForFunction(() => window.sketchbattle?.screen);
const k = page.keyboard;
const wait = (ms) => page.waitForTimeout(ms);
const tap = async (key, ms = 60) => { await k.down(key); await wait(ms); await k.up(key); };
const withHeld = async (held, key, ms = 60) => { await k.down(held); await wait(40); await tap(key, ms); await wait(40); await k.up(held); };
await wait(3600);                               // countdown + a beat of idle
await k.down("KeyD"); await wait(700); await k.up("KeyD");   // walk in
await tap("KeyJ"); await wait(320); await tap("KeyJ"); await wait(600);       // jab, jab
await withHeld("KeyD", "KeyJ"); await wait(700);                                 // hood slam (ftilt)
await tap("KeyK"); await wait(1000);                                             // rocket punch
await withHeld("KeyS", "KeyK"); await wait(1300);                                // TRANSFORM -> car
await k.down("KeyD"); await wait(900); await tap("KeyJ"); await wait(800); await k.up("KeyD"); // drive, full ram
await k.down("KeyA"); await wait(500); await k.up("KeyA");                       // reverse a bit
await k.down("KeyD"); await wait(1100); await k.up("KeyD");                      // build nitro
await tap("KeyK"); await wait(1100);                                             // NITRO BOOST
await withHeld("KeyA", "KeyK"); await wait(900);                                 // drift turn
await tap("KeyW"); await wait(260); await withHeld("KeyS", "KeyJ"); await wait(1000); // hop, slam
await withHeld("KeyS", "KeyK"); await wait(1300);                                // TRANSFORM -> mech
await tap("KeyW"); await wait(200); await tap("KeyK"); await wait(1300);         // jump jet
await withHeld("KeyD", "KeyJ"); await wait(600); await tap("KeyJ"); await wait(2500);
const hookErr = await page.evaluate(() => window.sketchbattle?.screen?.hookErr ?? null);
await context.close();
await browser.close();
const webm = readdirSync(out).find((f) => f.endsWith(".webm"));
renameSync(`${out}/${webm}`, `${out}/gearshift.webm`);
console.log(JSON.stringify({ errors, hookErr }));
