// Sheets through the codex CLI's image_generation tool on Ben's ChatGPT login, and the bookkeeping for when the
// forge has to use the paid API instead: one ping when that starts, one when codex is back.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { tellBen } from "./mod-alerts";
import type { SheetResult } from "./sheet";

const CODEX_DRIVER = "gpt-6-luna";
/** The codex pool is shared with BenBot's gpt-* work; past this weekly % the forge leaves it alone. */
const WEEKLY_CAP = Number(process.env.FORGE_CODEX_WEEKLY_CAP ?? 85);
const LIMITS = process.env.CODEX_LIMITS ?? path.join(os.homedir(), "Projects/benbot/scripts/codex-limits");
const STATE = path.join(os.homedir(), ".local/state/sketch-forge/codex-sheet.json");

interface FallbackState { since: string; sheets: number; reason: string }
const readState = (): FallbackState | null => (fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, "utf8")) : null);

/** Why codex shouldn't draw this sheet, or "" if it should. */
export async function codexBusy(): Promise<string> {
  let weekly: number;
  try {
    weekly = JSON.parse(execFileSync(LIMITS, ["--json"], { encoding: "utf8", timeout: 20_000 })).weekly.percent;
  } catch (e) {
    // the usage endpoint 403s now and then; a broken login will show up in the codex call itself
    console.error(`codex-limits failed, drawing with codex anyway: ${e instanceof Error ? e.message : e}`);
    return "";
  }
  return weekly >= WEEKLY_CAP ? `codex weekly pool at ${weekly}% (forge stops at ${WEEKLY_CAP}%)` : "";
}

export async function codexFellBack(reason: string, apiModel: string): Promise<void> {
  const s = readState();
  fs.mkdirSync(path.dirname(STATE), { recursive: true });
  fs.writeFileSync(STATE, JSON.stringify({ since: s?.since ?? new Date().toISOString(), sheets: (s?.sheets ?? 0) + 1, reason }));
  if (!s) await tellBen(`⚠️ forge sheets are falling back from codex to the paid ${apiModel} API. I'll ping again when codex is back.\n\`${reason.slice(0, 300)}\``);
}

export async function codexRecovered(): Promise<void> {
  const s = readState();
  if (!s) return;
  fs.rmSync(STATE);
  await tellBen(`✅ forge sheets are back on codex after ${s.sheets} on the paid API since ${s.since}.`);
}

/** One `codex exec` turn whose only job is a single image_generation call; the image lands in ~/.codex/generated_images/<thread>/. */
export async function drawSheetCodex(drawingPath: string, outPath: string, prompt: string): Promise<SheetResult> {
  const t0 = Date.now();
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "forge-codex-"));
  const instructions = `Call your image generation tool to edit the attached image, with the prompt below passed through verbatim. If the call errors, call it again, at most three calls in all. Do not run commands, write files or generate anything else. Then stop.\n\n<prompt>\n${prompt}\n</prompt>`;
  const args = ["exec", "--json", "--skip-git-repo-check", "--ephemeral", "-s", "read-only", "-m", CODEX_DRIVER, "-c", "model_reasoning_effort=low", "-i", drawingPath, "-"];
  const { threadId, failure, said } = await new Promise<{ threadId: string; failure: string; said: string }>((resolve, reject) => {
    const p = spawn("codex", args, { cwd, stdio: ["pipe", "pipe", "pipe"] });
    const timer = setTimeout(() => p.kill("SIGKILL"), 5 * 60_000);
    let out = "", err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("error", reject);
    p.on("close", (code, signal) => {
      clearTimeout(timer);
      let threadId = "", failure = "", said = "";
      for (const line of out.split("\n").filter(Boolean)) {
        const e = JSON.parse(line);
        if (e.type === "thread.started") threadId = e.thread_id;
        if (e.item?.type === "agent_message" && e.item.text) said = e.item.text;
        if (e.type === "turn.failed" || e.type === "error") failure = e.error?.message ?? e.message;
      }
      if (signal) failure ||= `codex killed by ${signal} after ${((Date.now() - t0) / 1000).toFixed(0)}s`;
      else if (code !== 0) failure ||= `codex exited ${code}: ${err.trim().split("\n").slice(-3).join(" | ")}`;
      resolve({ threadId, failure, said });
    });
    p.stdin.end(instructions);
  });
  fs.rmSync(cwd, { recursive: true });
  if (!threadId) throw new Error(`codex sheet: ${failure || "codex never started a thread"}`);
  // the tool often tells the driver it failed when the image did land, so the files are the truth
  const dir = path.join(process.env.CODEX_HOME ?? path.join(os.homedir(), ".codex"), "generated_images", threadId);
  const pngs = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(".png")).map((f) => path.join(dir, f)) : [];
  if (!pngs.length) throw new Error(`codex sheet: no image${failure ? `: ${failure}` : ""}; codex said: ${said || "(nothing)"}`);
  fs.copyFileSync(pngs.sort((a, b) => fs.statSync(a).mtimeMs - fs.statSync(b).mtimeMs)[0], outPath);
  fs.rmSync(dir, { recursive: true });
  return { backend: "codex", ms: Date.now() - t0, tokens: null, costUsd: 0 };
}
