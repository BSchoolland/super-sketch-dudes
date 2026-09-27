import { defOf } from "./fighter";
import type { Fighter, FighterDef } from "./types";

/** A new fighter's bars at their starting values, latches clear. */
export function startBars(def: FighterDef): { bars: Record<string, number>; tripped: Record<string, number> } {
  const bars: Record<string, number> = {}, tripped: Record<string, number> = {};
  for (const k in def.bars) { bars[k] = def.bars[k].start ?? 0; tripped[k] = 0; }
  return { bars, tripped };
}

/** Once per frame, after the hooks: every bar back inside [0, max], every latch moved if its value crossed a mark. */
export function settleBars(f: Fighter): void {
  const defs = defOf(f).bars;
  for (const k in defs) {
    const d = defs[k];
    const v = f.bars[k] = Math.max(0, Math.min(d.max, f.bars[k]));
    if (d.trip === undefined || d.rearm === undefined) continue;
    const up = d.trip > d.rearm;
    if (f.tripped[k]) { if (up ? v <= d.rearm : v >= d.rearm) f.tripped[k] = 0; }
    else if (up ? v >= d.trip : v <= d.trip) f.tripped[k] = 1;
  }
}

function barOf(f: Fighter, key: string) {
  const d = defOf(f).bars?.[key];
  if (!d) throw new Error(`${f.id} has no bar ${key}`);
  return d;
}

/** 0..1, how full the bar is. */
export function fill(f: Fighter, key: string): number {
  return Math.max(0, Math.min(1, f.bars[key] / barOf(f, key).max));
}

/** Whether the bar's latch is set (see Bar). */
export function tripped(f: Fighter, key: string): boolean {
  barOf(f, key);
  return f.tripped[key] === 1;
}

/** Spends `n` from the bar if that much is there; false, and nothing spent, otherwise. */
export function take(f: Fighter, key: string, n: number): boolean {
  barOf(f, key);
  if (f.bars[key] < n) return false;
  f.bars[key] -= n;
  return true;
}
