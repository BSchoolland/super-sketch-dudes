// Copies what the lab needs from production into netlab/.cache/prod (read-only on the server side):
//   node netlab/prod.mjs events              the wide event log, for stats.mjs --prod and scenario targets
//   node netlab/prod.mjs fighter <id> ...    generated fighters' bundles (gen/<id>), so a scenario can fight with them
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const PROD_CACHE = path.join(HERE, ".cache", "prod");
const HOST = process.env.NETLAB_PROD_HOST ?? "personal-server";
const DATA = process.env.NETLAB_PROD_DATA ?? "sketch-battle/server-data";

export function syncEvents() {
  fs.mkdirSync(PROD_CACHE, { recursive: true });
  execFileSync("rsync", ["-az", `${HOST}:${DATA}/events.jsonl*`, `${PROD_CACHE}/`], { stdio: "inherit" });
}

/** Ensures gen/<id> is cached; returns its directory. */
export function syncFighter(id) {
  if (!/^gen-[\w-]+$/.test(id)) throw new Error(`not a generated fighter id: ${id}`);
  const dir = path.join(PROD_CACHE, "gen", id);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(path.dirname(dir), { recursive: true });
    execFileSync("rsync", ["-az", `${HOST}:${DATA}/gen/${id}`, `${path.dirname(dir)}/`], { stdio: "inherit" });
  }
  return dir;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [what, ...ids] = process.argv.slice(2);
  if (what === "events") syncEvents();
  else if (what === "fighter" && ids.length) ids.forEach(syncFighter);
  else throw new Error("usage: node netlab/prod.mjs events | fighter <gen-id> ...");
}
