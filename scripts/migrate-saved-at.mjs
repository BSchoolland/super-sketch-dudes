// One-off: turns each player's saved ids into { id, at }, dated now, so a library can sort saves by when they were made.
// Run with the server stopped. Usage: node scripts/migrate-saved-at.mjs <dataDir>
import fs from "node:fs";
import path from "node:path";

const dataDir = process.argv[2];
if (!dataDir) throw new Error("usage: migrate-saved-at.mjs <dataDir>");
const dir = path.join(dataDir, "players");
const now = Date.now();
let migrated = 0;
for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".json"))) {
  const file = path.join(dir, f);
  const lib = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!lib.saved?.some((s) => typeof s === "string")) continue;
  lib.saved = lib.saved.map((s) => (typeof s === "string" ? { id: s, at: now } : s));
  fs.writeFileSync(file, JSON.stringify(lib, null, 1));
  migrated++;
}
console.log(`migrated saves in ${migrated} player files`);
