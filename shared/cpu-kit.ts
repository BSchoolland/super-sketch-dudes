// What every CPU sees and presses: the fight read off the state, reach and threats, and the inputs that start each kind of move.
import { C } from "./config";
import { cosDeg, sign, sinDeg } from "./fixed";
import { defOf } from "./fighter";
import { knockback } from "./hits";
import { B, type InputFrame } from "./input";
import { SPECIALS, hitAt, profileOf, type MoveInfo, type Profile, type SpecialId } from "./cpu-profile";
import { at, type Skill } from "./cpu-skill";
import { stageOf } from "./sim";
import { canCross, legs, route, surfaces, surfaceUnder, type Surface } from "./nav";
import type { Fighter, Hitbox, Move, Projectile, Stage, State } from "./types";

export const profile = (f: Fighter): Profile => profileOf(defOf(f));
export const reachOf = (f: Fighter): Record<string, MoveInfo> => profile(f).reach;

/** A move it has started over and over, nothing else in between, for this long is off the table until it starts another. */
export const SPAM_FRAMES = 12 * C.FPS;

export function spammed(f: Fighter, id: string): boolean {
  return f.streakMove === id && f.streakLast - f.streakFrom >= SPAM_FRAMES;
}

/** A ground attack pressed while dashing or running comes out as the dash attack (up: the up smash). */
export function runningInto(f: Fighter, move: string): string {
  return (f.action === "dash" || f.action === "run") && move !== "usmash" ? "dashAttack" : move;
}

export function blank(): InputFrame {
  return { x: 0, y: 0, cx: 0, cy: 0, b: 0 };
}

export function hash(state: State, f: Fighter, salt: number, period = 1): number {
  const tick = Math.floor(state.frame / period);
  let h = state.seed ^ Math.imul(tick + 1, 374761393) ^ Math.imul(f.slot + 1, 668265263) ^ Math.imul(f.moveInstance + 1, 2246822519) ^ salt;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}

export function pulse(state: State, slot: number, bit: number): number {
  return state.inputs[slot].b & bit ? 0 : bit;
}

export function targetOf(state: State, f: Fighter): Fighter | null {
  let target: Fighter | null = null;
  let best = Infinity;
  for (const other of state.fighters) {
    if (other.slot === f.slot || other.stocks <= 0 || other.action === "dead" || other.action === "respawn") continue;
    if (state.rules.teams && other.team === f.team) continue;
    const dx = other.x - f.x, dy = other.y - f.y;
    const score = dx * dx + dy * dy * 0.45;
    if (score < best) { best = score; target = other; }
  }
  return target;
}

/**
 * The solid block a fighter at (x, y) belongs to: the highest one under it, or else the nearest one sideways (over a
 * gap between islands). On a stage with one solid block, that block.
 */
export function mainBounds(state: State, stage: Stage, x: number, y: number): { x1: number; x2: number; y: number; bottom: number } {
  let under = -1, near = -1, underY = Infinity, nearD = Infinity;
  for (let i = 0; i < stage.platforms.length; i++) {
    const p = stage.platforms[i];
    if (!p.solid) continue;
    const o = state.platOffsets[i];
    const x1 = p.x1 + (o?.dx ?? 0), x2 = p.x2 + (o?.dx ?? 0), top = p.y + (o?.dy ?? 0);
    if (x >= x1 && x <= x2 && top >= y - 35 && top < underY) { under = i; underY = top; }
    const d = Math.max(x1 - x, x - x2, 0);
    if (d < nearD) { near = i; nearD = d; }
  }
  const i = under >= 0 ? under : Math.max(0, near);
  const p = stage.platforms[i], o = state.platOffsets[i];
  return { x1: p.x1 + (o?.dx ?? 0), x2: p.x2 + (o?.dx ?? 0), y: p.y + (o?.dy ?? 0), bottom: p.bottom! + (o?.dy ?? 0) };
}

export function nearEdge(state: State, f: Fighter, stage: Stage, margin: number): boolean {
  const main = mainBounds(state, stage, f.x, f.y);
  return f.x < main.x1 + margin || f.x > main.x2 - margin;
}

/** In the air and not over solid ground or a platform to land on (a ferry, a lift): time to recover. */
export function offStage(state: State, f: Fighter, stage: Stage): boolean {
  const main = mainBounds(state, stage, f.x, f.y);
  if (f.grounded || !(f.x < main.x1 - 8 || f.x > main.x2 + 8 || f.y > main.y + 35)) return false;
  return !surfaceUnder(surfaces(state, stage), f.x, f.y);
}

/** `slack` is how much farther than the truth the attacker believes the move reaches. */
export function moveCanReach(attacker: Fighter, victim: Fighter, moveId: string, facing: 1 | -1, slack = 0): boolean {
  const info = reachOf(attacker)[moveId];
  if (!info || info.first === 999 || spammed(attacker, moveId)) return false;
  const vdef = defOf(victim);
  const localX = (victim.x - attacker.x) * facing;
  const hurtLeft = localX - vdef.stats.width * 0.5;
  const hurtRight = localX + vdef.stats.width * 0.5;
  const relY = victim.y - attacker.y;
  const hurtTop = relY - vdef.stats.height;
  const hurtBottom = relY;
  return info.maxX + slack >= hurtLeft && info.minX <= hurtRight && info.maxY >= hurtTop && info.minY <= hurtBottom;
}

export function moveNearReach(attacker: Fighter, victim: Fighter, moveId: string, facing: 1 | -1, extra: number): boolean {
  const info = reachOf(attacker)[moveId];
  if (!info || info.first === 999) return false;
  const vdef = defOf(victim);
  const localX = (victim.x - attacker.x) * facing;
  const relY = victim.y - attacker.y;
  return info.maxX + extra >= localX - vdef.stats.width * 0.5 &&
    info.minX - extra <= localX + vdef.stats.width * 0.5 &&
    info.maxY + extra >= relY - vdef.stats.height && info.minY - extra <= relY;
}

/** `attacker` is as the CPU perceives it, so the attack is already `sk.delay` frames further along than it looks. */
export function attackThreatens(attacker: Fighter, victim: Fighter, sk: Skill): boolean {
  if (attacker.action !== "attack" || !attacker.move) return false;
  const info = reachOf(attacker)[attacker.move];
  if (!info || attacker.frame > info.last + 1) return false;
  const startupLead = sk.c >= 0.8 ? 5 : sk.c >= 0.5 ? 3 : 1;
  if (attacker.frame + startupLead < info.first) return false;
  return moveNearReach(attacker, victim, attacker.move, attacker.moveFacing, at(sk, 21, 45));
}

/** The soonest shot the CPU has been around long enough to notice that will cross its body, and the frames until it does. */
export function incomingShot(state: State, f: Fighter, sk: Skill): { p: Projectile; t: number } | null {
  const def = defOf(f), stage = stageOf(state);
  const w = def.stats.width * 0.5, h = def.stats.height;
  const surfs = surfaces(state, stage);
  let best: { p: Projectile; t: number } | null = null;
  for (const p of state.projectiles) {
    if (p.dead || p.owner === f.slot || p.age < sk.delay) continue;
    if (state.rules.teams && state.fighters[p.owner].team === f.team) continue;
    // fly it forward with its own physics (gravity, bounces off platform tops); homing and hook-steered shots read as straight
    let x = p.x, y = p.y, vx = p.vx, vy = p.vy, bounces = p.data.bounces ?? 0;
    for (let t = 0; t <= 45; t++) {
      if (Math.abs(x - f.x) <= w + p.hb.r && y >= f.y - h - p.hb.r && y <= f.y + p.hb.r) { if (!best || t < best.t) best = { p, t }; break; }
      if (t > 0 && !p.data.g && Math.abs(vx) < 0.5 && Math.abs(vy) < 0.5) break; // a planted hazard is not incoming
      if (p.data.g) vy += p.data.g;
      const py = y;
      x += vx; y += vy;
      if (!p.data.bounce) continue;
      for (const sf of surfs) if (x >= sf.x1 && x <= sf.x2 && y >= sf.y && py < sf.y && vy > 0) {
        y = sf.y; vy = -vy * 0.55; vx *= 0.8;
        if (++bounces > p.data.bounce) t = 99;
      }
    }
  }
  return best;
}

/** A shot it has seen coming, if it reads it right: turned back with a counter or reflector, jumped, air dodged or shielded. */
export function shotAnswer(state: State, f: Fighter, sk: Skill): InputFrame | null {
  const shot = incomingShot(state, f, sk);
  if (!shot || hash(state, f, 0x5407 + shot.p.id * 0x9e37, 1 << 20) % 100 >= at(sk, 10, 95)) return null;
  const { p, t } = shot;
  const toward = sign(p.x - f.x) as 1 | -1;
  const moves = defOf(f).moves;
  for (const s of NEUTRAL_SPECIALS) {
    const mv = moves[s];
    if (spammed(f, s)) continue;
    const opens = mv.counter ? mv.counter.frames[0] : mv.reflect ? reachOf(f)[s].first : -1;
    if (opens >= 0 && t >= opens && t <= opens + 4 && (mv.counter || s === "sspecial" || f.facing === toward)) return startSpecial(state, f, s, toward);
  }
  const out = blank();
  const low = p.y > f.y - defOf(f).stats.height * 0.6;
  if (f.grounded) {
    if (t <= 9) {
      if (f.shield <= 15) return null;
      out.b = B.SHIELD;
      return out;
    }
    if (t <= 20 && low) { out.x = toward * 60; out.b = pulse(state, f.slot, B.JUMP); return out; }
    return null;
  }
  if (t <= 16 && t > 6 && low && f.jumpsLeft > 0) { out.x = toward * 60; out.b = pulse(state, f.slot, B.JUMP); return out; }
  if (t <= 6 && !f.airDodged) { out.b = pulse(state, f.slot, B.SHIELD); return out; }
  return null;
}

export const SMASHES = ["usmash", "fsmash", "dsmash"] as const;

export function startSmash(state: State, f: Fighter, move: "fsmash" | "usmash" | "dsmash", facing: 1 | -1): InputFrame {
  const out = blank();
  if (spammed(f, runningInto(f, move)) || state.inputs[f.slot].cx || state.inputs[f.slot].cy) return out;
  if (move === "usmash") out.cy = -100;
  else if (move === "dsmash") out.cy = 100;
  else out.cx = facing * 100;
  return out;
}

export function startTilt(state: State, f: Fighter, move: "jab1" | "ftilt" | "utilt" | "dtilt", facing: 1 | -1): InputFrame {
  const out = blank();
  if (spammed(f, runningInto(f, move))) return out;
  if (move === "ftilt") out.x = facing * 45;
  else if (move === "utilt") out.y = -45;
  else if (move === "dtilt") out.y = 45;
  out.b = pulse(state, f.slot, B.ATTACK);
  return out;
}

export function startAerial(state: State, f: Fighter, move: "nair" | "fair" | "bair" | "uair" | "dair"): InputFrame {
  const out = blank();
  if (spammed(f, move) || state.inputs[f.slot].cx || state.inputs[f.slot].cy) return out;
  if (move === "fair") out.cx = f.facing * 100;
  else if (move === "bair") out.cx = -f.facing * 100;
  else if (move === "uair") out.cy = -100;
  else if (move === "dair") out.cy = 100;
  else out.b = pulse(state, f.slot, B.ATTACK);
  return out;
}

export function startSpecial(state: State, f: Fighter, move: SpecialId, facing: 1 | -1): InputFrame {
  const out = blank();
  if (spammed(f, move)) return out;
  if (move === "sspecial") out.x = facing * 100;
  else if (move === "uspecial") out.y = -100;
  else if (move === "dspecial") out.y = 100;
  out.b = pulse(state, f.slot, B.SPECIAL);
  return out;
}

export function strongestHitbox(move: Move): Hitbox | null {
  let best: Hitbox | null = null;
  for (const hb of move.hitboxes) if (!hb.grab && (!best || hb.damage > best.damage)) best = hb;
  return best;
}

/** Whether `hb` landing on the target from here would send it past a blast line; `smash` allows for a little charge, `margin` is how much of the way there counts. */
export function likelyKills(state: State, f: Fighter, target: Fighter, hb: Hitbox, smash: boolean, facing: 1 | -1, margin = 0.82): boolean {
  const damage = hb.damage * (smash ? 1.18 : 1);
  const kb = knockback(target.percent + damage, damage, defOf(target).stats.weight, hb.growth, hb.base);
  const speed = kb * C.KB_TO_VEL;
  const travel = speed * speed / (2 * C.LAUNCH_DECAY);
  const stage = stageOf(state);
  const angleX = Math.abs(cosDeg(hb.angle));
  const angleY = Math.max(0, sinDeg(hb.angle));
  const outward = sign(target.x - f.x) === facing;
  const horizontalDistance = facing > 0 ? stage.blast.right - target.x : target.x - stage.blast.left;
  const verticalDistance = target.y - defOf(target).stats.height - stage.blast.top;
  return (outward && angleX > 0.25 && travel * angleX > horizontalDistance * margin) ||
    (angleY > 0.45 && travel * angleY > verticalDistance * margin);
}

/** The smash that would finish the target from here: its own hit if that reaches, or the shot it throws if that flies into the target. */
export function killMove(state: State, f: Fighter, target: Fighter, facing: 1 | -1, sk: Skill): "fsmash" | "usmash" | "dsmash" | null {
  const moves = defOf(f).moves, p = profile(f);
  for (const m of SMASHES) {
    const hb = strongestHitbox(moves[m]);
    if (hb && moveCanReach(f, target, m, facing, sk.slack) && likelyKills(state, f, target, hb, true, facing)) return m;
    const shot = wouldHit(state, f, target, p, m, facing);
    if (shot?.hit && likelyKills(state, f, target, shot.hit, false, facing)) return m;
  }
  return null;
}

export const NEUTRAL_SPECIALS = ["nspecial", "sspecial", "dspecial"] as const;

/** True if the fighter would still be over the main stage after moving `dx` along its facing. */
export function landsOnStage(state: State, f: Fighter, stage: Stage, dx: number): boolean {
  const main = mainBounds(state, stage, f.x, f.y), x = f.x + f.facing * dx;
  return x > main.x1 + 50 && x < main.x2 - 50;
}

/** Whether `f` has a shot out that has been out for at least `age` frames. */
export function ownsProjectile(state: State, f: Fighter, age = 0): boolean {
  for (const p of state.projectiles) if (p.owner === f.slot && !p.dead && p.age >= age) return true;
  return false;
}

/** Whether `f` fired something within the last `frames` frames. */
export function justFired(state: State, f: Fighter, frames: number): boolean {
  return state.frame - f.lastShot < frames;
}

/** What `move` started now would do to the target, by the study (see hitAt), holding special no longer than `maxHold`. */
export function shotAt(p: Profile, move: string, f: Fighter, target: Fighter, facing: 1 | -1, maxHold = Infinity): { hold: number } | null {
  return hitAt(p, move, !f.grounded, (target.x - f.x) * facing, target.y - f.y, maxHold);
}

/** Farthest ahead any of the fighter's specials can put a shot from the ground. */
export function shotReach(p: Profile): number {
  let far = 0;
  for (const s of SPECIALS) for (const path of p.shots[s] ?? []) if (!path.air) for (const q of path.pts) far = Math.max(far, q.x + q.r);
  return far;
}

/**
 * Whether `move` (a special, or a normal that fires something) started now would hit the target where it
 * stands, and the hold it takes and its hardest shot, if it fires one; null if not, or not yet: it is
 * still cooling down, or a shot of its own is already out.
 */
export function wouldHit(state: State, f: Fighter, target: Fighter, p: Profile, move: string, facing: 1 | -1): { hold: number; hit: Hitbox | null } | null {
  if (spammed(f, move)) return null;
  const spot = shotAt(p, move, f, target, facing);
  if (!spot) return null;
  const paths = p.shots[move] ?? [];
  const path = paths.find((q) => q.air === !f.grounded && q.hold === spot.hold) ?? paths[0];
  // a shot: not before the move can actually fire again (a whiffed special is a gift); and one at a time,
  // unless this fighter lives by its shots and the last one is already on its way
  if (paths.length) {
    const cooldown = p.specials[move as SpecialId]?.cooldown ?? 30;
    if (justFired(state, f, Math.min(150, cooldown * 0.85))) return null;
    if (ownsProjectile(state, f) && !(p.zoning >= 0.5 && !justFired(state, f, 18))) return null;
  }
  return { hold: spot.hold, hit: path?.hit ?? null };
}

/** The route from where a fighter stands (or would land) to where the target stands; null when they share a surface or none exists. */
export function routeTo(state: State, f: Fighter, target: Fighter, stage: Stage): { me: Surface; next: Surface; goal: Surface } | null {
  const surfs = surfaces(state, stage);
  const me = f.grounded && f.platform >= 0 ? surfs[f.platform] : surfaceUnder(surfs, f.x, f.y);
  const goal = target.grounded && target.platform >= 0 ? surfs[target.platform] : surfaceUnder(surfs, target.x, target.y);
  if (!me || !goal || me.i === goal.i) return null;
  const path = route(surfs, me, goal, legs(f, stage));
  if (!path || path.length < 2) return null;
  return { me, next: path[1], goal };
}

/** Where on `me` to leave from for `next`, and which way to go from there: 0 is straight up, or straight down through a soft platform. */
export function launchPoint(me: Surface, next: Surface, towardX: number, soft: boolean): { lx: number; dir: -1 | 0 | 1 } {
  if (next.x1 > me.x2 - 10) return { lx: me.x2 - 14, dir: 1 };
  if (next.x2 < me.x1 + 10) return { lx: me.x1 + 14, dir: -1 };
  // down off a solid block: the edge nearer the target
  if (next.y > me.y + 8 && !soft) return towardX < (me.x1 + me.x2) / 2 ? { lx: me.x1 + 14, dir: -1 } : { lx: me.x2 - 14, dir: 1 };
  const lo = Math.max(me.x1, next.x1) + 14, hi = Math.min(me.x2, next.x2) - 14;
  return { lx: Math.max(lo, Math.min(hi, towardX)), dir: 0 };
}

/** Grounded and the target is on another surface: walk to the launch point and hop, drop off the edge, or wait for a moving platform. */
export function navInput(state: State, f: Fighter, target: Fighter, stage: Stage): InputFrame | null {
  const r = routeTo(state, f, target, stage);
  if (!r) return null;
  const { me, next } = r;
  const soft = !stage.platforms[me.i].solid;
  const { lx, dir } = launchPoint(me, next, target.x, soft);
  const out = blank();
  const dx = lx - f.x;
  if (Math.abs(dx) > 16) { out.x = sign(dx) * (Math.abs(dx) > 120 ? 100 : 55); return out; }
  if (!canCross(me, next, legs(f, stage), true)) return out;
  if (next.y < me.y - 8) {
    // up: a full hop, held toward the far side
    out.b = B.JUMP;
    out.x = dir * 100;
  } else if (dir) {
    out.x = dir * 100;
  } else if (f.action !== "crouch" || f.frame <= C.FLICK_WINDOW) {
    // dropping through takes a fresh flick down, so a crouch held too long lets go for a frame
    out.y = 100;
  }
  return out;
}

/** The target as the CPU sees it: what it was doing `sk.delay` frames ago, and where it has probably drifted since. */
export function perceived(state: State, target: Fighter, sk: Skill): Fighter {
  const ago = Math.min(sk.delay, state.seen.length - 1);
  const past = state.seen[ago]?.[target.slot];
  if (!past) return target;
  const lead = ago * sk.predict;
  return { ...target, ...past, x: past.x + past.vx * lead, y: past.grounded ? past.y : past.y + past.vy * lead };
}
