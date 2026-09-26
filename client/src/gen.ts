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

export interface FighterLoad { state: "loading" | "ready" | "failed"; error: string; promise: Promise<void> }
const loads = new Map<string, FighterLoad>();

/** Loads a generated fighter bundle once; the returned record says how it went (its promise settles either way). */
export function fighterLoad(bundleUrl: string): FighterLoad {
  let f = loads.get(bundleUrl);
  if (f) return f;
  const record: FighterLoad = { state: "loading", error: "", promise: Promise.resolve() };
  record.promise = loadGeneratedFighter(bundleUrl).then(
    () => { record.state = "ready"; },
    (error: unknown) => {
      console.error(`fighter bundle failed: ${bundleUrl}`, error);
      record.state = "failed";
      record.error = error instanceof Error ? error.message : String(error);
    },
  );
  loads.set(bundleUrl, record);
  return record;
}
