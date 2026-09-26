// House fighters for tests, the forge's checks and the headless scripts: the shipped bundles, built
// and registered the same way the client does (cell URLs don't matter headless).
import { readFileSync } from "node:fs";
import { registerFighter } from "../shared/fighters/index";
import { buildGenerated, type GeneratedBundle } from "../shared/gen/load";
import { HOUSE_ROSTER, houseBundlePath, type HouseId } from "../shared/house";
import type { FighterDef } from "../shared/types";

export function houseBundle(id: HouseId): GeneratedBundle {
  return JSON.parse(readFileSync(new URL(`../client/public/${houseBundlePath(id)}`, import.meta.url), "utf8")) as GeneratedBundle;
}

/** Builds a fresh def from the bundle and registers it under its house id. */
export async function loadHouse(id: HouseId): Promise<FighterDef> {
  const def = await buildGenerated(houseBundle(id));
  registerFighter(def);
  return def;
}

export function loadAllHouse(): Promise<FighterDef[]> {
  return Promise.all(HOUSE_ROSTER.map((h) => loadHouse(h.id)));
}

/** Script arguments name house fighters; anything else is a typo. */
export function houseId(arg: string): HouseId {
  const h = HOUSE_ROSTER.find((x) => x.id === arg);
  if (!h) throw new Error(`${arg} is not a house fighter (${HOUSE_ROSTER.map((x) => x.id).join(", ")})`);
  return h.id;
}
