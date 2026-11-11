// One-off: the game moved to the root of supersketchdudes.com, so stored fighter URLs lose their base:
// "/play/gen/" and "/sketch-battle/gen/" become "/gen/" in every .json and .jsonl file of a data dir, but the event logs.
// Dry run by default; --apply backs every file it changes up (same relative path) beside the data dir, then writes it.
//   node scripts/migrate-base.mjs <data dir> [--apply]
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const dataDir = args.find((a) => !a.startsWith("--"));
if (!dataDir || !fs.statSync(dataDir).isDirectory()) throw new Error("usage: node scripts/migrate-base.mjs <data dir> [--apply]");
const root = path.resolve(dataDir);
const OLD = /\/(?:play|sketch-battle)\/gen\//g;
/** events.jsonl and its rotations, and the old client log: what happened then, not data the game reads. */
const isLog = (name) => /^(events|client-log)\.jsonl(\.\d+)?$/.test(name);

function* files(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* files(p);
    else if (e.isFile() && /\.jsonl?$/.test(e.name) && !isLog(e.name)) yield p;
  }
}

const backup = `${root}-before-migrate-base-${new Date().toISOString().replace(/[:.]/g, "-")}`;
let scanned = 0, changed = 0, urls = 0;
const byPlace = new Map();
for (const file of files(root)) {
  scanned++;
  const text = fs.readFileSync(file, "utf8");
  const n = text.match(OLD)?.length ?? 0;
  if (!n) continue;
  const rel = path.relative(root, file);
  const out = text.replace(OLD, "/gen/");
  if (/\.json$/.test(file)) JSON.parse(out);
  else for (const line of out.split("\n")) if (line.trim()) JSON.parse(line);
  changed++;
  urls += n;
  const place = rel.split(path.sep)[0];
  byPlace.set(place, (byPlace.get(place) ?? 0) + 1);
  if (!apply) continue;
  fs.mkdirSync(path.dirname(path.join(backup, rel)), { recursive: true });
  fs.copyFileSync(file, path.join(backup, rel));
  fs.writeFileSync(`${file}.migrating`, out);
  fs.renameSync(`${file}.migrating`, file);
}
console.log(`${scanned} files scanned, ${changed} ${apply ? "changed" : "would change"}, ${urls} URLs`);
for (const [place, n] of [...byPlace].sort((a, b) => b[1] - a[1])) console.log(`  ${place}: ${n}`);
if (apply && changed) console.log(`backups in ${backup}`);
if (!apply) console.log("dry run: --apply writes");
