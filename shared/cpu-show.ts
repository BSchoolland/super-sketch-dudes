// What the showman CPU (cpu-showman.ts) finds worth showing off in a fighter: what kind each of its attacks is, how
// hard it hits and whether it fires something, which one is its signature, and which meters it fills up and which
// special spends them. Read off the def and the forge's study (cpu-profile.ts), plus private matches per meter; a pure
// function of the def.
import { startMove } from "./fighter";
import { B, EMPTY_INPUT } from "./input";
import { SPECIALS, profileOf, type SpecialId } from "./cpu-profile";
import { createMatch, step } from "./sim";
import type { Fighter, FighterDef } from "./types";

export type MoveKind = "special" | "smash" | "aerial" | "tilt" | "jab" | "dash";

/** The moves it throws in neutral (uspecial is for getting back). */
export const SHOW_MOVES: Record<string, MoveKind> = {
  jab1: "jab", ftilt: "tilt", utilt: "tilt", dtilt: "tilt", dashAttack: "dash",
  fsmash: "smash", usmash: "smash", dsmash: "smash",
  nair: "aerial", fair: "aerial", bair: "aerial", uair: "aerial", dair: "aerial",
  nspecial: "special", sspecial: "special", dspecial: "special",
};

export interface ShowMove {
  id: string;
  kind: MoveKind;
  /** The most damage one hit of it does: a hitbox, a shot it fires, or what the study saw it do to a dummy. */
  power: number;
  /** Base plus growth knockback of that hit. */
  launch: number;
  /** Fires something. */
  shoots: boolean;
  /** Has no hit, shot or measured damage at all (a stance, a summon, a transformation). */
  inert: boolean;
}

/** A bar that fills up over the fight, and the special that spends it when full (null: it goes off by itself). */
export interface Meter { key: string; payoff: SpecialId | null }

export interface Show {
  moves: ShowMove[];
  /** The hardest-hitting of them: what viewers should see land. */
  big: ShowMove;
  meters: Meter[];
}

const shows = new WeakMap<FighterDef, Show>();

export function showOf(def: FighterDef): Show {
  let s = shows.get(def);
  if (!s) { s = buildShow(def); shows.set(def, s); }
  return s;
}

function buildShow(def: FighterDef): Show {
  const p = profileOf(def);
  const moves: ShowMove[] = [];
  for (const id in SHOW_MOVES) {
    const mv = def.moves[id], kind = SHOW_MOVES[id];
    if (!mv) throw new Error(`showman: ${def.id} has no ${id}`);
    let power = 0, launch = 0;
    for (const hb of mv.hitboxes) if (!hb.grab && !hb.wind && hb.damage > power) { power = hb.damage; launch = hb.base + hb.growth; }
    const shots = p.shots[id] ?? [];
    for (const path of shots) if (path.hit && path.hit.damage > power) { power = path.hit.damage; launch = path.hit.base + path.hit.growth; }
    for (const grid of p.hits[id] ?? []) for (const cell of grid.cells) if (cell && cell.damage > power) power = cell.damage;
    const shoots = shots.some((path) => path.pts.length > 0);
    moves.push({ id, kind, power, launch, shoots, inert: power === 0 && !shoots });
  }
  const big = moves.reduce((a, b) => (b.power + b.launch / 40 > a.power + a.launch / 40 ? b : a));
  return { moves, big, meters: metersOf(def) };
}

/**
 * The bars that start below full and stay on the card (a curse, a rage, a ring count): filled by fighting. Each one is
 * filled in a private match and every special is started with it full; the one that empties it is its payoff.
 */
function metersOf(def: FighterDef): Meter[] {
  const out: Meter[] = [];
  for (const key in def.bars ?? {}) {
    const bar = def.bars![key];
    if ((bar.start ?? 0) >= bar.max || bar.trip !== undefined) continue;
    const s = createMatch({ stage: "proving", players: [{ fighter: def.id }, { fighter: def.id }], rules: { stocks: 99, time: 0 }, seed: 1 });
    if (bar.show && !bar.show(s.fighters[0])) continue;
    // one that drains on its own once full is a timer, not something to spend
    if (spends(def, key, null)) continue;
    out.push({ key, payoff: SPECIALS.find((sp) => sp !== "uspecial" && spends(def, key, sp)) ?? null });
  }
  return out;
}

const SPEND_FRAMES = 240;

/** Whether the bar, full, is below half within four seconds of starting `special` (null: of standing still). */
function spends(def: FighterDef, key: string, special: SpecialId | null): boolean {
  const max = def.bars![key].max;
  const s = createMatch({ stage: "proving", players: [{ fighter: def.id }, { fighter: def.id }], rules: { stocks: 99, time: 0 }, seed: 1 });
  const f = s.fighters[0], dummy = s.fighters[1];
  f.x = -300; f.facing = 1; f.moveFacing = 1;
  dummy.x = -150; dummy.facing = -1;
  f.bars[key] = max;
  const held = { ...EMPTY_INPUT, y: special === "dspecial" ? 100 : 0, x: special === "sspecial" ? 100 : 0, b: B.SPECIAL };
  if (special) { s.inputs[0] = { ...held }; startMove(s, f, special); }
  for (let i = 0; i < SPEND_FRAMES; i++) {
    step(s, [special && i < 60 ? held : EMPTY_INPUT, EMPTY_INPUT]);
    s.events.length = 0;
    if (f.bars[key] <= max * 0.5) return true;
  }
  return false;
}

/** The fighter's meter that is full now and has a special to spend it, if any. */
export function fullMeter(def: FighterDef, f: Fighter): Meter | null {
  for (const m of showOf(def).meters) if (m.payoff && f.bars[m.key] >= def.bars![m.key].max * 0.98) return m;
  return null;
}

/** The moves every fighter has that are no show of their own: follow-ups, grabs and throws, getting up, the taunt. */
const ROUTINE = new Set(["jab2", "jab3", "jabRapid", "jabFinish", "grab", "dashGrab", "pummel", "fthrow", "bthrow", "uthrow", "dthrow", "ledgeAttack", "getupAttack", "uspecial", "taunt"]);

/**
 * Whether `move` is one of the fighter's showpieces: a special, a smash, its biggest hit, the payoff of a full meter,
 * or a move of its own beyond the standard set (what a special turns into: a domain, a transformation, a beam).
 */
export function isShowpiece(def: FighterDef, f: Fighter, move: string): boolean {
  const show = showOf(def);
  if (show.big.id === move) return true;
  const kind = SHOW_MOVES[move];
  if (kind === "special" || kind === "smash") return true;
  if (!kind && !ROUTINE.has(move)) return true;
  return fullMeter(def, f)?.payoff === move;
}

export function showMove(def: FighterDef, move: string): ShowMove | undefined {
  return showOf(def).moves.find((m) => m.id === move);
}
