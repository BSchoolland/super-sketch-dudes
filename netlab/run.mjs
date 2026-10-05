// Net lab: plays a real online match between 2-4 headless Chromes, each in its own container behind its own
// shaped connection to a relay running this checkout, then reports it with the same numbers production logs.
// Usage: node netlab/run.mjs <scenario> [--minutes 3] [--seed 1] [--video <player>] [--post <discord thread id>]
//        [--net Name=profile ...] [--no-build] [--keep]
// Needs Docker (the sketchbattle-netlab image builds itself) and production's event log + fighters cached:
// run `node netlab/prod.mjs events` once (fighters sync on demand). Output lands in netlab/runs/<stamp>-<scenario>/.
import { execFileSync, spawnSync } from "node:child_process";
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
const IMAGE = "sketchbattle-netlab";
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
const postTo = opt("--post");
const netOverrides = Object.fromEntries(opts("--net").map((kv) => kv.split("=")));
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
  return { name: m.name, fighter: m.fighter, bundleUrl: m.bundleUrl, net, profile: profile(net) };
}).map((p, _, all) => {
  if (sc.cpu) for (const name of Object.keys(sc.cpu)) if (!all.some((q) => q.name === name)) throw new Error(`cpu throttle for ${name}, who isn't in ${sc.replay}`);
  return p;
});
if (videoOf && !players.some((p) => p.name === videoOf)) throw new Error(`--video ${videoOf}: no such player (${players.map((p) => p.name).join(", ")})`);

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
if (spawnSync("docker", ["image", "inspect", IMAGE], { stdio: "ignore" }).status !== 0) {
  log("building the netlab image");
  execFileSync("docker", ["build", "-q", "-t", IMAGE, HERE], { stdio: "inherit" });
}

// ---- containers: a relay on the game network; players on a control network (Playwright) plus the game network
const id = `netlab-${Date.now().toString(36)}`;
const relayName = `${id}-relay`;
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

const report = { scenario: scenarioName, about: sc.about, commit, seed, minutes, cpu: sc.cpu ?? {}, startedAt: new Date().toISOString(), players: players.map(({ profile: _, ...p }) => p), episodes: {}, timeline: {}, shaping: [] };
let browsers = [];
const pages = [];
try {
  for (const n of [`${id}-game`, `${id}-ctl`]) { docker("network", "create", n); created.networks.push(n); }
  docker("run", "-d", "--name", relayName, "--network", `${id}-game`, ...mounts, "-v", `${dataDir}:/data`,
    "-e", `PORT=${PORT}`, "-e", "DEV_LOGIN=1", "-e", "SKETCHBATTLE_DATA=/data", "-e", `BUILD=netlab-${commit}`, "-e", `SKETCHBATTLE_BASE=${BASE}`,
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
  for (const p of players) {
    const nets = JSON.parse(docker("inspect", "-f", "{{json .NetworkSettings.Networks}}", p.container));
    p.ctlIp = nets[`${id}-ctl`].IPAddress;
    const gameIp = nets[`${id}-game`].IPAddress;
    p.iface = docker("exec", p.container, "sh", "-c", `ip -o -4 addr show | awk '$4 ~ /^${gameIp.replace(/\./g, "\\.")}\\// {print $2}'`);
    if (!p.iface) throw new Error(`no game interface for ${gameIp} in ${p.container}`);
    p.shaper = new Shaper(p.container, p.iface);
    const steady = netemArgs(p.profile.base, []);
    p.shaper.setup(steady, steady);
    await waitFor(() => /ready ws/.test(docker("logs", p.container)), `${p.name}'s browser`, 30000);
  }
  log(`relay ${relayName}, players ${players.map((p) => `${p.name} (${p.net})`).join(", ")}`);

  // ---- browsers into one room
  for (const p of players) {
    const browser = await chromium.connect(`ws://${p.ctlIp}:9300/pw`);
    browsers.push(browser);
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, ...(p.name === videoOf ? { recordVideo: { dir: path.join(runDir, "video-raw"), size: { width: 1280, height: 720 } } } : {}) });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => log(`${p.name} page error: ${e.message}`));
    const throttle = sc.cpu?.[p.name];
    if (throttle) await (await ctx.newCDPSession(page)).send("Emulation.setCPUThrottlingRate", { rate: throttle });
    pages.push(page);
  }
  const url = `${origin}${BASE}`;
  const press = async (page, k) => { await page.keyboard.press(k); await page.waitForTimeout(100); };
  const [host, ...guests] = pages;
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
  await host.evaluate((stage) => window.sketchbattle.screen.startMatch({ stage, stocks: 99, time: 0, map: null }), config.stage);
  await Promise.all(pages.map((p) => p.waitForFunction(() => window.sketchbattle.screen.session?.state.frame > 0, null, { timeout: 90000 })));

  const botSource = fs.readFileSync(path.join(HERE, "bot.js"), "utf8");
  await Promise.all(pages.map((page, i) => page.evaluate(([src, s]) => (0, eval)(src)({ seed: s, slot: window.sketchbattle.screen.opts.localSlot }), [botSource, seed * 101 + i])));
  const trace = await host.evaluate(() => window.sketchbattle.screen.opts.telemetry.trace);
  log(`fighting: ${trace}, ${minutes} min`);

  // ---- episodes: each player's up and downlink on its own seeded schedule
  const seconds = minutes * 60;
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
  const deadline = startedAt + seconds * 1000;
  while (Date.now() < deadline) {
    await sleep(Math.min(15000, deadline - Date.now()));
    const frames = await Promise.all(pages.map((p) => p.evaluate(() => window.sketchbattle.screen.session?.state.frame ?? -1)));
    if (frames.some((f) => f < 0)) throw new Error(`a player left the match: frames ${frames.join(", ")}`);
    log(`frames ${frames.join(" / ")}`);
  }
  timers.forEach(clearTimeout);
  for (const p of players) { const steady = netemArgs(p.profile.base, []); p.shaper.set("up", steady); p.shaper.set("down", steady); }

  // ---- finish like a real match end, so every client sends its final event
  for (const [i, page] of pages.entries()) {
    report.timeline[players[i].name] = await page.evaluate(() => { window.__netlab.stop(); return window.__netlab.samples; });
  }
  await Promise.all(pages.map((page) => page.evaluate(() => window.sketchbattle.screen.cleanupMatch("done"))));
  await sleep(3000);
  for (const [i, page] of pages.entries()) {
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
