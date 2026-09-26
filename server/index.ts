import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import http from "node:http";
import { WebSocketServer } from "ws";
import { attachLobby } from "./lobby";
import { attachDraw } from "./draw";
import { attachGames } from "./games";
import { attachAuth } from "./auth";
import { initLibrary } from "./library";
import { attachForge } from "./forge";
import { attachCharacters } from "./characters";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const PORT = Number(process.env.PORT ?? 3008);
const BASE = (process.env.SKETCHBATTLE_BASE ?? "/sketch-battle/").replace(/\/$/, "");
const DATA_DIR = process.env.SKETCHBATTLE_DATA ?? path.join(root, "server-data");
fs.mkdirSync(DATA_DIR, { recursive: true });

const app = express();
// forge completions carry nine PNG cells + a sheet as base64; a new character carries its drawing
app.use((req, res, next) => express.json({ limit: req.path.includes("/forge/") ? "12mb" : req.path.includes("/games") ? "40mb" : req.path.endsWith("/characters") ? "2mb" : "8kb" })(req, res, next));
const api = express.Router();
// Apache proxies /sketch-battle/* to / here; when hit directly the prefix is still present, so mount both.
app.use("/api", api);
app.use(`${BASE}/api`, api);

api.get("/health", (_req, res) => res.json({ ok: true, build: process.env.BUILD ?? "dev" }));

// DRAW BATTLE: password-gated rooms, forge job queue, generated fighters served as static files
const DRAW_PASSWORD = process.env.DRAW_PASSWORD ?? "";
const FORGE_TOKEN = process.env.FORGE_TOKEN ?? "";
if (!DRAW_PASSWORD || !FORGE_TOKEN) console.warn("DRAW_PASSWORD / FORGE_TOKEN unset: draw battle is disabled");
// sign-in, libraries, the forge queue, the creator, draw battles
initLibrary(DATA_DIR);
attachAuth(api, { dataDir: DATA_DIR, devLogin: process.env.DEV_LOGIN === "1" });
attachForge(api, { token: FORGE_TOKEN, dataDir: DATA_DIR, genBase: `${BASE}/gen` });
attachCharacters(api, FORGE_TOKEN);
attachDraw(api, { password: DRAW_PASSWORD, dataDir: DATA_DIR });
// game bundles: whole builds of the game, one folder per hash; rooms switch between them live
attachGames(api, { token: FORGE_TOKEN, dataDir: DATA_DIR });
const gamesDir = path.join(DATA_DIR, "games");
app.use(`${BASE}/games`, express.static(gamesDir, { maxAge: "1y", immutable: true }));
app.use("/games", express.static(gamesDir, { maxAge: "1y", immutable: true }));
const genDir = path.join(DATA_DIR, "gen");
app.use(`${BASE}/gen`, express.static(genDir, { maxAge: "1y", immutable: true }));
app.use("/gen", express.static(genDir, { maxAge: "1y", immutable: true }));

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

const clientDir = fs.existsSync(path.join(root, "dist", "client")) ? path.join(root, "dist", "client") : path.join(root, "client");
const staticOpts = { maxAge: "1h", setHeaders: (res: express.Response, p: string) => { if (p.endsWith(".html")) res.setHeader("Cache-Control", "no-cache"); } };
app.use(BASE, express.static(clientDir, staticOpts));
app.use("/", express.static(clientDir, staticOpts));
// Discord sends the signed-in browser back to /auth with the token in the URL fragment; the game page handles it
app.get(["/", BASE, `${BASE}/`, "/auth", `${BASE}/auth`], (_req, res) => res.sendFile(path.join(clientDir, "index.html")));

const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });
server.on("upgrade", (req, socket, head) => {
  const url = req.url ?? "";
  if (url === "/ws" || url === `${BASE}/ws` || url.startsWith("/ws?") || url.startsWith(`${BASE}/ws?`)) {
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
  } else socket.destroy();
});
attachLobby(wss);

server.listen(PORT, () => console.log(`sketch-battle on :${PORT} serving ${clientDir}`));
