import crypto from "node:crypto";

/**
 * ICE servers for the players' peer-to-peer links. STUN finds each player's public address; TURN relays a pair
 * whose networks can't reach each other directly. TURN credentials follow coturn's REST scheme (`use-auth-secret`):
 * the username is the expiry time, the password an HMAC of it under the secret coturn shares with this server.
 *   RTC_STUN         comma-separated stun: URLs
 *   RTC_TURN         comma-separated turn:/turns: URLs
 *   RTC_TURN_SECRET  coturn's static-auth-secret
 * With none set, peers only find each other on a shared network and every other pair plays over the relay.
 */
export interface IceServer { urls: string[]; username?: string; credential?: string }

const TTL_S = 24 * 3600;
const list = (v: string | undefined): string[] => (v ?? "").split(",").map((s) => s.trim()).filter(Boolean);

export function iceConfigured(env = process.env): { stun: number; turn: number } {
  return { stun: list(env.RTC_STUN).length, turn: env.RTC_TURN_SECRET ? list(env.RTC_TURN).length : 0 };
}

export function iceServers(user: string, now = Date.now(), env = process.env): IceServer[] {
  const servers: IceServer[] = [];
  const stun = list(env.RTC_STUN), turn = list(env.RTC_TURN);
  if (stun.length) servers.push({ urls: stun });
  if (turn.length) {
    if (!env.RTC_TURN_SECRET) throw new Error("RTC_TURN is set without RTC_TURN_SECRET");
    const username = `${Math.floor(now / 1000) + TTL_S}:${user}`;
    const credential = crypto.createHmac("sha1", env.RTC_TURN_SECRET).update(username).digest("base64");
    servers.push({ urls: turn, username, credential });
  }
  return servers;
}
