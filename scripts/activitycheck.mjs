// The Discord Activity end to end, with Discord stubbed: the page's SDK (?activity=stub, dev builds only) and
// Discord's API (scripts/fake-discord.mjs, which a DEV_LOGIN server reaches through DISCORD_API). Starts its own
// fake Discord, server and Vite, then:
//   1. Ann and Bob open the same launch: both sign in with no sign-in screen, land in one room, and play a match
//      over the relay with no RTCPeerConnection ever made; their session events say discord-activity.
//   2. Cat opens another launch and lands in a room of her own.
//   3. Dee and Eve play the plain website (?dev=, BATTLE, CREATE LOBBY, JOIN ROOM): peer links are tried as before,
//      and nothing about the Activity shows.
// Usage: node scripts/activitycheck.mjs [--shots <dir>]
import { chromium } from "playwright";
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startFakeDiscord, fakeUserId } from "./fake-discord.mjs";
import { openOnline } from "./menu-nav.mjs";

const SERVER_PORT = Number(process.env.SERVER_PORT ?? 3029), VITE_PORT = Number(process.env.VITE_PORT ?? 5199), SECRET = "activitycheck-secret";
const shotsAt = process.argv.indexOf("--shots");
const shots = shotsAt > 0 ? process.argv[shotsAt + 1] : null;
const data = fs.mkdtempSync(path.join(os.tmpdir(), "activitycheck-"));
const base = `http://localhost:${VITE_PORT}/sketch-battle/`;
const children = [];
const fail = (message) => { throw new Error(message); };

function run(cmd, args, env) {
  // its own process group: npx's children go down with it
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

/** Counts RTCPeerConnections the page makes, and keeps the socket and request URLs it opens. */
const WATCH = () => {
  window.__made = { rtc: 0, sockets: [] };
  const Rtc = window.RTCPeerConnection;
  window.RTCPeerConnection = class extends Rtc { constructor(...a) { super(...a); window.__made.rtc++; } };
  const Ws = window.WebSocket;
  window.WebSocket = class extends Ws { constructor(url, p) { super(url, p); window.__made.sockets.push(String(url)); } };
};

let browser;
const fake = await startFakeDiscord({ secret: SECRET });
try {
  run("npx", ["tsx", "server/index.ts"], { PORT: String(SERVER_PORT), SKETCHBATTLE_DATA: data, DEV_LOGIN: "1", DISCORD_API: fake.api, DISCORD_CLIENT_SECRET: SECRET, FORGE_TOKEN: "" });
  await up(`http://localhost:${SERVER_PORT}/api/health`, "server");
  run("npx", ["vite", "--config", "client/vite.config.ts", "--port", String(VITE_PORT), "--strictPort"], { SKETCHBATTLE_SERVER: `http://localhost:${SERVER_PORT}` });
  await up(base, "vite");

  browser = await chromium.launch();
  const errors = [];
  async function page(name, url) {
    const p = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
    p.on("pageerror", (e) => errors.push(`${name}: ${e.message}`));
    p.on("console", (m) => { if (m.type() === "error") errors.push(`${name} console: ${m.text()}`); });
    await p.addInitScript(WATCH);
    if (url) await p.goto(url);
    return p;
  }
  const inLobby = (p, n) => p.waitForFunction((n) => window.sketchbattle?.screen?.lobbyDebug?.()?.members.length === n, n, { timeout: 20000 });
  const roomOf = (p) => p.evaluate(() => { const s = window.sketchbattle.screen; return { code: s.roomCode, call: !!s.context.room.call, screen: s.constructor.name }; });
  async function playMatch(pages, label) {
    for (const [i, p] of pages.entries()) await p.evaluate((id) => {
      window.sketchbattle.screen.pick({ id, name: id.toUpperCase(), bundleUrl: `/sketch-battle/house/${id}/bundle.json?v=${window.sketchbattle.build}`, house: true, entry: null });
    }, ["rocket", "wizard"][i]);
    await Promise.all(pages.map((p) => p.waitForFunction(() => window.sketchbattle.screen.lobbyDebug().members.every((m) => m.fighter))));
    for (const p of pages) await p.evaluate(() => window.sketchbattle.screen.toggleReady());
    await pages[0].waitForFunction(() => window.sketchbattle.screen.canStart());
    await pages[0].evaluate(() => window.sketchbattle.screen.startMatch({ stage: "rooftops", stocks: 3, time: 0, map: null }));
    await Promise.all(pages.map((p) => p.waitForFunction(() => typeof window.sketchbattle.screen.netDebug === "function", null, { timeout: 20000 })));
    // the countdown
    await pages[0].waitForTimeout(3800);
    for (let round = 0; round < 8; round++) {
      const key = round % 2 ? "KeyA" : "KeyD";
      await Promise.all(pages.map(async (p) => { await p.keyboard.down(key); await p.waitForTimeout(500); await p.keyboard.up(key); await p.keyboard.press("Space"); }));
    }
    const [a, b] = await Promise.all(pages.map((p) => p.evaluate(() => window.sketchbattle.screen.netDebug())));
    const frame = Math.min(a.frame, b.frame);
    if (frame < 200) fail(`${label}: the match only reached frame ${frame}`);
    const hashes = await Promise.all(pages.map((p) => p.evaluate((f) => window.sketchbattle.screen.netDebug(f).hash, frame)));
    if (hashes[0] === null || hashes[0] !== hashes[1]) fail(`${label}: hashes at frame ${frame} were ${hashes.join(" vs ")}`);
    console.log(`  ${label}: match ran to frame ${frame}, both hashed ${hashes[0]}`);
    return pages[0].evaluate(() => window.sketchbattle.screen.opts.telemetry.trace);
  }
  const made = (p) => p.evaluate(() => window.__made);

  console.log("1. one launch, two players");
  const call = (as, instance = "one") => `${base}?activity=stub&instance=${instance}&as=${as}`;
  const ann = await page("Ann", call("Ann"));
  await inLobby(ann, 1);
  const bob = await page("Bob", call("Bob"));
  await Promise.all([inLobby(ann, 2), inLobby(bob, 2)]);
  const [annRoom, bobRoom] = await Promise.all([roomOf(ann), roomOf(bob)]);
  if (annRoom.code !== bobRoom.code || !annRoom.call) fail(`not one call room: ${JSON.stringify([annRoom, bobRoom])}`);
  const players = await Promise.all([ann, bob].map((p) => p.evaluate(() => JSON.parse(localStorage.getItem("sketchbattle.account")).player)));
  if (players[0].id !== fakeUserId("Ann") || players[1].id !== fakeUserId("Bob")) fail(`signed in as ${JSON.stringify(players)}, not the Discord users`);
  console.log(`  both in room ${annRoom.code} (call room), signed in as Discord users ${players.map((p) => p.id).join(", ")}`);
  if (shots) { fs.mkdirSync(shots, { recursive: true }); await ann.screenshot({ path: path.join(shots, "call-lobby.png") }); }
  const callTrace = await playMatch([ann, bob], "call room");
  if (shots) await bob.screenshot({ path: path.join(shots, "call-match.png") });
  for (const [name, p] of [["Ann", ann], ["Bob", bob]]) {
    const m = await made(p);
    if (m.rtc !== 0) fail(`${name} made ${m.rtc} RTCPeerConnections`);
    // besides the relay, only Vite's own dev socket
    const relay = m.sockets.filter((u) => new URL(u).pathname === "/sketch-battle/ws");
    if (!relay.length || m.sockets.some((u) => !relay.includes(u) && !new URL(u).searchParams.has("token"))) fail(`${name} opened sockets ${m.sockets.join(", ")}`);
  }
  console.log("  no RTCPeerConnection on either page; every socket was the relay");

  console.log("2. another launch");
  const cat = await page("Cat", call("Cat", "two"));
  await inLobby(cat, 1);
  const catRoom = await roomOf(cat);
  if (catRoom.code === annRoom.code || !catRoom.call) fail(`Cat's launch landed in ${JSON.stringify(catRoom)}`);
  console.log(`  Cat is alone in room ${catRoom.code}`);

  console.log("3. the plain website");
  const dee = await page("Dee"), eve = await page("Eve");
  await openOnline(dee, base, "Dee");
  const battle = await dee.evaluate(() => window.sketchbattle.screen.items.map((i) => i.id));
  if (battle.includes("call")) fail(`the website's BATTLE menu offers ${battle.join(", ")}`);
  await dee.keyboard.press("ArrowDown"); await dee.waitForTimeout(120); await dee.keyboard.press("Enter"); await dee.waitForTimeout(120);
  await dee.keyboard.press("Enter");
  await dee.waitForFunction(() => typeof window.sketchbattle.screen.roomCode === "string");
  const code = await dee.evaluate(() => window.sketchbattle.screen.roomCode);
  await openOnline(eve, base, "Eve");
  for (let i = 0; i < 2; i++) { await eve.keyboard.press("ArrowDown"); await eve.waitForTimeout(120); }
  await eve.keyboard.press("Enter"); await eve.waitForTimeout(200);
  await eve.keyboard.type(code, { delay: 40 }); await eve.keyboard.press("Enter");
  await Promise.all([inLobby(dee, 2), inLobby(eve, 2)]);
  if ((await roomOf(dee)).call) fail("the website's room says it's a call room");
  const webTrace = await playMatch([dee, eve], "website room");
  const webMade = await Promise.all([dee, eve].map(made));
  if (webMade.some((m) => m.rtc === 0)) fail(`the website made no peer links: ${JSON.stringify(webMade.map((m) => m.rtc))}`);
  console.log(`  peer links tried as before (${webMade.map((m) => m.rtc).join(" and ")} RTCPeerConnections)`);

  for (const p of [ann, bob, cat, dee, eve]) await p.goto("about:blank");
  await new Promise((r) => setTimeout(r, 1500));
  const events = execFileSync("npx", ["tsx", "scripts/events.ts", "--data", data, "--kind", "session", "--json"], { encoding: "utf8" }).split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const byName = (name) => events.find((e) => e.client?.player?.name === name) ?? fail(`no session event for ${name}`);
  for (const name of ["Ann", "Bob", "Cat"]) {
    const s = byName(name);
    if (s.business.source?.visit?.ref !== "discord-activity") fail(`${name}'s session source is ${JSON.stringify(s.business.source?.visit)}`);
    if (!/^[0-9a-f]{32}$/.test(s.business.activity?.instance ?? "")) fail(`${name}'s session has activity ${JSON.stringify(s.business.activity)}`);
  }
  if (byName("Ann").business.activity.instance !== byName("Bob").business.activity.instance) fail("Ann and Bob's sessions name different launches");
  if (byName("Ann").business.activity.instance === byName("Cat").business.activity.instance) fail("Cat's session names Ann's launch");
  for (const name of ["Dee", "Eve"]) {
    const s = byName(name);
    if (s.business.activity || s.business.source?.visit?.ref) fail(`${name}'s website session has ${JSON.stringify({ activity: s.business.activity, ref: s.business.source?.visit?.ref })}`);
  }
  console.log("  sessions: Ann, Bob and Cat came from discord-activity (Ann and Bob on one launch), Dee and Eve from nowhere special");
  const matches = execFileSync("npx", ["tsx", "scripts/events.ts", "--data", data, "--kind", "match", "--json"], { encoding: "utf8" }).split("\n").filter(Boolean).map((l) => JSON.parse(l));
  for (const trace of [callTrace, webTrace]) if (!matches.some((e) => e.trace === trace && e.source === "server")) fail(`the relay has no match event on ${trace}`);
  if (errors.length) fail(`page errors:\n${errors.join("\n")}`);
  console.log("PASS activitycheck");
} catch (error) {
  console.error("FAIL activitycheck");
  console.error(error instanceof Error ? error.stack : error);
  for (const { log } of children) console.error(log().split("\n").slice(-25).join("\n"));
  process.exitCode = 1;
} finally {
  await browser?.close();
  fake.close();
  for (const { child } of children) process.kill(-child.pid);
  fs.rmSync(data, { recursive: true, force: true });
}
