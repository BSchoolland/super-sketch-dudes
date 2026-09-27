// The forge: one Opus session with full tools in its own git worktree, driven by forge/PROMPT.md.
// It draws the sheet, writes the fighter, checks it and "deploys" it with the scripts in forge/tools;
// deploy writes payload.json, which is the only thing that leaves the worktree.
import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { CheckReport } from "./checks";

export const AGENT_MODEL = "claude-opus-5-5";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const TIMEOUT_MS = 15 * 60_000;

export interface JobSpec { id: string; fighterId: string; playerName: string; hint?: { name: string; description: string } | null }

export interface ForgeReport {
  fighterId: string;
  name: string;
  wallMs: number;
  costUsd: number;
  sessionId: string;
  checks: CheckReport | undefined;
  soft: string[];
  notes: string;
}

export interface CompletePayload {
  name: string;
  tagline: string;
  description: string;
  /** Lines the players read while the fight loads: attack, special, up+special. */
  source: string;
  sprite: { px: number; feetPx: number; heightPx: number; anims: Record<string, string> };
  cells: Record<string, string>;
  sheet: string | undefined;
  report: ForgeReport;
}

export interface ForgeIO {
  progress(stage: string): Promise<void>;
  log(line: string): void;
}

/** A failure the job should be failed with, message as the players will see it. */
export class ForgeError extends Error {}

/** The steps the agent's tool use announces, in the order a forge goes through them. */
const STAGE_ORDER = ["drawing the animation", "designing the moves", "writing the fighter", "balance testing", "final checks and upload"];

export async function runForge(job: JobSpec, drawingSrc: string, dir: string, io: ForgeIO): Promise<CompletePayload> {
  const t0 = Date.now();
  fs.mkdirSync(dir, { recursive: true });
  const wt = path.join(root, "..", "forge-worktrees", job.id);
  fs.mkdirSync(path.dirname(wt), { recursive: true });
  const git = (...a: string[]) => { const r = spawnSync("git", a, { cwd: root, encoding: "utf8" }); if (r.status !== 0) throw new Error(`git ${a[0]}: ${r.stderr.trim()}`); return r.stdout; };
  // left behind by a worker that died mid-job: this attempt starts clean
  if (fs.existsSync(wt)) { spawnSync("git", ["worktree", "remove", "--force", wt], { cwd: root }); fs.rmSync(wt, { recursive: true, force: true }); }
  git("worktree", "add", "--detach", "--force", wt, "HEAD");
  fs.symlinkSync(path.join(root, "node_modules"), path.join(wt, "node_modules"));
  const work = path.join(wt, "forge", "work", job.fighterId);
  fs.mkdirSync(work, { recursive: true });
  const drawing = path.join(work, "drawing.png");
  fs.copyFileSync(drawingSrc, drawing);
  const rel = (p: string) => path.relative(wt, p);
  const notes = job.hint
    ? [job.hint.name ? `The player named it "${job.hint.name}".` : "", job.hint.description ? `The player says: "${job.hint.description}".` : ""].filter(Boolean).join(" ")
    : "The player didn't name or describe it.";
  // read per job, so a prompt edit reaches the next forge without restarting the worker
  const prompt = fs.readFileSync(path.join(here, "PROMPT.md"), "utf8").replace(/\{\{DRAWING\}\}/g, rel(drawing)).replace(/\{\{WORK\}\}/g, rel(work)).replace(/\{\{ID\}\}/g, job.fighterId).replace("{{NOTES}}", notes);
  fs.writeFileSync(path.join(dir, "prompt.txt"), prompt);
  await io.progress("an agent is making it");

  // stream the session so the room sees what it's doing
  const log = fs.createWriteStream(path.join(dir, "session.jsonl"));
  const result = await new Promise<{ costUsd: number; text: string; sessionId: string }>((resolve, reject) => {
    const child = spawn("claude", ["-p", "--model", AGENT_MODEL, "--dangerously-skip-permissions", "--output-format", "stream-json", "--verbose"], { cwd: wt, stdio: ["pipe", "pipe", "pipe"], env: { ...process.env } });
    let buf = "", err = "", timedOut = false, costUsd = 0, text = "", sessionId = "", lost = "", reached = -1;
    const timer = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, TIMEOUT_MS);
    const onLine = (line: string) => {
      log.write(line + "\n");
      let e: any; try { e = JSON.parse(line); } catch { return; }
      if (e.type === "assistant") for (const b of e.message?.content ?? []) {
        if (b.type === "tool_use") {
          const cmd = String(b.input?.command ?? b.input?.file_path ?? "");
          const stage = /tools\/sheet/.test(cmd) ? "drawing the animation"
            // the agent opening the cut-out cells means the drawing is done and it's on to the moves
            : b.name === "Read" && /\/cells\//.test(cmd) ? "designing the moves"
            : /tools\/check/.test(cmd) ? "balance testing" : /tools\/deploy/.test(cmd) ? "final checks and upload"
            : /\.fighter\.js/.test(cmd) && b.name === "Write" ? "writing the fighter" : null;
          const step = stage ? STAGE_ORDER.indexOf(stage) : -1;
          // steps only move forward (a later look at the cells isn't a step back); the server no longer
          // having this job running (it gave it to someone else) stops the work
          if (stage && step > reached) {
            reached = step;
            io.progress(stage).catch((e: Error) => { lost = e.message; io.log(`progress rejected, stopping: ${e.message}`); child.kill("SIGKILL"); });
          }
          io.log(`${b.name} ${cmd.slice(0, 120)}`);
        } else if (b.type === "text" && b.text) text = b.text;
      }
      if (e.type === "result") { costUsd = Number(e.total_cost_usd ?? 0); sessionId = String(e.session_id ?? ""); if (e.result) text = String(e.result); }
    };
    child.stdout.on("data", (d) => { buf += d; let i; while ((i = buf.indexOf("\n")) >= 0) { onLine(buf.slice(0, i)); buf = buf.slice(i + 1); } });
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => { clearTimeout(timer); reject(e); });
    child.on("close", (code) => {
      clearTimeout(timer); log.end();
      if (timedOut) return reject(new ForgeError(`the agent ran out of time (${TIMEOUT_MS / 60000} minutes)`));
      if (lost) return reject(new Error(`the site stopped this job: ${lost}`));
      if (code !== 0 && !fs.existsSync(path.join(work, "payload.json"))) return reject(new Error(`agent exited ${code}: ${(err || text).trim().slice(-400)}`));
      resolve({ costUsd, text, sessionId });
    });
    child.stdin.end(prompt);
  });
  fs.writeFileSync(path.join(dir, "agent-final.txt"), result.text);

  const payloadFile = path.join(work, "payload.json");
  if (!fs.existsSync(payloadFile)) throw new ForgeError(`the agent finished without deploying: ${result.text.trim().slice(0, 300)}`);
  const p = JSON.parse(fs.readFileSync(payloadFile, "utf8"));
  // keep what it made
  for (const f of fs.readdirSync(work)) if (f.endsWith(".fighter.js") || f === "payload.json") fs.copyFileSync(path.join(work, f), path.join(dir, f));
  if (fs.existsSync(path.join(work, "cells"))) fs.cpSync(path.join(work, "cells"), path.join(dir, "cells"), { recursive: true });
  spawnSync("git", ["worktree", "remove", "--force", wt], { cwd: root });

  const report: ForgeReport = {
    fighterId: job.fighterId, name: p.name, wallMs: Date.now() - t0, costUsd: result.costUsd, sessionId: result.sessionId,
    checks: p.report?.checks, soft: p.report?.soft ?? [], notes: result.text.slice(0, 2000),
  };
  fs.writeFileSync(path.join(dir, "report.json"), JSON.stringify(report, null, 1));
  return { name: p.name, tagline: p.tagline, description: p.description ?? "", source: p.source, sprite: p.sprite, cells: p.cells, sheet: p.sheet, report };
}
