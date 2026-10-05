// Net lab: plays a real online match between 2-4 headless Chromes, each in its own container behind its own
// shaped connection to a relay running this checkout, then reports it with the same numbers production logs.
// Usage: node netlab/run.mjs <scenario> [--minutes 3] [--seed 1] [--video <player>] [--post <discord thread id>]
//        [--net Name=profile ...] [--block Name=p2p|webrtc ...] [--at "<sec>:<action> <Name> [mode]" ...]
//        [--stocks 99] [--leave-out] [--shell] [--no-build] [--keep]
//   --block: `p2p` drops UDP between that player and the others (their links must go through TURN); `webrtc` drops
//            all UDP and TURN's TCP port too (no links at all: everything rides the relay).
//   --at: mid-match events: `block <Name> <mode>`, `unblock <Name>`, `cut <Name>` (all of its game traffic dropped:
//         the connection is gone), `leave <Name>` (closes the page, like quitting the tab).
//   --leave-out: a player whose fighter is out of stocks closes its page (the others carry on without them).
//   --shell: players load the swappable page (shell.html) on a game bundle built from this checkout; `--at <sec>:swap`
//            switches the room to a second copy of it mid-match, the way scripts/push-game.sh --room does.
// Needs Docker (the sketchbattle-netlab image builds itself) and production's event log + fighters cached:
// run `node netlab/prod.mjs events` once (fighters sync on demand). Output lands in netlab/runs/<stamp>-<scenario>/.
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { openOnline } from "../scripts/menu-nav.mjs";
import { syncFighter } from "./prod.mjs";
import { profile, rng, schedule } from "./profiles.mjs";
import { scenario } from "./scenarios.mjs";
import { netemArgs, Shaper } from "./shape.mjs";
import { renderTimeline } from "./timeline.mjs";
import { compareToProduction, formatMatches, matchStats, PROD_EVENTS, readEvents } from "./stats.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.dirname(HERE);
// tagged by the Dockerfile's content, so a changed Dockerfile builds a new image and never reuses a stale one
const IMAGE = `sketchbattle-netlab:${createHash("sha256").update(fs.readFileSync(path.join(HERE, "Dockerfile"))).digest("hex").slice(0, 12)}`;
const TURN_SECRET = "netlab";
const BASE = "/sketch-battle/";
const PORT = 3008;

// ---- arguments
const argv = process.argv.slice(2);
const opt = (name, fallback) => { const i = argv.indexOf(name); if (i < 0) return fallback; const v = argv[i + 1]; if (v === undefined || v.startsWith("--")) throw new Error(`${name} needs a value`); argv.splice(i, 2); return v; };
const opts = (name) => { const out = []; for (let v = opt(name); v !== undefined; v = opt(name)) out.push(v); return out; };
const has = (name) => { const i = argv.indexOf(name); if (i >= 0) argv.splice(i, 1); return i >= 0; };
const minutes = Number(opt("--minutes", "3"));
const seed = Number(opt("--seed", "1"));
const videoOf = opt("--video");
// --profile <player>: a CPU profile of that client over the fight (netlab/runs/<run>/<player>.cpuprofile, top functions in the report)
const profileOf = opt("--profile");
const postTo = opt("--post");
const netOverrides = Object.fromEntries(opts("--net").map((kv) => kv.split("=")));
const blockOverrides = Object.fromEntries(opts("--block").map((kv) => kv.split("=")));
const atEvents = opts("--at").map((spec) => {
  const swapAt = /^(\d+(?:\.\d+)?):swap$/.exec(spec);
  if (swapAt) return { atMs: Number(swapAt[1]) * 1000, action: "swap", name: null, mode: null };
  const m = /^(\d+(?:\.\d+)?):(block|unblock|cut|leave) (\S+)(?: (p2p|webrtc))?$/.exec(spec);
  if (!m || (m[2] === "block") !== !!m[4]) throw new Error(`--at "${spec}": want "<sec>:block <Name> p2p|webrtc", "<sec>:unblock|cut|leave <Name>", "<sec>:swap"`);
  return { atMs: Number(m[1]) * 1000, action: m[2], name: m[3], mode: m[4] ?? null };
});
const stocks = Number(opt("--stocks", "99"));
const leaveOut = has("--leave-out");
const shell = has("--shell");
const noBuild = has("--no-build"), keep = has("--keep");
const [scenarioName, ...rest] = argv;
if (!scenarioName || rest.length) throw new Error(`usage: node netlab/run.mjs <scenario> [--minutes 3] [--seed 1] [--video <player>] [--post <thread>] [--net Name=profile] [--no-build] [--keep]`);
const sc = scenario(scenarioName);

const sh = (cmd, args, o = {}) => execFileSync(cmd, args, { encoding: "utf8", ...o }).trim();
const docker = (...args) => sh("docker", args);
const log = (...a) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- what to replay
if (!fs.existsSync(PROD_EVENTS)) throw new Error(`no production events cached: run node netlab/prod.mjs events`);
const prodEvents = readEvents([PROD_EVENTS]);
const replay = prodEvents.find((e) => e.kind === "match" && e.source === "server" && e.trace === sc.replay);
if (!replay) throw new Error(`replay match ${sc.replay} isn't in the cached production log`);
const config = replay.business.match.config;
const players = replay.business.members.sort((a, b) => a.slot - b.slot).map((m) => {
  const net = netOverrides[m.name] ?? sc.net[m.name];
  if (!net) throw new Error(`scenario ${scenarioName} has no network profile for ${m.name}`);
  const block = blockOverrides[m.name] ?? sc.block?.[m.name] ?? null;
  if (block && !["p2p", "webrtc"].includes(block)) throw new Error(`${m.name}: block ${block}; want p2p or webrtc`);
  return { name: m.name, fighter: m.fighter, bundleUrl: m.bundleUrl, net, profile: profile(net), block };
}).map((p, _, all) => {
  if (sc.cpu) for (const name of Object.keys(sc.cpu)) if (!all.some((q) => q.name === name)) throw new Error(`cpu throttle for ${name}, who isn't in ${sc.replay}`);
  return p;
});
if (profileOf && !players.some((p) => p.name === profileOf)) throw new Error(`--profile ${profileOf}: no such player (${players.map((p) => p.name).join(", ")})`);
if (videoOf && !players.some((p) => p.name === videoOf)) throw new Error(`--video ${videoOf}: no such player (${players.map((p) => p.name).join(", ")})`);
for (const e of atEvents) if (e.name && !players.some((p) => p.name === e.name)) throw new Error(`--at: no player ${e.name}`);
if (atEvents.some((e) => e.action === "swap") && !shell) throw new Error("--at swap needs --shell");

const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const runDir = path.join(HERE, "runs", `${stamp}-${scenarioName}`);
const dataDir = path.join(runDir, "data");
fs.mkdirSync(path.join(dataDir, "gen"), { recursive: true });
for (const p of players) {
  const m = /\/gen\/(gen-[\w-]+)\//.exec(p.bundleUrl);
  if (!m) throw new Error(`${p.name}'s fighter isn't a generated one: ${p.bundleUrl}`);
  fs.cpSync(syncFighter(m[1]), path.join(dataDir, "gen", m[1]), { recursive: true });
}

// ---- build and image
const commit = sh("git", ["-C", REPO, "rev-parse", "--short", "HEAD"]);
if (!noBuild) { log("building the client and server"); execFileSync("npm", ["run", "build"], { cwd: REPO, stdio: ["ignore", "ignore", "inherit"] }); }
if (!fs.existsSync(path.join(REPO, "dist", "server.mjs"))) throw new Error("no dist/server.mjs: run without --no-build");
// two game bundles of this checkout for the shell: the second differs by a comment, so the room has something to swap to
const BUNDLES = ["lab-a", "lab-b"];
if (shell) {
  log("building the game bundle");
  execFileSync("npx", ["vite", "build", "--config", "client/vite.app.config.ts", "--logLevel", "warn"], { cwd: REPO, stdio: ["ignore", "ignore", "inherit"] });
  for (const name of BUNDLES) fs.cpSync(path.join(REPO, "dist", "game"), path.join(dataDir, "games", name), { recursive: true });
  fs.appendFileSync(path.join(dataDir, "games", BUNDLES[1], "app.js"), "\n// lab-b\n");
}
if (spawnSync("docker", ["image", "inspect", IMAGE], { stdio: "ignore" }).status !== 0) {
  log("building the netlab image");
  execFileSync("docker", ["build", "-q", "-t", IMAGE, HERE], { stdio: "inherit" });
}

// ---- containers: a relay on the game network; players on a control network (Playwright) plus the game network
const id = `netlab-${Date.now().toString(36)}`;
const relayName = `${id}-relay`;
const turnName = `${id}-turn`;
const origin = `http://${relayName}:${PORT}`;
const modules = fs.realpathSync(path.join(REPO, "node_modules"));
const mounts = ["-v", `${REPO}:${REPO}:ro`, "-v", `${modules}:${modules}:ro`, "-w", REPO];
const created = { containers: [], networks: [] };
async function teardown() {
  if (keep) { log(`--keep: left ${created.containers.join(", ")} running`); return; }
  for (const c of created.containers) spawnSync("docker", ["rm", "-f", c], { stdio: "ignore" });
  for (const n of created.networks) spawnSync("docker", ["network", "rm", n], { stdio: "ignore" });
}
process.on("SIGINT", async () => { await teardown(); process.exit(130); });

const report = { scenario: scenarioName, about: sc.about, commit, seed, minutes, cpu: sc.cpu ?? {}, stocks, at: atEvents, startedAt: new Date().toISOString(), players: players.map(({ profile: _, ...p }) => p), episodes: {}, timeline: {}, shaping: [], firewall: [], left: [], links: {} };
let browsers = [];
const pages = [];
try {
  for (const n of [`${id}-game`, `${id}-ctl`]) { docker("network", "create", n); created.networks.push(n); }
  // STUN and TURN for the players' peer-to-peer links, beside the relay and unshaped like it (production: coturn on the same box)
  docker("run", "-d", "--name", turnName, "--network", `${id}-game`, IMAGE, "turnserver", "--listening-port", "3478", "--use-auth-secret",
    "--static-auth-secret", TURN_SECRET, "--realm", "netlab", "--no-tls", "--no-dtls", "--no-cli", "--fingerprint", "--min-port", "49152", "--max-port", "49999", "--log-file", "stdout", "--simple-log");
  created.containers.push(turnName);
  docker("run", "-d", "--name", relayName, "--network", `${id}-game`, ...mounts, "-v", `${dataDir}:/data`,
    "-e", `PORT=${PORT}`, "-e", "DEV_LOGIN=1", "-e", "SKETCHBATTLE_DATA=/data", "-e", `BUILD=netlab-${commit}`, "-e", `SKETCHBATTLE_BASE=${BASE}`,
    "-e", `RTC_STUN=stun:${turnName}:3478`, "-e", `RTC_TURN=turn:${turnName}:3478?transport=udp,turn:${turnName}:3478?transport=tcp`, "-e", `RTC_TURN_SECRET=${TURN_SECRET}`, "-e", `FORGE_TOKEN=${TURN_SECRET}`,
    "--user", `${process.getuid()}:${process.getgid()}`, IMAGE, "node", "dist/server.mjs");
  created.containers.push(relayName);

  for (const [slot, p] of players.entries()) {
    p.container = `${id}-p${slot}`;
    docker("run", "-d", "--name", p.container, "--network", `${id}-ctl`, "--cap-add", "NET_ADMIN", "--shm-size", "1g", ...mounts,
      "-e", `NETLAB_ORIGIN=${origin}`, IMAGE, "node", "netlab/browser-server.mjs");
    created.containers.push(p.container);
    docker("network", "connect", `${id}-game`, p.container);
  }
  await waitFor(() => spawnSync("docker", ["exec", relayName, "node", "-e", `fetch("http://localhost:${PORT}${BASE}api/health").then(r=>process.exit(r.ok?0:1),()=>process.exit(1))`]).status === 0, "the relay to answer", 30000);

  // ---- shape every player's game interface, before sign-in so the relay's auto input delay sees the real round trip
  const ifaceOf = (container, ip) => docker("exec", container, "sh", "-c", `ip -o -4 addr show | awk '$4 ~ /^${ip.replace(/\./g, "\\.")}\\// {print $2}'`);
  for (const p of players) {
    const nets = JSON.parse(docker("inspect", "-f", "{{json .NetworkSettings.Networks}}", p.container));
    p.ctlIp = nets[`${id}-ctl`].IPAddress;
    p.gameIp = nets[`${id}-game`].IPAddress;
    p.iface = ifaceOf(p.container, p.gameIp);
    if (!p.iface) throw new Error(`no game interface for ${p.gameIp} in ${p.container}`);
    // the control network joins the players too, unshaped: no game traffic may cross it, peer-to-peer links included
    const ctlIface = ifaceOf(p.container, p.ctlIp);
    if (!ctlIface) throw new Error(`no control interface for ${p.ctlIp} in ${p.container}`);
    docker("exec", p.container, "sh", "-ec", `iptables -A OUTPUT -o ${ctlIface} -p udp -j DROP; iptables -A INPUT -i ${ctlIface} -p udp -j DROP`);
    p.shaper = new Shaper(p.container, p.iface);
    const steady = netemArgs(p.profile.base, []);
    p.shaper.setup(steady, steady);
    await waitFor(() => /ready ws/.test(docker("logs", p.container)), `${p.name}'s browser`, 30000);
  }
  // the game network's iptables chain per player: what a blocked network lets through
  const firewall = (p, mode) => {
    const rules = [`iptables -N NETLAB 2>/dev/null || iptables -F NETLAB`, `iptables -C OUTPUT -o ${p.iface} -j NETLAB 2>/dev/null || iptables -I OUTPUT -o ${p.iface} -j NETLAB`, `iptables -C INPUT -i ${p.iface} -j NETLAB 2>/dev/null || iptables -I INPUT -i ${p.iface} -j NETLAB`];
    if (mode === "p2p") for (const q of players) if (q !== p) rules.push(`iptables -A NETLAB -p udp -d ${q.gameIp} -j DROP`, `iptables -A NETLAB -p udp -s ${q.gameIp} -j DROP`);
    if (mode === "webrtc") rules.push("iptables -A NETLAB -p udp -j DROP", "iptables -A NETLAB -p tcp --dport 3478 -j DROP", "iptables -A NETLAB -p tcp --sport 3478 -j DROP");
    if (mode === "cut") rules.push("iptables -A NETLAB -j DROP");
    docker("exec", p.container, "sh", "-ec", rules.join("; "));
    report.firewall.push([Date.now(), p.name, mode ?? "open"]);
  };
  for (const p of players) firewall(p, p.block);
  log(`relay ${relayName}, players ${players.map((p) => `${p.name} (${p.net}${p.block ? `, ${p.block} blocked` : ""})`).join(", ")}`);

  // ---- browsers into one room
  for (const p of players) {
    const browser = await chromium.connect(`ws://${p.ctlIp}:9300/pw`);
    browsers.push(browser);
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, ...(p.name === videoOf ? { recordVideo: { dir: path.join(runDir, "video-raw"), size: { width: 1280, height: 720 } } } : {}) });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => log(`${p.name} page error: ${e.message}`));
    // NETLAB_CONSOLE=1: every console error and failed request of every page, for debugging the lab itself
    if (process.env.NETLAB_CONSOLE) {
      page.on("console", (m) => { if (m.type() === "error") log(`${p.name} console: ${m.text()}`); });
      page.on("requestfailed", (r) => log(`${p.name} request failed: ${r.url()} ${r.failure()?.errorText}`));
      page.on("response", (r) => { if (r.status() >= 400) log(`${p.name} HTTP ${r.status()} ${r.url()}`); });
    }
    const throttle = sc.cpu?.[p.name];
    const cdp = throttle || p.name === profileOf ? await ctx.newCDPSession(page) : null;
    if (throttle) await cdp.send("Emulation.setCPUThrottlingRate", { rate: throttle });
    if (p.name === profileOf) p.cdp = cdp;
    pages.push(page);
  }
  const url = shell ? `${origin}${BASE}shell.html?game=${BUNDLES[0]}` : `${origin}${BASE}`;
  const press = async (page, k) => { await page.keyboard.press(k); await page.waitForTimeout(100); };
  const [host, ...guests] = pages;
  // the game bundle is tens of MB (its music inlined): load it once, past the menus' own waits, so it's in the cache
  if (shell) await Promise.all(pages.map(async (page, i) => {
    await page.goto(`${url}&dev=${encodeURIComponent(players[i].name)}`);
    await page.waitForFunction(() => window.sketchbattle?.screen, null, { timeout: 180000 });
  }));
  // menus by keyboard like a player; the create and join prompts by their methods (private room, typed code)
  await openOnline(host, url, players[0].name); await press(host, "ArrowDown"); await press(host, "Enter");
  await host.waitForFunction(() => window.sketchbattle.screen.phase === "create", null, { timeout: 20000 });
  await host.evaluate(() => window.sketchbattle.screen.create(false));
  await host.waitForFunction(() => window.sketchbattle.screen.roomCode !== null, null, { timeout: 20000 });
  const code = await host.evaluate(() => window.sketchbattle.screen.roomCode);
  for (const [i, g] of guests.entries()) {
    await openOnline(g, url, players[i + 1].name); await press(g, "ArrowDown"); await press(g, "ArrowDown"); await press(g, "Enter");
    await g.waitForFunction(() => window.sketchbattle.screen.phase === "join", null, { timeout: 20000 });
    await g.evaluate((c) => window.sketchbattle.screen.join(c), code);
  }
  await host.waitForFunction((n) => window.sketchbattle.screen.lobbyDebug?.()?.members.length === n, players.length, { timeout: 30000 });
  for (const [i, page] of pages.entries()) {
    const { fighter, bundleUrl } = players[i];
    await page.evaluate((pick) => window.sketchbattle.screen.context.transport.sendLobby({ t: "pick", ...pick, ready: true }), { fighter, bundleUrl });
  }
  await host.waitForFunction(() => window.sketchbattle.screen.lobbyDebug?.()?.members.every((m) => m.ready), null, { timeout: 30000 });
  log(`room ${code}: ${players.length} players ready, starting ${config.stage}`);
  await host.evaluate(([stage, n]) => window.sketchbattle.screen.startMatch({ stage, stocks: n, time: 0, map: null }), [config.stage, stocks]);
  await Promise.all(pages.map((p) => p.waitForFunction(() => window.sketchbattle.screen.session?.state.frame > 0, null, { timeout: 90000 })));

  const botSource = fs.readFileSync(path.join(HERE, "bot.js"), "utf8");
  await Promise.all(pages.map((page, i) => page.evaluate(([src, s]) => (0, eval)(src)({ seed: s, slot: window.sketchbattle.screen.opts.localSlot }), [botSource, seed * 101 + i])));
  const trace = await host.evaluate(() => window.sketchbattle.screen.opts.telemetry.trace);
  log(`fighting: ${trace}, ${minutes} min`);

  // ---- episodes: each player's up and downlink on its own seeded schedule
  const seconds = minutes * 60;
  const profiled = players.find((p) => p.cdp);
  if (profiled) { await profiled.cdp.send("Profiler.enable"); await profiled.cdp.send("Profiler.setSamplingInterval", { interval: 1000 }); await profiled.cdp.send("Profiler.start"); }
  const startedAt = Date.now();
  const timers = [];
  for (const [i, p] of players.entries()) {
    for (const [d, dir] of ["up", "down"].entries()) {
      const eps = schedule(p.profile, seconds, rng(seed * 1009 + i * 2 + d));
      report.episodes[`${p.name}/${dir}`] = eps;
      // evaluate at the scheduled instant, not Date.now(): a timer firing a millisecond early must not keep an ending episode alive
      const apply = (t) => {
        const args = netemArgs(p.profile.base, eps.filter((e) => e.atMs <= t && t < e.endMs));
        p.shaper.set(dir, args);
        report.shaping.push([Date.now() - startedAt, t, `${p.name}/${dir}`, args]);
      };
      for (const e of eps) timers.push(setTimeout(() => apply(e.atMs), e.atMs), setTimeout(() => apply(e.endMs), e.endMs));
    }
  }
  // ---- mid-match events and players leaving
  const gone = new Set(), cut = new Set();
  const leave = async (i, why) => {
    if (gone.has(i)) return;
    gone.add(i);
    const p = players[i];
    report.timeline[p.name] = await pages[i].evaluate(() => { window.__netlab.stop(); return window.__netlab.samples; });
    report.left.push({ name: p.name, atMs: Date.now() - startedAt, why });
    log(`${p.name} leaves (${why})`);
    await pages[i].context().close();
  };
  const pending = [];
  for (const e of atEvents) {
    timers.push(setTimeout(() => {
      const i = players.findIndex((p) => p.name === e.name);
      log(`${e.action}${e.name ? ` ${e.name}` : ""}${e.mode ? ` ${e.mode}` : ""}`);
      if (e.action === "swap") {
        const body = JSON.stringify({ hash: BUNDLES[1] });
        const out = docker("exec", relayName, "node", "-e", `fetch("http://localhost:${PORT}${BASE}api/rooms/${code}/game",{method:"POST",headers:{"content-type":"application/json","x-forge-token":"${TURN_SECRET}"},body:${JSON.stringify(body)}}).then(async r=>{console.log(r.status, await r.text())})`);
        report.swap = { atMs: Date.now() - startedAt, relay: out };
        log(`swap: ${out}`);
      } else if (e.action === "leave") pending.push(leave(i, "left the page"));
      else {
        if (e.action === "cut") cut.add(i);
        if (e.action === "unblock") cut.delete(i);
        firewall(players[i], e.action === "block" ? e.mode : e.action === "cut" ? "cut" : players[i].block);
      }
    }, e.atMs));
  }
  // what each player's links settled on, once they're up: the lab checks they run on the shaped game network
  timers.push(setTimeout(() => pending.push(Promise.all(pages.map(async (page, i) => {
    if (gone.has(i)) return;
    report.links[players[i].name] = await page.evaluate(selectedPairs);
  })).then(() => log(`links: ${Object.entries(report.links).map(([n, l]) => `${n} ${l.map((x) => `${x.peer}:${x.route}`).join(",")}`).join(" · ")}`))), 25000));
  const deadline = startedAt + seconds * 1000;
  let over = false;
  while (Date.now() < deadline && !over) {
    await sleep(Math.min(leaveOut || atEvents.length ? 3000 : 15000, deadline - Date.now()));
    await Promise.all(pending.splice(0));
    const views = await Promise.all(pages.map((p, i) => (gone.has(i) ? null : p.evaluate(() => {
      const s = window.sketchbattle.screen;
      const fighter = s.session?.state.fighters[s.opts.localSlot];
      return { frame: s.session?.state.frame ?? -1, out: !!fighter && fighter.stocks <= 0, screen: s.constructor.name, phase: s.phase ?? null, bundle: window.sketchbattle.hash, swapAt: s.swapAt?.frame ?? null, final: s.session?.finalThrough?.() ?? null };
    }))));
    if (leaveOut) for (const [i, v] of views.entries()) if (v?.out) await leave(i, "out of stocks");
    const here = views.map((v, i) => (gone.has(i) || cut.has(i) ? null : v)).filter(Boolean);
    if (here.some((v) => v.frame < 0)) {
      if (!report.left.length && !cut.size) throw new Error(`a player left the match: ${views.map((v) => v ? `${v.screen}/${v.phase}/${v.frame}` : "gone").join(", ")}`);
      // after a player went, the others back in the room is the match over, as it should be
      if (here.every((v) => v.frame < 0)) {
        report.backInRoom = { atMs: Date.now() - startedAt, screens: here.map((v) => `${v.screen}/${v.phase}`) };
        log(`everyone still here is back in the room (${report.backInRoom.screens.join(", ")})`);
        over = true;
      }
    }
    log(`frames ${views.map((v) => (!v ? "gone" : shell ? `${v.frame} (${v.bundle}${v.swapAt ? `, swap at ${v.swapAt}, final ${v.final}` : ""})` : v.frame)).join(" / ")}`);
  }
  timers.forEach(clearTimeout);
  await Promise.all(pending.splice(0));
  if (shell) {
    report.bundles = await Promise.all(pages.map((page, i) => (gone.has(i) ? null : page.evaluate(() => ({ hash: window.sketchbattle.hash, frame: window.sketchbattle.screen.session?.state.frame ?? -1, resumedAt: window.sketchbattle.screen.opts?.resume?.frame ?? null })))));
    log(`bundles: ${JSON.stringify(report.bundles)}`);
  }
  for (const p of players) { const steady = netemArgs(p.profile.base, []); p.shaper.set("up", steady); p.shaper.set("down", steady); }

  // ---- finish like a real match end, so every client sends its final event
  for (const [i, page] of pages.entries()) {
    if (gone.has(i)) continue;
    report.timeline[players[i].name] = await page.evaluate(() => { window.__netlab.stop(); return window.__netlab.samples; });
    if (players[i].cdp && profiled === players[i]) {
      const { profile } = await players[i].cdp.send("Profiler.stop");
      fs.writeFileSync(path.join(runDir, `${players[i].name}.cpuprofile`), JSON.stringify(profile));
      report.profile = { player: players[i].name, top: topSelfTime(profile, 30) };
    }
  }
  await Promise.all(pages.map((page, i) => (gone.has(i) ? null : page.evaluate(() => { const s = window.sketchbattle.screen; if (s.session && s.cleanupMatch) s.cleanupMatch("done"); }))));
  await sleep(3000);
  for (const [i, page] of pages.entries()) {
    if (gone.has(i)) continue;
    const video = page.video();
    await page.context().close();
    if (video) {
      const raw = path.join(runDir, "video-raw.webm");
      await video.saveAs(raw);
      const mp4 = path.join(runDir, `${players[i].name}.mp4`);
      execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-i", raw, "-c:v", "libx264", "-preset", "veryfast", "-crf", "28", "-movflags", "+faststart", mp4]);
      fs.rmSync(raw); fs.rmSync(path.join(runDir, "video-raw"), { recursive: true, force: true });
      report.video = mp4;
    }
  }
  for (const p of players) await p.shaper.close();
} catch (error) {
  // what each player was looking at when it went wrong
  for (const [i, page] of pages.entries()) {
    const shot = path.join(runDir, `fail-${players[i].name}.png`);
    await page.screenshot({ path: shot }).then(() => log(`screenshot: ${shot}`), (e) => log(`no screenshot of ${players[i].name}: ${e.message}`));
    log(`${players[i].name} screen: ${await page.evaluate(() => { const s = window.sketchbattle?.screen; return s ? `${s.constructor.name} phase=${s.phase ?? "-"} error=${s.error ?? "-"}` : "none"; }).catch((e) => e.message)}`);
  }
  throw error;
} finally {
  for (const b of browsers) await b.close().catch((e) => log(`closing a browser: ${e.message}`));
  await teardown();
}

// ---- report: the lab's match against the production matches it recreates
const lab = matchStats(readEvents([path.join(dataDir, "events.jsonl")]));
if (!lab.length) throw new Error(`no finished match in ${dataDir}/events.jsonl`);
const targets = matchStats(prodEvents).filter((m) => sc.targets.includes(m.trace));
report.lab = lab;
report.targets = targets;
fs.writeFileSync(path.join(runDir, "report.json"), JSON.stringify(report, null, 1));
const episodeLine = (name) => ["up", "down"].map((d) => { const e = report.episodes[`${name}/${d}`]; return `${d} ${e.filter((x) => x.type === "spike").length} spikes ${e.filter((x) => x.type === "blackout").length} blackouts`; }).join(", ");
const text = [
  `# netlab ${scenarioName} · ${commit} · seed ${seed} · ${minutes} min`,
  sc.about,
  "",
  ...players.map((p) => `${p.name}: ${p.net} (${episodeLine(p.name)})`),
  "",
  "## lab",
  formatMatches(lab),
  ...(targets.length ? ["", "## lab vs production (↑/↓: outside production's range)", "```", compareToProduction(lab[0], targets), "```", "", "## production", formatMatches(targets)] : []),
  ...(report.profile ? ["", `## CPU profile: ${report.profile.player} (self time)`, ...report.profile.top.slice(0, 20).map(([pct, fn]) => `${String(pct).padStart(5)}%  ${fn}`)] : []),
].join("\n");
fs.writeFileSync(path.join(runDir, "report.md"), text + "\n");
const timeline = await renderTimeline(runDir);
console.log("\n" + text + `\n\n${runDir}`);

if (postTo) {
  const files = [timeline, report.video].filter(Boolean);
  const summary = `netlab ${scenarioName} (${minutes} min, seed ${seed}): lab ${lab[0].waitSPerMin} s/min frozen, ${lab[0].waitsPerMin} waits/min` + (targets.length ? ` · production ${(targets.reduce((s, m) => s + m.waitSPerMin, 0) / targets.length).toFixed(1)} s/min, ${Math.round(targets.reduce((s, m) => s + m.waitsPerMin, 0) / targets.length)} waits/min` : "");
  execFileSync("discord-send", [postTo, ...(files.length ? ["--file", ...files, "--"] : []), summary], { stdio: "inherit" });
}

async function waitFor(check, what, ms) {
  const until = Date.now() + ms;
  while (!check()) {
    if (Date.now() > until) throw new Error(`timed out waiting for ${what}`);
    await sleep(500);
  }
}

/** In a player's page: per peer link, the route and the selected candidate pair's addresses (from getStats). */
async function selectedPairs() {
  const mesh = window.sketchbattle.screen.opts?.mesh;
  if (!mesh) return [];
  const out = [];
  for (const peer of mesh.peers.values()) {
    if (!peer.pc || !peer.open) { out.push({ peer: peer.id, route: "none" }); continue; }
    const report = new Map();
    (await peer.pc.getStats()).forEach((s) => report.set(s.id, s));
    let pair = null;
    for (const s of report.values()) if (s.type === "transport" && s.selectedCandidatePairId) pair = report.get(s.selectedCandidatePairId);
    const local = pair && report.get(pair.localCandidateId), remote = pair && report.get(pair.remoteCandidateId);
    out.push({ peer: peer.id, route: peer.stats.route, local: local ? `${local.candidateType} ${local.address}:${local.port} ${local.protocol}` : null, remote: remote ? `${remote.candidateType} ${remote.address}:${remote.port}` : null });
  }
  return out;
}

/** The functions a CPU profile spent the most self time in: [share %, "name file:line"]. */
function topSelfTime(profile, n) {
  const byId = new Map(profile.nodes.map((node) => [node.id, node]));
  const self = new Map();
  let total = 0;
  profile.samples.forEach((id, i) => {
    const { callFrame: f } = byId.get(id);
    const key = `${f.functionName || "(anonymous)"} ${f.url.split("/").pop().split("?")[0]}:${f.lineNumber + 1}`;
    const dt = profile.timeDeltas[i] ?? 0;
    self.set(key, (self.get(key) ?? 0) + dt);
    total += dt;
  });
  return [...self].sort((a, b) => b[1] - a[1]).slice(0, n).map(([key, us]) => [Math.round((1000 * us) / total) / 10, key]);
}
