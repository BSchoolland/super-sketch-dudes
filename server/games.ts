import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type express from "express";
import { broadcast, rooms } from "./lobby";

/**
 * Game bundles: a whole build of the game (app.js + style.css + assets) stored under its content
 * hash. A room can be switched to a bundle at any time; every client in it swaps live, mid-match
 * if there is one. Pushing needs the forge token, like everything else that changes the game.
 */
export interface GamesOptions { token: string; dataDir: string }

const SAFE = /^[a-z0-9._-]+(\/[a-z0-9._-]+)*$/i;

export function attachGames(api: express.Router, opts: GamesOptions): void {
  const dir = path.join(opts.dataDir, "games");
  fs.mkdirSync(dir, { recursive: true });
  const currentFile = path.join(dir, "current");
  const authed = (req: express.Request, res: express.Response): boolean => {
    if (!opts.token || req.header("x-forge-token") !== opts.token) { res.status(401).json({ error: "bad token" }); return false; }
    return true;
  };

  api.get("/games/current", (_req, res) => {
    if (!fs.existsSync(currentFile)) return res.status(404).json({ error: "no current game" });
    res.json({ hash: fs.readFileSync(currentFile, "utf8").trim() });
  });

  api.get("/games", (_req, res) => {
    const list = fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => ({ hash: d.name, at: fs.statSync(path.join(dir, d.name)).mtimeMs }));
    res.json({ current: fs.existsSync(currentFile) ? fs.readFileSync(currentFile, "utf8").trim() : null, games: list.sort((a, b) => b.at - a.at) });
  });

  // { files: { "app.js": <base64>, "style.css": <base64>, ... } } -> { hash }
  api.post("/games", (req, res) => {
    if (!authed(req, res)) return;
    const files = req.body?.files;
    if (!files || typeof files !== "object" || typeof files["app.js"] !== "string") return res.status(400).json({ error: "files.app.js required" });
    for (const name of Object.keys(files)) if (!SAFE.test(name) || name.includes("..")) return res.status(400).json({ error: `bad file name ${name}` });
    const app = Buffer.from(files["app.js"], "base64");
    const hash = crypto.createHash("sha256").update(app).digest("hex").slice(0, 12);
    const out = path.join(dir, hash);
    fs.mkdirSync(out, { recursive: true });
    for (const [name, b64] of Object.entries(files)) {
      const p = path.join(out, name);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, Buffer.from(String(b64), "base64"));
    }
    res.json({ hash });
  });

  api.post("/games/current", (req, res) => {
    if (!authed(req, res)) return;
    const hash = String(req.body?.hash ?? "");
    if (!fs.existsSync(path.join(dir, hash, "app.js"))) return res.status(404).json({ error: "no such game" });
    fs.writeFileSync(currentFile, hash);
    res.json({ hash });
  });

  // switch a room to a bundle: the room hears `game`, its host answers with the swap frame
  api.post("/rooms/:code/game", (req, res) => {
    if (!authed(req, res)) return;
    const room = rooms.get(String(req.params.code).toUpperCase());
    if (!room) return res.status(404).json({ error: "no such room" });
    const hash = String(req.body?.hash ?? "");
    if (!fs.existsSync(path.join(dir, hash, "app.js"))) return res.status(404).json({ error: "no such game" });
    room.game = hash;
    broadcast(room, { t: "game", hash });
    res.json({ hash, members: room.members.length, started: room.started });
  });

  api.get("/rooms", (req, res) => {
    if (!authed(req, res)) return;
    res.json({ rooms: [...rooms.values()].map((r) => ({ code: r.code, members: r.members.map((m) => m.name), started: r.started, game: r.game })) });
  });
}
