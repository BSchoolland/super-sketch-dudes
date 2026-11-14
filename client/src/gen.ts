import { buildGenerated, type GeneratedBundle } from "../../shared/gen/load";
import { registerFighter, roster, unregisterFighter } from "../../shared/fighters/index";
import { preloadSprite, releaseSprite } from "./render/sprite";
import type { FighterDef } from "../../shared/types";
import { cellForAnim } from "../../shared/gen/sprite";

const defs = new Map<string, Promise<FighterDef>>();

/** Fetches a generated fighter bundle, builds and registers it (once per URL), without waiting for its images. */
function fighterDef(url: string): Promise<FighterDef> {
  let d = defs.get(url);
  if (!d) {
    d = (async () => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`fighter bundle ${url}: HTTP ${res.status}`);
      const bundle = (await res.json()) as GeneratedBundle;
      if (roster[bundle.id]?.sprite) return roster[bundle.id];
      const def = await buildGenerated(bundle);
      registerFighter(def);
      return def;
    })();
    d.catch(() => defs.delete(url));
    defs.set(url, d);
  }
  return d;
}

/** Fetches a generated fighter bundle, builds and registers it, and waits for all its images. Idempotent per id. */
export async function loadGeneratedFighter(url: string): Promise<FighterDef> {
  const def = await fighterDef(url);
  await preloadSprite(def);
  return def;
}

/** Forgets a loaded fighter: out of the roster, its images released, loaded from scratch next time. */
export function unloadFighter(bundleUrl: string, id: string): void {
  loads.delete(bundleUrl);
  portraits.delete(bundleUrl);
  defs.delete(bundleUrl);
  const def = roster[id];
  if (!def) return;
  releaseSprite(def);
  unregisterFighter(id);
}

export interface FighterLoad { state: "loading" | "ready" | "failed"; error: string; promise: Promise<void>; /** How long it took, once settled. */ ms: number; /** performance.now() when it became ready (art fades in from here). */ readyAt: number }
const loads = new Map<string, FighterLoad>();

/** Loads a generated fighter bundle once; the returned record says how it went (its promise settles either way). */
export function fighterLoad(bundleUrl: string): FighterLoad {
  let f = loads.get(bundleUrl);
  if (f) return f;
  const record: FighterLoad = { state: "loading", error: "", promise: Promise.resolve(), ms: 0, readyAt: 0 };
  const t0 = performance.now();
  record.promise = loadGeneratedFighter(bundleUrl).then(
    () => { record.state = "ready"; record.readyAt = performance.now(); record.ms = Math.round(record.readyAt - t0); },
    (error: unknown) => {
      record.ms = Math.round(performance.now() - t0);
      console.error(`fighter bundle failed: ${bundleUrl}`, error);
      record.state = "failed";
      record.error = error instanceof Error ? error.message : String(error);
    },
  );
  loads.set(bundleUrl, record);
  return record;
}

const portraits = new Map<string, FighterLoad>();

/**
 * Enough of a fighter for a card: its bundle and the one pose it stands in, not every pose a match needs (a full
 * fighter is megabytes, and a list shows dozens). Ready as soon as a full load of it is.
 */
export function portraitLoad(bundleUrl: string): FighterLoad {
  const full = loads.get(bundleUrl);
  if (full?.state === "ready") return full;
  let f = portraits.get(bundleUrl);
  if (f) return f;
  const record: FighterLoad = { state: "loading", error: "", promise: Promise.resolve(), ms: 0, readyAt: 0 };
  const t0 = performance.now();
  record.promise = fighterDef(bundleUrl).then((def) => preloadSprite(def, [cellForAnim(def, "idle")])).then(
    () => { record.state = "ready"; record.readyAt = performance.now(); record.ms = Math.round(record.readyAt - t0); },
    (error: unknown) => {
      record.ms = Math.round(performance.now() - t0);
      console.error(`fighter bundle failed: ${bundleUrl}`, error);
      record.state = "failed";
      record.error = error instanceof Error ? error.message : String(error);
    },
  );
  portraits.set(bundleUrl, record);
  return record;
}
