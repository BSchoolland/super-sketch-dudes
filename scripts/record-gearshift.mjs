// Records GEARSHIFT's choreography in a real match: mech, transform, drive, boost, transform back.
// Usage: node scripts/record-gearshift.mjs [base] [outdir]
import { chromium } from "playwright";
import { mkdirSync, readdirSync, renameSync } from "node:fs";
import { down as btnDown, up as btnUp, press as btnPress } from "./lib/keys.mjs";
const base = process.argv[2] ?? "http://localhost:5177/sketch-battle/";
const out = process.argv[3] ?? "/tmp/tf/video";
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, recordVideo: { dir: out, size: { width: 1280, height: 720 } } });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
await page.goto(`${base}?quick=1&p2=cpu&cpu=1&f=gearshift,tank&stage=proving&seed=3`);
await page.waitForFunction(() => window.sketchbattle?.screen);
const k = page.keyboard;
const wait = (ms) => page.waitForTimeout(ms);
const tap = async (key, ms = 60) => { await btnDown(page, key); await wait(ms); await btnUp(page, key); };
const withHeld = async (held, key, ms = 60) => { await k.down(held); await wait(40); await tap(key, ms); await wait(40); await k.up(held); };
await wait(3600);                               // countdown + a beat of idle
await k.down("KeyD"); await wait(600); await k.up("KeyD");   // walk in
await tap("Mouse0"); await wait(320); await tap("Mouse0"); await wait(600);       // jab, jab
await withHeld("KeyD", "Mouse0"); await wait(700);                                 // hood slam (ftilt)
await tap("Mouse2"); await wait(1000);                                             // rocket punch
await withHeld("KeyS", "Mouse2"); await wait(1300);                                // TRANSFORM -> car
await k.down("KeyD"); await wait(420); await tap("Mouse0"); await wait(800); await k.up("KeyD"); // drive, full ram
await k.down("KeyA"); await wait(380); await k.up("KeyA"); await wait(500);      // back off
await k.down("KeyD"); await wait(450); await k.up("KeyD"); await wait(300);      // build nitro
await withHeld("KeyA", "Mouse2"); await wait(900);                                 // drift: swing round
await withHeld("KeyD", "Mouse2"); await wait(900);                                 // and back
await tap("Mouse2"); await wait(1100);                                             // NITRO BOOST
await tap("KeyW"); await wait(260); await withHeld("KeyS", "Mouse0"); await wait(1000); // hop, slam
await withHeld("KeyS", "Mouse2"); await wait(1300);                                // TRANSFORM -> mech
await tap("KeyW"); await wait(200); await tap("Mouse2"); await wait(1300);         // jump jet
await withHeld("KeyD", "Mouse0"); await wait(600); await tap("Mouse0"); await wait(2500);
const hookErr = await page.evaluate(() => window.sketchbattle?.screen?.hookErr ?? null);
await context.close();
await browser.close();
const webm = readdirSync(out).find((f) => f.endsWith(".webm"));
renameSync(`${out}/${webm}`, `${out}/gearshift.webm`);
console.log(JSON.stringify({ errors, hookErr }));
