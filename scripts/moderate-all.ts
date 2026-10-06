// Runs the auto moderator's judges over every finished character and holds the flagged ones out of COMMUNITY.
// Nobody's library changes and nobody's reputation moves. Resumable: characters already in the results file are skipped.
// Usage: npx tsx scripts/moderate-all.ts [results.jsonl]   (SITE and FORGE_TOKEN from the forge env)
import fs from "node:fs";
import path from "node:path";
import { loadForgeEnv } from "../forge/env";
import { moderate, ModerationUnavailable } from "../forge/moderate";

loadForgeEnv();
const SITE = (process.env.SITE ?? "").replace(/\/$/, "");
const TOKEN = process.env.FORGE_TOKEN ?? "";
if (!SITE || !TOKEN) throw new Error("SITE and FORGE_TOKEN must be set");
const RESULTS = path.resolve(process.argv[2] ?? "forge/runs/moderate-all.jsonl");
const WORK = path.join(path.dirname(RESULTS), "moderate-all");
const PARALLEL = 3;
/** This many judge failures in a row means the judges are down (a usage limit, a logout): stop rather than skip everyone. */
const GIVE_UP = 3;

const done = new Set(fs.existsSync(RESULTS) ? fs.readFileSync(RESULTS, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l).id as string) : []);
const everyone = (await (await fetch(`${SITE}/api/characters/everyone`)).json()).characters as { id: string; name: string | null }[];
const todo = everyone.filter((c) => !done.has(c.id));
console.log(`${everyone.length} characters, ${done.size} already judged, ${todo.length} to go`);

let failedInARow = 0, judged = 0, held = 0, stopped = "";
async function one(c: { id: string; name: string | null }): Promise<void> {
  const dir = path.join(WORK, c.id);
  fs.mkdirSync(dir, { recursive: true });
  const res = await fetch(`${SITE}/gen/drawings/${c.id}.png`);
  if (!res.ok) { fs.appendFileSync(RESULTS, JSON.stringify({ id: c.id, name: c.name, error: `drawing: HTTP ${res.status}` }) + "\n"); return; }
  const drawing = path.join(dir, "drawing.png");
  fs.writeFileSync(drawing, Buffer.from(await res.arrayBuffer()));
  let j;
  try { j = await moderate(drawing, c.name ?? "", dir); } catch (e) {
    if (!(e instanceof ModerationUnavailable)) throw e;
    console.log(`${c.id}: judges unavailable: ${e.message}`);
    if (++failedInARow >= GIVE_UP) stopped = `judges failed ${GIVE_UP} times in a row: ${e.message}`;
    return;
  }
  failedInARow = 0;
  const flagged = j.harsh.verdict !== "pass" || j.lenient.verdict !== "pass";
  if (flagged) {
    const r = await fetch(`${SITE}/api/characters/${c.id}/hold`, { method: "POST", headers: { "x-forge-token": TOKEN } });
    if (r.status !== 204) throw new Error(`hold ${c.id}: HTTP ${r.status} ${await r.text()}`);
    held++;
  }
  fs.appendFileSync(RESULTS, JSON.stringify({ id: c.id, name: c.name, ...j, held: flagged, at: Date.now() }) + "\n");
  console.log(`${++judged}/${todo.length} ${c.id} ${c.name}: harsh ${j.harsh.verdict}, lenient ${j.lenient.verdict}${flagged ? " -> held" : ""}`);
}

const queue = [...todo];
await Promise.all(Array.from({ length: PARALLEL }, async () => { for (let c = queue.shift(); c && !stopped; c = queue.shift()) await one(c); }));
console.log(`${stopped ? "STOPPED" : "done"}: ${judged} judged, ${held} held${stopped ? `; ${stopped} (rerun to resume)` : ""}`);
if (stopped) process.exit(2);
