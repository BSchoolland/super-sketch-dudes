import crypto from "node:crypto";
import { CRAZYGAMES_PREFIX } from "../shared/account";

/**
 * Who a CrazyGames user token says the player is. The SDK's `getUserToken({ signingKeyType: "IN_GAME_AUTH" })` is an
 * RS256 JWT signed with a key CrazyGames publishes as a JWKS; it carries the CrazyGames user and the game it was
 * minted for, and lives an hour.
 */
export const CRAZYGAMES_JWKS = "https://userportal.crazygames.com/.well-known/jwks.json";

export interface CrazyGamesUser { userId: string; username: string; profilePictureUrl: string | null }
export interface Jwk { kid?: string; kty: string; alg?: string; n?: string; e?: string }

/** A user id becomes a player id, and player ids name files: anything but these characters is refused. */
const USER_ID = /^[\w-]{1,64}$/;

export const crazyGamesPlayerId = (userId: string): string => `${CRAZYGAMES_PREFIX}${userId}`;

const part = (s: string): unknown => JSON.parse(Buffer.from(s, "base64url").toString("utf8"));

/** Why a token isn't a user: a bad signature, another game's token, an expired one; `unknownKey` when it names a key we don't have. */
export interface TokenRefusal { error: string; unknownKey?: true }

/** The token's user, or why it isn't one. `now` in ms. */
export function verifyCrazyGamesToken(token: string, keys: Jwk[], gameId: string, now: number): CrazyGamesUser | TokenRefusal {
  const pieces = token.split(".");
  if (pieces.length !== 3) return { error: "not a token" };
  let header: { alg?: unknown; kid?: unknown }, payload: Record<string, unknown>;
  try {
    header = part(pieces[0]) as typeof header;
    payload = part(pieces[1]) as Record<string, unknown>;
  } catch (error) {
    return { error: `unreadable token: ${error instanceof Error ? error.message : String(error)}` };
  }
  if (header.alg !== "RS256") return { error: `token signed with ${String(header.alg)}, not RS256` };
  // the in-game auth key names itself; the SDK's local demo tokens name none, and a nameless token must match some key
  const candidates = header.kid === undefined ? keys.filter((k) => k.kty === "RSA") : keys.filter((k) => k.kid === header.kid);
  if (!candidates.length) return { error: `no CrazyGames key ${String(header.kid)}`, unknownKey: true };
  const signed = Buffer.from(`${pieces[0]}.${pieces[1]}`), signature = Buffer.from(pieces[2], "base64url");
  if (!candidates.some((k) => crypto.verify("RSA-SHA256", signed, crypto.createPublicKey({ key: k as crypto.JsonWebKey, format: "jwk" }), signature))) return { error: "bad signature" };
  if (typeof payload.exp !== "number" || payload.exp * 1000 <= now) return { error: "token expired" };
  if (payload.gameId !== gameId) return { error: `token is for game ${String(payload.gameId)}, not this one` };
  const { userId, username, profilePictureUrl } = payload;
  if (typeof userId !== "string" || !USER_ID.test(userId)) return { error: `unexpected user id ${JSON.stringify(userId)}` };
  if (typeof username !== "string" || !username) return { error: "token has no username" };
  return { userId, username, profilePictureUrl: typeof profilePictureUrl === "string" && profilePictureUrl ? profilePictureUrl : null };
}

/** CrazyGames' keys, fetched on first use and again on `refresh` (a token named a key we don't have), at most once a minute. */
export function crazyGamesKeys(url: string): (refresh: boolean) => Promise<Jwk[]> {
  let keys: Jwk[] | null = null, refreshedAt = -Infinity;
  return async (refresh) => {
    if (keys && !(refresh && Date.now() - refreshedAt > 60_000)) return keys;
    if (keys) refreshedAt = Date.now();
    const r = await fetch(url);
    if (!r.ok) throw new Error(`CrazyGames' keys (${url}) said ${r.status}`);
    const body = (await r.json()) as { keys?: unknown };
    if (!Array.isArray(body.keys) || !body.keys.length) throw new Error(`CrazyGames' keys (${url}) had no keys`);
    keys = body.keys as Jwk[];
    return keys;
  };
}
