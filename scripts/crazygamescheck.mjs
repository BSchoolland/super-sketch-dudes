// The CrazyGames build end to end, with CrazyGames stubbed: the page's SDK (?crazygames=stub, dev builds only) and
// CrazyGames' token keys (scripts/fake-crazygames.mjs, which a DEV_LOGIN server trusts through CRAZYGAMES_JWKS).
// Starts its own fake CrazyGames, server (scratch data dir), Vite and scripts/fake-forge.mjs, then:
//   1. a guest lands on the title: loading events, no Discord/Google/email anywhere, privacy/terms open in a new tab
//      and link nowhere but each other (no way to the website's copy of the game)
//   2. the guest plays VS BOTS (gameplay start/stop around the match and its pause, happytime on the win) and draws a
//      character (gameplay while drawing)
//   3. the guest logs in to CrazyGames from SIGN IN: they're crazygames-<id>, named by CrazyGames, and keep the
//      character; a reload logged in keeps them; SETTINGS has no CHANGE NAME or SIGN OUT; a failed login shows the
//      CrazyGames door (SIGN IN WITH CRAZYGAMES, BACK, nothing else)
//   4. instant multiplayer: Ann lands in a private room, tells CrazyGames about it, INVITE copies a link; Bob opens the
//      link logged in and lands in her room; both see CrazyGames names; they play a match; Cat accepts an invite from
//      CrazyGames' UI while on the title and lands there too
//   5. every page asked nothing of any host but this one; the session events say crazygames
// Usage: node scripts/crazygamescheck.mjs [--shots <dir>]   (SERVER_PORT, VITE_PORT override 3431 / 5631)
import { chromium } from "playwright";
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fakeCrazyGamesUserId, startFakeCrazyGames } from "./fake-crazygames.mjs";

const SERVER_PORT = Number(process.env.SERVER_PORT ?? 3431), VITE_PORT = Number(process.env.VITE_PORT ?? 5631), TOKEN = "devtoken", GAME = "crazygamescheck";
const shotsAt = process.argv.indexOf("--shots");
const shots = shotsAt > 0 ? process.argv[shotsAt + 1] : null;
const data = fs.mkdtempSync(path.join(os.tmpdir(), "crazygamescheck-"));
const origin = `http://localhost:${VITE_PORT}`, base = `${origin}/`;
const children = [];
const fail = (message) => { throw new Error(message); };
const ACCOUNT_KEY = "sketchbattle.crazygames.account";

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
const fake = await startFakeCrazyGames({ gameId: GAME });
try {
  run("npx", ["tsx", "server/index.ts"], { PORT: String(SERVER_PORT), SKETCHBATTLE_DATA: data, DEV_LOGIN: "1", FORGE_TOKEN: TOKEN, CRAZYGAMES_JWKS: fake.jwks, CRAZYGAMES_GAME_ID: GAME });
  await up(`http://localhost:${SERVER_PORT}/api/health`, "server");
  run("npx", ["vite", "--config", "client/vite.config.ts", "--port", String(VITE_PORT), "--strictPort"], { SKETCHBATTLE_SERVER: `http://localhost:${SERVER_PORT}` });
  await up(base, "vite");
  run("node", ["scripts/fake-forge.mjs", `http://localhost:${SERVER_PORT}`, TOKEN]);

  browser = await chromium.launch();
  const errors = errorsSeen;
  /** Hosts a page asked for that aren't this site or the fake CrazyGames. */
  const offsite = [];
  const fakeHost = new URL(fake.url).host;
  async function page(name, url) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin });
    const p = await context.newPage();
    p.on("pageerror", (e) => errors.push(`${name}: ${e.message}`));
    // the dud's login is meant to fail: the fake won't mint for its name
    const expected = name === "dud" ? /sign-in failed|wouldn't mint|status of 400/ : null;
    p.on("console", (m) => { if (m.type() === "error" && !expected?.test(m.text())) errors.push(`${name} console: ${m.text()}`); });
    p.on("request", (r) => { const host = new URL(r.url()).host; if (!["", `localhost:${VITE_PORT}`, fakeHost].includes(host) && !r.url().startsWith("data:")) offsite.push(`${name}: ${r.url()}`); });
    if (url) await p.goto(url);
    return p;
  }
  const stub = (extra = "") => `${base}?crazygames=stub&cgapi=${encodeURIComponent(fake.url)}${extra}`;
  const shot = async (p, name) => { if (shots) { fs.mkdirSync(shots, { recursive: true }); await p.waitForTimeout(300); await p.screenshot({ path: path.join(shots, `${name}.png`) }); } };
  const screen = (p) => p.evaluate(() => window.sketchbattle?.screen?.constructor.name);
  const on = (p, name, ms = 20000) => p.waitForFunction((n) => window.sketchbattle?.screen?.constructor.name === n, name, { timeout: ms }).catch(async () => { await p.screenshot({ path: path.join(os.tmpdir(), "crazygamescheck-timeout.png") }); fail(`waited for ${name}, on ${await screen(p)} (${path.join(os.tmpdir(), "crazygamescheck-timeout.png")})`); });
  const player = (p) => p.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? "null")?.player ?? null, ACCOUNT_KEY);
  const sessionOf = (p) => p.evaluate((k) => JSON.parse(localStorage.getItem(k)).session, ACCOUNT_KEY);
  const calls = (p) => p.evaluate(() => window.__crazygames.calls.slice());
  const at = async (p, x, y) => { const v = p.viewportSize(), s = Math.min(v.width / 1920, v.height / 1080); return [(v.width - 1920 * s) / 2 + x * s, (v.height - 1080 * s) / 2 + y * s]; };
  const tap = async (p, x, y) => { const [px, py] = await at(p, x, y); await p.mouse.click(px, py); await p.waitForTimeout(150); };
  const press = async (p, key, n = 1) => { for (let i = 0; i < n; i++) { await p.keyboard.press(key); await p.waitForTimeout(120); } };
  const buttonIds = (p) => p.evaluate(() => window.sketchbattle.screen.buttons?.().map((b) => b.id) ?? []);
  const button = async (p, id) => {
    const b = await p.evaluate((id) => window.sketchbattle.screen.buttons().find((b) => b.id === id), id);
    if (!b) fail(`no ${id} button on ${await screen(p)}`);
    await tap(p, b.x + b.w / 2, b.y + b.h / 2);
  };
  const noAccountsButOurs = async (p, where) => {
    const ids = await buttonIds(p);
    const bad = ids.filter((id) => ["discord", "google", "email", "signout", "name"].includes(id));
    if (bad.length) fail(`${where} offers ${bad.join(", ")}`);
  };
  async function choose(p, id) {
    await p.waitForFunction(() => window.sketchbattle.screen.items?.some((i) => i.id === "maps"), null, { timeout: 10000 });
    await p.evaluate((id) => { const s = window.sketchbattle.screen; s.sel = s.items.findIndex((i) => i.id === id); }, id);
    await press(p, "Enter");
  }
  const pickHouse = (p, id) => p.evaluate((id) => window.sketchbattle.screen.pick({ id, name: id.toUpperCase(), bundleUrl: `/house/${id}/bundle.json?v=${window.sketchbattle.build}`, house: true, entry: null }), id);
  const inLobby = (p, n) => p.waitForFunction((n) => window.sketchbattle?.screen?.lobbyDebug?.()?.members.length === n, n, { timeout: 20000 });
  const SIGN_IN = [1920 - 40 - 110, 30 + 38];

  console.log("1. a guest arrives");
  const bea = await page("bea", stub("&login=Bea_Stub"));
  await on(bea, "TitleScreen");
  await bea.mouse.move(2, 2);
  const beaGuest = await player(bea);
  if (!beaGuest?.id.startsWith("guest-")) fail(`a new CrazyGames player is ${JSON.stringify(beaGuest)}, not a guest`);
  if (await bea.evaluate(() => localStorage.getItem("sketchbattle.account"))) fail("the CrazyGames build wrote the website's account key");
  await bea.waitForFunction(() => window.__crazygames.calls.includes("loadingStop"));
  const first = await calls(bea);
  if (first[0] !== "loadingStart" || first.indexOf("loadingStop") < 0) fail(`the SDK was told ${first.join(", ")}`);
  await bea.waitForTimeout(1200);
  await shot(bea, "01-title-guest");
  const [popup] = await Promise.all([bea.waitForEvent("popup"), tap(bea, 22 + 30, 1080 - 20)]);
  await popup.waitForLoadState();
  if (new URL(popup.url()).pathname !== "/privacy") fail(`privacy opened ${popup.url()}`);
  const links = await popup.evaluate(() => [...document.querySelectorAll("a")].map((a) => a.href));
  if (links.some((href) => !href.startsWith("mailto:") && !/\/(privacy|terms)\?from=crazygames$/.test(href))) fail(`the privacy page from CrazyGames links ${links.join(", ")}`);
  if (shots) await popup.screenshot({ path: path.join(shots, "01b-privacy-from-crazygames.png"), fullPage: true });
  if (!(await screen(bea))) fail("clicking privacy navigated the game away");
  await popup.close();
  console.log(`  ${beaGuest.name} (${beaGuest.id}); loadingStart, loadingStop; privacy opens in a new tab and the game stays`);

  console.log("2. the guest plays VS BOTS, then draws");
  await choose(bea, "battle");
  await on(bea, "BattleMenuScreen");
  await noAccountsButOurs(bea, "BATTLE");
  await press(bea, "ArrowDown", 3); await press(bea, "Enter");
  await inLobby(bea, 1);
  if ((await calls(bea)).some((c) => c.startsWith("updateRoom"))) fail("a VS BOTS room was offered to CrazyGames to invite into");
  await pickHouse(bea, "rocket");
  await bea.waitForFunction(() => window.sketchbattle.screen.canStart(), null, { timeout: 20000 });
  await bea.evaluate(() => window.sketchbattle.screen.startMatch({ stage: "rooftops", stocks: 3, time: 0, map: null }));
  await on(bea, "VersusScreen", 30000);
  await bea.waitForTimeout(5000);
  if (!(await calls(bea)).includes("gameplayStart")) fail("no gameplayStart in a match");
  await shot(bea, "02-bots-match-guest");
  await press(bea, "Escape");
  await bea.waitForTimeout(300);
  if ((await calls(bea)).at(-1) !== "gameplayStop") fail(`pausing left the SDK at ${(await calls(bea)).at(-1)}`);
  await press(bea, "Enter");
  await bea.waitForTimeout(300);
  if ((await calls(bea)).at(-1) !== "gameplayStart") fail("RESUME didn't start gameplay again");
  // the bot runs out of stocks: Bea, on this computer, wins
  await bea.evaluate(() => { window.sketchbattle.screen.match.state.fighters[1].stocks = 0; });
  await bea.waitForFunction(() => window.sketchbattle.screen.match.state.ended);
  await bea.waitForTimeout(300);
  const won = (await calls(bea)).filter((c) => c.startsWith("gameplay") || c === "happytime");
  if (won.at(-1) !== "happytime" || won.at(-2) !== "gameplayStop" || won.filter((c) => c === "happytime").length !== 1) fail(`winning told the SDK ${won.join(", ")}`);
  await shot(bea, "02b-bots-match-won");
  await bea.waitForTimeout(1300);
  await press(bea, "Escape");
  await bea.waitForFunction(() => window.sketchbattle.screen.constructor.name !== "VersusScreen");
  await bea.waitForTimeout(300);
  if ((await calls(bea)).filter((c) => c.startsWith("gameplay")).at(-1) !== "gameplayStop") fail("leaving the match left gameplay on");
  for (let i = 0; i < 4 && (await screen(bea)) !== "TitleScreen"; i++) { await press(bea, "Escape"); await bea.waitForTimeout(300); }
  await on(bea, "TitleScreen");
  await choose(bea, "create");
  await on(bea, "CreateScreen");
  await bea.waitForTimeout(200);
  if ((await calls(bea)).at(-1) !== "gameplayStart") fail("drawing isn't gameplay");
  const stroke = async (pts) => { await bea.mouse.move(...await at(bea, ...pts[0])); await bea.mouse.down(); for (const q of pts.slice(1)) await bea.mouse.move(...await at(bea, ...q), { steps: 4 }); await bea.mouse.up(); };
  await stroke(Array.from({ length: 29 }, (_, i) => [960 + Math.cos(i / 28 * Math.PI * 2) * 90, 330 + Math.sin(i / 28 * Math.PI * 2) * 90]));
  await stroke([[960, 420], [960, 700]]); await stroke([[960, 520], [820, 460]]); await stroke([[960, 520], [1110, 600]]);
  await stroke([[960, 700], [860, 950]]); await stroke([[960, 700], [1060, 950]]);
  await shot(bea, "03-drawing-guest");
  await button(bea, "done");
  await on(bea, "DescribeScreen");
  await bea.waitForTimeout(200);
  if ((await calls(bea)).at(-1) !== "gameplayStop") fail("naming the drawing is still gameplay");
  await bea.fill("#overlay input", "STICK GUEST");
  await button(bea, "send");
  await on(bea, "LibraryScreen");
  await bea.waitForFunction(() => (window.sketchbattle.screen.entries ?? []).some((e) => e.status === "ready"), null, { timeout: 60000 });
  const made = await bea.evaluate(() => window.sketchbattle.screen.entries.find((e) => e.status === "ready"));
  console.log(`  VS BOTS: gameplayStart, gameplayStop on pause, start on resume, stop and one happytime on a win; drawing is gameplay; ${made.name} forged (${made.id})`);

  console.log("3. the guest logs in to CrazyGames");
  for (let i = 0; i < 3 && (await screen(bea)) !== "TitleScreen"; i++) await press(bea, "Escape");
  await on(bea, "TitleScreen");
  await bea.mouse.move(2, 2);
  await tap(bea, ...SIGN_IN);
  await bea.waitForFunction((k) => JSON.parse(localStorage.getItem(k))?.player?.id.startsWith("crazygames-"), ACCOUNT_KEY, { timeout: 15000 });
  await on(bea, "TitleScreen");
  const beaCg = await player(bea);
  if (beaCg.id !== `crazygames-${fakeCrazyGamesUserId("Bea_Stub")}` || beaCg.name !== "Bea_Stub") fail(`logged in as ${JSON.stringify(beaCg)}`);
  if (!(await calls(bea)).includes("showAuthPrompt")) fail("SIGN IN didn't ask CrazyGames' login prompt");
  const libraryOf = async (p) => (await (await fetch(`${base}api/library`, { headers: { "x-session": await sessionOf(p) } })).json()).characters;
  const kept = (await libraryOf(bea)).find((c) => c.id === made.id);
  if (!kept || kept.owner !== beaCg.id) fail(`after logging in the library has ${JSON.stringify((await libraryOf(bea)).map((c) => [c.id, c.owner]))}`);
  await bea.waitForTimeout(1200);
  await shot(bea, "04-title-crazygames-user");
  await bea.goto(stub("&user=Bea_Stub"));
  await on(bea, "TitleScreen");
  if ((await player(bea)).id !== beaCg.id) fail(`a reload logged in is ${JSON.stringify(await player(bea))}`);
  if (!(await libraryOf(bea)).some((c) => c.id === made.id)) fail("the character is gone after a reload");
  await choose(bea, "settings");
  await on(bea, "SettingsScreen");
  await noAccountsButOurs(bea, "SETTINGS");
  await shot(bea, "05-settings-crazygames-user");
  console.log(`  ${beaGuest.name} is ${beaCg.name} (${beaCg.id}), still with ${made.name}; again after a reload; no CHANGE NAME or SIGN OUT`);
  // a login CrazyGames can't vouch for (the fake won't mint for this name): the CrazyGames door, with why
  const dud = await page("dud", stub("&login=not%20a%20name"));
  await on(dud, "TitleScreen");
  await dud.mouse.move(2, 2);
  await tap(dud, ...SIGN_IN);
  await on(dud, "SignInScreen");
  const door = await buttonIds(dud);
  if (door.join() !== "crazygames,back") fail(`the CrazyGames sign-in door has ${door.join(", ")}`);
  if (!/mint/.test(await dud.evaluate(() => window.sketchbattle.screen.error))) fail(`the door says "${await dud.evaluate(() => window.sketchbattle.screen.error)}"`);
  await shot(dud, "06-signin-door-error");
  await button(dud, "back");
  await on(dud, "TitleScreen");
  if (!(await player(dud)).id.startsWith("guest-")) fail("BACK from a failed login isn't the guest");
  console.log("  a failed login shows SIGN IN WITH CRAZYGAMES and BACK only, with the reason; BACK plays on as the guest");

  console.log("4. instant multiplayer and an invite link");
  const ann = await page("ann", stub("&user=Ann_Stub&instantJoin=true"));
  await inLobby(ann, 1);
  const code = await ann.evaluate(() => window.sketchbattle.screen.roomCode);
  const room = await ann.evaluate(() => window.__crazygames.room);
  if (JSON.stringify(room) !== JSON.stringify({ roomId: code, isJoinable: true, inviteParams: { room: code } })) fail(`CrazyGames was told the room is ${JSON.stringify(room)}`);
  if (!(await ann.evaluate(() => window.sketchbattle.screen.context.room.public === false))) fail("instant multiplayer's room is public");
  await ann.mouse.move(2, 2);
  await tap(ann, 1920 - 40 - 110, 22 + 32);
  await ann.waitForFunction(() => window.sketchbattle.screen.invited);
  const invited = await ann.evaluate(() => window.sketchbattle.screen.invited);
  if (invited.error) fail(`INVITE: ${invited.text}`);
  const link = await ann.evaluate(() => navigator.clipboard.readText());
  if (new URLSearchParams(new URL(link).searchParams.get("czy_invite_params") ?? "").get("room") !== code) fail(`INVITE copied ${link}`);
  await shot(ann, "07-lobby-invite-copied");
  const bob = await page("bob", `${link}&user=Bob_Stub`);
  await Promise.all([inLobby(ann, 2), inLobby(bob, 2)]);
  if ((await bob.evaluate(() => window.sketchbattle.screen.roomCode)) !== code) fail("Bob's invite landed somewhere else");
  const names = await ann.evaluate(() => window.sketchbattle.screen.context.room.members.map((m) => m.name));
  if (names.join() !== "Ann_Stub,Bob_Stub") fail(`the lobby shows ${names.join(", ")}, not the CrazyGames names`);
  await shot(bob, "08-lobby-two-crazygames-users");
  console.log(`  Ann landed in private room ${code}, CrazyGames knows it; INVITE copied ${link.replace(fake.url, "<fake>")}; Bob opened it and is in`);
  const cat = await page("cat", stub());
  await on(cat, "TitleScreen");
  await cat.evaluate((code) => window.__crazygames.join({ room: code }), code);
  await Promise.all([inLobby(ann, 3), inLobby(cat, 3)]);
  console.log("  Cat, a guest on the title, accepted an invite from CrazyGames' UI and is in too");
  await cat.evaluate(() => window.sketchbattle.screen.leave());
  await Promise.all([inLobby(ann, 2), inLobby(bob, 2)]);
  await pickHouse(ann, "rocket"); await pickHouse(bob, "wizard");
  await Promise.all([ann, bob].map((p) => p.waitForFunction(() => window.sketchbattle.screen.lobbyDebug().members.every((m) => m.fighter))));
  for (const p of [ann, bob]) await p.evaluate(() => window.sketchbattle.screen.toggleReady());
  await ann.waitForFunction(() => window.sketchbattle.screen.canStart());
  await ann.evaluate(() => window.sketchbattle.screen.startMatch({ stage: "rooftops", stocks: 3, time: 0, map: null }));
  await Promise.all([ann, bob].map((p) => p.waitForFunction(() => typeof window.sketchbattle.screen.netDebug === "function", null, { timeout: 20000 })));
  await ann.waitForTimeout(3800);
  for (let round = 0; round < 6; round++) await Promise.all([ann, bob].map(async (p) => { await p.keyboard.down(round % 2 ? "KeyA" : "KeyD"); await p.waitForTimeout(400); await p.keyboard.up(round % 2 ? "KeyA" : "KeyD"); await p.keyboard.press("Space"); }));
  await ann.waitForTimeout(1000);
  const frames = await Promise.all([ann, bob].map((p) => p.evaluate(() => window.sketchbattle.screen.netDebug().frame)));
  const f = Math.min(...frames) - 10;
  const hashes = await Promise.all([ann, bob].map((p) => p.evaluate((f) => window.sketchbattle.screen.netDebug(f).hash, f)));
  if (f < 150 || hashes[0] === null || hashes[0] !== hashes[1]) fail(`the match: frames ${frames}, hashes at ${f} ${hashes.join(" vs ")}`);
  for (const [name, p] of [["Ann", ann], ["Bob", bob]]) if (!(await calls(p)).includes("gameplayStart")) fail(`${name}'s match never started gameplay`);
  await shot(ann, "09-match-crazygames-users");
  console.log(`  Ann_Stub vs Bob_Stub played to frame ${Math.min(...frames)}, hashes agree at ${f}`);

  console.log("5. off-site requests and session events");
  if (offsite.length) fail(`pages asked other hosts:\n${offsite.slice(0, 10).join("\n")}`);
  for (const p of [ann, bob, cat, bea, dud]) await p.goto("about:blank");
  await new Promise((r) => setTimeout(r, 1500));
  const sessions = execFileSync("npx", ["tsx", "scripts/events.ts", "--data", data, "--kind", "session", "--json"], { encoding: "utf8" }).split("\n").filter(Boolean).map((l) => JSON.parse(l));
  if (!sessions.length) fail("no session events");
  const wrong = sessions.filter((s) => s.business.source?.visit?.ref !== "crazygames" || s.business.crazygames?.environment !== "crazygames");
  if (wrong.length) fail(`sessions not from crazygames: ${JSON.stringify(wrong.map((s) => [s.business.source?.visit, s.business.crazygames]))}`);
  if (!sessions.some((s) => s.business.crazygames.instant) || !sessions.some((s) => s.business.crazygames.invited)) fail("no session says it was instant multiplayer or an invite");
  console.log(`  no page asked another host; all ${sessions.length} sessions say source crazygames`);

  if (errors.length) fail(`page errors:\n${errors.join("\n")}`);
  console.log("PASS crazygamescheck");
} catch (error) {
  console.error("FAIL crazygamescheck");
  console.error(error instanceof Error ? error.stack : error);
  if (errorsSeen.length) console.error(`page errors:\n${errorsSeen.slice(0, 10).join("\n")}`);
  for (const { log } of children) console.error(log().split("\n").slice(-25).join("\n"));
  process.exitCode = 1;
} finally {
  await browser?.close();
  fake.close();
  for (const { child } of children) process.kill(-child.pid);
  await new Promise((r) => setTimeout(r, 500));
  fs.rmSync(data, { recursive: true, force: true });
}
