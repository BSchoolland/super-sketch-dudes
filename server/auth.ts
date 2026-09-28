import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type express from "express";
import { GOOGLE_CLIENT_ID, SESSION_HEADER, type Player } from "../shared/account";

/**
 * Sign-in: the browser does Discord's implicit OAuth grant (no client secret), gets an access
 * token, and posts it here. We ask Discord who it belongs to and hand back a session token,
 * which the client sends on every request and on the lobby socket. Google is the same trip with
 * an ID token, which Google checks for us and we hold to our client ID and the client's nonce.
 * Or: an email and password,
 * scrypt-hashed in accounts.json. Sessions persist to disk. DEV_LOGIN=1 adds a name-only login
 * for local tests.
 */
/** `botKey`: a secret that lets the bench's bots sign in as bot accounts (ids `bot-…`, never a real player's); unset, no bot login. */
export interface AuthOptions { dataDir: string; devLogin: boolean; botKey: string | null }

const sessions = new Map<string, { player: Player; at: number }>();
let file = "";

function save(): void {
  fs.writeFileSync(file, JSON.stringify([...sessions.entries()]));
}

/** Keyed by lowercased email. */
interface Account { player: Player; salt: string; hash: string }
const accounts = new Map<string, Account>();
let accountsFile = "";

function saveAccounts(): void {
  fs.writeFileSync(accountsFile, JSON.stringify([...accounts.entries()]));
}

const PASSWORD_MIN = 8, PASSWORD_MAX = 200;
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;

function hashPassword(password: string, salt: string): Promise<string> {
  return new Promise((resolve, reject) => crypto.scrypt(password, salt, 64, (err, key) => (err ? reject(err) : resolve(key.toString("base64")))));
}

async function passwordMatches(account: Account, password: string): Promise<boolean> {
  const hash = Buffer.from(await hashPassword(password, account.salt), "base64");
  return crypto.timingSafeEqual(hash, Buffer.from(account.hash, "base64"));
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
  accountsFile = path.join(opts.dataDir, "accounts.json");
  if (fs.existsSync(accountsFile)) for (const [k, v] of JSON.parse(fs.readFileSync(accountsFile, "utf8"))) accounts.set(k, v);

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

  api.post("/auth/google", async (req, res) => {
    const idToken = String(req.body?.idToken ?? ""), nonce = String(req.body?.nonce ?? "");
    if (!idToken || !nonce) return res.status(400).json({ error: "idToken and nonce required" });
    const r = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`);
    if (!r.ok) return res.status(401).json({ error: `google said ${r.status}` });
    const t = (await r.json()) as { aud: string; iss: string; sub: string; nonce?: string; name?: string; given_name?: string; picture?: string };
    if (t.aud !== GOOGLE_CLIENT_ID || !["accounts.google.com", "https://accounts.google.com"].includes(t.iss)) return res.status(401).json({ error: "that token isn't for this game" });
    if (t.nonce !== nonce) return res.status(401).json({ error: "sign-in expired, try again" });
    const player: Player = { id: `google-${t.sub}`, name: cleanName(t.given_name || t.name), avatar: t.picture ?? null };
    res.json({ session: issue(player), player });
  });

  api.post("/auth/signup", async (req, res) => {
    const email = String(req.body?.email ?? "").trim().toLowerCase();
    const password = String(req.body?.password ?? "");
    if (!EMAIL.test(email)) return res.status(400).json({ error: "that doesn't look like an email" });
    if (password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) return res.status(400).json({ error: `password needs ${PASSWORD_MIN}+ characters` });
    if (accounts.has(email)) return res.status(409).json({ error: "that email already has an account" });
    const salt = crypto.randomBytes(16).toString("base64");
    const player: Player = { id: `email-${crypto.randomBytes(9).toString("hex")}`, name: cleanName(req.body?.name), avatar: null };
    accounts.set(email, { player, salt, hash: await hashPassword(password, salt) });
    saveAccounts();
    res.json({ session: issue(player), player });
  });

  api.post("/auth/login", async (req, res) => {
    const account = accounts.get(String(req.body?.email ?? "").trim().toLowerCase());
    const password = String(req.body?.password ?? "").slice(0, PASSWORD_MAX);
    if (!account || !(await passwordMatches(account, password))) return res.status(401).json({ error: "wrong email or password" });
    res.json({ session: issue(account.player), player: account.player });
  });

  if (opts.devLogin) {
    api.post("/auth/dev", (req, res) => {
      const name = cleanName(req.body?.name);
      const player: Player = { id: `dev-${name.toLowerCase().replace(/\W+/g, "-")}`, name, avatar: null };
      res.json({ session: issue(player), player });
    });
  }

  if (opts.botKey) {
    const key = Buffer.from(opts.botKey);
    api.post("/auth/bot", (req, res) => {
      const given = Buffer.from(String(req.body?.key ?? ""));
      if (given.length !== key.length || !crypto.timingSafeEqual(given, key)) return res.status(401).json({ error: "wrong bot key" });
      const name = cleanName(req.body?.name);
      const player: Player = { id: `bot-${name.toLowerCase().replace(/\W+/g, "-")}`, name, avatar: null };
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
