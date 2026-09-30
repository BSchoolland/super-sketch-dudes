// What the CPU can only learn about a fighter by playing it: every special, and every move that fires
// something, run in private matches. Too slow for a browser starting a match, so the forge runs it once
// and it ships in the bundle (FighterDef.cpu); the game only reads it (cpu-profile.ts). A pure function of
// the def, so every client that loads the bundle plays against the same CPU.
import { formDef, isActionable, startMove } from "./fighter";
import { registerFighter, unregisterFighter } from "./fighters/index";
import { B, EMPTY_INPUT, type InputFrame } from "./input";
import { createMatch, step } from "./sim";
import type { FighterDef, Hitbox } from "./types";

/** Bumped whenever what a study holds or how it is measured changes: bundles with an older one must be re-studied. */
export const STUDY_VERSION = 1;

export const SPECIALS = ["nspecial", "sspecial", "uspecial", "dspecial"] as const;
export type SpecialId = (typeof SPECIALS)[number];

/** A hold longer than any move: held to the end. (Studies travel as JSON, which has no Infinity.) */
export const HELD = 9999;
/** Hold lengths a special is studied at: tapped, a short charge, and held to the end. */
export const HOLDS = [0, 24, HELD] as const;

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
  /** Tapped over and over for five seconds: projectile damage it puts out per frame, and the frames between shots. */
  shotDpf: number;
  cooldown: number;
}

/** One projectile trail: where the shots went, in fighter units relative to where the fighter started, facing +x. */
export interface ShotPath {
  /** Frames the special button was held from the start (HELD: to the end). */
  hold: number;
  /** Started airborne (high above the stage) rather than on the ground. */
  air: boolean;
  pts: ShotPoint[];
  /** The hardest-hitting projectile it put out, as fired (tapped: no charge). */
  hit: Hitbox | null;
}
export interface ShotPoint { x: number; y: number; r: number; t: number }

/**
 * Where a frozen dummy was put, relative to the fighter's feet with the fighter facing +x: every x with
 * every y (y down). Behind, overlapping, and in front out to a long shot; well above to a little below.
 */
export const GRID_X = [-280, -150, -50, 50, 140, 240, 350, 470, 600, 750, 900];
export const GRID_Y = [-360, -220, -110, 0, 110];

/** The dummy was hit `t` frames after the move started, for `damage` (the first hit only). */
export interface HitCell { t: number; damage: number }
/** One move started one way (ground/air, a hold length) against a dummy at every grid spot: cells[xi * GRID_Y.length + yi], null = never hit. */
export interface HitGrid { air: boolean; hold: number; cells: (HitCell | null)[] }

export type Spot = "near" | "far" | "behind";
/** Holding `move` for `hold` frames from the ground: which dummies (all at 0%) it KO'd, and how long it keeps the fighter busy. */
export interface Plan { move: SpecialId; hold: number; kos: Spot[]; frames: number }

/** Everything measured about the fighter in one form. */
export interface FormStudy {
  specials: Record<SpecialId, SpecialProbe>;
  /** Projectile trails of every move that fires something: the specials and any hooked normal. */
  shots: Record<string, ShotPath[]>;
  /** Hit grids of the specials and of every normal that fires something. */
  hits: Record<string, HitGrid[]>;
  /** Every hold of a held special that KO'd at least one dummy, shortest hold first per move. */
  plans: Plan[];
}

export interface CpuStudy { version: number; base: FormStudy; forms: Record<string, FormStudy> }

/** Studies the fighter (registered in the roster) in its base form and in each of its forms. */
export function studyFighter(def: FighterDef): CpuStudy {
  const forms: Record<string, FormStudy> = {};
  for (const name of Object.keys(def.forms ?? {})) {
    // the form as a fighter of its own that is always in it: no fighter state has to be found that enters it
    const fd: FighterDef = { ...formDef(def, name), id: `${def.id}~${name}`, form: undefined, forms: undefined };
    registerFighter(fd);
    try { forms[name] = studyForm(fd); } finally { unregisterFighter(fd.id); }
  }
  return { version: STUDY_VERSION, base: studyForm(def), forms };
}

function studyForm(def: FighterDef): FormStudy {
  const specials = {} as Record<SpecialId, SpecialProbe>;
  const shots: Record<string, ShotPath[]> = {};
  const hits: Record<string, HitGrid[]> = {};
  const drift = runSpecial(def, null, true, 0).trail;
  for (const s of SPECIALS) {
    const ground = runSpecial(def, s, false, HELD), air = runSpecial(def, s, true, HELD), tapped = runSpecial(def, s, false, 0);
    const paths = [ground.path, air.path, tapped.path, runSpecial(def, s, true, 0).path, runSpecial(def, s, false, HOLDS[1]).path, runSpecial(def, s, true, HOLDS[1]).path].filter((q) => q.pts.length);
    const { dpf, cooldown } = shotRate(def, s);
    specials[s] = { groundDx: ground.dx, airDx: air.dx - drift[air.frames], airRise: air.rise, airDrop: air.drop, shotRange: Math.max(ground.shot, air.shot), held: ground.frames > tapped.frames + 8, shotDpf: dpf, cooldown };
    shots[s] = paths;
    hits[s] = [false, true].flatMap((a) => HOLDS.map((h) => hitGrid(def, s, a, h)));
  }
  for (const id in def.moves) {
    if ((SPECIALS as readonly string[]).includes(id) || !def.moves[id].hook) continue;
    const paths = [runSpecial(def, id, false, 0), runSpecial(def, id, true, 0)].map((r) => r.path).filter((p) => p.pts.length);
    if (!paths.length) continue;
    shots[id] = paths;
    hits[id] = [hitGrid(def, id, false, 0), hitGrid(def, id, true, 0)];
  }
  return { specials, shots, hits, plans: plansFor(def, specials) };
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
  let minY = y0, shot = 0, frames = PROBE_FRAMES, done = false, dx = 0, drop = 0, hit: Hitbox | null = null;
  const trail = [0];
  const pts: ShotPoint[] = [];
  for (let i = 0; i < PROBE_FRAMES; i++) {
    step(s, [done ? EMPTY_INPUT : i < hold ? input : stick, EMPTY_INPUT]);
    s.events.length = 0;
    trail.push(f.x - x0);
    for (const p of s.projectiles) if (p.owner === 0 && !p.dead) {
      shot = Math.max(shot, p.x + p.hb.r - x0);
      if (!hit || p.hb.damage > hit.damage) hit = { ...p.hb };
      pts.push({ x: p.x - x0, y: p.y - y0, r: p.hb.r, t: i + 1 });
    }
    if (!move) continue;
    if (!done) {
      minY = Math.min(minY, f.y);
      if (f.action !== "attack" || f.move !== move) { done = true; frames = i + 1; dx = f.x - x0; drop = f.y - y0; }
    }
    if (done && !s.projectiles.some((p) => p.owner === 0 && !p.dead)) break;
  }
  if (!done) { dx = f.x - x0; drop = f.y - y0; }
  return { dx, rise: y0 - minY, drop, shot, frames, trail, path: { hold, air, pts: thin(pts, 48), hit } };
}

/** At most about `n` of the points, evenly spread, the farthest one kept (a trail's reach is its farthest point). */
function thin(pts: ShotPoint[], n: number): ShotPoint[] {
  if (pts.length <= n) return pts;
  const every = Math.ceil(pts.length / n);
  const far = pts.reduce((a, b) => (b.x + b.r > a.x + a.r ? b : a));
  const out = pts.filter((_, i) => i % every === 0);
  if (!out.includes(far)) out.push(far);
  return out;
}

/** The move started one way against a dummy frozen at each grid spot in turn. */
function hitGrid(def: FighterDef, move: string, air: boolean, hold: number): HitGrid {
  const cells: (HitCell | null)[] = [];
  for (const gx of GRID_X) for (const gy of GRID_Y) cells.push(runAt(def, move, air, hold, gx, gy));
  return { air, hold, cells };
}

/**
 * Like runSpecial, with the dummy held still at (dx, dy) from the fighter's start (in the air if it isn't
 * standing on the fighter's ground) until the move first hits it, or the move and its shots are over.
 * The dummy is where a target stands when the CPU decides; whatever homes, aims or pounces finds it there.
 */
function runAt(def: FighterDef, move: string, air: boolean, hold: number, dx: number, dy: number): HitCell | null {
  const s = createMatch({ stage: "proving", players: [{ fighter: def.id }, { fighter: def.id }], rules: { stocks: 99, time: 0 }, seed: 1 });
  const f = s.fighters[0], dummy = s.fighters[1];
  f.x = -400; f.facing = 1; f.moveFacing = 1;
  if (air) { f.y = -500; f.grounded = false; f.platform = -1; f.action = "air"; }
  const dx0 = f.x + dx, dy0 = f.y + dy, standing = !air && dy === 0;
  const freeze = () => {
    dummy.x = dx0; dummy.y = dy0; dummy.vx = 0; dummy.vy = 0; dummy.facing = -1;
    if (!standing) { dummy.grounded = false; dummy.platform = -1; if (dummy.action === "idle") dummy.action = "air"; }
  };
  freeze();
  const stick = { ...EMPTY_INPUT, x: 100, y: move === "uspecial" ? -100 : 0 };
  const input = { ...stick, b: hold > 0 ? B.SPECIAL : 0 };
  s.inputs[0] = { ...input };
  startMove(s, f, move);
  let done = false;
  for (let i = 0; i < PROBE_FRAMES; i++) {
    const before = dummy.percent;
    step(s, [done ? EMPTY_INPUT : i < hold ? input : stick, EMPTY_INPUT]);
    s.events.length = 0;
    if (dummy.percent > before) return { t: i + 1, damage: dummy.percent - before };
    freeze();
    if (!done && (f.action !== "attack" || f.move !== move)) done = true;
    if (done && !s.projectiles.some((p) => p.owner === 0 && !p.dead)) break;
  }
  return null;
}

const PLAN_HOLDS = [20, 60, 120, 240, 360];
const PLAN_SPOTS: [Spot, number][] = [["near", 120], ["far", 420], ["behind", -420]];
/** After letting go: long enough for a launched dummy to reach a blast line. */
const PLAN_AFTER = 180;
const PLANNED = ["nspecial", "sspecial", "dspecial"] as const;

/**
 * What holding a special actually achieves, measured rather than read: each special that keeps going while
 * held is run for a range of hold lengths, with idle dummies at 0% close in front, far in front and behind,
 * and the KOs are counted. A special that looks like nothing (a stance, a meter that fills) but wipes the
 * arena after four seconds shows up as exactly that.
 */
function plansFor(def: FighterDef, specials: Record<SpecialId, SpecialProbe>): Plan[] {
  const plans: Plan[] = [];
  for (const s of PLANNED) {
    if (!specials[s].held) continue;
    for (const hold of PLAN_HOLDS) {
      const plan = runPlan(def, s, hold);
      if (plan.kos.length) { plans.push(plan); break; }
    }
  }
  return plans;
}

function runPlan(def: FighterDef, move: SpecialId, hold: number): Plan {
  const s = createMatch({ stage: "proving", players: [def.id, def.id, def.id, def.id].map((fighter) => ({ fighter })), rules: { stocks: 9, time: 0 }, seed: 1 });
  const f = s.fighters[0];
  f.x = 0; f.facing = 1; f.moveFacing = 1;
  PLAN_SPOTS.forEach(([, x], i) => { const d = s.fighters[i + 1]; d.x = x; d.facing = x > 0 ? -1 : 1; });
  const stick: InputFrame = { ...EMPTY_INPUT, x: move === "sspecial" ? 100 : 0, y: move === "dspecial" ? 100 : 0 };
  const held = { ...stick, b: B.SPECIAL };
  s.inputs[0] = { ...held };
  startMove(s, f, move);
  const kos = new Set<Spot>();
  let frames = hold + PLAN_AFTER;
  for (let i = 0; i < hold + PLAN_AFTER; i++) {
    step(s, [i < hold ? held : EMPTY_INPUT, EMPTY_INPUT, EMPTY_INPUT, EMPTY_INPUT]);
    for (const e of s.events) if (e.t === "ko" && e.slot > 0) kos.add(PLAN_SPOTS[e.slot - 1][0]);
    s.events.length = 0;
    if (i > hold && frames === hold + PLAN_AFTER && isActionable(f)) frames = i;
  }
  return { move, hold, kos: [...kos], frames };
}
