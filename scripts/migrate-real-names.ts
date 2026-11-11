// One-off: every Google player, and any other player ids given, gets a made-up two-word name in place of the one on
// file (Google sign-ins used to take the Google first name). Rewrites it everywhere it's stored: the player's record,
// their sessions, their email account, their maps and their forge jobs. Every character bundle loses the name of who drew it.
// Run with the server stopped. Usage: tsx scripts/migrate-real-names.ts <dataDir> [playerId ...]
import fs from "node:fs";
import path from "node:path";
import { randomName } from "../server/names";

const [dataDir, ...extra] = process.argv.slice(2);
if (!dataDir) throw new Error("usage: migrate-real-names.ts <dataDir> [playerId ...]");
const read = (f: string): any => JSON.parse(fs.readFileSync(path.join(dataDir, f), "utf8"));
const write = (f: string, v: unknown, indent?: number): void => fs.writeFileSync(path.join(dataDir, f), JSON.stringify(v, null, indent));

const names = new Map<string, string>();
const playerFiles = fs.readdirSync(path.join(dataDir, "players")).filter((f) => f.endsWith(".json"));
for (const id of extra) if (!playerFiles.includes(`${id}.json`)) throw new Error(`no such player: ${id}`);
for (const f of playerFiles) {
  const id = path.basename(f, ".json");
  if (!id.startsWith("google-") && !extra.includes(id)) continue;
  const lib = read(`players/${f}`);
  if (!lib.player) throw new Error(`players/${f} has no player`);
  const name = randomName();
  names.set(id, name);
  lib.player.name = name;
  write(`players/${f}`, lib, 1);
}

const sessions = read("sessions.json") as [string, { player: { id: string; name: string } }][];
let sessionCount = 0;
for (const [, s] of sessions) { const name = names.get(s.player.id); if (name) { s.player.name = name; sessionCount++; } }
write("sessions.json", sessions);

const accounts = read("accounts.json") as [string, { player: { id: string; name: string } }][];
let accountCount = 0;
for (const [, a] of accounts) { const name = names.get(a.player.id); if (name) { a.player.name = name; accountCount++; } }
write("accounts.json", accounts);

let mapCount = 0;
for (const f of fs.readdirSync(path.join(dataDir, "maps")).filter((f) => f.endsWith(".json"))) {
  const doc = read(`maps/${f}`);
  const name = names.get(doc.owner);
  if (!name) continue;
  doc.ownerName = name;
  write(`maps/${f}`, doc, 1);
  mapCount++;
}

const jobs = read("forge-jobs.json") as { owner: string; playerName: string }[];
let jobCount = 0;
for (const job of jobs) { const name = names.get(job.owner); if (name) { job.playerName = name; jobCount++; } }
write("forge-jobs.json", jobs);

// bundles are public files and used to name who drew them; nothing reads that
let bundleCount = 0;
const gen = path.join(dataDir, "gen");
for (const f of fs.readdirSync(gen, { recursive: true }) as string[]) {
  if (path.basename(f) !== "bundle.json") continue;
  const bundle = JSON.parse(fs.readFileSync(path.join(gen, f), "utf8"));
  if (!("player" in bundle)) continue;
  delete bundle.player;
  fs.writeFileSync(path.join(gen, f), JSON.stringify(bundle));
  bundleCount++;
}
console.log(`renamed ${names.size} players: ${sessionCount} sessions, ${accountCount} email accounts, ${mapCount} maps, ${jobCount} forge jobs; ${bundleCount} bundles no longer name a player`);
