import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type express from "express";
import type { LibraryEntry, Player } from "../shared/account";
import type { CharStatus } from "../shared/account";
import { buildGenerated } from "../shared/gen/load";
import { SPRITE_CELLS } from "../shared/gen/sprite";
import { upsertCharacter } from "./library";
import { finish, openEvent } from "./events";
import type { WideEvent } from "../shared/wide";

/**
 * The forge job queue. A job is one drawing becoming one fighter; it belongs to a player and
 * lands in their library whatever started it. The forge
 * worker on Ben's machine polls /forge/jobs/next with FORGE_TOKEN; nothing here calls out to it.
 */
export interface ForgeJob {
  id: string;
  fighterId: string;
  owner: string;
  playerName: string;
  /** Names of the player's other characters so the agent avoids repeats. */
  drawingPath: string;
  status: "queued" | "running" | "done" | "failed";
  stage: string;
  error: string | null;
  claimedAt: number;
  attempts: number;
  origin: LibraryEntry["origin"];
  /** What the player typed about it, if anything: the design pass reads it. */
  hint: { name: string; description: string } | null;
  createdAt: number;
  /** Filled in on completion. */
  result: { name: string; tagline: string; description: string; card: string[] | null; bundleUrl: string; sheetUrl: string | null } | null;
}

const jobs = new Map<string, ForgeJob>();
const queue: string[] = [];
/** Each job's wide event, from queued to done or failed. A restart starts a new one on the same trace. */
const events = new Map<string, WideEvent>();
let genDir = "", genBase = "", jobsFile = "";

/** Every job change is written out, so a restart mid-character requeues it instead of stranding it. */
function persist(): void {
  if (jobsFile) fs.writeFileSync(jobsFile, JSON.stringify([...jobs.values()]));
}
function restore(): void {
  if (!fs.existsSync(jobsFile)) return;
  const saved = JSON.parse(fs.readFileSync(jobsFile, "utf8")) as ForgeJob[];
  for (const job of saved) {
    jobs.set(job.id, job);
    if (job.status === "queued" || job.status === "running") {
      job.status = "queued"; job.stage = "back in line after a restart"; job.claimedAt = 0;
      queue.push(job.id);
    }
  }
  const requeued = queue.length;
  if (requeued) console.log(`forge: requeued ${requeued} job(s) from before the restart`);
  for (const id of queue) { const job = jobs.get(id)!; openJobEvent(job, null).set("restored", true); upsertCharacter(entryOf(job)); }
}

export const jobOf = (id: string): ForgeJob | undefined => jobs.get(id);
export const drawingUrlOf = (fighterId: string): string => `${genBase}/drawings/${fighterId}.png`;

export function charStatusOf(job: ForgeJob): CharStatus {
  return job.status === "running" ? "generating" : job.status === "done" ? "ready" : job.status;
}

export function entryOf(job: ForgeJob): LibraryEntry {
  return {
    id: job.fighterId, owner: job.owner, status: charStatusOf(job), stage: job.stage, error: job.error,
    name: job.result?.name ?? null, tagline: job.result?.tagline ?? null, description: job.result?.description ?? null, card: job.result?.card ?? null,
    drawingUrl: drawingUrlOf(job.fighterId), bundleUrl: job.result?.bundleUrl ?? null, sheetUrl: job.result?.sheetUrl ?? null,
    createdAt: job.createdAt, origin: job.origin,
  };
}

function openJobEvent(job: ForgeJob, parent: string | null): WideEvent {
  const e = openEvent("forge", `f-${job.id}`, parent)
    .set("job", { id: job.id, fighterId: job.fighterId, owner: job.owner, player: job.playerName, origin: job.origin, hint: !!job.hint })
    .set("timeline", []);
  events.set(job.id, e);
  return e;
}

function record(job: ForgeJob): void {
  const e = events.get(job.id);
  if (!e) return;
  const timeline = e.business.timeline as { status: string; stage: string; at: number }[];
  const last = timeline[timeline.length - 1];
  if ((!last || last.status !== job.status || last.stage !== job.stage) && timeline.length < 60) timeline.push({ status: job.status, stage: job.stage, at: Date.now() - e.t0 });
  e.set("attempts", job.attempts);
  if (job.claimedAt) e.set("queuedMs", job.claimedAt - job.createdAt);
  if (job.status === "done") {
    e.set("result", { message: `${job.result?.name ?? "?"} forged in ${Math.round((Date.now() - job.createdAt) / 1000)} s`, bundleUrl: job.result?.bundleUrl ?? null });
    finish(e); events.delete(job.id);
  } else if (job.status === "failed") {
    e.issue("error", "failed", job.error ?? "no reason given");
    finish(e); events.delete(job.id);
  }
}

function changed(job: ForgeJob, player?: Player): void {
  upsertCharacter(entryOf(job), player);
  persist();
  record(job);
}

/** Stores the drawing and queues the job; the library gets the entry at once, as "queued". */
/** `parent` is the trace the job came from: the creator's request. */
export function enqueueJob(spec: { fighterId: string; player: Player; png: Buffer; origin: LibraryEntry["origin"]; hint?: { name: string; description: string } | null; parent: string | null }): ForgeJob {
  const drawingPath = path.join(genDir, "drawings", `${spec.fighterId}.png`);
  fs.mkdirSync(path.dirname(drawingPath), { recursive: true });
  fs.writeFileSync(drawingPath, spec.png);
  const job: ForgeJob = {
    id: crypto.randomBytes(6).toString("hex"), fighterId: spec.fighterId, owner: spec.player.id, playerName: spec.player.name,
    drawingPath, status: "queued", stage: "waiting in line", error: null, claimedAt: 0, attempts: 0, origin: spec.origin, hint: spec.hint ?? null, createdAt: Date.now(), result: null,
  };
  jobs.set(job.id, job);
  queue.push(job.id);
  openJobEvent(job, spec.parent).set("bytes", spec.png.length);
  changed(job, spec.player);
  return job;
}

/** Writes a finished character's files under /gen/<id>/ (validating the module) and returns what the library shows. */
export async function storeCharacter(fighterId: string, playerName: string, b: any): Promise<NonNullable<ForgeJob["result"]>> {
  for (const k of ["name", "tagline", "description", "source"]) if (typeof b[k] !== "string") throw new Error(`${k} must be a string`);
  if (!b.sprite || typeof b.sprite !== "object") throw new Error("sprite missing");
  if (!b.cells || typeof b.cells !== "object") throw new Error("cells missing");
  for (const c of SPRITE_CELLS) if (typeof b.cells[c] !== "string") throw new Error(`cell ${c} missing`);
  // gen files are served immutable, so every version of a character gets its own URLs (re-imports, retries)
  const ver = crypto.createHash("sha1").update(b.source).update(Object.keys(b.cells).sort().map((c) => b.cells[c]).join("")).digest("hex").slice(0, 8);
  const dir = path.join(genDir, fighterId, ver);
  const base = `${genBase}/${fighterId}/${ver}`;
  fs.mkdirSync(dir, { recursive: true });
  const cells: Record<string, string> = {};
  for (const c of Object.keys(b.cells)) {
    if (!/^[\w-]+$/.test(c)) continue;
    fs.writeFileSync(path.join(dir, `${c}.png`), Buffer.from(b.cells[c], "base64")); cells[c] = `${base}/${c}.png`;
  }
  if (typeof b.sheet === "string") fs.writeFileSync(path.join(dir, "sheet.png"), Buffer.from(b.sheet, "base64"));
  const sprite = { px: Number(b.sprite.px), feetPx: Number(b.sprite.feetPx), heightPx: Number(b.sprite.heightPx), anims: b.sprite.anims && typeof b.sprite.anims === "object" ? b.sprite.anims : {}, cells };
  const bundle = { id: fighterId, player: playerName, description: b.description, source: b.source, sprite };
  await buildGenerated(bundle); // the forge already validated; this is the server refusing to serve a broken one
  fs.writeFileSync(path.join(dir, "bundle.json"), JSON.stringify(bundle));
  if (b.report !== undefined) fs.writeFileSync(path.join(dir, "report.json"), JSON.stringify(b.report));
  return {
    name: b.name.slice(0, 28), tagline: b.tagline.slice(0, 120), description: b.description.slice(0, 600),
    card: Array.isArray(b.card) ? b.card.slice(0, 4).map((c: unknown) => String(c).slice(0, 60)) : null,
    bundleUrl: `${base}/bundle.json`, sheetUrl: typeof b.sheet === "string" ? `${base}/sheet.png` : null,
  };
}

export function newFighterId(prefix: string): string {
  return `gen-${prefix}-${crypto.randomBytes(3).toString("hex")}`;
}

export interface ForgeOptions { token: string; dataDir: string; genBase: string }

export function attachForge(api: express.Router, opts: ForgeOptions): void {
  genDir = path.join(opts.dataDir, "gen");
  genBase = opts.genBase;
  fs.mkdirSync(genDir, { recursive: true });
  jobsFile = path.join(opts.dataDir, "forge-jobs.json");
  restore();

  const setStatus = (job: ForgeJob, status: ForgeJob["status"], stage: string, error: string | null = null): void => {
    job.status = status; job.stage = stage; job.error = error;
    changed(job);
  };

  // a job the forge claimed but never finished goes back on the queue once
  setInterval(() => {
    for (const job of jobs.values()) {
      if (job.status === "running" && Date.now() - job.claimedAt > 15 * 60_000) {
        events.get(job.id)?.issue("warn", "timeout", `claimed ${Math.round((Date.now() - job.claimedAt) / 60_000)} min ago and never finished`);
        if (job.attempts >= 2) setStatus(job, "failed", "", "gave up on this one after two tries");
        else { queue.push(job.id); setStatus(job, "queued", "back in line"); }
      }
    }
  }, 15_000).unref();

  const forgeAuth = (req: express.Request, res: express.Response): boolean => {
    const t = req.get("x-forge-token") ?? String(req.query.token ?? "");
    if (!opts.token || t !== opts.token) { res.status(401).json({ error: "bad forge token" }); return false; }
    return true;
  };
  api.get("/forge/jobs/next", (req, res) => {
    if (!forgeAuth(req, res)) return;
    while (queue.length) {
      const id = queue.shift()!;
      const job = jobs.get(id);
      if (!job || job.status !== "queued") continue;
      job.claimedAt = Date.now(); job.attempts++;
      setStatus(job, "running", "reading the drawing");
      return res.json({ id: job.id, fighterId: job.fighterId, playerName: job.playerName, attempts: job.attempts, hint: job.hint });
    }
    res.status(204).end();
  });
  api.get("/forge/jobs/:id/drawing.png", (req, res) => {
    if (!forgeAuth(req, res)) return;
    const job = jobs.get(req.params.id);
    if (!job) return res.status(404).end();
    res.sendFile(job.drawingPath);
  });
  api.post("/forge/jobs/:id/progress", (req, res) => {
    if (!forgeAuth(req, res)) return;
    const job = jobs.get(req.params.id);
    if (!job || job.status !== "running") return res.status(409).json({ error: "job not running" });
    setStatus(job, "running", String(req.body?.stage ?? "").slice(0, 80));
    res.status(204).end();
  });
  api.post("/forge/jobs/:id/fail", (req, res) => {
    if (!forgeAuth(req, res)) return;
    const job = jobs.get(req.params.id);
    if (!job || job.status !== "running") return res.status(409).json({ error: "job not running" });
    setStatus(job, "failed", "", String(req.body?.error ?? "couldn't be made").slice(0, 300));
    res.status(204).end();
  });
  api.post("/forge/jobs/:id/complete", async (req, res) => {
    if (!forgeAuth(req, res)) return;
    const job = jobs.get(req.params.id);
    if (!job || job.status !== "running") return res.status(409).json({ error: "job not running" });
    try {
      job.result = await storeCharacter(job.fighterId, job.playerName, req.body ?? {});
      setStatus(job, "done", "");
      res.status(204).end();
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      setStatus(job, "failed", "", error.slice(0, 300));
      res.status(400).json({ error });
    }
  });
  api.get("/forge/health", (req, res) => { if (!forgeAuth(req, res)) return; res.json({ ok: true, queued: queue.length, jobs: jobs.size }); });
}
