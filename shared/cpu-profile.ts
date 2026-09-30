// What the CPU knows about a fighter: the reach of every move from its hitboxes, and the study the forge
// ran of what each special actually does (cpu-study.ts, shipped in the bundle). The bot reads this instead
// of knowing fighters by name, so it plays any forged fighter. Nothing here runs the sim.
import { formDef } from "./fighter";
import { roster } from "./fighters/index";
import { GRID_X, GRID_Y, STUDY_VERSION, SPECIALS, type HitCell, type HitGrid, type Plan, type ShotPath, type SpecialId, type SpecialProbe } from "./cpu-study";
import type { FighterDef } from "./types";

export { HOLDS, HELD, SPECIALS, type SpecialId, type SpecialProbe, type ShotPath, type ShotPoint, type Plan, type Spot } from "./cpu-study";

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

export interface Profile {
  reach: Record<string, MoveInfo>;
  specials: Record<SpecialId, SpecialProbe>;
  /** Height one air jump gains. */
  airJumpHeight: number;
  /** Height the air jumps plus the up special can regain. */
  recoveryHeight: number;
  /** Heavy or a poor recovery: survive toward the stage, don't chase offstage. */
  cautious: boolean;
  /** Shot paths of every move that fires something: the specials and any hooked normal. */
  shots: Record<string, ShotPath[]>;
  /** Where each special (and each normal that fires something) hits a dummy standing still, by hold. */
  hits: Record<string, HitGrid[]>;
  /** Held specials that KO'd a dummy, and at what hold. */
  plans: Plan[];
  /** 0: a brawler; 1: its shots out-damage its tilts, so it keeps its distance and shoots. */
  zoning: number;
}

const profiles = new WeakMap<FighterDef, Profile>();

/** The profile of a fighter's def, or of one of its forms' defs (what defOf gives). */
export function profileOf(def: FighterDef): Profile {
  let p = profiles.get(def);
  if (!p) { p = buildProfile(def); profiles.set(def, p); }
  return p;
}

/** Which of its fighter's forms `def` is: null for the base def. */
function formOf(def: FighterDef): string | null {
  const base = roster[def.id];
  if (!base) throw new Error(`cpu: ${def.id} is not registered`);
  if (base === def) return null;
  const name = Object.keys(base.forms ?? {}).find((n) => formDef(base, n) === def);
  if (!name) throw new Error(`cpu: a def of ${def.id} that is neither it nor one of its forms`);
  return name;
}

function buildProfile(def: FighterDef): Profile {
  const form = formOf(def);
  const study = roster[def.id].cpu;
  if (!study || study.version !== STUDY_VERSION) throw new Error(`cpu: ${def.id} has ${study ? `a v${study.version}` : "no"} CPU study, v${STUDY_VERSION} needed: the forge studies fighters (forge/tools/study.ts)`);
  const fs = form ? study.forms[form] : study.base;
  if (!fs) throw new Error(`cpu: ${def.id}'s CPU study has no form ${form}`);
  const reach: Record<string, MoveInfo> = {};
  for (const id in def.moves) reach[id] = moveInfo(def, id);
  const st = def.stats;
  const airJumpHeight = st.doubleJump * st.doubleJump / (2 * st.gravity);
  const recoveryHeight = Math.max(0, st.jumps - 1) * airJumpHeight + fs.specials.uspecial.airRise;
  const cautious = st.weight >= 110 || recoveryHeight < 320 || st.airSpeed < 3;
  return { reach, specials: fs.specials, airJumpHeight, recoveryHeight, cautious, shots: fs.shots, hits: fs.hits, plans: fs.plans, zoning: zoningOf(def, reach, fs.shots, fs.specials) };
}

/**
 * What `move` does to a target standing (tx, ty) from the fighter (facing +x, y down), started grounded
 * or airborne, holding special no longer than `maxHold`: the shortest hold that hit a dummy at the
 * nearest studied spot, or null. Past the grid's ends nothing was studied, so nothing hits.
 */
export function hitAt(p: Profile, move: string, air: boolean, tx: number, ty: number, maxHold = Infinity): { hold: number; cell: HitCell } | null {
  const grids = p.hits[move];
  if (!grids) return null;
  const xi = nearest(GRID_X, tx, 120), yi = nearest(GRID_Y, ty, 90);
  if (xi < 0 || yi < 0) return null;
  let best: { hold: number; cell: HitCell } | null = null;
  for (const g of grids) {
    if (g.air !== air || g.hold > maxHold || (best && g.hold >= best.hold)) continue;
    const cell = g.cells[xi * GRID_Y.length + yi];
    if (cell) best = { hold: g.hold, cell };
  }
  return best;
}

/** Index of the grid value nearest v, or -1 if v is more than `beyond` past either end. */
function nearest(grid: readonly number[], v: number, beyond: number): number {
  if (v < grid[0] - beyond || v > grid[grid.length - 1] + beyond) return -1;
  let best = 0;
  for (let i = 1; i < grid.length; i++) if (Math.abs(grid[i] - v) < Math.abs(grid[best] - v)) best = i;
  return best;
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

