import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type express from "express";
import { SESSION_HEADER, type Player } from "../shared/account";

/**
 * Sign-in: the browser does Discord's implicit OAuth grant (no client secret), gets an access
 * token, and posts it here. We ask Discord who it belongs to and hand back a session token,
 * which the client sends on every request and on the lobby socket. Sessions persist to disk.
 * DEV_LOGIN=1 adds a name-only login for local tests.
 */
export interface AuthOptions { dataDir: string; devLogin: boolean }

const sessions = new Map<string, { player: Player; at: number }>();
let file = "";

function save(): void {
  fs.writeFileSync(file, JSON.stringify([...sessions.entries()]));
}

export function playerFromSession(token: unknown): Player | null {
  if (typeof token !== "string" || !token) return null;
  return sessions.get(token)?.player ?? null;
}

export function playerOf(req: express.Request): Player | null {
  return playerFromSession(req.get(SESSION_HEADER) ?? req.query.session);
}

function issue(player: Player): string {
  const token = crypto.randomBytes(24).toString("base64url");
  sessions.set(token, { player, at: Date.now() });
  save();
  return token;
}

const cleanName = (s: unknown): string => String(s ?? "").replace(/[^\w \-.!?]/g, "").slice(0, 14) || "someone";

export function attachAuth(api: express.Router, opts: AuthOptions): void {
  file = path.join(opts.dataDir, "sessions.json");
  if (fs.existsSync(file)) for (const [k, v] of JSON.parse(fs.readFileSync(file, "utf8"))) sessions.set(k, v);

  api.post("/auth/discord", async (req, res) => {
    const accessToken = String(req.body?.accessToken ?? "");
    if (!accessToken) return res.status(400).json({ error: "accessToken required" });
    const r = await fetch("https://discord.com/api/users/@me", { headers: { authorization: `Bearer ${accessToken}` } });
    if (!r.ok) return res.status(401).json({ error: `discord said ${r.status}` });
    const u = (await r.json()) as { id: string; username: string; global_name?: string | null; avatar?: string | null };
    const player: Player = {
      id: u.id,
      name: cleanName(u.global_name || u.username),
      avatar: u.avatar ? `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.png?size=96` : null,
    };
    res.json({ session: issue(player), player });
  });

  if (opts.devLogin) {
    api.post("/auth/dev", (req, res) => {
      const name = cleanName(req.body?.name);
      const player: Player = { id: `dev-${name.toLowerCase().replace(/\W+/g, "-")}`, name, avatar: null };
      res.json({ session: issue(player), player });
    });
  }

  api.get("/me", (req, res) => {
    const player = playerOf(req);
    if (!player) return res.status(401).json({ error: "not signed in" });
    res.json({ player });
  });

  api.post("/auth/logout", (req, res) => {
    const token = req.get(SESSION_HEADER);
    if (token && sessions.delete(token)) save();
    res.status(204).end();
  });
}
