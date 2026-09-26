import type { FighterDef, FighterId } from "../types";

/** Every fighter is a forged drawing; the roster holds the ones loaded so far. */
export const roster: Record<FighterId, FighterDef> = {};
/** Every registered fighter in registration order. Mutated by registerFighter. */
export const rosterList: FighterDef[] = [];

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
  if (!roster[id]) return;
  delete roster[id];
  const i = rosterList.findIndex((d) => d.id === id);
  if (i >= 0) rosterList.splice(i, 1);
  for (const cb of listeners) cb(id);
}
