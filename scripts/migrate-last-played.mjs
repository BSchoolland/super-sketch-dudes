// One-off: gives every player a record with lastPlayed 0.1.0 (Alpha), dated by the latest sign-in or character we know of.
// Covers players with a file under players/ and those only in sessions.json or accounts.json. Run with the server stopped.
// Usage: node scripts/migrate-last-played.mjs <dataDir>
import fs from "node:fs";
import path from "node:path";

const dataDir = process.argv[2];
if (!dataDir) throw new Error("usage: migrate-last-played.mjs <dataDir>");
const dir = path.join(dataDir, "players");
const fileOf = (id) => path.join(dir, `${id.replace(/[^\w-]/g, "_")}.json`);
const read = (f) => (fs.existsSync(path.join(dataDir, f)) ? JSON.parse(fs.readFileSync(path.join(dataDir, f), "utf8")) : []);

const latest = new Map(), players = new Map();
const seen = (player, at) => {
  players.set(player.id, player);
  if (at) latest.set(player.id, Math.max(latest.get(player.id) ?? 0, at));
};
for (const [, s] of read("sessions.json")) seen(s.player, s.at);
for (const [, a] of read("accounts.json")) seen(a.player, 0);

const now = Date.now();
let migrated = 0, created = 0;
for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".json"))) {
  const lib = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
  if ("lastPlayed" in lib) continue;
  const id = path.basename(f, ".json");
  const at = Math.max(latest.get(lib.player?.id ?? id) ?? 0, ...lib.characters.map((c) => c.createdAt));
  fs.writeFileSync(path.join(dir, f), JSON.stringify({ player: lib.player, lastPlayed: { version: "0.1.0", at: at || now }, characters: lib.characters }, null, 1));
  migrated++;
}
for (const [id, player] of players) {
  if (fs.existsSync(fileOf(id))) continue;
  fs.writeFileSync(fileOf(id), JSON.stringify({ player, lastPlayed: { version: "0.1.0", at: latest.get(id) ?? now }, characters: [] }, null, 1));
  created++;
}
console.log(`migrated ${migrated} player files, created ${created} for players with no characters`);
