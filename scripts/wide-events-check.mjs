// Three browsers play an online room. Kirill's screen is broken on purpose (a NaN camera, then a 0x0 window, which
// leaves plain paper), then Bob's tab crashes mid-fight and the others go back to the room and leave. The store must
// hold every client's match event plus the relay's on one trace: Kirill's saying what his screen did, Bob's partial.
// Expects a DEV_LOGIN server and Vite in front of it:
//   SKETCHBATTLE_DATA=/tmp/wide-data DEV_LOGIN=1 PORT=3028 npx tsx server/index.ts
//   SKETCHBATTLE_SERVER=http://localhost:3028 npx vite --config client/vite.config.ts --port 5198
// Usage: node scripts/wide-events-check.mjs [base=http://localhost:5198/sketch-battle/] [data=/tmp/wide-data]
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { openOnline } from "./menu-nav.mjs";

const base = process.argv[2] ?? "http://localhost:5198/sketch-battle/";
const data = process.argv[3] ?? "/tmp/wide-data";
const browser = await chromium.launch();
const pages = await Promise.all(["Ann", "Bob", "Kirill"].map(async (name) => {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  page.on("framenavigated", (f) => { if (f === page.mainFrame()) console.log(`  ${name} navigated: ${f.url()}`); });
  page.on("pageerror", (e) => console.log(`  ${name} page error: ${e.message.split("\n")[0]}`));
  return page;
}));
const press = async (p, key, n = 1) => { for (let i = 0; i < n; i++) { await p.keyboard.press(key); await p.waitForTimeout(110); } };
const screen = (p, fn) => p.evaluate(fn);

const toOnline = (p, name) => openOnline(p, base, name);

try {
  const [host, ...guests] = pages;
  await toOnline(host, "Ann");
  await press(host, "ArrowDown"); await press(host, "Enter");
  // CREATE LOBBY asks public or code-only; the first is public
  await press(host, "Enter");
  await host.waitForFunction(() => typeof window.sketchbattle.screen.roomCode === "string");
  const code = await screen(host, () => window.sketchbattle.screen.roomCode);
  for (const [i, g] of guests.entries()) {
    await toOnline(g, i ? "Kirill" : "Bob");
    await press(g, "ArrowDown", 2); await press(g, "Enter");
    await g.keyboard.type(code, { delay: 40 }); await press(g, "Enter");
  }
  // fresh dev accounts own no characters, and the shelf only offers your own: pick a house fighter directly
  await Promise.all(pages.map((p) => p.waitForFunction(() => window.sketchbattle.screen.lobbyDebug?.()?.members.length === 3)));
  for (const [i, p] of pages.entries()) await p.evaluate((id) => {
    const s = window.sketchbattle.screen;
    s.pick({ id, name: id.toUpperCase(), bundleUrl: `/sketch-battle/house/${id}/bundle.json?v=${window.sketchbattle.build}`, house: true, entry: null });
  }, ["rocket", "wizard", "slugbert"][i]);
  await Promise.all(pages.map((p) => p.waitForFunction(() => window.sketchbattle.screen.lobbyDebug().members.every((m) => m.fighter))));
  for (const p of pages) await screen(p, () => window.sketchbattle.screen.toggleReady());
  await host.waitForFunction(() => window.sketchbattle.screen.canStart());
  await screen(host, () => window.sketchbattle.screen.startMatch({ stage: "rooftops", stocks: 3, time: 0, map: null }));
  await Promise.all(pages.map((p) => p.waitForFunction(() => typeof window.sketchbattle.screen.netDebug === "function", null, { timeout: 20000 })));
  const trace = await screen(host, () => window.sketchbattle.screen.opts.telemetry.trace);
  console.log(`room ${code}, match ${trace}`);
  await host.waitForTimeout(3800);
  // long enough that every page sends its periodic snapshot mid-match
  for (let round = 0; round < 12; round++) {
    const key = round % 2 ? "KeyA" : "KeyD";
    await Promise.all(pages.map(async (p) => { await p.keyboard.down(key); await p.waitForTimeout(700); await p.keyboard.up(key); await p.keyboard.press("Space"); }));
  }
  await host.waitForTimeout(6000);
  const [bob, kirill] = guests;
  await kirill.evaluate(() => { window.sketchbattle.screen.renderer.cam.x = NaN; });
  await host.waitForTimeout(1000);
  await kirill.evaluate(() => {
    Object.defineProperty(window, "innerWidth", { value: 0 });
    Object.defineProperty(window, "innerHeight", { value: 0 });
    window.dispatchEvent(new Event("resize"));
  });
  await host.waitForTimeout(1000);
  // Bob's tab crashes: no pagehide, no beacon; what he sent while playing is all there is
  const cdp = await bob.context().newCDPSession(bob);
  cdp.send("Page.crash").catch((e) => console.log(`bob's tab crashed (${e.message.split("\n")[0]})`));
  await Promise.all([host, kirill].map((p) => p.waitForFunction(() => "roomCode" in window.sketchbattle.screen, null, { timeout: 10000 })));
  await host.waitForTimeout(500);
  for (const p of [host, kirill]) await p.goto("about:blank");
  await host.waitForTimeout(1500);

  const out = execFileSync("npx", ["tsx", "scripts/events.ts", "--data", data, "--trace", trace, "--json"], { encoding: "utf8" });
  const events = out.split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const clients = events.filter((e) => e.kind === "match" && e.source === "client");
  const relay = events.filter((e) => e.kind === "match" && e.source === "server");
  const names = clients.map((e) => e.client.player?.name).sort();
  console.log(`${clients.length} client match events (${names.join(", ")}), ${relay.length} relay match event(s)`);
  for (const e of [...clients, ...relay]) console.log(`  ${e.source} ${e.client?.player?.name ?? ""} level=${e.level} final=${e.final} exit=${e.business.exit} frames=${e.business.net?.frames ?? e.business.relay?.map((s) => s.newest).join("/")} headline=${e.headline}`);
  const by = (name) => clients.find((e) => e.client.player?.name === name);
  const codes = by("Kirill")?.issues.map((i) => i.code) ?? [];
  console.log(`  Kirill's issues: ${by("Kirill")?.issues.map((i) => `${i.level} ${i.code}: ${i.message}`).join(" | ")}`);
  const sessions = execFileSync("npx", ["tsx", "scripts/events.ts", "--data", data, "--kind", "session", "--json"], { encoding: "utf8" }).split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const sessionNames = sessions.filter((e) => clients.some((c) => c.parent === e.trace)).map((e) => e.client.player?.name).sort();
  console.log(`  their sessions: ${sessionNames.join(", ")}`);
  const ok = clients.length === 3 && relay.length === 1 && names.join() === "Ann,Bob,Kirill" && sessionNames.join() === "Ann,Bob,Kirill"
    && ["Ann", "Kirill"].every((n) => by(n).final && by(n).business.exit === "left" && by(n).business.net.frames > 900)
    && !by("Bob").final && by("Bob").business.net.frames > 300
    && by("Kirill").level === "error" && ["camera", "view", "blank"].every((c) => codes.includes(c));
  console.log(ok ? "PASS wide-events-check" : "FAIL wide-events-check");
  process.exitCode = ok ? 0 : 1;
} catch (e) { console.error("FAIL wide-events-check", e); process.exitCode = 1; } finally { await browser.close(); }
