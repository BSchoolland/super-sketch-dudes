import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { SPRITE_CELLS } from "../shared/gen/sprite";
import type { GeneratedBundle } from "../shared/gen/load";
import { runAgent, addTokens, noTokens, type AgentResult, type Tokens } from "./agent";
import { readConcept, provisionalHeight, type Concept } from "./concept";
import { conceptPrompt, conceptFeedbackPrompt, facingPrompt, modulePrompt, feedbackPrompt, type CellsMeta } from "./prompts";
import { drawSheet, SHEET_MODEL, type SheetResult } from "./sheet";
import type { CheckInput, CheckReport } from "./checks";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const TSX = path.join(root, "node_modules/.bin/tsx");
const MODULE_RETRIES = 2;
/** Pass-2 effort. Low writes a module in ~95s; medium thinks longer (the builder measured 5-6 min at the default) and passes the gate about as often. */
const MODULE_EFFORT = (process.env.FORGE_EFFORT ?? "medium") as "low" | "medium" | "high";
const CHECKS_TIMEOUT_MS = 120_000;

export interface JobSpec { id: string; fighterId: string; playerName: string; round: number; siblings: string[] }

export interface CompletePayload {
  name: string;
  tagline: string;
  description: string;
  /** Four lines the players read while the fight loads: attack, special, up+special, grab. */
  card: string[];
  source: string;
  sprite: { px: number; feetPx: number; heightPx: number; anims: Record<string, string> };
  cells: Record<string, string>;
  sheet: string;
  report: ForgeReport;
}

export interface ForgeReport {
  fighterId: string;
  name: string;
  height: number;
  mirrored: boolean;
  timings: Record<string, number>;
  wallMs: number;
  agent: { calls: { pass: string; ms: number; costUsd: number; tokens: Tokens }[]; tokens: Tokens; costUsd: number };
  sheet: { model: string; ms: number; tokens: SheetResult["tokens"]; costUsd: number | null };
  costUsd: number;
  attempts: { attempt: number; failures: string[] }[];
  checks: CheckReport;
  soft: string[];
  notes: string;
}

export interface PipelineIO {
  progress(stage: string): Promise<void>;
  log(line: string): void;
}

/** A failure the job should be failed with, message as the players will see it. */
export class ForgeError extends Error {}

export async function runPipeline(job: JobSpec, drawingSrc: string, dir: string, io: PipelineIO): Promise<CompletePayload> {
  fs.mkdirSync(dir, { recursive: true });
  const t0 = Date.now();
  const timings: Record<string, number> = {};
  const calls: ForgeReport["agent"]["calls"] = [];
  const step = async <T>(name: string, fn: () => Promise<T>, detail?: (r: T) => string): Promise<T> => {
    const s = Date.now();
    const r = await fn();
    timings[name] = (timings[name] ?? 0) + Date.now() - s;
    io.log(`${name} ${((Date.now() - s) / 1000).toFixed(1)}s${detail ? ` ${detail(r)}` : ""}`);
    return r;
  };
  const agent = async (pass: string, prompt: string, resume?: string, effort?: "low" | "medium" | "high"): Promise<AgentResult> => {
    fs.appendFileSync(path.join(dir, "prompts.log"), `\n===== ${pass} ${resume ? `(resume ${resume})` : ""}\n${prompt}\n`);
    const r = await runAgent(prompt, dir, { resume, effort });
    calls.push({ pass, ms: r.ms, costUsd: r.costUsd, tokens: r.tokens });
    fs.appendFileSync(path.join(dir, "prompts.log"), `----- reply (${r.sessionId})\n${r.result}\n`);
    return r;
  };

  const drawing = path.join(dir, "drawing.png");
  if (path.resolve(drawingSrc) !== drawing) fs.copyFileSync(drawingSrc, drawing);

  // the sheet needs only the drawing, so it's drawn while pass 1 designs the fighter
  await io.progress("designing the moveset, drawing the sheet");
  const sheetPath = path.join(dir, "sheet.png");
  const sheetPromise = step("sheet", () => drawSheet(drawing, null, sheetPath), (s) => s.costUsd === null ? "no usage reported" : `~$${s.costUsd.toFixed(3)}`);
  sheetPromise.catch(() => { /* reported where it's awaited, after the concept */ });

  // pass 1: concept
  const conceptFile = path.join(dir, "concept.json");
  let conceptSession = "";
  const concept = await step("concept", async () => {
    let r = await agent("concept", conceptPrompt({ drawing, out: conceptFile, player: job.playerName, round: job.round, siblings: job.siblings }));
    let c = readConcept(conceptFile);
    if (!c.concept) {
      io.log(`concept rejected: ${c.problems.join("; ")}`);
      r = await agent("concept-fix", conceptFeedbackPrompt(c.problems, conceptFile), r.sessionId);
      c = readConcept(conceptFile);
    }
    if (!c.concept) throw new ForgeError(`the concept pass wrote an unusable design: ${c.problems.join("; ")}`);
    conceptSession = r.sessionId;
    return c.concept;
  }, (c) => `${c.name} (${c.archetype})`);

  if (!fs.existsSync(sheetPath)) await io.progress("drawing the sheet");
  const sheet = await sheetPromise;

  // normalise
  await io.progress("cutting out the cells");
  const cellsDir = path.join(dir, "cells");
  const normalize = async (mirror: boolean): Promise<CellsMeta> => {
    const { code, stdout, stderr } = await run("python3", [path.join(here, "img/normalize.py"), sheetPath, cellsDir, "--mirror", mirror ? "1" : "0"], 60_000);
    if (code !== 0) throw new ForgeError(`cutting the sheet into cells failed: ${(stderr || stdout).trim().split("\n").pop()}`);
    return JSON.parse(fs.readFileSync(path.join(cellsDir, "cells.json"), "utf8")) as CellsMeta;
  };
  let meta = await step("cells", () => normalize(false));
  // the image model keeps the drawing's facing more often than it obeys "face right"; the engine needs right
  const faces = await step("facing", async () => {
    const out = path.join(dir, "facing.json");
    await agent("facing", facingPrompt(cellsDir, out), conceptSession, "low");
    const f = fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, "utf8")).faces : undefined;
    if (f !== "left" && f !== "right") throw new ForgeError(`the facing check wrote ${JSON.stringify(f)} instead of "left" or "right"`);
    return f as "left" | "right";
  }, (f) => f);
  if (faces === "left") meta = await step("cells", () => normalize(true), () => "mirrored");

  // pass 2 + checks, retried with the failure list
  const height = provisionalHeight(concept, meta.cells.idle.box);
  const moduleFile = path.join(dir, "module.json");
  const attempts: ForgeReport["attempts"] = [];
  let session = "";
  let passed: { source: string; anims: Record<string, string>; notes: string; checks: CheckReport } | null = null;
  let failures: string[] = [];
  for (let attempt = 0; attempt <= MODULE_RETRIES && !passed; attempt++) {
    if (attempt === 0) await io.progress("writing the fighter");
    else await io.progress(`fixing: ${failures[0]}`.slice(0, 80));
    const prompt = attempt === 0 ? modulePrompt({ concept, cellsDir, meta, height, out: moduleFile }) : feedbackPrompt(failures, moduleFile);
    if (attempt === 0) fs.rmSync(moduleFile, { force: true });
    const r = await step("module", () => agent(attempt === 0 ? "module" : `module-fix-${attempt}`, prompt, session || undefined, MODULE_EFFORT));
    session = r.sessionId;
    const mod = readModule(moduleFile);
    if (!mod.module) { failures = mod.problems; attempts.push({ attempt, failures }); io.log(`module rejected: ${failures.join("; ")}`); continue; }
    await io.progress("balance testing");
    const bundle = bundleFor(job, concept, mod.module.source, mod.module.anims, meta, "cells");
    const checks = await step("checks", () => runChecksProcess({ bundle, height }, path.join(dir, `checks-${attempt}`)), (c) => c.ok ? `ok${c.soft.length ? ` (soft: ${c.soft.join("; ")})` : ""}` : `${c.failures.length} failures`);
    failures = checks.failures.map((f) => f.msg);
    attempts.push({ attempt, failures });
    if (checks.ok) passed = { ...mod.module, checks };
    else io.log(`checks failed: ${failures.join(" | ")}`);
  }
  if (!passed) throw new ForgeError(`the fighter failed its checks after ${MODULE_RETRIES + 1} tries: ${failures.join("; ")}`);

  const tokens = calls.reduce((a, c) => addTokens(a, c.tokens), noTokens());
  const agentCost = calls.reduce((a, c) => a + c.costUsd, 0);
  const report: ForgeReport = {
    fighterId: job.fighterId, name: concept.name, height, mirrored: faces === "left", timings, wallMs: Date.now() - t0,
    agent: { calls, tokens, costUsd: agentCost },
    sheet: { model: SHEET_MODEL, ms: sheet.ms, tokens: sheet.tokens, costUsd: sheet.costUsd },
    costUsd: agentCost + (sheet.costUsd ?? 0),
    attempts, checks: passed.checks, soft: passed.checks.soft, notes: passed.notes,
  };
  fs.writeFileSync(path.join(dir, "report.json"), JSON.stringify(report, null, 1));
  const b64 = (f: string) => fs.readFileSync(f).toString("base64");
  return {
    name: concept.name, tagline: concept.tagline, description: concept.description, card: concept.card, source: passed.source,
    sprite: { px: meta.px, feetPx: meta.feetPx, heightPx: meta.heightPx, anims: passed.anims },
    cells: Object.fromEntries(SPRITE_CELLS.map((c) => [c, b64(path.join(cellsDir, `${c}.png`))])),
    sheet: b64(sheetPath),
    report,
  };
}

export function bundleFor(job: JobSpec, concept: Concept, source: string, anims: Record<string, string>, meta: CellsMeta, cellBase: string): GeneratedBundle {
  return {
    id: job.fighterId, player: job.playerName, description: concept.description, source,
    sprite: { px: meta.px, feetPx: meta.feetPx, heightPx: meta.heightPx, anims, cells: Object.fromEntries(SPRITE_CELLS.map((c) => [c, `${cellBase}/${c}.png`])) },
  };
}

function readModule(file: string): { module: { source: string; anims: Record<string, string>; notes: string } | null; problems: string[] } {
  if (!fs.existsSync(file)) return { module: null, problems: [`you did not write ${file}; Write the JSON file with the Write tool`] };
  let j: any;
  try { j = JSON.parse(fs.readFileSync(file, "utf8")); } catch (e) { return { module: null, problems: [`${file} is not valid JSON (${(e as Error).message}); the module source must be one JSON string with newlines and quotes escaped`] }; }
  const p: string[] = [];
  if (typeof j.source !== "string" || !j.source.trim()) p.push(`"source" must be the whole module as a string`);
  const anims = j.anims ?? {};
  if (typeof anims !== "object" || Array.isArray(anims)) p.push(`"anims" must be an object of state -> cell name`);
  else for (const [k, v] of Object.entries(anims)) if (typeof v !== "string") p.push(`"anims.${k}" must be a cell name string`);
  return p.length ? { module: null, problems: p } : { module: { source: j.source, anims, notes: typeof j.notes === "string" ? j.notes : "" }, problems: [] };
}

async function runChecksProcess(input: CheckInput, base: string): Promise<CheckReport> {
  fs.writeFileSync(`${base}-in.json`, JSON.stringify(input));
  const { code, stderr, timedOut } = await run(TSX, [path.join(here, "checks.ts"), `${base}-in.json`, `${base}.json`], CHECKS_TIMEOUT_MS);
  if (timedOut) return { ok: false, failures: [{ kind: "hard", msg: `the headless checks did not finish in ${CHECKS_TIMEOUT_MS / 1000}s: some hook or loop never terminates (a while loop on fighter state, or a move whose next chains back to itself forever)` }], soft: [], ladder: {}, recovery: null, killPercents: {}, movesUsed: [], timings: {} };
  if (code !== 0) throw new Error(`checks process exited ${code}: ${stderr.trim().slice(-600)}`);
  return JSON.parse(fs.readFileSync(`${base}.json`, "utf8")) as CheckReport;
}

function run(cmd: string, args: string[], timeoutMs: number): Promise<{ code: number | null; stdout: string; stderr: string; timedOut: boolean }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "", timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, timeoutMs);
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", (e) => { clearTimeout(timer); reject(e); });
    child.on("close", (code) => { clearTimeout(timer); resolve({ code, stdout, stderr, timedOut }); });
  });
}
