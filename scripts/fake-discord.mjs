// A stand-in for the two Discord endpoints sign-in uses, for the Activity played with ?activity=stub on a dev build.
// The stub SDK's code for `as=<name>` is "stub-<name>"; this trades it for a token and says the token is <name>,
// with a made-up user id per name. Run it, then the server with DEV_LOGIN=1 and DISCORD_API pointed at it:
//   DISCORD_CLIENT_SECRET=fake node scripts/fake-discord.mjs 3099
//   DEV_LOGIN=1 DISCORD_API=http://localhost:3099/api DISCORD_CLIENT_SECRET=fake npx tsx server/index.ts
// then open http://localhost:5175/sketch-battle/?activity=stub&instance=one&as=Ann
import http from "node:http";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const APP_ID = "1506034935838937201";

/** A Discord user id (a snowflake's shape) that only depends on the name. */
export const fakeUserId = (name) => (BigInt(`0x${crypto.createHash("sha256").update(name).digest("hex").slice(0, 15)}`) + 10n ** 17n).toString();

/** Starts it on `port` (0: any free one); resolves to its API base and what it was asked. */
export function startFakeDiscord({ secret, port = 0 }) {
  const exchanges = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      const reply = (status, json) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(json)); };
      if (req.method === "POST" && req.url === "/api/oauth2/token") {
        const form = new URLSearchParams(body);
        exchanges.push(Object.fromEntries(form));
        if (req.headers["content-type"] !== "application/x-www-form-urlencoded") return reply(400, { error: "invalid_request" });
        if (form.get("client_id") !== APP_ID || form.get("client_secret") !== secret) return reply(401, { error: "invalid_client" });
        // the Embedded App SDK's authorize sends no redirect_uri, so an exchange carrying one would be refused
        if (form.get("grant_type") !== "authorization_code" || form.has("redirect_uri")) return reply(400, { error: "invalid_grant" });
        const name = /^stub-(\w{1,32})$/.exec(form.get("code") ?? "")?.[1];
        if (!name) return reply(400, { error: "invalid_grant" });
        return reply(200, { access_token: `fake-${name}`, token_type: "Bearer", expires_in: 604800, scope: "identify" });
      }
      if (req.method === "GET" && req.url === "/api/users/@me") {
        const name = /^Bearer fake-(\w+)$/.exec(req.headers.authorization ?? "")?.[1];
        if (!name) return reply(401, { message: "401: Unauthorized", code: 0 });
        return reply(200, { id: fakeUserId(name), username: name.toLowerCase(), global_name: name, avatar: null });
      }
      reply(404, { message: "404: Not Found", code: 0 });
    });
  });
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve({ api: `http://127.0.0.1:${server.address().port}/api`, exchanges, close: () => server.close() })));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const secret = process.env.DISCORD_CLIENT_SECRET;
  if (!secret) throw new Error("set DISCORD_CLIENT_SECRET (any value; the server must have the same)");
  const { api } = await startFakeDiscord({ secret, port: Number(process.argv[2] ?? 3099) });
  console.log(`fake Discord at ${api}`);
}
