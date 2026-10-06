import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type express from "express";
import type { LibraryEntry, Player } from "../shared/account";
import type { CharStatus } from "../shared/account";
import { buildGenerated } from "../shared/gen/load";
import { SPRITE_CELLS } from "../shared/gen/sprite";
import { STUDY_VERSION, type CpuStudy } from "../shared/cpu-study";
import { upsertCharacter } from "./library";
import { finish, openEvent } from "./events";
import type { WideEvent } from "../shared/wide";
import { isJudgement, type Judgements } from "../shared/moderation";
import { attachModeration, decide } from "./moderation";

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
  /** Listed in COMMUNITY once it's done. */
  public: boolean;
  createdAt: number;
  /** The auto moderator's judgements, once both judges have answered. */
  moderation: Judgements | null;
  /** Filled in on completion. */
  result: { name: string; tagline: string; description: string; bundleUrl: string; sheetUrl: string | null } | null;
}

const jobs = new Map<string, ForgeJob>();
const queue: string[] = [];
/** Each job's wide event, from queued to done or failed. A restart starts a new one on the same trace. */
const events = new Map<string, WideEvent>();
let genDir = "", genBase = "", jobsFile = "";

/** Every job change is written out, so a restart mid-character picks it back up instead of stranding it. */
function persist(): void {
  if (jobsFile) fs.writeFileSync(jobsFile, JSON.stringify([...jobs.values()]));
}
function restore(): void {
  if (!fs.existsSync(jobsFile)) return;
  const saved = JSON.parse(fs.readFileSync(jobsFile, "utf8")) as ForgeJob[];
  const restored: ForgeJob[] = [];
  for (const job of saved) {
    job.public ??= true;
    job.moderation ??= null;
    jobs.set(job.id, job);
    if (job.status === "queued") { queue.push(job.id); restored.push(job); }
    // the worker outlives a server restart and is still on it: keep it running; the stale-claim
    // timeout below requeues it if the worker really is gone
    if (job.status === "running") { job.claimedAt = Date.now(); restored.push(job); }
  }
  if (restored.length) console.log(`forge: picked up ${restored.length} job(s) from before the restart`);
  for (const job of restored) { openJobEvent(job, null).set("restored", true); upsertCharacter(entryOf(job)); }
}

export const jobOf = (id: string): ForgeJob | undefined => jobs.get(id);
export const drawingUrlOf = (fighterId: string): string => `${genBase}/drawings/${fighterId}.png`;

export function charStatusOf(job: ForgeJob): CharStatus {
  return job.status === "running" ? "generating" : job.status === "done" ? "ready" : job.status;
}

export function entryOf(job: ForgeJob): LibraryEntry {
  return {
    id: job.fighterId, owner: job.owner, status: charStatusOf(job), stage: job.stage, error: job.error,
    name: job.result?.name ?? null, tagline: job.result?.tagline ?? null, description: job.result?.description ?? null,
    drawingUrl: drawingUrlOf(job.fighterId), bundleUrl: job.result?.bundleUrl ?? null, sheetUrl: job.result?.sheetUrl ?? null,
    createdAt: job.createdAt, origin: job.origin, public: job.public,
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

/** How many of one player's characters the forge works on at once: two, or three while nobody else is waiting. */
const PER_PLAYER = 2, PER_PLAYER_QUIET = 3;

/**
 * The job the forge should take next. A player with nothing being forged goes first (someone
 * drawing one character isn't stuck behind another player's batch); otherwise first come, first
 * served. Nobody gets more than their share of the forge at once.
 */
function nextFairJob(): ForgeJob | null {
  for (let i = queue.length - 1; i >= 0; i--) if (jobs.get(queue[i])?.status !== "queued") queue.splice(i, 1);
  const running = new Map<string, number>();
  for (const job of jobs.values()) if (job.status === "running") running.set(job.owner, (running.get(job.owner) ?? 0) + 1);
  const waiting = queue.map((id) => jobs.get(id)).filter((j): j is ForgeJob => !!j && j.status === "queued");
  const owners = new Set(waiting.map((j) => j.owner));
  const cap = (owner: string) => ([...owners].some((o) => o !== owner) ? PER_PLAYER : PER_PLAYER_QUIET);
  const allowed = waiting.filter((j) => (running.get(j.owner) ?? 0) < cap(j.owner));
  return allowed.find((j) => !running.get(j.owner)) ?? allowed[0] ?? null;
}

/** Stores the drawing and queues the job; the library gets the entry at once, as "queued". */
/** `parent` is the trace the job came from: the creator's request. */
export function enqueueJob(spec: { fighterId: string; player: Player; png: Buffer; origin: LibraryEntry["origin"]; hint?: { name: string; description: string } | null; public: boolean; parent: string | null }): ForgeJob {
  const drawingPath = path.join(genDir, "drawings", `${spec.fighterId}.png`);
  fs.mkdirSync(path.dirname(drawingPath), { recursive: true });
  fs.writeFileSync(drawingPath, spec.png);
  const job: ForgeJob = {
    id: crypto.randomBytes(6).toString("hex"), fighterId: spec.fighterId, owner: spec.player.id, playerName: spec.player.name,
    drawingPath, status: "queued", stage: "waiting in line", error: null, claimedAt: 0, attempts: 0, origin: spec.origin, hint: spec.hint ?? null, public: spec.public, createdAt: Date.now(), moderation: null, result: null,
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
  if (!isStudy(b.cpu)) throw new Error("cpu (the forge's CPU study) missing");
  const bundle = { id: fighterId, player: playerName, description: b.description, source: b.source, sprite, cpu: b.cpu };
  await buildGenerated(bundle); // the forge already validated; this is the server refusing to serve a broken one
  fs.writeFileSync(path.join(dir, "bundle.json"), JSON.stringify(bundle));
  if (b.report !== undefined) fs.writeFileSync(path.join(dir, "report.json"), JSON.stringify(b.report));
  return {
    name: b.name.slice(0, 28), tagline: b.tagline.slice(0, 120), description: b.description.slice(0, 600),
    bundleUrl: `${base}/bundle.json`, sheetUrl: typeof b.sheet === "string" ? `${base}/sheet.png` : null,
  };
}

/** The forge's CPU study, as far as the server checks one: the version the game reads. */
function isStudy(cpu: unknown): cpu is CpuStudy {
  return !!cpu && typeof cpu === "object" && (cpu as CpuStudy).version === STUDY_VERSION && typeof (cpu as CpuStudy).base === "object";
}

/** A new version of a stored character with its module (and the CPU study of it), its CPU study alone, or its
 * cells (and the idle height they were cut at) replaced; everything else comes along, under a new URL. */
export async function reviseCharacter(entry: LibraryEntry, change: { source?: string; cpu?: unknown; cells?: Record<string, string>; heightPx?: number }): Promise<{ bundleUrl: string; sheetUrl: string | null }> {
  if (change.source !== undefined && change.cpu === undefined) throw new Error("a new source needs the CPU study of it (cpu)");
  if (change.cpu !== undefined && !isStudy(change.cpu)) throw new Error(`cpu is not a v${STUDY_VERSION} CPU study`);
  if (!entry.bundleUrl) throw new Error(`${entry.id} has no bundle`);
  const oldVer = path.basename(path.dirname(entry.bundleUrl));
  const oldDir = path.join(genDir, entry.id, oldVer);
  const old = JSON.parse(fs.readFileSync(path.join(oldDir, "bundle.json"), "utf8"));
  if (change.cells) for (const c of Object.keys(old.sprite.cells)) if (typeof change.cells[c] !== "string") throw new Error(`cell ${c} missing`);
  const source = change.source ?? old.source;
  const hash = crypto.createHash("sha1").update(source).update(oldVer);
  if (change.cells) hash.update(Object.keys(change.cells).sort().map((c) => change.cells![c]).join(""));
  if (change.cpu) hash.update(JSON.stringify(change.cpu));
  const ver = hash.digest("hex").slice(0, 8);
  const dir = path.join(genDir, entry.id, ver);
  const base = `${genBase}/${entry.id}/${ver}`;
  fs.mkdirSync(dir, { recursive: true });
  const cells: Record<string, string> = {};
  for (const c of Object.keys(old.sprite.cells)) {
    if (change.cells) fs.writeFileSync(path.join(dir, `${c}.png`), Buffer.from(change.cells[c], "base64"));
    else fs.copyFileSync(path.join(oldDir, `${c}.png`), path.join(dir, `${c}.png`));
    cells[c] = `${base}/${c}.png`;
  }
  const sheet = fs.existsSync(path.join(oldDir, "sheet.png"));
  if (sheet) fs.copyFileSync(path.join(oldDir, "sheet.png"), path.join(dir, "sheet.png"));
  const heightPx = change.heightPx ?? old.sprite.heightPx;
  const bundle = { ...old, source, sprite: { ...old.sprite, heightPx, cells }, cpu: change.cpu ?? old.cpu };
  await buildGenerated(bundle);
  fs.writeFileSync(path.join(dir, "bundle.json"), JSON.stringify(bundle));
  return { bundleUrl: `${base}/bundle.json`, sheetUrl: sheet ? `${base}/sheet.png` : null };
}

/** Characters the forge has finished, for the count players see. */
export function charactersMade(): number {
  let n = 0;
  for (const job of jobs.values()) if (job.status === "done") n++;
  return n;
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
  attachModeration(opts.dataDir);
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
    const job = nextFairJob();
    if (job) {
      queue.splice(queue.indexOf(job.id), 1);
      job.claimedAt = Date.now(); job.attempts++;
      setStatus(job, "running", "reading the drawing");
      return res.json({ id: job.id, fighterId: job.fighterId, playerName: job.playerName, attempts: job.attempts, hint: job.hint, moderated: !!job.moderation });
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
  // { harsh, lenient } -> { blocked }; a blocked job is failed here, with the reason the player sees
  api.post("/forge/jobs/:id/moderation", (req, res) => {
    if (!forgeAuth(req, res)) return;
    const job = jobs.get(req.params.id);
    if (!job || job.status !== "running") return res.status(409).json({ error: "job not running" });
    if (job.moderation) return res.status(409).json({ error: "already moderated" });
    const { harsh, lenient } = req.body ?? {};
    if (!isJudgement(harsh) || !isJudgement(lenient)) return res.status(400).json({ error: "harsh and lenient judgements required" });
    job.moderation = { harsh, lenient };
    const d = decide(job.owner, job.fighterId, job.moderation);
    events.get(job.id)?.set("moderation", { harsh: harsh.verdict, lenient: lenient.verdict, blocked: d.blocked, reputation: [d.before, d.after] });
    if (d.blocked) setStatus(job, "failed", "", d.error);
    else changed(job);
    res.json({ blocked: d.blocked, before: d.before, after: d.after });
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
