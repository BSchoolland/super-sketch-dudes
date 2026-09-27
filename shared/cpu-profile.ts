// What the CPU knows about a fighter, derived from its def alone: the reach of every move from its
// hitboxes, and what each special actually does, measured by running it in a private match. The bot
// reads this instead of knowing fighters by name, so it plays any forged fighter. Everything here is
// a pure function of the def, so every client derives the same profile.
import { roster } from "./fighters/index";
import { isActionable, startMove } from "./fighter";
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
  /** Where its projectiles fly, per start (ground / air) and hold length. */
  paths: ShotPath[];
  /** Tapped over and over for five seconds: projectile damage it puts out per frame, and the frames between shots. */
  shotDpf: number;
  cooldown: number;
}

/** One projectile trail: where the shots went, in fighter units relative to where the fighter started, facing +x. */
export interface ShotPath {
  /** Frames the special button was held from the start (Infinity: held to the end). */
  hold: number;
  /** Started airborne (high above the stage) rather than on the ground. */
  air: boolean;
  pts: ShotPoint[];
  damage: number;
}
export interface ShotPoint { x: number; y: number; r: number; t: number }

/** Hold lengths a special is probed at: tapped, a short charge, and held to the end. */
export const HOLDS = [0, 24, Infinity] as const;

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
  /** Shot paths of every move that fires something: the specials and any hooked normal. */
  shots: Record<string, ShotPath[]>;
  /** 0: a brawler; 1: its shots out-damage its tilts, so it keeps its distance and shoots. */
  zoning: number;
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
  const shots = shotsOf(base, def);
  return { reach, specials, airJumpHeight, recoveryHeight, cautious, shots, zoning: zoningOf(def, reach, shots, specials) };
}

const shotTables = new WeakMap<FighterDef, Record<string, ShotPath[]>>();

/** Every move that can fire something (only a hook can spawn a projectile), probed tapped from the ground and the air. */
function shotsOf(base: FighterDef, def: FighterDef): Record<string, ShotPath[]> {
  let t = shotTables.get(base);
  if (!t) {
    t = {};
    const probes = probesOf(base);
    for (const s of SPECIALS) t[s] = probes[s].paths;
    for (const id in base.moves) {
      if ((SPECIALS as readonly string[]).includes(id) || !base.moves[id].hook) continue;
      const paths = [runSpecial(base, id, false, 0), runSpecial(base, id, true, 0)].map((r) => r.path).filter((p) => p.pts.length);
      if (paths.length) t[id] = paths;
    }
    shotTables.set(base, t);
  }
  const out: Record<string, ShotPath[]> = {};
  for (const id in t) if (def.moves[id] === base.moves[id]) out[id] = t[id];
  return out;
}

/**
 * How much a fighter should play keep-away: the projectile damage its specials put out per frame when
 * fired as often as they come (a fireball every 150 frames counts for little; a stream of embers for a
 * lot), against what its tilts would do landing every half second.
 */
function zoningOf(def: FighterDef, reach: Record<string, MoveInfo>, shots: Record<string, ShotPath[]>, specials: Profile["specials"]): number {
  let dpf = 0;
  for (const s of SPECIALS) {
    const probe = specials[s];
    if (!probe) continue;
    const far = Math.max(0, ...(shots[s] ?? []).map((path) => path.pts.reduce((m, q) => Math.max(m, q.x + q.r), 0)));
    if (far >= 220) dpf = Math.max(dpf, probe.shotDpf);
  }
  if (!dpf) return 0;
  const tilts = ["ftilt", "utilt", "dtilt"].map((m) => reach[m]?.damage ?? 0).sort((a, b) => a - b);
  const tilt = Math.max(1, tilts[1]) / 30;
  // a slow fighter can't make rushing work anyway; a fast one would rather brawl than wait
  const mobility = ((5.2 - def.stats.run) / 2.5) * 0.4;
  return Math.max(0, Math.min(1, (dpf / tilt - 0.3) / 0.5 + mobility));
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
    const drift = runSpecial(def, null, true, 0).trail;
    for (const s of SPECIALS) {
      const ground = runSpecial(def, s, false, Infinity), air = runSpecial(def, s, true, Infinity), tapped = runSpecial(def, s, false, 0);
      const paths = [ground.path, air.path, tapped.path, runSpecial(def, s, true, 0).path, runSpecial(def, s, false, HOLDS[1]).path, runSpecial(def, s, true, HOLDS[1]).path].filter((q) => q.pts.length);
      const { dpf, cooldown } = shotRate(def, s);
      p[s] = { groundDx: ground.dx, airDx: air.dx - drift[air.frames], airRise: air.rise, airDrop: air.drop, shotRange: Math.max(ground.shot, air.shot), held: ground.frames > tapped.frames + 8, paths, shotDpf: dpf, cooldown };
    }
    probes.set(def, p);
  }
  return p;
}

const PROBE_FRAMES = 240;
const RATE_FRAMES = 300;

/** Taps the special whenever the fighter can act, for five seconds: how much projectile damage that puts out, and how often a shot actually comes. */
function shotRate(def: FighterDef, move: SpecialId): { dpf: number; cooldown: number } {
  const s = createMatch({ stage: "proving", players: [{ fighter: def.id }, { fighter: def.id }], rules: { stocks: 99, time: 0 }, seed: 1 });
  const f = s.fighters[0], dummy = s.fighters[1];
  dummy.x = -520; dummy.facing = 1;
  f.x = -400; f.facing = 1; f.moveFacing = 1;
  const stick = { ...EMPTY_INPUT, x: 100, y: move === "uspecial" ? -100 : 0 };
  let damage = 0, shots = 0, last = -1, gaps = 0, pressed = false;
  const seen = new Set<number>();
  for (let i = 0; i < RATE_FRAMES; i++) {
    const tap: boolean = !pressed && isActionable(f) && f.grounded;
    step(s, [tap ? { ...stick, b: B.SPECIAL } : stick, EMPTY_INPUT]);
    pressed = tap;
    s.events.length = 0;
    for (const p of s.projectiles) {
      if (p.owner !== 0 || seen.has(p.id)) continue;
      seen.add(p.id);
      damage += p.hb.damage;
      if (last >= 0 && i - last > 3) { gaps += i - last; shots++; }
      last = i;
    }
    if (f.y > 400) break; // it flew off the stage
  }
  return { dpf: damage / RATE_FRAMES, cooldown: shots ? gaps / shots : RATE_FRAMES };
}

/**
 * Starts the move (or nothing, for the drift baseline) facing +x on the left of the stage with a
 * dummy behind, holds the stick forward and the special button for `hold` frames, and watches until
 * the move and its projectiles are over. `path` is where its projectiles went.
 */
function runSpecial(def: FighterDef, move: string | null, air: boolean, hold: number): { dx: number; rise: number; drop: number; shot: number; frames: number; trail: number[]; path: ShotPath } {
  const s = createMatch({ stage: "proving", players: [{ fighter: def.id }, { fighter: def.id }], rules: { stocks: 99, time: 0 }, seed: 1 });
  const f = s.fighters[0], dummy = s.fighters[1];
  dummy.x = -520; dummy.facing = 1;
  f.x = -400; f.facing = 1; f.moveFacing = 1;
  if (air) { f.y = -500; f.grounded = false; f.platform = -1; f.action = "air"; }
  const x0 = f.x, y0 = f.y;
  const stick = { ...EMPTY_INPUT, x: 100, y: move === "uspecial" ? -100 : 0 };
  const input = { ...stick, b: hold > 0 ? B.SPECIAL : 0 };
  // already held last frame, so the sim sees no fresh press to buffer into a second special
  s.inputs[0] = { ...input };
  if (move) startMove(s, f, move);
  let minY = y0, shot = 0, frames = PROBE_FRAMES, done = false, dx = 0, drop = 0, damage = 0;
  const trail = [0];
  const pts: ShotPoint[] = [];
  for (let i = 0; i < PROBE_FRAMES; i++) {
    step(s, [done ? EMPTY_INPUT : i < hold ? input : stick, EMPTY_INPUT]);
    s.events.length = 0;
    trail.push(f.x - x0);
    for (const p of s.projectiles) if (p.owner === 0 && !p.dead) {
      shot = Math.max(shot, p.x + p.hb.r - x0);
      damage = Math.max(damage, p.hb.damage);
      if (pts.length < 400) pts.push({ x: p.x - x0, y: p.y - y0, r: p.hb.r, t: i + 1 });
    }
    if (!move) continue;
    if (!done) {
      minY = Math.min(minY, f.y);
      if (f.action !== "attack" || f.move !== move) { done = true; frames = i + 1; dx = f.x - x0; drop = f.y - y0; }
    }
    if (done && !s.projectiles.some((p) => p.owner === 0 && !p.dead)) break;
  }
  if (!done) { dx = f.x - x0; drop = f.y - y0; }
  return { dx, rise: y0 - minY, drop, shot, frames, trail, path: { hold, air, pts, damage } };
}
