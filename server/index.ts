import express from "express";
import { attachSchool } from "./school";
import { attachFeedback } from "./feedback";
import { FEEDBACK_ADMIN } from "../shared/feedback";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import http from "node:http";
import { WebSocketServer } from "ws";
import { attachLobby } from "./lobby";
import { attachGames } from "./games";
import { applyName, attachAuth, playerFromSession } from "./auth";
import { attachNameJudging } from "./name-requests";
import { initLibrary } from "./library";
import { attachForge } from "./forge";
import { attachCharacters } from "./characters";
import { attachMaps, initMaps } from "./maps";
import { attachBrawlStats } from "./brawl-stats";
import { attachEvents, initEvents, requestErrors, requestEvents, watchProcess } from "./events";
import { iceConfigured } from "./ice";
import { restoreHandoff, saveHandoff } from "./handoff";
import { sweepGuests } from "./guests";
import { OLD_HOST, oldHostPage } from "./oldhost";
import { attachHome } from "./home";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const PORT = Number(process.env.PORT ?? 3008);
const BASE = (process.env.SKETCHBATTLE_BASE ?? "/").replace(/\/$/, "");
/** A path at the root and under the base (Apache may hand requests over with the base or without it), and any more. */
const at = (p: string, ...more: string[]): string[] => [...new Set([p, `${BASE}${p}`, ...more])];
/** Where the game was for an afternoon: tabs opened then still reach the API, the relay and fighters there; pages redirect. */
const PLAY = "/play";
const DATA_DIR = process.env.SKETCHBATTLE_DATA ?? path.join(root, "server-data");
fs.mkdirSync(DATA_DIR, { recursive: true });
initEvents(DATA_DIR);
const processEvent = watchProcess({ port: PORT, base: BASE, node: process.version }, () => saveHandoff(DATA_DIR));

const app = express();
// forge completions carry nine PNG cells + a sheet as base64; a new character carries its drawing
app.use((req, res, next) => express.json({ limit: req.path.includes("/forge/") || req.path.endsWith("/characters/import") || req.path.endsWith("/cells") ? "12mb" : req.path.endsWith("/cpu") ? "4mb" : req.path.includes("/games") ? "40mb" : req.path.endsWith("/events") ? "256kb" : req.path.endsWith("/source") ? "4mb" : req.path.endsWith("/characters") || req.path.endsWith("/feedback") || req.path.endsWith("/feedback/response") ? "2mb" : req.path.includes("/maps") ? "80kb" : "8kb" })(req, res, next));
const api = express.Router();
app.use(at("/api", `${PLAY}/api`), api);
api.use(requestEvents());

api.get("/health", (_req, res) => res.json({ ok: true, build: process.env.BUILD ?? "dev" }));

const FORGE_TOKEN = process.env.FORGE_TOKEN ?? "";
if (!FORGE_TOKEN) console.warn("FORGE_TOKEN unset: the forge and game bundle uploads are disabled");
const ice = iceConfigured();
if (!ice.stun || !ice.turn) console.warn(`peer-to-peer: ${ice.stun} STUN and ${ice.turn} TURN servers (RTC_STUN, RTC_TURN, RTC_TURN_SECRET); pairs that can't connect directly play over the relay`);
// a fake Discord stands in for the real one only on a DEV_LOGIN server (scripts/activitycheck.mjs)
if (process.env.DISCORD_API && process.env.DEV_LOGIN !== "1") throw new Error("DISCORD_API is set without DEV_LOGIN=1: only a dev server may talk to a fake Discord");
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET || null;
if (!DISCORD_CLIENT_SECRET) console.warn("DISCORD_CLIENT_SECRET unset: nobody can sign in inside the Discord Activity");
// sign-in, libraries, the forge queue, the creator
initLibrary(DATA_DIR);
attachAuth(api, { dataDir: DATA_DIR, devLogin: process.env.DEV_LOGIN === "1", botKey: process.env.BOT_LOGIN_KEY || null, discord: { api: process.env.DISCORD_API ?? "https://discord.com/api", clientSecret: DISCORD_CLIENT_SECRET } });
attachForge(api, { token: FORGE_TOKEN, dataDir: DATA_DIR, genBase: `${BASE}/gen` });
// typed names wait for the moderator's judges, which the forge worker runs
attachNameJudging(api, { token: FORGE_TOKEN, rename: applyName });
attachCharacters(api, FORGE_TOKEN, DATA_DIR);
// player-made maps, for the accounts in map-makers.json
initMaps({ dataDir: DATA_DIR, devLogin: process.env.DEV_LOGIN === "1" });
attachMaps(api);
// guests who stopped coming back; a failed sweep is an error on the process event, not a crash loop at every boot
const sweep = (): void => {
  try {
    const { swept, kept } = sweepGuests(Date.now());
    if (swept) console.log(`guests: deleted ${swept} who stopped playing`);
    if (kept.length) processEvent.issue("warn", "guest-sweep", `kept ${kept.length} idle guests (open forge jobs, or a starter or the dummy is theirs): ${kept.slice(0, 5).join(", ")}`);
  } catch (error) {
    console.error("guest sweep failed", error);
    processEvent.issue("error", "guest-sweep", error instanceof Error ? error.message : String(error), error instanceof Error ? error.stack : undefined);
  }
};
sweep();
setInterval(sweep, 6 * 3_600_000).unref();
// game bundles: whole builds of the game, one folder per hash; rooms switch between them live
attachGames(api, { token: FORGE_TOKEN, dataDir: DATA_DIR });
const gamesDir = path.join(DATA_DIR, "games");
app.use(at("/games", `${PLAY}/games`), express.static(gamesDir, { maxAge: "1y", immutable: true }));
const genDir = path.join(DATA_DIR, "gen");
app.use(at("/gen", `${PLAY}/gen`), express.static(genDir, { maxAge: "1y", immutable: true }));

attachEvents(api);
attachBrawlStats(api, DATA_DIR);
attachSchool(api);
// on a DEV_LOGIN server, ?dev=ben reads and answers feedback
attachFeedback(api, { dataDir: DATA_DIR, admins: [FEEDBACK_ADMIN, ...(process.env.DEV_LOGIN === "1" ? ["dev-ben"] : [])] });
// the one-line log that builds from before wide events still post to
const LOG = path.join(DATA_DIR, "client-log.jsonl");
const LOG_MAX = 8 * 1024 * 1024;
api.post("/log", (req, res) => {
  const b = req.body;
  if (!b || typeof b !== "object" || typeof b.event !== "string") return res.status(400).json({ error: "bad log" });
  const line = JSON.stringify({ at: new Date().toISOString(), ...b }).slice(0, 4000);
  if (fs.existsSync(LOG) && fs.statSync(LOG).size > LOG_MAX) fs.renameSync(LOG, LOG + ".1");
  fs.appendFileSync(LOG, line + "\n");
  res.status(204).end();
});
api.use(requestErrors());

const clientDir = fs.existsSync(path.join(root, "dist", "client")) ? path.join(root, "dist", "client") : path.join(root, "client");
// house fighters keep their URLs across builds, so they revalidate (ETag) instead of sitting in the browser cache
const staticOpts = { maxAge: "1h", setHeaders: (res: express.Response, p: string) => { if (p.endsWith(".html") || p.includes(`${path.sep}house${path.sep}`)) res.setHeader("Cache-Control", "no-cache"); } };
// the game's old host: its page sends the browser to the new home
app.get([...at("/"), ...at("/index.html")], (req, res, next) => {
  if (req.get("x-forwarded-host") !== OLD_HOST) return next();
  const q = req.originalUrl.indexOf("?");
  res.setHeader("Cache-Control", "no-cache");
  res.type("html").send(oldHostPage(q < 0 ? "" : req.originalUrl.slice(q)));
});
if (BASE !== PLAY) app.get(/^\/play(\/|$)/, (req, res) => res.redirect(301, req.originalUrl.slice(PLAY.length) || "/"));
// the game page; Discord and Google send the signed-in browser back to /auth with the token in the URL fragment
attachHome(app, { at, base: `${BASE}/`, indexFile: path.join(clientDir, "index.html"), genDir });
app.use(at("/"), express.static(clientDir, staticOpts));
// the privacy notice and terms: plain pages beside the game (privacy.html is the URL Google's consent screen has)
for (const page of ["privacy", "terms"]) app.get(at(`/${page}`), (_req, res) => res.sendFile(path.join(clientDir, `${page}.html`)));

const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });
server.on("upgrade", (req, socket, head) => {
  const url = req.url ?? "";
  if (at("/ws", `${PLAY}/ws`).some((p) => url === p || url.startsWith(`${p}?`))) {
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
  } else socket.destroy();
});
attachLobby(wss, playerFromSession);
restoreHandoff(DATA_DIR, processEvent);

server.listen(PORT, () => console.log(`sketch-battle on :${PORT} serving ${clientDir}`));
