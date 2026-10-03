// One-off: seeds <dataDir>/plays.json from the relay's match events, so fighters played before play counts existed don't start at 0.
// Counts each server match trace once, +1 per member's fighter, same as recordPlays at START. Does nothing if plays.json exists.
// Run with the server stopped, before this build first starts. Usage: node scripts/backfill-plays.mjs <dataDir>
import fs from "node:fs";
import path from "node:path";

const dataDir = process.argv[2];
if (!dataDir) throw new Error("usage: backfill-plays.mjs <dataDir>");
const out = path.join(dataDir, "plays.json");
if (fs.existsSync(out)) {
  console.log(`${out} exists, not backfilling`);
  process.exit(0);
}

const log = path.join(dataDir, "events.jsonl");
const files = [log + ".1", log].filter((f) => fs.existsSync(f));
if (!files.length) throw new Error(`no ${log}`);

// The first snapshot of a match is written before its members are set; a later one carries them.
const traces = new Set(), members = new Map();
for (const file of files) {
  fs.readFileSync(file, "utf8").split("\n").forEach((line, i) => {
    if (!line) return;
    let e;
    try { e = JSON.parse(line); } catch (err) { throw new Error(`${file}:${i + 1}: ${err.message}`); }
    if (e.kind !== "match" || e.source !== "server") return;
    traces.add(e.trace);
    const list = e.business.members;
    if (list === undefined || members.has(e.trace)) return;
    if (!Array.isArray(list) || !list.length || list.some((m) => typeof m?.fighter !== "string" || !m.fighter)) {
      throw new Error(`${file}:${i + 1}: match ${e.trace} has malformed members ${JSON.stringify(list)}`);
    }
    members.set(e.trace, list.map((m) => m.fighter));
  });
}
const unknown = [...traces].filter((t) => !members.has(t));
if (unknown.length) throw new Error(`matches with no members snapshot: ${unknown.join(" ")}`);

const plays = {};
for (const fighters of members.values()) for (const id of fighters) plays[id] = (plays[id] ?? 0) + 1;
fs.writeFileSync(out, JSON.stringify(plays), { flag: "wx" });
const top = Object.entries(plays).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([id, n]) => `${id} ${n}`).join(", ");
console.log(`${members.size} matches, ${Object.keys(plays).length} fighters into ${out}; top: ${top}`);
