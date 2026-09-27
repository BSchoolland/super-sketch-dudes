import { C } from "./config";
import { hashNumbers } from "./fixed";
import { stepFighter } from "./fighter";
import { roster } from "./fighters/index";
import { resolveHits } from "./hits";
import { EMPTY_INPUT, cloneInput, type InputFrame } from "./input";
import { stepPhysics, stepProjectiles, updatePlatforms } from "./physics";
import { stepRules } from "./rules";
import { stages } from "./stages/index";
import type { Fighter, FighterId, Glimpse, Rules, Stage, StageId, State } from "./types";

export interface MatchConfig {
  stage: StageId;
  players: { fighter: FighterId; team?: number; cpu?: number }[];
  rules?: Partial<Rules>;
  seed: number;
}

export const DEFAULT_RULES: Rules = { stocks: 3, time: 0, teams: false, damageRatio: 1 };

export function stageOf(state: State): Stage {
  return stages[state.stage];
}

export function createFighter(slot: number, id: FighterId, stage: Stage, rules: Rules, team: number, cpu: number): Fighter {
  const def = roster[id];
  if (!def) throw new Error(`unknown fighter ${id}`);
  const sp = stage.spawns[slot % stage.spawns.length];
  return {
    slot, id, team,
    x: sp.x, y: sp.y, vx: 0, vy: 0, facing: sp.facing,
    grounded: false, platform: -1,
    action: "air", frame: 0, move: null, moveInstance: 0, moveFacing: sp.facing,
    percent: 0, stocks: rules.stocks,
    jumpsLeft: def.stats.jumps - 1, fastFalling: false, airDodged: false, usedUpSpecial: false,
    hitlag: 0, hitstun: 0, pending: null,
    shield: C.SHIELD_MAX, shieldHeld: false,
    invuln: 0, ledge: -1, ledgeCooldown: 0, ledgeTime: 0,
    hitLog: {}, hitsThisMove: 0,
    grabbing: -1, grabbedBy: -1, grabTimer: 0, mash: 0,
    respawnTimer: 0, lastShot: -999, charge: 0, chargeMax: C.SMASH_CHARGE_MAX,
    wallJumped: false, techWindow: 0, lastHitBy: -1, lastHitFrame: -1000,
    special: def.special(), cpu, kos: 0, falls: 0, dealt: 0,
    idleFrames: 0, lastDamage: 0, tauntCooldown: 0, landed: false,
    buf: 0, bufAge: 0, flickX: 0, flickY: 0, flickT: 0,
    shieldFrames: 0, chargeMul: 1, counterDmg: 0, dropTimer: 0,
    cpuSeed: (slot + 1) * 2654435761 >>> 0,
  };
}

export function createMatch(cfg: MatchConfig): State {
  const stage = stages[cfg.stage];
  if (!stage) throw new Error(`unknown stage ${cfg.stage}`);
  const rules: Rules = { ...DEFAULT_RULES, ...cfg.rules };
  const state: State = {
    frame: 0, rng: (cfg.seed >>> 0) || 1, seed: cfg.seed, rules, stage: cfg.stage,
    fighters: cfg.players.map((p, i) => createFighter(i, p.fighter, stage, rules, p.team ?? i, p.cpu ?? 0)),
    projectiles: [], nextProjectile: 1, events: [], timer: rules.time,
    ended: false, winner: -1, suddenDeath: false, slowmo: 0, paused: false,
    platOffsets: stage.platforms.map(() => ({ dx: 0, dy: 0 })),
    inputs: cfg.players.map(() => cloneInput(EMPTY_INPUT)),
    seen: [],
  };
  // start on the ground where possible
  for (const f of state.fighters) {
    f.grounded = true;
    f.platform = 0;
    f.y = stage.platforms[0].y;
    f.action = "idle";
  }
  return state;
}

/** Advance one frame. `inputs` is one InputFrame per fighter slot. Mutates and returns state. */
export function step(state: State, inputs: InputFrame[]): State {
  const stage = stageOf(state);
  state.frame++;
  if (state.slowmo > 0) state.slowmo--;
  updatePlatforms(state, stage);
  for (const f of state.fighters) {
    const inp = inputs[f.slot] ?? EMPTY_INPUT;
    stepFighter(state, f, inp, state.inputs[f.slot], stage);
  }
  for (const f of state.fighters) stepPhysics(state, f, inputs[f.slot] ?? EMPTY_INPUT, stage);
  stepProjectiles(state, stage);
  resolveHits(state);
  stepRules(state, stage);
  for (let i = 0; i < state.inputs.length; i++) state.inputs[i] = cloneInput(inputs[i] ?? EMPTY_INPUT);
  state.seen.unshift(state.fighters.map(glimpse));
  if (state.seen.length > SEEN_FRAMES) state.seen.pop();
  return state;
}

/** Longest a CPU can lag behind what's happening. */
export const SEEN_FRAMES = 32;

function glimpse(f: Fighter): Glimpse {
  return {
    x: f.x, y: f.y, vx: f.vx, vy: f.vy, facing: f.facing, grounded: f.grounded, action: f.action, frame: f.frame,
    move: f.move, moveFacing: f.moveFacing, percent: f.percent, shieldHeld: f.shieldHeld, ledge: f.ledge, invuln: f.invuln, hitstun: f.hitstun,
  };
}

function cloneRecord(r: Record<string, number>): Record<string, number> {
  const o: Record<string, number> = {};
  for (const k in r) o[k] = r[k];
  return o;
}

export function cloneState(s: State): State {
  return {
    ...s,
    rules: { ...s.rules },
    fighters: s.fighters.map((f) => ({ ...f, pending: f.pending ? { ...f.pending } : null, hitLog: cloneRecord(f.hitLog), special: cloneRecord(f.special) })),
    projectiles: s.projectiles.map((p) => ({ ...p, hb: { ...p.hb }, hitLog: cloneRecord(p.hitLog), data: cloneRecord(p.data) })),
    events: [], // events are per-frame output, never carried in a snapshot
    platOffsets: s.platOffsets.map((o) => ({ ...o })),
    inputs: s.inputs.map(cloneInput),
    seen: [...s.seen],
  };
}

export function hashState(s: State): number {
  const nums: number[] = [s.frame, s.rng, s.timer, s.ended ? 1 : 0, s.winner];
  for (const f of s.fighters) {
    nums.push(f.x, f.y, f.vx, f.vy, f.facing, f.grounded ? 1 : 0, f.frame, f.percent, f.stocks, f.hitlag, f.hitstun, f.shield, f.invuln, f.jumpsLeft, f.ledge, f.charge, f.grabbing, f.grabbedBy);
    let a = 0; for (let i = 0; i < f.action.length; i++) a = (a * 31 + f.action.charCodeAt(i)) | 0;
    nums.push(a);
    for (const k in f.special) nums.push(f.special[k]);
  }
  for (const p of s.projectiles) nums.push(p.x, p.y, p.vx, p.vy, p.age, p.owner);
  return hashNumbers(nums);
}
