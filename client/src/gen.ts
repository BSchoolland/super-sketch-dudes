import { buildGenerated, type GeneratedBundle } from "../../shared/gen/load";
import { registerFighter, roster } from "../../shared/fighters/index";
import { preloadSprite } from "./render/sprite";
import type { FighterDef } from "../../shared/types";

/** Fetches a generated fighter bundle, builds and registers it, and waits for its images. Idempotent per id. */
export async function loadGeneratedFighter(url: string): Promise<FighterDef> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fighter bundle ${url}: HTTP ${res.status}`);
  const bundle = (await res.json()) as GeneratedBundle;
  if (roster[bundle.id]?.sprite) { await preloadSprite(roster[bundle.id]); return roster[bundle.id]; }
  const def = await buildGenerated(bundle);
  registerFighter(def);
  await preloadSprite(def);
  return def;
}
