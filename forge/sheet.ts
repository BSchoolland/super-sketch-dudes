import fs from "node:fs";
import path from "node:path";
import OpenAI, { toFile } from "openai";
import { SPRITE_CELLS } from "../shared/gen/sprite";
import type { Concept } from "./concept";

export const SHEET_MODEL = "gpt-image-2.5-sunburst";
const TEMPLATE = fs.readFileSync(new URL("./SHEET-PROMPT.md", import.meta.url), "utf8");

export interface SheetResult { ms: number; tokens: { input: number; output: number } }

export function sheetPrompt(concept: Concept): string {
  let p = TEMPLATE.replace("{{counts}}", concept.counts.map((c) => `  - ${c}`).join("\n"));
  for (const c of SPRITE_CELLS) p = p.replace(`{{${c}}}`, concept.cells[c].trim().replace(/\s*\|\s*/g, ", "));
  if (/\{\{\w[\w-]*\}\}/.test(p)) throw new Error(`sheet prompt has an unfilled placeholder: ${p.match(/\{\{\w[\w-]*\}\}/)![0]}`);
  return p;
}

export async function drawSheet(drawingPath: string, concept: Concept, outPath: string): Promise<SheetResult> {
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
  return { ms: Date.now() - t0, tokens: { input: res.usage?.input_tokens ?? 0, output: res.usage?.output_tokens ?? 0 } };
}
