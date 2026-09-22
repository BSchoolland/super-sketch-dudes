import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import http from "node:http";
import { WebSocketServer } from "ws";
import { attachLobby } from "./lobby";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const PORT = Number(process.env.PORT ?? 3008);
const DATA_DIR = process.env.RINGOUT_DATA ?? path.join(root, "server-data");
fs.mkdirSync(DATA_DIR, { recursive: true });

const app = express();
app.use(express.json({ limit: "8kb" }));
const api = express.Router();
// Apache proxies /ringout/* to / here; when hit directly the prefix is still present, so mount both.
app.use("/api", api);
app.use("/ringout/api", api);

api.get("/health", (_req, res) => res.json({ ok: true, build: process.env.BUILD ?? "dev" }));

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
app.use("/ringout", express.static(clientDir, staticOpts));
app.use("/", express.static(clientDir, staticOpts));
app.get(["/", "/ringout", "/ringout/"], (_req, res) => res.sendFile(path.join(clientDir, "index.html")));

const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });
server.on("upgrade", (req, socket, head) => {
  const url = req.url ?? "";
  if (url === "/ws" || url === "/ringout/ws" || url.startsWith("/ws?") || url.startsWith("/ringout/ws?")) {
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
  } else socket.destroy();
});
attachLobby(wss);

server.listen(PORT, () => console.log(`ringout on :${PORT} serving ${clientDir}`));
