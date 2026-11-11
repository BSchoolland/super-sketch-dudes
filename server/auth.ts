import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type express from "express";
import { DISCORD_APP_ID, GOOGLE_CLIENT_ID, SESSION_HEADER, isGuest, type LastPlayed, type News, type Player } from "../shared/account";
import type { WideEvent } from "../shared/wide";
import { markPlayed, nameOf, renamePlayer, seeNews } from "./library";
import { adoptGuest, newGuest } from "./guests";
import { clientIp } from "./school";
import { randomName, typedName } from "./names";
import { renameMapsOf } from "./maps";
import { renameJobsOf } from "./forge";

/**
 * Sign-in: the browser does Discord's implicit OAuth grant (no client secret), gets an access
 * token, and posts it here. We ask Discord who it belongs to and hand back a session token,
 * which the client sends on every request and on the lobby socket. Inside the Discord Activity
 * there is no redirect: the client gets a one-time code from the Embedded App SDK and we exchange
 * it for the access token with the app's client secret, then ask Discord the same way. Google is the same trip with
 * an ID token, which Google checks for us and we hold to our client ID and the client's nonce; a Google player's name is one we pick (names.ts), never Google's.
 * Or an email and password, scrypt-hashed in accounts.json (the client asks a birth year first and keeps the answer to itself). A browser with
 * no session gets a guest (ids `guest-…`, guests.ts); signing in from a guest's session moves what the guest made to
 * the account. Sessions persist to disk. DEV_LOGIN=1 adds a name-only login for local tests.
 */
/**
 * `botKey`: a secret that lets the bench's bots sign in as bot accounts (ids `bot-…`, never a real player's); unset, no bot login.
 * `discord.api`: Discord's API base (a fake one in tests); `discord.clientSecret`: the app's, for the Activity's code exchange.
 */
export interface AuthOptions { dataDir: string; devLogin: boolean; botKey: string | null; discord: { api: string; clientSecret: string | null } }

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
const GUESTS_PER_HOUR = 200;

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

/** Ends every session a player has. */
export function endSessionsOf(id: string): void {
  let ended = false;
  for (const [token, s] of sessions) if (s.player.id === id) { sessions.delete(token); ended = true; }
  if (ended) save();
}

/**
 * A signed-in player, when they last played before this sign-in (null: never) and their NEW stickers. `arriving` is who
 * the sign-in says they are: a player with a record keeps the name on it. Signing in to an account from a guest's
 * session moves the guest's library to it and ends the guest.
 */
function issue(arriving: Player, req: express.Request, res: express.Response): { session: string; player: Player; lastPlayed: LastPlayed | null; news: News | null } {
  const player: Player = { ...arriving, name: nameOf(arriving.id) ?? arriving.name };
  const was = playerOf(req);
  if (was && isGuest(was.id) && !isGuest(player.id)) {
    const moved = adoptGuest(was.id, player);
    (res.locals.event as WideEvent | undefined)?.set("adopted", { guest: was.id, player: player.id, ...moved });
  }
  const token = crypto.randomBytes(24).toString("base64url");
  sessions.set(token, { player, at: Date.now() });
  save();
  return { session: token, player, ...markPlayed(player) };
}

const cleanName = (s: unknown): string => typedName(s) || "someone";

export function attachAuth(api: express.Router, opts: AuthOptions): void {
  file = path.join(opts.dataDir, "sessions.json");
  if (fs.existsSync(file)) for (const [k, v] of JSON.parse(fs.readFileSync(file, "utf8"))) sessions.set(k, v);
  accountsFile = path.join(opts.dataDir, "accounts.json");
  if (fs.existsSync(accountsFile)) for (const [k, v] of JSON.parse(fs.readFileSync(accountsFile, "utf8"))) accounts.set(k, v);

  /** The player a Discord access token belongs to, or why Discord wouldn't say. */
  async function discordPlayer(accessToken: string): Promise<Player | string> {
    const r = await fetch(`${opts.discord.api}/users/@me`, { headers: { authorization: `Bearer ${accessToken}` } });
    if (!r.ok) return `discord said ${r.status}`;
    const u = (await r.json()) as { id: string; username: string; global_name?: string | null; avatar?: string | null };
    return {
      id: u.id,
      name: cleanName(u.global_name || u.username),
      avatar: u.avatar ? `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.png?size=96` : null,
    };
  }

  api.post("/auth/discord", async (req, res) => {
    const accessToken = String(req.body?.accessToken ?? "");
    if (!accessToken) return res.status(400).json({ error: "accessToken required" });
    const player = await discordPlayer(accessToken);
    if (typeof player === "string") return res.status(401).json({ error: player });
    res.json(issue(player, req, res));
  });

  // the Activity's code was authorized without a redirect_uri, so the exchange carries none either
  api.post("/auth/discord/activity", async (req, res) => {
    const code = String(req.body?.code ?? "");
    if (!code) return res.status(400).json({ error: "code required" });
    if (!opts.discord.clientSecret) {
      const why = "DISCORD_CLIENT_SECRET is not set on the server, so a Discord Activity sign-in can't be exchanged";
      console.error(why);
      return res.status(500).json({ error: why });
    }
    const r = await fetch(`${opts.discord.api}/oauth2/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: DISCORD_APP_ID, client_secret: opts.discord.clientSecret, grant_type: "authorization_code", code }),
    });
    if (!r.ok) return res.status(401).json({ error: `discord refused the code: ${r.status} ${(await r.text()).slice(0, 200)}` });
    const { access_token: accessToken } = (await r.json()) as { access_token?: unknown };
    if (typeof accessToken !== "string") return res.status(502).json({ error: "discord's token response had no access_token" });
    const player = await discordPlayer(accessToken);
    if (typeof player === "string") return res.status(401).json({ error: player });
    res.json(issue(player, req, res));
  });

  api.post("/auth/google", async (req, res) => {
    const idToken = String(req.body?.idToken ?? ""), nonce = String(req.body?.nonce ?? "");
    if (!idToken || !nonce) return res.status(400).json({ error: "idToken and nonce required" });
    const r = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`);
    if (!r.ok) return res.status(401).json({ error: `google said ${r.status}` });
    const t = (await r.json()) as { aud: string; iss: string; sub: string; nonce?: string; picture?: string };
    if (t.aud !== GOOGLE_CLIENT_ID || !["accounts.google.com", "https://accounts.google.com"].includes(t.iss)) return res.status(401).json({ error: "that token isn't for this game" });
    if (t.nonce !== nonce) return res.status(401).json({ error: "sign-in expired, try again" });
    // a guest who signs in keeps the name they've been playing under
    const was = playerOf(req);
    const player: Player = { id: `google-${t.sub}`, name: was && isGuest(was.id) ? was.name : randomName(), avatar: t.picture ?? null };
    res.json(issue(player, req, res));
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
    res.json(issue(player, req, res));
  });

  // a browser's first visit; a busy school network shares one address, so the cap is generous
  const guestsPerHour = new Map<string, { hour: number; n: number }>();
  api.post("/auth/guest", (req, res) => {
    const ip = clientIp(req), hour = Math.floor(Date.now() / 3_600_000);
    const seen = guestsPerHour.get(ip);
    if (seen && seen.hour !== hour) for (const [k, v] of guestsPerHour) if (v.hour !== hour) guestsPerHour.delete(k);
    const n = seen?.hour === hour ? seen.n : 0;
    if (n >= GUESTS_PER_HOUR) return res.status(429).json({ error: "too many new guests from this network: try again in an hour" });
    guestsPerHour.set(ip, { hour, n: n + 1 });
    res.json(issue(newGuest(), req, res));
  });

  api.post("/auth/login", async (req, res) => {
    const account = accounts.get(String(req.body?.email ?? "").trim().toLowerCase());
    const password = String(req.body?.password ?? "").slice(0, PASSWORD_MAX);
    if (!account || !(await passwordMatches(account, password))) return res.status(401).json({ error: "wrong email or password" });
    res.json(issue(account.player, req, res));
  });

  if (opts.devLogin) {
    api.post("/auth/dev", (req, res) => {
      const name = cleanName(req.body?.name);
      const player: Player = { id: `dev-${name.toLowerCase().replace(/\W+/g, "-")}`, name, avatar: null };
      res.json(issue(player, req, res));
    });
  }

  if (opts.botKey) {
    const key = Buffer.from(opts.botKey);
    api.post("/auth/bot", (req, res) => {
      const given = Buffer.from(String(req.body?.key ?? ""));
      if (given.length !== key.length || !crypto.timingSafeEqual(given, key)) return res.status(401).json({ error: "wrong bot key" });
      const name = cleanName(req.body?.name);
      const player: Player = { id: `bot-${name.toLowerCase().replace(/\W+/g, "-")}`, name, avatar: null };
      res.json(issue(player, req, res));
    });
  }

  api.get("/me", (req, res) => {
    const player = playerOf(req);
    if (!player) return res.status(401).json({ error: "not signed in" });
    res.json({ player });
  });

  // an account picks the name everyone sees: on their characters, their maps and in rooms
  api.post("/me/name", (req, res) => {
    const player = playerOf(req);
    if (!player) return res.status(401).json({ error: "not signed in" });
    if (isGuest(player.id)) return res.status(403).json({ error: "sign in to pick your own name" });
    const name = typedName(req.body?.name);
    if (!name) return res.status(400).json({ error: "a name needs letters or numbers" });
    const renamed = renamePlayer(player.id, name);
    for (const s of sessions.values()) if (s.player.id === renamed.id) s.player = renamed;
    save();
    for (const a of accounts.values()) if (a.player.id === renamed.id) { a.player = renamed; saveAccounts(); }
    renameMapsOf(renamed);
    renameJobsOf(renamed);
    res.json({ player: renamed });
  });

  // a returning player with a saved session, opening the game
  api.post("/me/played", (req, res) => {
    const player = playerOf(req);
    if (!player) return res.status(401).json({ error: "not signed in" });
    res.json(markPlayed(player));
  });

  // they opened something with a NEW sticker on it
  api.post("/me/news/:what", (req, res) => {
    const player = playerOf(req);
    if (!player) return res.status(401).json({ error: "not signed in" });
    const what = req.params.what;
    if (what !== "characters" && what !== "community") return res.status(400).json({ error: `no such news: ${what}` });
    res.json({ news: seeNews(player.id, what) });
  });

  api.post("/auth/logout", (req, res) => {
    const token = req.get(SESSION_HEADER);
    if (token && sessions.delete(token)) save();
    res.status(204).end();
  });
}
