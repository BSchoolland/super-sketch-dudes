import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type express from "express";
import type { LibraryEntry, Player } from "../shared/account";
import type { CharStatus } from "../shared/draw";
import { buildGenerated } from "../shared/gen/load";
import { SPRITE_CELLS } from "../shared/gen/sprite";
import { upsertCharacter } from "./library";

/**
 * The forge job queue. A job is one drawing becoming one fighter; it belongs to a player and
 * lands in their library whatever started it (the creator, or a draw battle round). The forge
 * worker on Ben's machine polls /forge/jobs/next with FORGE_TOKEN; nothing here calls out to it.
 */
export interface ForgeJob {
  id: string;
  fighterId: string;
  owner: string;
  playerName: string;
  /** Names of the player's other characters so the agent avoids repeats. */
  siblings: string[];
  drawingPath: string;
  status: "queued" | "running" | "done" | "failed";
  stage: string;
  error: string | null;
  claimedAt: number;
  attempts: number;
  origin: LibraryEntry["origin"];
  /** What the player typed about it, if anything: the design pass reads it. */
  hint: { name: string; description: string } | null;
  /** Which forge makes it: v1 is the two-pass pipeline, v2 one agent with tools in a worktree. */
  forge: "v1" | "v2";
  createdAt: number;
  /** Filled in on completion. */
  result: { name: string; tagline: string; description: string; card: string[] | null; bundleUrl: string; sheetUrl: string | null } | null;
}

const jobs = new Map<string, ForgeJob>();
const queue: string[] = [];
const listeners = new Set<(job: ForgeJob) => void>();
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
  for (const id of queue) { const job = jobs.get(id)!; upsertCharacter(entryOf(job)); }
}

/** Runs whenever a job changes (status, stage, completion). Draw rooms mirror it into their state. */
export function onJob(cb: (job: ForgeJob) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
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

function changed(job: ForgeJob, player?: Player): void {
  upsertCharacter(entryOf(job), player);
  persist();
  for (const cb of listeners) cb(job);
}

/** Stores the drawing and queues the job; the library gets the entry at once, as "queued". */
export const DEFAULT_FORGE = (process.env.FORGE_DEFAULT === "v2" ? "v2" : "v1") as "v1" | "v2";
export function enqueueJob(spec: { fighterId: string; player: Player; siblings: string[]; png: Buffer; origin: LibraryEntry["origin"]; hint?: { name: string; description: string } | null; forge?: "v1" | "v2" }): ForgeJob {
  const drawingPath = path.join(genDir, "drawings", `${spec.fighterId}.png`);
  fs.mkdirSync(path.dirname(drawingPath), { recursive: true });
  fs.writeFileSync(drawingPath, spec.png);
  const job: ForgeJob = {
    id: crypto.randomBytes(6).toString("hex"), fighterId: spec.fighterId, owner: spec.player.id, playerName: spec.player.name, siblings: spec.siblings,
    drawingPath, status: "queued", stage: "waiting in line", error: null, claimedAt: 0, attempts: 0, origin: spec.origin, hint: spec.hint ?? null, forge: spec.forge ?? DEFAULT_FORGE, createdAt: Date.now(), result: null,
  };
  jobs.set(job.id, job);
  queue.push(job.id);
  changed(job, spec.player);
  return job;
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
      return res.json({ id: job.id, fighterId: job.fighterId, playerName: job.playerName, round: 1, siblings: job.siblings, attempts: job.attempts, hint: job.hint, forge: job.forge ?? "v1" });
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
    const b = req.body ?? {};
    try {
      for (const k of ["name", "tagline", "description", "source"]) if (typeof b[k] !== "string") throw new Error(`${k} must be a string`);
      if (!b.sprite || typeof b.sprite !== "object") throw new Error("sprite missing");
      if (!b.cells || typeof b.cells !== "object") throw new Error("cells missing");
      for (const c of SPRITE_CELLS) if (typeof b.cells[c] !== "string") throw new Error(`cell ${c} missing`);
      const dir = path.join(genDir, job.fighterId);
      fs.mkdirSync(dir, { recursive: true });
      const cells: Record<string, string> = {};
      for (const c of SPRITE_CELLS) { fs.writeFileSync(path.join(dir, `${c}.png`), Buffer.from(b.cells[c], "base64")); cells[c] = `${genBase}/${job.fighterId}/${c}.png`; }
      if (typeof b.sheet === "string") fs.writeFileSync(path.join(dir, "sheet.png"), Buffer.from(b.sheet, "base64"));
      const sprite = { px: Number(b.sprite.px), feetPx: Number(b.sprite.feetPx), heightPx: Number(b.sprite.heightPx), anims: b.sprite.anims && typeof b.sprite.anims === "object" ? b.sprite.anims : {}, cells };
      const bundle = { id: job.fighterId, player: job.playerName, description: b.description, source: b.source, sprite };
      await buildGenerated(bundle); // the forge already validated; this is the server refusing to serve a broken one
      fs.writeFileSync(path.join(dir, "bundle.json"), JSON.stringify(bundle));
      if (b.report !== undefined) fs.writeFileSync(path.join(dir, "report.json"), JSON.stringify(b.report));
      job.result = {
        name: b.name.slice(0, 24), tagline: b.tagline.slice(0, 120), description: b.description.slice(0, 600),
        card: Array.isArray(b.card) ? b.card.slice(0, 4).map((c: unknown) => String(c).slice(0, 60)) : null,
        bundleUrl: `${genBase}/${job.fighterId}/bundle.json`, sheetUrl: typeof b.sheet === "string" ? `${genBase}/${job.fighterId}/sheet.png` : null,
      };
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
