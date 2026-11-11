// A stand-in for CrazyGames' side of sign-in, for the game played with ?crazygames=stub on a dev build: the key set
// CrazyGames publishes (a test key pair made at start) and a mint for user tokens, which the stub SDK asks for. Run it,
// then the server with DEV_LOGIN=1, CRAZYGAMES_JWKS pointed at it and the same game id:
//   node scripts/fake-crazygames.mjs 3498 test-game
//   DEV_LOGIN=1 CRAZYGAMES_JWKS=http://127.0.0.1:3498/.well-known/jwks.json CRAZYGAMES_GAME_ID=test-game npx tsx server/index.ts
// then open http://localhost:5175/?crazygames=stub&cgapi=http://127.0.0.1:3498&user=Ann_Stub
import http from "node:http";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

/** A CrazyGames user id that only depends on the name. */
export const fakeCrazyGamesUserId = (name) => `cg${crypto.createHash("sha256").update(name).digest("hex").slice(0, 16)}`;

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");

/** An RS256 JWT with `header` and `payload`, signed with `key`. */
export function signJwt(header, payload, key) {
  const body = `${b64(header)}.${b64(payload)}`;
  return `${body}.${crypto.sign("RSA-SHA256", Buffer.from(body), key).toString("base64url")}`;
}

/**
 * Starts it on `port` (0: any free one). `mint(name, overrides)` makes a token the way CrazyGames does (kid
 * `ingame-auth`, an hour to live); overrides change the payload, the header, or sign with another key.
 */
export function startFakeCrazyGames({ gameId, port = 0 }) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: "jwk" }), kid: "ingame-auth", use: "sig", alg: "RS256" };
  const mint = (name, { payload = {}, header = {}, key = privateKey } = {}) => {
    const now = Math.floor(Date.now() / 1000);
    return signJwt({ alg: "RS256", typ: "JWT", kid: "ingame-auth", ...header }, { userId: fakeCrazyGamesUserId(name), username: name, gameId, profilePictureUrl: null, iat: now, exp: now + 3600, ...payload }, key);
  };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://fake");
    // the stub SDK runs in the game's page, on another port
    const reply = (status, json) => { res.writeHead(status, { "content-type": "application/json", "access-control-allow-origin": "*" }); res.end(JSON.stringify(json)); };
    if (req.method === "GET" && url.pathname === "/.well-known/jwks.json") return reply(200, { keys: [jwk] });
    if (req.method === "GET" && url.pathname === "/token") {
      const name = url.searchParams.get("user");
      if (!name || !/^[\w.]{1,20}$/.test(name)) return reply(400, { error: "user=<CrazyGames username> required" });
      return reply(200, { token: mint(name) });
    }
    reply(404, { error: "no such fake endpoint" });
  });
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => {
    const url = `http://127.0.0.1:${server.address().port}`;
    resolve({ url, jwks: `${url}/.well-known/jwks.json`, mint, close: () => server.close() });
  }));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const gameId = process.argv[3];
  if (!gameId) throw new Error("usage: node scripts/fake-crazygames.mjs <port> <game id> (the server's CRAZYGAMES_GAME_ID)");
  const { url, jwks } = await startFakeCrazyGames({ gameId, port: Number(process.argv[2]) });
  console.log(`fake CrazyGames at ${url} (keys at ${jwks})`);
}
