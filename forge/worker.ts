// The forge worker: polls the site for forge jobs, runs the forge, posts the fighter back.
// Usage: npx tsx forge/worker.ts   (SITE, FORGE_TOKEN, OPENAI_API_KEY from the env, forge/.env or ~/.config/sketch-forge/env)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadForgeEnv } from "./env";
import { runForge, ForgeError, type JobSpec } from "./forge";
import { moderate, ModerationUnavailable } from "./moderate";
import { alertFlagged, alertUnavailable, checkAlertConfig, queueReview, type Submission } from "./mod-alerts";

loadForgeEnv();
const SITE = (process.env.SITE ?? "").replace(/\/$/, "");
const TOKEN = process.env.FORGE_TOKEN ?? "";
if (!SITE || !TOKEN) throw new Error("SITE and FORGE_TOKEN must be set (env, forge/.env or ~/.config/sketch-forge/env)");
if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY must be set (forge/.env)");
checkAlertConfig();
const CONCURRENCY = Number(process.env.FORGE_CONCURRENCY ?? 6);
const POLL_MS = 2000;
const RUNS = path.join(path.dirname(fileURLToPath(import.meta.url)), "runs");

const stamp = () => new Date().toISOString().slice(11, 19);
const log = (tag: string, line: string) => console.log(`${stamp()} [${tag}] ${line}`);

async function api(p: string, init?: RequestInit): Promise<Response> {
  return fetch(`${SITE}/api/forge${p}`, { ...init, headers: { "x-forge-token": TOKEN, "content-type": "application/json", ...(init?.headers ?? {}) } });
}
async function post(p: string, body: unknown): Promise<Response> {
  const res = await api(p, { method: "POST", body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`POST ${p}: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`);
  return res;
}

/** Jobs this worker is on right now, so a job handed out twice (a server that lost track) isn't run twice. */
const active = new Set<string>();

type Claimed = JobSpec & { attempts: number; moderated: boolean };

async function handle(job: Claimed): Promise<void> {
  const tag = job.fighterId;
  if (active.has(job.id)) { log(tag, `claimed job ${job.id} again (attempt ${job.attempts}) while still running it: carrying on with the one in progress`); return; }
  active.add(job.id);
  const dir = path.join(RUNS, job.id);
  fs.mkdirSync(dir, { recursive: true });
  const t0 = Date.now();
  log(tag, `claimed job ${job.id} for ${job.playerName} (attempt ${job.attempts})`);
  try {
    const res = await api(`/jobs/${job.id}/drawing.png`);
    if (!res.ok) throw new Error(`drawing download: HTTP ${res.status}`);
    const drawing = path.join(dir, "drawing.png");
    fs.writeFileSync(drawing, Buffer.from(await res.arrayBuffer()));
    const verdict = job.moderated ? "judged" : await moderated(job, drawing, dir);
    if (verdict === "blocked") return;
    const payload = await runForge(job, drawing, dir, {
      progress: async (stage) => { await post(`/jobs/${job.id}/progress`, { stage }); },
      log: (line) => log(tag, line),
    });
    await post(`/jobs/${job.id}/complete`, payload);
    if (verdict === "unjudged") await queueReview(submissionOf(job, drawing)).catch((e) => log(tag, `REVIEW QUEUE FAILED: ${e instanceof Error ? e.message : String(e)}`));
    log(tag, `DONE ${payload.name} in ${((Date.now() - t0) / 1000).toFixed(0)}s, agent $${payload.report.costUsd.toFixed(2)}`);
  } catch (e) {
    const msg = e instanceof ForgeError ? e.message : `something broke: ${e instanceof Error ? e.message : String(e)}`;
    fs.writeFileSync(path.join(dir, "error.txt"), e instanceof Error ? e.stack ?? e.message : String(e));
    log(tag, `FAILED after ${((Date.now() - t0) / 1000).toFixed(0)}s: ${msg}`);
    await post(`/jobs/${job.id}/fail`, { error: msg }).catch((err) => log(tag, `could not report the failure: ${err.message}`));
  } finally {
    active.delete(job.id);
  }
}

const submissionOf = (job: Claimed, drawing: string): Submission => ({ jobId: job.id, fighterId: job.fighterId, playerName: job.playerName, name: job.hint?.name ?? "", drawing });

/** Runs the judges. Judges that can't run let the character through, loudly ("unjudged"). */
async function moderated(job: Claimed, drawing: string, dir: string): Promise<"judged" | "blocked" | "unjudged"> {
  const tag = job.fighterId;
  const s = submissionOf(job, drawing);
  const alert = (what: string, p: Promise<void>) => p.catch((e) => log(tag, `ALERT FAILED (${what}): ${e instanceof Error ? e.message : String(e)}`));
  await post(`/jobs/${job.id}/progress`, { stage: "auto moderator" });
  let judgements;
  try { judgements = await moderate(drawing, s.name, dir); } catch (e) {
    if (!(e instanceof ModerationUnavailable)) throw e;
    log(tag, `MODERATION UNAVAILABLE, forging unjudged: ${e.message}`);
    await alert("unavailable", alertUnavailable(s, e.message));
    return "unjudged";
  }
  const d = (await (await post(`/jobs/${job.id}/moderation`, judgements)).json()) as { blocked: boolean; before: number; after: number };
  log(tag, `moderation: harsh ${judgements.harsh.verdict}, lenient ${judgements.lenient.verdict}, reputation ${d.before} -> ${d.after}${d.blocked ? ": BLOCKED" : ""}`);
  if (judgements.harsh.verdict !== "pass" || judgements.lenient.verdict !== "pass") await alert("flagged", alertFlagged(s, judgements, d));
  return d.blocked ? "blocked" : "judged";
}

let running = 0;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
log("forge", `polling ${SITE} with ${CONCURRENCY} slots`);
for (;;) {
  if (running >= CONCURRENCY) { await sleep(500); continue; }
  let job: Claimed | null = null;
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
