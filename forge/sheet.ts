import fs from "node:fs";
import path from "node:path";
import OpenAI, { toFile } from "openai";
import { SPRITE_CELLS } from "../shared/gen/sprite";
import type { Concept } from "./concept";

export const SHEET_MODEL = "gpt-image-2.5-sunburst";
const TEMPLATE = fs.readFileSync(new URL("./SHEET-PROMPT.md", import.meta.url), "utf8");

export interface SheetResult { ms: number; tokens: { text: number; image: number; output: number } | null; costUsd: number | null }

// $ per token, gpt-image-1 list rates (sunburst's aren't published); the report calls this an estimate
const RATE = { text: 5e-6, image: 10e-6, output: 40e-6 };

/** Pose descriptions when the sheet is drawn before the design exists (it runs alongside pass 1). */
const GENERIC_CELLS: Record<string, string> = {
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
const GENERIC_COUNTS = "  - every countable feature of the input (legs, arms, eyes, wheels, dots, stripes, teeth, spikes) appears EXACTLY as many times as in the input, no more, no fewer";

export function sheetPrompt(concept: Concept | null): string {
  let p = TEMPLATE.replace("{{counts}}", concept ? concept.counts.map((c) => `  - ${c}`).join("\n") : GENERIC_COUNTS);
  for (const c of SPRITE_CELLS) p = p.replace(`{{${c}}}`, (concept ? concept.cells[c] : GENERIC_CELLS[c]).trim().replace(/\s*\|\s*/g, ", "));
  if (/\{\{\w[\w-]*\}\}/.test(p)) throw new Error(`sheet prompt has an unfilled placeholder: ${p.match(/\{\{\w[\w-]*\}\}/)![0]}`);
  return p;
}

export async function drawSheet(drawingPath: string, concept: Concept | null, outPath: string): Promise<SheetResult> {
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not set (forge/.env)");
  const client = new OpenAI({ timeout: 5 * 60_000, maxRetries: 1 });
  const prompt = sheetPrompt(concept);
  fs.writeFileSync(path.join(path.dirname(outPath), "sheet-prompt.txt"), prompt);
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
  if (!u) return { ms: Date.now() - t0, tokens: null, costUsd: null };
  const tokens = { text: u.input_tokens_details?.text_tokens ?? 0, image: u.input_tokens_details?.image_tokens ?? 0, output: u.output_tokens };
  return { ms: Date.now() - t0, tokens, costUsd: tokens.text * RATE.text + tokens.image * RATE.image + tokens.output * RATE.output };
}
