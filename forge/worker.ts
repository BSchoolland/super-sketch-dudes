// The forge worker: polls the site for draw-battle jobs, runs the pipeline, posts the fighter back.
// Usage: npx tsx forge/worker.ts   (SITE, FORGE_TOKEN, OPENAI_API_KEY from the env, forge/.env or ~/.config/sketch-forge/env)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadForgeEnv } from "./env";
import { runPipeline, ForgeError, type JobSpec } from "./pipeline";

loadForgeEnv();
const SITE = (process.env.SITE ?? "").replace(/\/$/, "");
const TOKEN = process.env.FORGE_TOKEN ?? "";
if (!SITE || !TOKEN) throw new Error("SITE and FORGE_TOKEN must be set (env, forge/.env or ~/.config/sketch-forge/env)");
if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY must be set (forge/.env)");
const CONCURRENCY = Number(process.env.FORGE_CONCURRENCY ?? 4);
const POLL_MS = 2000;
const RUNS = path.join(path.dirname(fileURLToPath(import.meta.url)), "runs");

const stamp = () => new Date().toISOString().slice(11, 19);
const log = (tag: string, line: string) => console.log(`${stamp()} [${tag}] ${line}`);

async function api(p: string, init?: RequestInit): Promise<Response> {
  return fetch(`${SITE}/api/forge${p}`, { ...init, headers: { "x-forge-token": TOKEN, "content-type": "application/json", ...(init?.headers ?? {}) } });
}
async function post(p: string, body: unknown): Promise<void> {
  const res = await api(p, { method: "POST", body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`POST ${p}: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`);
}

async function handle(job: JobSpec & { attempts: number }): Promise<void> {
  const tag = job.fighterId;
  const dir = path.join(RUNS, job.id);
  fs.mkdirSync(dir, { recursive: true });
  const t0 = Date.now();
  log(tag, `claimed job ${job.id} for ${job.playerName} round ${job.round} (attempt ${job.attempts})`);
  try {
    const res = await api(`/jobs/${job.id}/drawing.png`);
    if (!res.ok) throw new Error(`drawing download: HTTP ${res.status}`);
    const drawing = path.join(dir, "drawing.png");
    fs.writeFileSync(drawing, Buffer.from(await res.arrayBuffer()));
    const payload = await runPipeline(job, drawing, dir, {
      progress: (stage) => post(`/jobs/${job.id}/progress`, { stage }),
      log: (line) => log(tag, line),
    });
    await post(`/jobs/${job.id}/complete`, payload);
    log(tag, `DONE ${payload.name} in ${((Date.now() - t0) / 1000).toFixed(0)}s, $${payload.report.costUsd.toFixed(2)} (agent $${payload.report.agent.costUsd.toFixed(2)}, sheet ~$${(payload.report.sheet.costUsd ?? NaN).toFixed(2)})`);
  } catch (e) {
    const msg = e instanceof ForgeError ? e.message : `forge error: ${e instanceof Error ? e.message : String(e)}`;
    fs.writeFileSync(path.join(dir, "error.txt"), e instanceof Error ? e.stack ?? e.message : String(e));
    log(tag, `FAILED after ${((Date.now() - t0) / 1000).toFixed(0)}s: ${msg}`);
    await post(`/jobs/${job.id}/fail`, { error: msg }).catch((err) => log(tag, `could not report the failure: ${err.message}`));
  }
}

let running = 0;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
log("forge", `polling ${SITE} with ${CONCURRENCY} slots`);
for (;;) {
  if (running >= CONCURRENCY) { await sleep(500); continue; }
  let job: (JobSpec & { attempts: number }) | null = null;
  try {
    const res = await api("/jobs/next");
    if (res.status === 200) job = await res.json();
    else if (res.status !== 204) log("forge", `poll: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  } catch (e) {
    log("forge", `poll failed: ${(e as Error).message}`);
  }
  if (!job) { await sleep(POLL_MS); continue; }
  running++;
  void handle(job).finally(() => running--);
}
