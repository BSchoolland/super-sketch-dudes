import type { FighterDef, FighterId } from "../types";
import { sable } from "./sable/index";
import { brick } from "./brick/index";
import { wick } from "./wick/index";
import { pilot } from "./pilot/index";

/** The four built-in fighters. */
export const STOCK_IDS: readonly FighterId[] = ["sable", "brick", "wick", "pilot"];

export const roster: Record<FighterId, FighterDef> = {
  sable,
  brick,
  wick,
  pilot,
};
/** Every registered fighter, stock first, in registration order. Mutated by registerFighter. */
export const rosterList: FighterDef[] = Object.values(roster);

const listeners = new Set<(id: FighterId) => void>();
/** Runs after a fighter is registered or removed, so caches keyed by fighter id can drop their entry. */
export function onRosterChange(cb: (id: FighterId) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Adds (or replaces) a fighter at runtime. Generated fighters go through here. */
export function registerFighter(def: FighterDef): void {
  if (!def.id) throw new Error("fighter has no id");
  const i = rosterList.findIndex((d) => d.id === def.id);
  if (i >= 0) rosterList[i] = def; else rosterList.push(def);
  roster[def.id] = def;
  for (const cb of listeners) cb(def.id);
}

export function unregisterFighter(id: FighterId): void {
  if (STOCK_IDS.includes(id)) throw new Error(`cannot remove stock fighter ${id}`);
  if (!roster[id]) return;
  delete roster[id];
  const i = rosterList.findIndex((d) => d.id === id);
  if (i >= 0) rosterList.splice(i, 1);
  for (const cb of listeners) cb(id);
}
