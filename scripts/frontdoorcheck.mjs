// The front door end to end: guest play, signing in from a guest, the email signup age question, the static pages.
// Starts its own server (DEV_LOGIN, a scratch data dir), Vite and scripts/fake-forge.mjs, then:
//   1. a brand-new browser lands on the title as a guest and plays VS BOTS
//   2. two guests in different browsers play an online match
//   3. a guest draws a character, the fake forge makes it, they create an email account (birth year first) and still have it
//   4. an under-13 answer gets no account, and going back doesn't ask again (a reload neither); the answer is never sent
//   5. the year that turns 13 this year asks the month, this month asks the day; DISCORD and GOOGLE go straight out
//   6. a signed-in session reopens untouched; SIGN OUT starts a fresh guest
//   7. /privacy, /terms and /privacy.html, desktop and phone
// Usage: node scripts/frontdoorcheck.mjs [--shots <dir>]   (SERVER_PORT, VITE_PORT override 3231 / 5431)
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const SERVER_PORT = Number(process.env.SERVER_PORT ?? 3231), VITE_PORT = Number(process.env.VITE_PORT ?? 5431), TOKEN = "devtoken";
const shotsAt = process.argv.indexOf("--shots");
const shots = shotsAt > 0 ? process.argv[shotsAt + 1] : null;
const data = fs.mkdtempSync(path.join(os.tmpdir(), "frontdoorcheck-"));
const base = `http://localhost:${VITE_PORT}/sketch-battle/`;
const children = [];
const fail = (message) => { throw new Error(message); };
const YEAR = new Date().getFullYear(), MONTH = new Date().getMonth() + 1;

function run(cmd, args, env) {
  const child = spawn(cmd, args, { env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"], detached: true });
  let log = "";
  child.stdout.on("data", (d) => (log += d));
  child.stderr.on("data", (d) => (log += d));
  children.push({ child, log: () => log });
  return child;
}
async function up(url, what) {
  for (let i = 0; i < 150; i++) {
    try { if ((await fetch(url)).ok) return; } catch { /* not listening yet */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  fail(`${what} never came up at ${url}`);
}

let browser;
const errorsSeen = [];
try {
  run("npx", ["tsx", "server/index.ts"], { PORT: String(SERVER_PORT), SKETCHBATTLE_DATA: data, DEV_LOGIN: "1", FORGE_TOKEN: TOKEN });
  await up(`http://localhost:${SERVER_PORT}/api/health`, "server");
  run("npx", ["vite", "--config", "client/vite.config.ts", "--port", String(VITE_PORT), "--strictPort"], { SKETCHBATTLE_SERVER: `http://localhost:${SERVER_PORT}` });
  await up(base, "vite");
  run("node", ["scripts/fake-forge.mjs", `http://localhost:${SERVER_PORT}`, TOKEN]);

  browser = await chromium.launch();
  const errors = errorsSeen;
  /** Every request body a page posts to the API, to check what the server was told. */
  const posted = [];
  async function page(name, viewport = { width: 1280, height: 720 }) {
    const p = await (await browser.newContext({ viewport })).newPage();
    p.on("pageerror", (e) => errors.push(`${name}: ${e.message}`));
    p.on("console", (m) => { if (m.type() === "error" && !/signed out|401/.test(m.text())) errors.push(`${name} console: ${m.text()}`); });
    p.on("request", (r) => { if (r.url().includes("/api/") && r.method() !== "GET") posted.push({ who: name, url: r.url(), body: r.postData() ?? "" }); });
    return p;
  }
  const shot = async (p, name) => { if (shots) { fs.mkdirSync(shots, { recursive: true }); await p.waitForTimeout(300); await p.screenshot({ path: path.join(shots, `${name}.png`) }); } };
  const screen = (p) => p.evaluate(() => window.sketchbattle.screen.constructor.name);
  const on = (p, name, ms = 20000) => p.waitForFunction((n) => window.sketchbattle?.screen?.constructor.name === n, name, { timeout: ms }).catch(async () => { await p.screenshot({ path: path.join(os.tmpdir(), "frontdoorcheck-timeout.png") }); fail(`waited for ${name}, on ${await screen(p)} (${path.join(os.tmpdir(), "frontdoorcheck-timeout.png")})`); });
  const player = (p) => p.evaluate(() => JSON.parse(localStorage.getItem("sketchbattle.account") ?? "null")?.player ?? null);
  /** View coordinates (1920x1080) to page pixels; every viewport here is 16:9 or the canvas letterboxes. */
  const at = async (p, x, y) => {
    const v = p.viewportSize(), s = Math.min(v.width / 1920, v.height / 1080);
    return [(v.width - 1920 * s) / 2 + x * s, (v.height - 1080 * s) / 2 + y * s];
  };
  const tap = async (p, x, y) => { const [px, py] = await at(p, x, y); await p.mouse.click(px, py); await p.waitForTimeout(150); };
  const button = async (p, id) => {
    const b = await p.evaluate((id) => window.sketchbattle.screen.buttons().find((b) => b.id === id), id);
    if (!b) fail(`no ${id} button on ${await screen(p)}`);
    await tap(p, b.x + b.w / 2, b.y + b.h / 2);
  };
  const hasButton = (p, id) => p.evaluate((id) => window.sketchbattle.screen.buttons().some((b) => b.id === id), id);
  const press = async (p, key, n = 1) => { for (let i = 0; i < n; i++) { await p.keyboard.press(key); await p.waitForTimeout(120); } };
  async function asGuest(p) {
    await p.goto(base);
    await on(p, "TitleScreen");
    await p.mouse.move(2, 2);
    const who = await player(p);
    if (!who?.id.startsWith("guest-")) fail(`a new browser is ${JSON.stringify(who)}, not a guest`);
    return who;
  }
  /** A title menu row, once MAPS (every player on a DEV_LOGIN server) has joined the rows. */
  async function choose(p, id) {
    await p.waitForFunction(() => window.sketchbattle.screen.items.some((i) => i.id === "maps"), null, { timeout: 10000 });
    await p.evaluate((id) => { const s = window.sketchbattle.screen; s.sel = s.items.findIndex((i) => i.id === id); }, id);
    await press(p, "Enter");
  }
  async function battle(p, downs) {
    await choose(p, "battle");
    await on(p, "BattleMenuScreen");
    await press(p, "ArrowDown", downs);
    await press(p, "Enter");
  }
  const pickHouse = (p, id) => p.evaluate((id) => window.sketchbattle.screen.pick({ id, name: id.toUpperCase(), bundleUrl: `/sketch-battle/house/${id}/bundle.json?v=${window.sketchbattle.build}`, house: true, entry: null }), id);
  const inLobby = (p, n) => p.waitForFunction((n) => window.sketchbattle?.screen?.lobbyDebug?.()?.members.length === n, n, { timeout: 20000 });
  async function played(pages, label) {
    await Promise.all(pages.map((p) => p.waitForFunction(() => typeof window.sketchbattle.screen.netDebug === "function", null, { timeout: 20000 })));
    await pages[0].waitForTimeout(3800);
    for (let round = 0; round < 6; round++) await Promise.all(pages.map(async (p) => { await p.keyboard.down(round % 2 ? "KeyA" : "KeyD"); await p.waitForTimeout(400); await p.keyboard.up(round % 2 ? "KeyA" : "KeyD"); await p.keyboard.press("Space"); }));
    const frames = await Promise.all(pages.map((p) => p.evaluate(() => window.sketchbattle.screen.netDebug().frame)));
    if (Math.min(...frames) < 150) fail(`${label}: only reached frame ${Math.min(...frames)}`);
    if (pages.length > 1) {
      // a frame both sides have every input for, not one still predicted
      await pages[0].waitForTimeout(1000);
      const now = await Promise.all(pages.map((p) => p.evaluate(() => window.sketchbattle.screen.netDebug().frame)));
      const f = Math.min(...now) - 10;
      const hashes = await Promise.all(pages.map((p) => p.evaluate((f) => window.sketchbattle.screen.netDebug(f).hash, f)));
      if (hashes[0] === null || hashes.some((h) => h !== hashes[0])) fail(`${label}: hashes at ${f}: ${hashes.join(" vs ")}`);
    }
    console.log(`  ${label}: played to frame ${Math.min(...frames)}`);
  }

  console.log("1. a brand-new browser");
  const ann = await page("ann");
  const annGuest = await asGuest(ann);
  await ann.waitForTimeout(1500);
  await shot(ann, "title-guest");
  const visited = await ann.evaluate(() => window.sketchbattle.screen.constructor.name);
  console.log(`  lands on ${visited} as ${annGuest.name} (${annGuest.id})`);
  await battle(ann, 3);
  await inLobby(ann, 1);
  await pickHouse(ann, "rocket");
  await ann.waitForFunction(() => window.sketchbattle.screen.canStart(), null, { timeout: 20000 });
  await ann.evaluate(() => window.sketchbattle.screen.startMatch({ stage: "rooftops", stocks: 3, time: 0, map: null }));
  // everyone in the room on this computer: the match runs here
  await on(ann, "VersusScreen", 30000);
  await ann.waitForTimeout(6000);
  const botFrame = await ann.evaluate(() => window.sketchbattle.screen.match.state.frame);
  if (botFrame < 150) fail(`VS BOTS only reached frame ${botFrame}`);
  console.log(`  VS BOTS as a guest: played to frame ${botFrame}`);
  await shot(ann, "bots-match-guest");

  console.log("2. two guests online");
  const g1 = await page("g1"), g2 = await page("g2");
  const [p1, p2] = [await asGuest(g1), await asGuest(g2)];
  if (p1.id === p2.id) fail("two browsers got one guest");
  await battle(g1, 1);
  await press(g1, "Enter");
  await g1.waitForFunction(() => typeof window.sketchbattle.screen.roomCode === "string", null, { timeout: 20000 });
  const code = await g1.evaluate(() => window.sketchbattle.screen.roomCode);
  await battle(g2, 2);
  await g2.waitForTimeout(200);
  await g2.keyboard.type(code, { delay: 40 }); await g2.keyboard.press("Enter");
  await Promise.all([inLobby(g1, 2), inLobby(g2, 2)]);
  const names = await g1.evaluate(() => window.sketchbattle.screen.context.room.members.map((m) => m.name));
  if (!names.includes(p1.name) || !names.includes(p2.name)) fail(`the lobby has ${names.join(", ")}, not the guests' names`);
  await shot(g1, "lobby-two-guests");
  await pickHouse(g1, "rocket"); await pickHouse(g2, "wizard");
  await Promise.all([g1, g2].map((p) => p.waitForFunction(() => window.sketchbattle.screen.lobbyDebug().members.every((m) => m.fighter))));
  for (const p of [g1, g2]) await p.evaluate(() => window.sketchbattle.screen.toggleReady());
  await g1.waitForFunction(() => window.sketchbattle.screen.canStart());
  await g1.evaluate(() => window.sketchbattle.screen.startMatch({ stage: "rooftops", stocks: 3, time: 0, map: null }));
  await played([g1, g2], `room ${code}, ${p1.name} vs ${p2.name}`);
  await g1.context().close(); await g2.context().close();

  console.log("3. a guest draws, then makes an email account");
  const bea = await page("bea");
  const beaGuest = await asGuest(bea);
  await choose(bea, "create");
  await on(bea, "CreateScreen");
  const stroke = async (pts) => { await bea.mouse.move(...await at(bea, ...pts[0])); await bea.mouse.down(); for (const q of pts.slice(1)) await bea.mouse.move(...await at(bea, ...q), { steps: 4 }); await bea.mouse.up(); };
  await stroke(Array.from({ length: 29 }, (_, i) => [960 + Math.cos(i / 28 * Math.PI * 2) * 90, 330 + Math.sin(i / 28 * Math.PI * 2) * 90]));
  await stroke([[960, 420], [960, 700]]); await stroke([[960, 520], [820, 460]]); await stroke([[960, 520], [1110, 600]]);
  await stroke([[960, 700], [860, 950]]); await stroke([[960, 700], [1060, 950]]);
  await button(bea, "done");
  await on(bea, "DescribeScreen");
  if (await hasButton(bea, "public")) fail("a guest is offered SHARE WITH EVERYONE");
  await bea.fill("#overlay input", "STICK GUEST");
  await shot(bea, "describe-guest");
  await button(bea, "send");
  await on(bea, "LibraryScreen");
  await bea.waitForFunction(() => (window.sketchbattle.screen.entries ?? []).some((e) => e.status === "ready"), null, { timeout: 60000 });
  const made = await bea.evaluate(() => window.sketchbattle.screen.entries.find((e) => e.status === "ready"));
  console.log(`  forged ${made.name} (${made.id}) for ${beaGuest.id}`);
  const community = async () => (await (await fetch(`${base}api/characters/community?sort=new`)).json()).characters.map((c) => c.id);
  if ((await community()).includes(made.id)) fail("a guest's character is in COMMUNITY");
  await press(bea, "Enter");
  await bea.waitForTimeout(800);
  await shot(bea, "library-detail-guest");
  await press(bea, "Escape"); await press(bea, "Escape");
  await on(bea, "TitleScreen");
  await bea.mouse.move(2, 2);
  await tap(bea, 1920 - 40 - 110, 30 + 38);
  await on(bea, "SignInScreen");
  await shot(bea, "signin-door");
  await button(bea, "email");
  await shot(bea, "signin-email-form");
  await button(bea, "switch");
  await bea.waitForTimeout(200);
  await shot(bea, "signup-age-year");
  await bea.fill("#overlay input", String(YEAR - 30));
  await button(bea, "next");
  if (await bea.locator("#overlay input").count() !== 3) fail("an adult's year didn't open the signup form");
  await shot(bea, "signup-form");
  const inputs = bea.locator("#overlay input");
  await inputs.nth(0).fill("bea@example.com"); await inputs.nth(1).fill("long enough pw"); await inputs.nth(2).fill("BEA");
  await button(bea, "submit");
  await on(bea, "TitleScreen");
  const beaAcct = await player(bea);
  if (!beaAcct.id.startsWith("email-")) fail(`signed up as ${JSON.stringify(beaAcct)}`);
  await bea.waitForTimeout(1200);
  await shot(bea, "title-signed-in");
  const lib = (await (await fetch(`${base}api/library`, { headers: { "x-session": await bea.evaluate(() => JSON.parse(localStorage.getItem("sketchbattle.account")).session) } })).json()).characters;
  const kept = lib.find((c) => c.id === made.id);
  if (!kept || kept.owner !== beaAcct.id) fail(`after signing up the library is ${JSON.stringify(lib.map((c) => [c.id, c.owner]))}`);
  if (!(await community()).includes(made.id)) fail("the signed-in account's character isn't in COMMUNITY (the normal default is public)");
  const signup = posted.find((r) => r.url.endsWith("/auth/signup"));
  if (!signup || Object.keys(JSON.parse(signup.body)).sort().join() !== "email,name,password") fail(`signup posted ${signup?.body}`);
  console.log(`  ${beaGuest.name} is now ${beaAcct.name} (${beaAcct.id}) and still has ${made.name}, now in COMMUNITY`);

  console.log("4. under 13");
  const kid = await page("kid");
  await asGuest(kid);
  await tap(kid, 1920 - 40 - 110, 30 + 38);
  await on(kid, "SignInScreen");
  await button(kid, "email"); await button(kid, "switch");
  const youngYear = String(YEAR - 10);
  await kid.fill("#overlay input", youngYear);
  await button(kid, "next");
  if (!(await hasButton(kid, "play"))) fail("an under-13 year didn't end at KEEP PLAYING");
  if (await kid.locator("#overlay input").count()) fail("the under-13 screen left a text field up");
  await shot(kid, "signup-under-13");
  await button(kid, "play");
  await on(kid, "TitleScreen");
  await kid.mouse.move(2, 2);
  await tap(kid, 1920 - 40 - 110, 30 + 38);
  await on(kid, "SignInScreen");
  await button(kid, "email"); await button(kid, "switch");
  if (!(await hasButton(kid, "play"))) fail("going back offered the birth year again");
  await kid.reload();
  await on(kid, "TitleScreen");
  await kid.mouse.move(2, 2);
  await tap(kid, 1920 - 40 - 110, 30 + 38);
  await on(kid, "SignInScreen");
  await button(kid, "email"); await button(kid, "switch");
  if (!(await hasButton(kid, "play"))) fail("a reload offered the birth year again");
  const kidStorage = await kid.evaluate(() => Object.fromEntries(Object.entries(localStorage)));
  if (JSON.stringify(kidStorage).includes(youngYear)) fail(`the year is in localStorage: ${JSON.stringify(kidStorage)}`);
  const leaked = posted.filter((r) => r.body.includes(youngYear) || (r.who === "kid" && r.url.includes("/auth/") && !r.url.endsWith("/auth/guest")));
  if (leaked.length) fail(`the server was told: ${JSON.stringify(leaked).slice(0, 400)}`);
  const kidEvents = fs.readFileSync(path.join(data, "events.jsonl"), "utf8");
  if (kidEvents.includes(`"${youngYear}"`)) fail("the year is in the event store");
  console.log("  no account; asked again after BACK and a reload: refused both times; nothing about it reached the server");

  console.log("5. the month, the day, and the OAuth buttons");
  const mo = await page("mo");
  await asGuest(mo);
  await tap(mo, 1920 - 40 - 110, 30 + 38);
  await on(mo, "SignInScreen");
  await button(mo, "email"); await button(mo, "switch");
  await mo.fill("#overlay input", String(YEAR - 13));
  await button(mo, "next");
  if (!(await hasButton(mo, "month1"))) fail("the year turning 13 didn't ask the month");
  await shot(mo, "signup-age-month");
  await button(mo, `month${MONTH}`);
  if (await mo.locator("#overlay input").count() !== 2) fail("this month didn't ask the day");
  await shot(mo, "signup-age-day");
  await button(mo, "back");
  await mo.route(/discord\.com|accounts\.google\.com/, (r) => r.fulfill({ status: 200, contentType: "text/html", body: "<p>provider</p>" }));
  for (const id of ["discord", "google"]) {
    await mo.goto(base);
    if (id === "google") {
      // back without a token: the door says why, and BACK plays on as the same guest
      await on(mo, "SignInScreen");
      const why = await mo.evaluate(() => window.sketchbattle.screen.error);
      if (!/Discord sign-in didn't finish/.test(why)) fail(`back from Discord with nothing, the door says "${why}"`);
      await shot(mo, "signin-unfinished");
      await button(mo, "back");
    }
    await on(mo, "TitleScreen");
    await mo.mouse.move(2, 2);
    await tap(mo, 1920 - 40 - 110, 30 + 38);
    await on(mo, "SignInScreen");
    await Promise.all([mo.waitForURL(/discord\.com|accounts\.google\.com/), button(mo, id)]);
    const host = new URL(mo.url()).host;
    if (!host.includes(id === "discord" ? "discord.com" : "google.com")) fail(`${id} went to ${mo.url()}`);
  }
  console.log("  the year turning 13 asks the month; this month asks the day; DISCORD and GOOGLE leave for the provider at once");

  console.log("6. a signed-in session, and signing out");
  const zed = await page("zed");
  await zed.goto(`${base}?dev=Zed`);
  await on(zed, "TitleScreen");
  await zed.goto(base);
  await on(zed, "TitleScreen");
  const zedP = await player(zed);
  if (zedP.id !== "dev-zed") fail(`a returning signed-in player came back as ${JSON.stringify(zedP)}`);
  await choose(zed, "settings");
  await on(zed, "SettingsScreen");
  await shot(zed, "settings-signed-in");
  await button(zed, "signout");
  await on(zed, "TitleScreen");
  const after = await player(zed);
  if (!after?.id.startsWith("guest-")) fail(`signing out left ${JSON.stringify(after)}`);
  await choose(zed, "settings");
  await on(zed, "SettingsScreen");
  if (await hasButton(zed, "signout")) fail("a guest is offered SIGN OUT");
  await shot(zed, "settings-guest");
  console.log(`  dev-zed reopened untouched; SIGN OUT made ${after.name} (${after.id})`);

  console.log("7. the static pages");
  for (const [vp, label] of [[{ width: 1280, height: 800 }, "desktop"], [{ width: 390, height: 844 }, "phone"]]) {
    const p = await page(`pages-${label}`, vp);
    for (const url of ["privacy", "terms", "privacy.html"]) {
      const res = await p.goto(`${base}${url}`);
      if (!res.ok()) fail(`${url}: HTTP ${res.status()}`);
      const h1 = await p.locator("h1").innerText();
      if (!/privacy|terms/i.test(h1)) fail(`${url} has heading ${h1}`);
      const font = await p.evaluate(() => document.fonts.check("20px 'Patrick Hand'"));
      if (!font) fail(`${url}: Patrick Hand didn't load`);
      const wide = await p.evaluate(() => document.documentElement.scrollWidth > innerWidth);
      if (wide) fail(`${url} scrolls sideways on ${label}`);
      if (url !== "privacy.html") await p.screenshot({ path: path.join(shots ?? os.tmpdir(), `${url}-${label}.png`), fullPage: true });
    }
    if (label === "phone") {
      await p.goto(base);
      await on(p, "TitleScreen");
      await shot(p, "title-guest-phone");
      await tap(p, 1920 - 40 - 110, 30 + 38);
      await on(p, "SignInScreen");
      await shot(p, "signin-door-phone");
    }
  }
  console.log("  privacy, terms and privacy.html load in the paper look on desktop and phone, no sideways scroll");

  if (errors.length) fail(`page errors:\n${errors.join("\n")}`);
  console.log("PASS frontdoorcheck");
} catch (error) {
  console.error("FAIL frontdoorcheck");
  console.error(error instanceof Error ? error.stack : error);
  if (errorsSeen.length) console.error(`page errors:\n${errorsSeen.slice(0, 10).join("\n")}`);
  for (const { log } of children) console.error(log().split("\n").slice(-25).join("\n"));
  process.exitCode = 1;
} finally {
  await browser?.close();
  for (const { child } of children) process.kill(-child.pid);
  await new Promise((r) => setTimeout(r, 500));
  fs.rmSync(data, { recursive: true, force: true });
}
