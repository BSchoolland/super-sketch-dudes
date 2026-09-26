// What the CPU knows about a fighter, derived from its def alone: the reach of every move from its
// hitboxes, and what each special actually does, measured by running it in a private match. The bot
// reads this instead of knowing fighters by name, so it plays any forged fighter. Everything here is
// a pure function of the def, so every client derives the same profile.
import { roster } from "./fighters/index";
import { startMove } from "./fighter";
import { B, EMPTY_INPUT } from "./input";
import { createMatch, step } from "./sim";
import type { FighterDef } from "./types";

export interface MoveInfo {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  first: number;
  last: number;
  damage: number;
  angle: number;
  base: number;
  growth: number;
}

export const EMPTY_MOVE: MoveInfo = {
  minX: 0, maxX: 0, minY: 0, maxY: 0,
  first: 999, last: 0, damage: 0, angle: 0, base: 0, growth: 0,
};

/** One special, run from the ground and from high in the air with the stick held forward (and up for uspecial). */
export interface SpecialProbe {
  /** How far the fighter moved forward over the move, started grounded / airborne. */
  groundDx: number;
  airDx: number;
  /** Height gained over the air start (0 if it only fell), and how far below the start it ended. */
  airRise: number;
  airDrop: number;
  /** Farthest ahead of the fighter a projectile it spawned reached; 0 if it spawned none. */
  shotRange: number;
  /** Holding special keeps the move going (a charge or a sustained flight). */
  held: boolean;
}

export const SPECIALS = ["nspecial", "sspecial", "uspecial", "dspecial"] as const;
export type SpecialId = (typeof SPECIALS)[number];

export interface Profile {
  reach: Record<string, MoveInfo>;
  /** Undefined for a special a form overrides (forms can't be entered without the fighter's own state). */
  specials: Partial<Record<SpecialId, SpecialProbe>>;
  /** Height one air jump gains. */
  airJumpHeight: number;
  /** Height the air jumps plus the up special can regain. */
  recoveryHeight: number;
  /** Heavy or a poor recovery: survive toward the stage, don't chase offstage. */
  cautious: boolean;
}

const profiles = new WeakMap<FighterDef, Profile>();
const probes = new WeakMap<FighterDef, Record<SpecialId, SpecialProbe>>();

export function profileOf(def: FighterDef): Profile {
  let p = profiles.get(def);
  if (!p) { p = buildProfile(def); profiles.set(def, p); }
  return p;
}

function buildProfile(def: FighterDef): Profile {
  const reach: Record<string, MoveInfo> = {};
  for (const id in def.moves) reach[id] = moveInfo(def, id);
  const base = roster[def.id];
  if (!base) throw new Error(`cpu: ${def.id} is not registered`);
  const baseProbes = probesOf(base);
  const specials: Profile["specials"] = {};
  for (const s of SPECIALS) if (def.moves[s] === base.moves[s]) specials[s] = baseProbes[s];
  const st = def.stats;
  const airJumpHeight = st.doubleJump * st.doubleJump / (2 * st.gravity);
  const recoveryHeight = Math.max(0, st.jumps - 1) * airJumpHeight + (specials.uspecial?.airRise ?? 0);
  const cautious = st.weight >= 110 || recoveryHeight < 320 || st.airSpeed < 3;
  return { reach, specials, airJumpHeight, recoveryHeight, cautious };
}

function moveInfo(def: FighterDef, id: string): MoveInfo {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  let first = 999, last = 0, damage = 0, angle = 0, base = 0, growth = 0;
  for (const hb of def.moves[id].hitboxes) {
    const x2 = hb.x2 ?? hb.x, y2 = hb.y2 ?? hb.y;
    minX = Math.min(minX, hb.x - hb.r, x2 - hb.r);
    maxX = Math.max(maxX, hb.x + hb.r, x2 + hb.r);
    minY = Math.min(minY, hb.y - hb.r, y2 - hb.r);
    maxY = Math.max(maxY, hb.y + hb.r, y2 + hb.r);
    first = Math.min(first, hb.frames[0]);
    last = Math.max(last, hb.frames[1]);
    if (!hb.grab && hb.damage > damage) {
      damage = hb.damage;
      angle = hb.angle;
      base = hb.base;
      growth = hb.growth;
    }
  }
  return first === 999 ? { ...EMPTY_MOVE } : { minX, maxX, minY, maxY, first, last, damage, angle, base, growth };
}

function probesOf(def: FighterDef): Record<SpecialId, SpecialProbe> {
  let p = probes.get(def);
  if (!p) {
    p = {} as Record<SpecialId, SpecialProbe>;
    const drift = runSpecial(def, null, true, false).path;
    for (const s of SPECIALS) {
      const ground = runSpecial(def, s, false, true), air = runSpecial(def, s, true, true), tapped = runSpecial(def, s, false, false);
      p[s] = { groundDx: ground.dx, airDx: air.dx - drift[air.frames], airRise: air.rise, airDrop: air.drop, shotRange: Math.max(ground.shot, air.shot), held: ground.frames > tapped.frames + 8 };
    }
    probes.set(def, p);
  }
  return p;
}

const PROBE_FRAMES = 240;

/**
 * Starts the special (or nothing, for the drift baseline) facing +x on the left of the stage with a
 * dummy behind, holds the stick forward, and watches until the move and its projectiles are over.
 */
function runSpecial(def: FighterDef, move: SpecialId | null, air: boolean, hold: boolean): { dx: number; rise: number; drop: number; shot: number; frames: number; path: number[] } {
  const s = createMatch({ stage: "proving", players: [{ fighter: def.id }, { fighter: def.id }], rules: { stocks: 99, time: 0 }, seed: 1 });
  const f = s.fighters[0], dummy = s.fighters[1];
  dummy.x = -520; dummy.facing = 1;
  f.x = -400; f.facing = 1; f.moveFacing = 1;
  if (air) { f.y = -500; f.grounded = false; f.platform = -1; f.action = "air"; }
  const x0 = f.x, y0 = f.y;
  const input = { ...EMPTY_INPUT, x: 100, y: move === "uspecial" ? -100 : 0, b: hold ? B.SPECIAL : 0 };
  // already held last frame, so the sim sees no fresh press to buffer into a second special
  s.inputs[0] = { ...input };
  if (move) startMove(s, f, move);
  let minY = y0, shot = 0, frames = PROBE_FRAMES, done = false, dx = 0, drop = 0;
  const path = [0];
  for (let i = 0; i < PROBE_FRAMES; i++) {
    step(s, [done ? EMPTY_INPUT : input, EMPTY_INPUT]);
    s.events.length = 0;
    path.push(f.x - x0);
    for (const p of s.projectiles) if (p.owner === 0 && !p.dead) shot = Math.max(shot, p.x + p.hb.r - x0);
    if (!move) continue;
    if (!done) {
      minY = Math.min(minY, f.y);
      if (f.action !== "attack" || f.move !== move) { done = true; frames = i + 1; dx = f.x - x0; drop = f.y - y0; }
    }
    if (done && !s.projectiles.some((p) => p.owner === 0 && !p.dead)) break;
  }
  if (!done) { dx = f.x - x0; drop = f.y - y0; }
  return { dx, rise: y0 - minY, drop, shot, frames, path };
}
