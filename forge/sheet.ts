import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import OpenAI, { toFile } from "openai";
import { tellBen } from "./mod-alerts";
import { SPRITE_CELLS } from "../shared/gen/sprite";

export const SHEET_MODEL = "gpt-image-2.5-sunburst";
/** `codex` draws through Ben's ChatGPT login (codex CLI's image_generation tool); when codex fails the sheet falls back to the paid API and pings Ben. */
const BACKEND = process.env.FORGE_SHEET_BACKEND ?? "api";
const CODEX_DRIVER = "gpt-6-luna";
const TEMPLATE = fs.readFileSync(new URL("./SHEET-PROMPT.md", import.meta.url), "utf8");

export interface SheetResult { backend: string; codexError?: string; ms: number; tokens: { text: number; image: number; output: number } | null; costUsd: number | null }

// $ per token, gpt-image-1 list rates (sunburst's aren't published); the report calls this an estimate
const RATE = { text: 5e-6, image: 10e-6, output: 40e-6 };

/** What the character is doing in each cell. */
const CELLS: Record<string, string> = {
  idle: "idle stance, at rest, weight settled",
  walk: "walking, mid-stride, the body leaning into the step",
  jump: "jumping, pushed off the ground, limbs or parts tucked or trailing",
  "atk-fwd": "attacking forward: its most obvious weapon, limb or part thrust far ahead of the body, the rest counterbalancing",
  "atk-up": "attacking upward: the same part swung high above the body, body stretched tall",
  "atk-down": "attacking downward: the same part driven at the ground, body crouched over it",
  hit: "getting hit: recoiling, the body folded or dented, parts flung",
  launched: "launched flying backwards, the whole body arched and tumbling, loose parts trailing",
  block: "blocking: braced and closed up, whatever it has pulled in front of it like a shield",
};
const COUNTS = "  - every countable feature of the input (legs, arms, eyes, wheels, dots, stripes, teeth, spikes) appears EXACTLY as many times as in the input, no more, no fewer";

export function sheetPrompt(): string {
  let p = TEMPLATE.replace("{{counts}}", COUNTS);
  for (const c of SPRITE_CELLS) p = p.replace(`{{${c}}}`, CELLS[c]);
  if (/\{\{\w[\w-]*\}\}/.test(p)) throw new Error(`sheet prompt has an unfilled placeholder: ${p.match(/\{\{\w[\w-]*\}\}/)![0]}`);
  return p;
}

/** `note`: what the forge agent saw go wrong in an earlier sheet of this drawing, passed on to the image model. */
export async function drawSheet(drawingPath: string, outPath: string, note = ""): Promise<SheetResult> {
  const prompt = note ? `${sheetPrompt()}\n\nAbout this particular drawing: ${note}` : sheetPrompt();
  fs.writeFileSync(path.join(path.dirname(outPath), "sheet-prompt.txt"), prompt);
  if (BACKEND === "api") return drawSheetApi(drawingPath, outPath, prompt);
  if (BACKEND !== "codex") throw new Error(`FORGE_SHEET_BACKEND must be api or codex, not ${BACKEND}`);
  try {
    return await drawSheetCodex(drawingPath, outPath, prompt);
  } catch (e) {
    const codexError = e instanceof Error ? e.message : String(e);
    console.error(`codex sheet failed, drawing with ${SHEET_MODEL} instead: ${codexError}`);
    await tellBen(`⚠️ forge sheet fell back from codex to the paid ${SHEET_MODEL} API (\`${path.basename(path.dirname(drawingPath))}\`)\n\`${codexError.slice(0, 300)}\``);
    return { ...(await drawSheetApi(drawingPath, outPath, prompt)), codexError };
  }
}

async function drawSheetApi(drawingPath: string, outPath: string, prompt: string): Promise<SheetResult> {
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not set (forge/.env)");
  const client = new OpenAI({ timeout: 5 * 60_000, maxRetries: 1 });
  const t0 = Date.now();
  const res = await client.images.edit({
    model: SHEET_MODEL,
    image: await toFile(fs.createReadStream(drawingPath), "drawing.png", { type: "image/png" }),
    prompt,
    size: "1024x1024",
    quality: "high",
  });
  const b64 = res.data?.[0]?.b64_json;
  if (!b64) throw new Error(`${SHEET_MODEL} returned no image`);
  fs.writeFileSync(outPath, Buffer.from(b64, "base64"));
  const u = res.usage;
  if (!u) return { backend: "api", ms: Date.now() - t0, tokens: null, costUsd: null };
  const tokens = { text: u.input_tokens_details?.text_tokens ?? 0, image: u.input_tokens_details?.image_tokens ?? 0, output: u.output_tokens };
  return { backend: "api", ms: Date.now() - t0, tokens, costUsd: tokens.text * RATE.text + tokens.image * RATE.image + tokens.output * RATE.output };
}

/** One `codex exec` turn whose only job is a single image_generation call; the image lands in ~/.codex/generated_images/<thread>/. */
async function drawSheetCodex(drawingPath: string, outPath: string, prompt: string): Promise<SheetResult> {
  const t0 = Date.now();
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "forge-codex-"));
  const instructions = `Call your image generation tool exactly once, editing the attached image with the prompt below passed through verbatim. Do not run commands, write files or generate anything else. Then stop.\n\n<prompt>\n${prompt}\n</prompt>`;
  const args = ["exec", "--json", "--skip-git-repo-check", "--ephemeral", "-s", "read-only", "-m", CODEX_DRIVER, "-c", "model_reasoning_effort=low", "-i", drawingPath, "-"];
  const { threadId, failure } = await new Promise<{ threadId: string; failure: string }>((resolve, reject) => {
    const p = spawn("codex", args, { cwd, stdio: ["pipe", "pipe", "pipe"] });
    const timer = setTimeout(() => p.kill("SIGKILL"), 5 * 60_000);
    let out = "", err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("error", reject);
    p.on("close", (code, signal) => {
      clearTimeout(timer);
      let threadId = "", failure = "";
      for (const line of out.split("\n").filter(Boolean)) {
        const e = JSON.parse(line);
        if (e.type === "thread.started") threadId = e.thread_id;
        if (e.type === "turn.failed" || e.type === "error") failure = e.error?.message ?? e.message;
      }
      if (signal) failure ||= `codex killed by ${signal} after ${((Date.now() - t0) / 1000).toFixed(0)}s`;
      else if (code !== 0) failure ||= `codex exited ${code}: ${err.trim().split("\n").slice(-3).join(" | ")}`;
      resolve({ threadId, failure });
    });
    p.stdin.end(instructions);
  });
  fs.rmSync(cwd, { recursive: true });
  if (failure) throw new Error(`codex sheet: ${failure}`);
  const dir = path.join(process.env.CODEX_HOME ?? path.join(os.homedir(), ".codex"), "generated_images", threadId);
  const pngs = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(".png")) : [];
  if (pngs.length !== 1) throw new Error(`codex sheet: expected one image in ${dir}, found ${pngs.length}`);
  fs.copyFileSync(path.join(dir, pngs[0]), outPath);
  fs.rmSync(dir, { recursive: true });
  return { backend: "codex", ms: Date.now() - t0, tokens: null, costUsd: 0 };
}
