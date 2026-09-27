import { C } from "./config";
import { cosDeg, sign, sinDeg } from "./fixed";
import { currentMove, defOf, isActionable } from "./fighter";
import { knockback } from "./hits";
import { B, type InputFrame } from "./input";
import { EMPTY_MOVE, SPECIALS, profileOf, type MoveInfo, type Profile, type SpecialId } from "./cpu-profile";
import { at, skillOf, type Skill } from "./cpu-skill";
import { stageOf } from "./sim";
import { canCross, legs, route, surfaces, surfaceUnder, type Surface } from "./nav";
import type { Fighter, Hitbox, Move, Projectile, Stage, State } from "./types";


const profile = (f: Fighter): Profile => profileOf(defOf(f));
const reachOf = (f: Fighter): Record<string, MoveInfo> => profile(f).reach;

function blank(): InputFrame {
  return { x: 0, y: 0, cx: 0, cy: 0, b: 0 };
}

function hash(state: State, f: Fighter, salt: number, period = 1): number {
  const tick = Math.floor(state.frame / period);
  let h = state.seed ^ Math.imul(tick + 1, 374761393) ^ Math.imul(f.slot + 1, 668265263) ^ Math.imul(f.moveInstance + 1, 2246822519) ^ salt;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}

function pulse(state: State, slot: number, bit: number): number {
  return state.inputs[slot].b & bit ? 0 : bit;
}

function targetOf(state: State, f: Fighter): Fighter | null {
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

function mainBounds(state: State, stage: Stage): { x1: number; x2: number; y: number } {
  const p = stage.platforms[0];
  const o = state.platOffsets[0];
  return { x1: p.x1 + (o?.dx ?? 0), x2: p.x2 + (o?.dx ?? 0), y: p.y + (o?.dy ?? 0) };
}

function offStage(state: State, f: Fighter, stage: Stage): boolean {
  const main = mainBounds(state, stage);
  return !f.grounded && (f.x < main.x1 - 8 || f.x > main.x2 + 8 || f.y > main.y + 35);
}

/** `slack` is how much farther than the truth the attacker believes the move reaches. */
function moveCanReach(attacker: Fighter, victim: Fighter, moveId: string, facing: 1 | -1, slack = 0): boolean {
  const info = reachOf(attacker)[moveId];
  if (!info || info.first === 999) return false;
  const vdef = defOf(victim);
  const localX = (victim.x - attacker.x) * facing;
  const hurtLeft = localX - vdef.stats.width * 0.5;
  const hurtRight = localX + vdef.stats.width * 0.5;
  const relY = victim.y - attacker.y;
  const hurtTop = relY - vdef.stats.height;
  const hurtBottom = relY;
  return info.maxX + slack >= hurtLeft && info.minX <= hurtRight && info.maxY >= hurtTop && info.minY <= hurtBottom;
}

function moveNearReach(attacker: Fighter, victim: Fighter, moveId: string, facing: 1 | -1, extra: number): boolean {
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
function attackThreatens(attacker: Fighter, victim: Fighter, sk: Skill): boolean {
  if (attacker.action !== "attack" || !attacker.move) return false;
  const info = reachOf(attacker)[attacker.move];
  if (!info || attacker.frame > info.last + 1) return false;
  const startupLead = sk.c >= 0.8 ? 5 : sk.c >= 0.5 ? 3 : 1;
  if (attacker.frame + startupLead < info.first) return false;
  return moveNearReach(attacker, victim, attacker.move, attacker.moveFacing, at(sk, 21, 45));
}

/** The soonest shot the CPU has been around long enough to notice that will cross its body, and the frames until it does. */
function incomingShot(state: State, f: Fighter, sk: Skill): { p: Projectile; t: number } | null {
  const def = defOf(f);
  let best: { p: Projectile; t: number } | null = null;
  for (const p of state.projectiles) {
    if (p.dead || p.owner === f.slot || p.age < sk.delay) continue;
    if (state.rules.teams && state.fighters[p.owner].team === f.team) continue;
    const dx = f.x - p.x;
    const gap = Math.max(0, Math.abs(dx) - def.stats.width * 0.5 - p.hb.r);
    if (gap > 0 && (p.vx * dx <= 0 || Math.abs(p.vx) < 0.5)) continue;
    const t = gap > 0 ? gap / Math.abs(p.vx) : 0;
    if (t > 45) continue;
    const y = p.y + p.vy * t;
    if (y < f.y - def.stats.height - p.hb.r || y > f.y + p.hb.r) continue;
    if (!best || t < best.t) best = { p, t };
  }
  return best;
}

/** A shot it has seen coming, if it reads it right: turned back with a counter or reflector, jumped, air dodged or shielded. */
function shotAnswer(state: State, f: Fighter, sk: Skill): InputFrame | null {
  const shot = incomingShot(state, f, sk);
  if (!shot || hash(state, f, 0x5407 + shot.p.id * 0x9e37, 1 << 20) % 100 >= at(sk, 10, 95)) return null;
  const { p, t } = shot;
  const toward = sign(p.x - f.x) as 1 | -1;
  const moves = defOf(f).moves;
  for (const s of NEUTRAL_SPECIALS) {
    const mv = moves[s];
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

function impendingCollision(state: State, f: Fighter, stage: Stage): boolean {
  if (f.vy > 0.5) {
    for (let i = 0; i < stage.platforms.length; i++) {
      const p = stage.platforms[i], o = state.platOffsets[i];
      const x1 = p.x1 + (o?.dx ?? 0), x2 = p.x2 + (o?.dx ?? 0), y = p.y + (o?.dy ?? 0);
      if (f.x >= x1 && f.x <= x2 && f.y <= y && y - f.y <= f.vy * 18 + 18) return true;
    }
  }
  const main = mainBounds(state, stage);
  const halfW = defOf(f).stats.width * 0.5;
  const insideWallY = f.y > main.y && f.y - defOf(f).stats.height < stage.platforms[0].bottom!;
  if (insideWallY && ((f.vx > 0 && f.x < main.x1 - halfW && main.x1 - halfW - f.x < f.vx * 18 + 12) ||
    (f.vx < 0 && f.x > main.x2 + halfW && f.x - main.x2 - halfW < -f.vx * 18 + 12))) return true;
  return false;
}

function disadvantageInput(state: State, f: Fighter, target: Fighter | null, sk: Skill, stage: Stage): InputFrame {
  const out = blank();
  if (f.hitlag > 0 && f.pending) {
    const attacker = state.fighters[f.pending.attacker] ?? target;
    const main = mainBounds(state, stage);
    const nearEdge = profile(f).cautious && (f.x < main.x1 + 170 || f.x > main.x2 - 170);
    out.x = nearEdge ? sign((main.x1 + main.x2) * 0.5 - f.x) * 90 : attacker ? sign(f.x - attacker.x) * 85 : sign(-f.pending.vx) * 85;
    out.y = -100;
    if (hash(state, f, 0xd1d1, 30) % 100 >= at(sk, 25, 100)) { out.x = 0; out.y = 0; }
    return out;
  }
  if (f.action === "grabbed" || f.action === "thrown") {
    const phase = (state.frame + f.slot) & 3;
    out.x = phase < 2 ? 100 : -100;
    out.y = phase & 1 ? -100 : 100;
    out.b = phase === 0 ? pulse(state, f.slot, B.ATTACK) : phase === 2 ? pulse(state, f.slot, B.SPECIAL) : 0;
    return out;
  }
  if (f.action === "tumble" || f.action === "hitstun") {
    const attacker = f.lastHitBy >= 0 ? state.fighters[f.lastHitBy] : target;
    const main = mainBounds(state, stage);
    const nearEdge = profile(f).cautious && (f.x < main.x1 + 140 || f.x > main.x2 - 140);
    out.x = nearEdge ? sign((main.x1 + main.x2) * 0.5 - f.x) * 90 : attacker ? sign(f.x - attacker.x) * 80 : sign(-f.vx) * 80;
    out.y = -70;
    if (hash(state, f, 0xd1d1, 30) % 100 >= at(sk, 25, 100)) { out.x = 0; out.y = 0; }
    if (sk.c >= 0.3 && f.action === "tumble" && impendingCollision(state, f, stage)) {
      if (hash(state, f, 0x51ed, 7) % 100 < at(sk, 30, 95)) out.b = pulse(state, f.slot, B.SHIELD);
    }
    if (f.action === "tumble" && f.frame >= f.hitstun && sk.c >= 0.55 && !f.airDodged && hash(state, f, 0xada, 45) % 100 < at(sk, 5, 45)) {
      out.b = pulse(state, f.slot, B.SHIELD);
      out.x = -sign(f.vx) * 70;
    }
    return out;
  }
  return out;
}

function ledgeInput(state: State, f: Fighter, target: Fighter | null, sk: Skill, stage: Stage): InputFrame {
  const out = blank();
  if (f.action === "ledgeGrab") return out;
  const wait = sk.c >= 0.8 ? 8 + hash(state, f, 0x1ed9, 60) % 16 : 18 + hash(state, f, 0x1ed9, 90) % 35;
  if (f.ledgeTime < wait) return out;
  const ledge = stage.ledges[f.ledge];
  const close = target && Math.abs(target.x - f.x) < 145;
  const option = hash(state, f, 0x1ed6, 90) % 100;
  if (close && option < at(sk, 31, 55)) out.b = pulse(state, f.slot, B.ATTACK);
  else if (option < 45) out.b = pulse(state, f.slot, B.SHIELD);
  else if (option < 70) out.b = pulse(state, f.slot, B.JUMP);
  else if (option < 92) out.x = -ledge.side * 55;
  else out.y = 100;
  return out;
}

function recoveryInput(state: State, f: Fighter, sk: Skill, stage: Stage): InputFrame {
  const out = blank();
  const def = defOf(f), main = mainBounds(state, stage);
  const side: 1 | -1 = f.x < (main.x1 + main.x2) * 0.5 ? -1 : 1;
  const ledge = side < 0 ? stage.ledges[0] : stage.ledges[stage.ledges.length - 1];
  const ledgeX = ledge.x + (state.platOffsets[ledge.platform]?.dx ?? 0);
  const ledgeY = ledge.y + (state.platOffsets[ledge.platform]?.dy ?? 0);
  const above = f.y < ledgeY - 35;
  const targetX = above ? ledgeX - side * 45 : ledgeX + side * (def.stats.width * 0.5 + 10);
  const dx = targetX - f.x;
  const toward = sign(dx) as 1 | -1 | 0;
  out.x = toward * (Math.abs(dx) > 45 ? 100 : 55);

  const p = profile(f);
  if (f.action === "attack") {
    // a sustained special that carries the fighter (a flight, a jet) keeps going while special is held
    const probe = p.specials[f.move as SpecialId];
    const carries = probe?.held && (f.move === "uspecial" || probe.airDx > 0);
    const home = f.y < ledgeY - 150 && (side < 0 ? f.x > main.x1 + 30 : f.x < main.x2 - 30);
    if (carries && !home) {
      out.b = B.SPECIAL;
      if (f.move === "uspecial") out.y = -100;
    }
    return out;
  }
  if (f.action === "helpless") return out;
  if (f.action === "tumble" && f.frame < f.hitstun) return out;

  if (!f.airDodged && (f.usedUpSpecial || f.jumpsLeft === 0)) {
    const pursuer = targetOf(state, f);
    const pursued = pursuer && Math.abs(pursuer.x - f.x) < 270 && Math.abs(pursuer.y - f.y) < 220;
    if ((pursued || (incomingShot(state, f, sk)?.t ?? 99) < 30 || f.y > ledgeY + 280) && hash(state, f, 0xa1d0, 24) % 100 < at(sk, 44, 92)) {
      out.x = toward * 100;
      out.y = f.y > ledgeY + 80 ? -55 : 0;
      out.b = pulse(state, f.slot, B.SHIELD);
      if (out.b) return out;
    }
  }

  const wallDistance = side < 0 ? main.x1 - f.x : f.x - main.x2;
  if (def.stats.wallJump && wallDistance >= -4 && wallDistance < def.stats.width * 0.8 && f.y > ledgeY + 25 && !f.wallJumped) {
    out.x = side * 100;
    return out;
  }

  const horizontalGap = Math.abs(f.x - ledgeX);
  const across = sidewaysRecovery(f, p);
  if (across && !f.usedUpSpecial && horizontalGap > 180 && f.y > ledgeY - 280 && f.y < ledgeY + 120 && (across === "sspecial" || f.facing === toward)) {
    const special = startSpecial(state, f, across, toward || f.facing);
    if (special.b) return special;
  }

  const falling = f.vy > 0.5;
  // a fighter whose air jump barely lifts it (or that falls fast) jumps as soon as it can
  const sinker = p.airJumpHeight < 120 || def.stats.fallSpeed >= 8.5;
  const jumpEarly = f.y > ledgeY - (sinker ? 230 : 110);
  if (f.jumpsLeft > 0 && (falling || jumpEarly) && (f.y > ledgeY - 260 || horizontalGap > 190)) {
    out.b = pulse(state, f.slot, B.JUMP);
    if (out.b) return out;
  }

  if (!f.usedUpSpecial) {
    const useUp = f.y > ledgeY + 30 || (falling && f.y > ledgeY - 95);
    if (useUp) {
      out.x = toward * 45;
      out.y = -100;
      out.b = pulse(state, f.slot, B.SPECIAL);
      return out;
    }
  }

  if (above && horizontalGap < 90 && f.vy > 0) out.x = -side * 55;
  return out;
}

/** The special (other than uspecial) that carries the fighter farthest sideways through the air, holding its height, without leaving it helpless. */
function sidewaysRecovery(f: Fighter, p: Profile): SpecialId | null {
  const moves = defOf(f).moves;
  let best: SpecialId | null = null, far = 120;
  for (const s of SPECIALS) {
    const probe = p.specials[s];
    if (s === "uspecial" || !probe || moves[s].helpless || probe.airDrop > probe.airDx * 0.5 || probe.airDx <= far) continue;
    best = s; far = probe.airDx;
  }
  return best;
}

const SMASHES = ["usmash", "fsmash", "dsmash"] as const;

function startSmash(state: State, f: Fighter, move: "fsmash" | "usmash" | "dsmash", facing: 1 | -1): InputFrame {
  const out = blank();
  if (state.inputs[f.slot].cx || state.inputs[f.slot].cy) return out;
  if (move === "usmash") out.cy = -100;
  else if (move === "dsmash") out.cy = 100;
  else out.cx = facing * 100;
  return out;
}

function startTilt(state: State, f: Fighter, move: "jab1" | "ftilt" | "utilt" | "dtilt", facing: 1 | -1): InputFrame {
  const out = blank();
  if (move === "ftilt") out.x = facing * 45;
  else if (move === "utilt") out.y = -45;
  else if (move === "dtilt") out.y = 45;
  out.b = pulse(state, f.slot, B.ATTACK);
  return out;
}

function startAerial(state: State, f: Fighter, move: "nair" | "fair" | "bair" | "uair" | "dair"): InputFrame {
  const out = blank();
  if (state.inputs[f.slot].cx || state.inputs[f.slot].cy) return out;
  if (move === "fair") out.cx = f.facing * 100;
  else if (move === "bair") out.cx = -f.facing * 100;
  else if (move === "uair") out.cy = -100;
  else if (move === "dair") out.cy = 100;
  else out.b = pulse(state, f.slot, B.ATTACK);
  return out;
}

function startSpecial(state: State, f: Fighter, move: SpecialId, facing: 1 | -1): InputFrame {
  const out = blank();
  if (move === "sspecial") out.x = facing * 100;
  else if (move === "uspecial") out.y = -100;
  else if (move === "dspecial") out.y = 100;
  out.b = pulse(state, f.slot, B.SPECIAL);
  return out;
}

function strongestHitbox(move: Move): Hitbox | null {
  let best: Hitbox | null = null;
  for (const hb of move.hitboxes) if (!hb.grab && (!best || hb.damage > best.damage)) best = hb;
  return best;
}

function likelyKills(state: State, f: Fighter, target: Fighter, moveId: string, facing: 1 | -1): boolean {
  const move = defOf(f).moves[moveId];
  if (!move) return false;
  const hb = strongestHitbox(move);
  if (!hb) return false;
  const damage = hb.damage * (move.smash ? 1.18 : 1);
  const kb = knockback(target.percent + damage, damage, defOf(target).stats.weight, hb.growth, hb.base);
  const speed = kb * C.KB_TO_VEL;
  const travel = speed * speed / (2 * C.LAUNCH_DECAY);
  const stage = stageOf(state);
  const angleX = Math.abs(cosDeg(hb.angle));
  const angleY = Math.max(0, sinDeg(hb.angle));
  const outward = sign(target.x - f.x) === facing;
  const horizontalDistance = facing > 0 ? stage.blast.right - target.x : target.x - stage.blast.left;
  const verticalDistance = target.y - defOf(target).stats.height - stage.blast.top;
  return (outward && angleX > 0.25 && travel * angleX > horizontalDistance * 0.82) ||
    (angleY > 0.45 && travel * angleY > verticalDistance * 0.82);
}

function killMove(state: State, f: Fighter, target: Fighter, facing: 1 | -1, sk: Skill): "fsmash" | "usmash" | "dsmash" | null {
  for (const m of SMASHES) if (moveCanReach(f, target, m, facing, sk.slack) && likelyKills(state, f, target, m, facing)) return m;
  return null;
}

function handleCommitted(state: State, f: Fighter, target: Fighter | null, sk: Skill, stage: Stage): InputFrame | null {
  if (f.action === "smashCharge") {
    const out = blank();
    const targetUnsafe = target && (target.action === "hitstun" || target.action === "tumble" || target.action === "knockdown" || target.action === "shieldBreak");
    const desired = targetUnsafe ? at(sk, 15, 39) : sk.c >= 0.8 ? 8 : 2;
    if (f.charge < desired && (!target || Math.abs(target.x - f.x) > 95 || targetUnsafe)) out.b = B.ATTACK;
    return out;
  }
  if (f.action === "shield") {
    const out = blank();
    const danger = (target && attackThreatens(target, f, sk)) || (incomingShot(state, f, sk)?.t ?? 99) < 14;
    if (danger && f.shield > 10) out.b = B.SHIELD;
    return out;
  }
  if (f.action === "grabHold") {
    const out = blank();
    if (!target) return out;
    if (f.frame <= 3) return out;
    const towardEdge: 1 | -1 = f.x < (stage.blast.left + stage.blast.right) * 0.5 ? -1 : 1;
    if (target.percent > 95) out.x = towardEdge === f.facing ? 100 * f.facing : -100 * f.facing;
    else if (target.percent < 45) out.y = target.y < f.y - 30 ? -100 : 100;
    else out.x = 100 * f.facing;
    out.b = pulse(state, f.slot, B.SPECIAL);
    return out;
  }
  if (f.action === "jumpSquat") {
    const out = blank();
    if (target) out.x = sign(target.x - f.x) * 80;
    return out;
  }
  if (f.action === "attack") {
    const out = blank();
    if (offStage(state, f, stage)) return recoveryInput(state, f, sk, stage);
    const move = currentMove(f);
    if (!move) return out;
    const probe = profile(f).specials[f.move as SpecialId];
    if (probe?.held) {
      if (f.move === "uspecial") { out.b = B.SPECIAL; out.y = -100; }
      else if (Math.abs(probe.groundDx) > 100) {
        // a flight: keep going while the target is still ahead
        if (target && sign(target.x - f.x) === f.moveFacing && Math.abs(target.x - f.x) > 40) out.b = B.SPECIAL;
      } else {
        // a charge: build it while it's safe, let go at a random moment
        const safe = target && (Math.abs(target.x - f.x) > 190 || target.action === "hitstun" || target.action === "tumble");
        if (safe && hash(state, f, 0xc4a6) % 100 >= Math.round(at(sk, 6, 3))) out.b = B.SPECIAL;
      }
      if (target && !f.grounded) out.x = sign(target.x - f.x) * 45;
      return out;
    }
    if (move.next && f.hitsThisMove > 0 && f.frame >= (move.nextFrom ?? 1)) out.b = pulse(state, f.slot, B.ATTACK);
    if (!f.grounded && target) out.x = sign(target.x - f.x) * 55;
    return out;
  }
  if (!isActionable(f)) return blank();
  return null;
}

const NEUTRAL_SPECIALS = ["nspecial", "sspecial", "dspecial"] as const;

/** True if the fighter would still be over the main stage after moving `dx` along its facing. */
function landsOnStage(state: State, f: Fighter, stage: Stage, dx: number): boolean {
  const main = mainBounds(state, stage), x = f.x + f.facing * dx;
  return x > main.x1 + 50 && x < main.x2 - 50;
}

/** Whether `f` has a shot out that has been out for at least `age` frames. */
function ownsProjectile(state: State, f: Fighter, age = 0): boolean {
  for (const p of state.projectiles) if (p.owner === f.slot && !p.dead && p.age >= age) return true;
  return false;
}

function specialChoice(state: State, f: Fighter, target: Fighter, sk: Skill, facing: 1 | -1, distance: number, stage: Stage): InputFrame | null {
  const p = profile(f), moves = defOf(f).moves;
  const dy = target.y - f.y;
  for (const [i, s] of NEUTRAL_SPECIALS.entries()) {
    const mv = moves[s], probe = p.specials[s];
    const aimed = s === "sspecial" || f.facing === facing;
    const roll = (salt: number, period: number) => hash(state, f, salt + i * 0x101, period) % 100;
    if (mv.counter) {
      if (attackThreatens(target, f, sk) && roll(0x71f0, 30) < at(sk, 13, 37)) return startSpecial(state, f, s, facing);
      continue;
    }
    if (mv.helpless) continue;
    if (moveCanReach(f, target, s, facing, sk.slack) && roll(0x5e11, 25) < at(sk, 13, 37)) return startSpecial(state, f, s, facing);
    if (!probe || !aimed || !landsOnStage(state, f, stage, probe.groundDx)) continue;
    if (probe.shotRange > 0 && distance > 140 && distance < probe.shotRange * 0.9 && Math.abs(dy) < 90 && !ownsProjectile(state, f) && roll(0x5106, 35) < at(sk, 18, 50)) return startSpecial(state, f, s, facing);
    if (probe.groundDx > 150 && mv.hitboxes.length && distance > 150 && distance < probe.groundDx * 0.9 && Math.abs(dy) < 60 && roll(0x7a6e, 40) < at(sk, 11, 35)) return startSpecial(state, f, s, facing);
    // a special that shows no hit, shot or movement (a stance, a transformation): now and then, from far away
    const inert = !mv.hitboxes.length && !probe.shotRange && Math.abs(probe.groundDx) < 40;
    if (inert && distance > 380 && roll(0x1a9e, 60) < at(sk, 3, 11)) return startSpecial(state, f, s, facing);
  }
  return null;
}

function edgeguardInput(state: State, f: Fighter, target: Fighter, sk: Skill, stage: Stage): InputFrame | null {
  if (sk.c < 0.5 || !offStage(state, target, stage) || !f.grounded) return null;
  const main = mainBounds(state, stage);
  const side: 1 | -1 = target.x < (main.x1 + main.x2) * 0.5 ? -1 : 1;
  const ledgeX = side < 0 ? main.x1 : main.x2;
  const trapX = ledgeX - side * (85 + defOf(f).stats.width * 0.25);
  const distanceToTrap = trapX - f.x;
  if (Math.abs(distanceToTrap) > 35) {
    const out = blank(); out.x = sign(distanceToTrap) * (Math.abs(distanceToTrap) > 120 ? 100 : 45); return out;
  }
  const targetDistance = Math.abs(target.x - f.x);
  if (target.ledge >= 0 && target.invuln < 8 && targetDistance < 180) {
    const facing = sign(target.x - f.x) as 1 | -1;
    const smash = killMove(state, f, target, facing, sk);
    if (smash) return startSmash(state, f, smash, facing);
    return startTilt(state, f, "ftilt", facing);
  }
  const stockLead = f.stocks > target.stocks;
  const edgeRange = stockLead ? 330 : 210;
  const edgeDepth = stockLead ? 210 : 100;
  const edgeChance = stockLead ? 72 : 35;
  if (!profile(f).cautious && sk.c >= 0.8 && targetDistance < edgeRange && target.y < main.y + edgeDepth && target.y > main.y - 190 && hash(state, f, 0xed6e, 45) % 100 < edgeChance) {
    const out = blank(); out.x = side * 80; out.b = pulse(state, f.slot, B.JUMP); return out;
  }
  return blank();
}

/** The route from where a fighter stands (or would land) to where the target stands; null when they share a surface or none exists. */
function routeTo(state: State, f: Fighter, target: Fighter, stage: Stage): { me: Surface; next: Surface; goal: Surface } | null {
  const surfs = surfaces(state, stage);
  const me = f.grounded && f.platform >= 0 ? surfs[f.platform] : surfaceUnder(surfs, f.x, f.y);
  const goal = target.grounded && target.platform >= 0 ? surfs[target.platform] : surfaceUnder(surfs, target.x, target.y);
  if (!me || !goal || me.i === goal.i) return null;
  const path = route(surfs, me, goal, legs(f));
  if (!path || path.length < 2) return null;
  return { me, next: path[1], goal };
}

/** Where on `me` to leave from for `next`, and which way to go from there: 0 is straight up, or straight down through a soft platform. */
function launchPoint(me: Surface, next: Surface, towardX: number, soft: boolean): { lx: number; dir: -1 | 0 | 1 } {
  if (next.x1 > me.x2 - 10) return { lx: me.x2 - 14, dir: 1 };
  if (next.x2 < me.x1 + 10) return { lx: me.x1 + 14, dir: -1 };
  // down off a solid block: the edge nearer the target
  if (next.y > me.y + 8 && !soft) return towardX < (me.x1 + me.x2) / 2 ? { lx: me.x1 + 14, dir: -1 } : { lx: me.x2 - 14, dir: 1 };
  const lo = Math.max(me.x1, next.x1) + 14, hi = Math.min(me.x2, next.x2) - 14;
  return { lx: Math.max(lo, Math.min(hi, towardX)), dir: 0 };
}

/** Grounded and the target is on another surface: walk to the launch point and hop, drop off the edge, or wait for a moving platform. */
function navInput(state: State, f: Fighter, target: Fighter, stage: Stage): InputFrame | null {
  const r = routeTo(state, f, target, stage);
  if (!r) return null;
  const { me, next } = r;
  const soft = !stage.platforms[me.i].solid;
  const { lx, dir } = launchPoint(me, next, target.x, soft);
  const out = blank();
  const dx = lx - f.x;
  if (Math.abs(dx) > 16) { out.x = sign(dx) * (Math.abs(dx) > 120 ? 100 : 55); return out; }
  if (!canCross(me, next, legs(f), true)) return out;
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

function aerialNeutral(state: State, f: Fighter, target: Fighter, sk: Skill, stage: Stage): InputFrame {
  const out = blank();
  const dx = target.x - f.x, dy = target.y - f.y;
  out.x = sign(dx) * (Math.abs(dx) > 45 ? 80 : 35);
  // on a route: steer for the next surface, double jump when it is still above
  const r = routeTo(state, f, target, stage);
  if (r) {
    const aim = Math.max(r.next.x1 + 14, Math.min(r.next.x2 - 14, f.x));
    const ax = aim - f.x;
    out.x = Math.abs(ax) > 8 ? sign(ax) * 100 : 0;
    if (f.vy > 0 && r.next.y < f.y - 10 && f.jumpsLeft > 0 && f.action === "air") out.b = pulse(state, f.slot, B.JUMP);
    if (f.vy > 0 && r.next.y > f.y + 60 && Math.abs(ax) <= 8) out.y = 100;
    return out;
  }
  const dodge = shotAnswer(state, f, sk);
  if (dodge) return dodge;
  const facingToTarget = sign(dx) === f.facing, slack = sk.slack;
  if (target.action === "tumble" || target.action === "hitstun") {
    if (dy < -35 && moveCanReach(f, target, "uair", f.facing, slack)) return startAerial(state, f, "uair");
  }
  if (Math.abs(dx) < 90 && dy > 30 && moveCanReach(f, target, "dair", f.facing, slack) && sk.c >= 0.55) return startAerial(state, f, "dair");
  if (facingToTarget && moveCanReach(f, target, "fair", f.facing, slack)) return startAerial(state, f, "fair");
  if (!facingToTarget && moveCanReach(f, target, "bair", f.facing, slack)) return startAerial(state, f, "bair");
  if (moveCanReach(f, target, "nair", f.facing, slack)) return startAerial(state, f, "nair");
  if (f.vy > 0 && f.y < target.y - 20 && sk.c >= 0.3) out.y = 100;
  return out;
}

function groundNeutral(state: State, f: Fighter, target: Fighter, sk: Skill, stage: Stage): InputFrame {
  const out = blank();
  const dx = target.x - f.x, dy = target.y - f.y;
  const distance = Math.abs(dx), facing = (dx >= 0 ? 1 : -1) as 1 | -1;
  const mistake = hash(state, f, 0xb07, 24) % 100 >= at(sk, 55, 95);

  if (attackThreatens(target, f, sk)) {
    // a smash with armour from its first frames trades through the attack instead of shielding it
    const armoured = SMASHES.find((m) => { const a = defOf(f).moves[m].armour; return a && a.frames[0] <= 3 && a.threshold >= 8; });
    if (armoured && sk.c >= 0.55 && moveNearReach(f, target, armoured, facing, 35) && hash(state, f, 0xb41c, 16) % 100 < 68) {
      return startSmash(state, f, armoured, facing);
    }
    if (f.shield > 12 && hash(state, f, 0xdefe, 12) % 100 < at(sk, 12, 90)) {
      out.b = B.SHIELD;
      if (sk.c >= 0.8 && hash(state, f, 0xd0d6, 20) % 100 < 35) out.y = 100;
      return out;
    }
  }

  const dodge = shotAnswer(state, f, sk);
  if (dodge) return dodge;

  const edgeguard = edgeguardInput(state, f, target, sk, stage);
  if (edgeguard) return edgeguard;

  // what it sees is `delay` frames old, so the move has that much less left than it looks
  const opponentMove = currentMove(target);
  const opponentInfo = target.move ? reachOf(target)[target.move] : null;
  const punishable = target.action === "attack" && opponentMove && opponentInfo && target.frame > opponentInfo.last && opponentMove.total - target.frame - sk.delay >= 4;
  if (punishable && distance < at(sk, 200, 280)) {
    if (distance < 90 && hash(state, f, 0x9a11, 20) % 100 < at(sk, 35, 75)) return startTilt(state, f, "jab1", facing);
    if (moveCanReach(f, target, "ftilt", facing, sk.slack)) return startTilt(state, f, "ftilt", facing);
    out.x = facing * 100;
    return out;
  }

  if (target.percent > (sk.c < 0.3 ? 85 : 45)) {
    const smash = killMove(state, f, target, facing, sk);
    const commits = sk.c >= 0.3 ? (!mistake || sk.c >= 0.8) : hash(state, f, 0x510a, 18) % 100 < 36;
    if (smash && commits) return startSmash(state, f, smash, facing);
  }

  const special = specialChoice(state, f, target, sk, facing, distance, stage);
  if (special) return special;

  // a zoner: run in while its shot is out or it's stuck in a move, and hop the last stretch
  const zoning = ownsProjectile(state, target, sk.delay) || target.action === "attack";
  if (zoning && distance > 220 && sk.c >= 0.3) {
    out.x = facing * 100;
    if (distance < 360 && f.action === "run" && hash(state, f, 0x2011, 30) % 100 < at(sk, 10, 45)) out.b = pulse(state, f.slot, B.JUMP);
    return out;
  }

  const nav = navInput(state, f, target, stage);
  if (nav) return nav;

  if (dy < -65) {
    if (moveCanReach(f, target, "utilt", facing, sk.slack)) return startTilt(state, f, "utilt", facing);
    if (distance < at(sk, 188, 252)) { out.x = facing * 65; out.b = pulse(state, f.slot, B.JUMP); return out; }
  }

  const moveCycle = (f.moveInstance + hash(state, f, 0xa771, 30)) % 5;
  const close = 84 + sk.slack;
  if (!mistake) {
    if (moveCycle === 0 && moveCanReach(f, target, "dtilt", facing, sk.slack)) return startTilt(state, f, "dtilt", facing);
    if ((moveCycle === 1 || moveCycle === 3) && distance < close) return startTilt(state, f, "jab1", facing);
    if ((moveCycle === 2 || moveCycle === 4) && moveCanReach(f, target, "ftilt", facing, sk.slack)) return startTilt(state, f, "ftilt", facing);
  } else if (distance < 150 && state.frame % thinkEvery(sk) === 0) {
    return startTilt(state, f, moveCycle & 1 ? "jab1" : "ftilt", facing);
  }

  const ftilt = reachOf(f).ftilt ?? EMPTY_MOVE;
  const desired = Math.max(55, ftilt.maxX + defOf(target).stats.width * 0.35 - (sk.c < 0.3 ? 25 : 5));
  if (distance > desired + 28) {
    out.x = facing * (distance > desired + 110 ? 100 : 45);
    if (distance < 250 && f.action === "dash" && !mistake && hash(state, f, 0xda55, 18) % 100 < at(sk, 24, 56)) out.b = pulse(state, f.slot, B.ATTACK);
    return out;
  }
  if (distance < desired - 24) {
    out.x = -facing * (sk.c >= 0.5 ? 100 : 45);
    return out;
  }
  if (hash(state, f, 0xdace, 35) % 100 < at(sk, 21, 45)) out.x = -facing * 100;
  else if (hash(state, f, 0x5a0b, 30) % 100 < at(sk, 18, 42)) { out.x = facing * 60; out.b = pulse(state, f.slot, B.JUMP); }
  return out;
}

/** How many frames a dithering low-tier CPU waits between looks at the fight. */
function thinkEvery(sk: Skill): number {
  return Math.round(at(sk, 12, 2));
}

/** The target as the CPU sees it: where it was and what it was doing `sk.delay` frames ago. */
function perceived(state: State, target: Fighter, sk: Skill): Fighter {
  const past = state.seen[Math.min(sk.delay, state.seen.length - 1)]?.[target.slot];
  return past ? { ...target, ...past } : target;
}

/** `tier` is 1 (PATHETIC) to 5 (UNFAIR); see cpu-skill.ts. */
export function cpuInput(state: State, slot: number, tier: number): InputFrame {
  const f = state.fighters[slot];
  if (!f || f.action === "dead") return blank();
  const sk = skillOf(tier);
  const stage = stageOf(state);
  const seen = targetOf(state, f);
  const target = seen && perceived(state, seen, sk);

  if (f.hitlag > 0 || f.action === "grabbed" || f.action === "thrown" || f.action === "tumble" || f.action === "hitstun") {
    if (offStage(state, f, stage) && f.hitlag === 0 && f.action === "tumble" && f.frame >= f.hitstun) return recoveryInput(state, f, sk, stage);
    return disadvantageInput(state, f, target, sk, stage);
  }
  if (f.ledge >= 0) return ledgeInput(state, f, target, sk, stage);
  if (offStage(state, f, stage)) return recoveryInput(state, f, sk, stage);

  const committed = handleCommitted(state, f, target, sk, stage);
  if (committed) return committed;
  if (!target) return blank();
  if (!f.grounded) return aerialNeutral(state, f, target, sk, stage);

  const think = thinkEvery(sk);
  if (sk.c < 0.3 && state.frame % think !== 0 && hash(state, f, 0x5107, think) % 100 < 45) {
    const out = blank();
    if (Math.abs(target.x - f.x) > 170) out.x = sign(target.x - f.x) * 45;
    return out;
  }
  return groundNeutral(state, f, target, sk, stage);
}
