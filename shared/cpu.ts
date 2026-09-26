import { C } from "./config";
import { cosDeg, sign, sinDeg } from "./fixed";
import { currentMove, defOf, isActionable } from "./fighter";
import { knockback } from "./hits";
import { B, type InputFrame } from "./input";
import { EMPTY_MOVE, SPECIALS, profileOf, type MoveInfo, type Profile, type SpecialId } from "./cpu-profile";
import { stageOf } from "./sim";
import type { Fighter, Hitbox, Move, Stage, State } from "./types";

const REACTION = [30, 30, 26, 21, 15, 11, 8, 6, 4, 3];
const THINK = [12, 12, 10, 8, 7, 6, 5, 4, 3, 2];

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

function moveCanReach(attacker: Fighter, victim: Fighter, moveId: string, facing: 1 | -1): boolean {
  const info = reachOf(attacker)[moveId];
  if (!info || info.first === 999) return false;
  const vdef = defOf(victim);
  const localX = (victim.x - attacker.x) * facing;
  const hurtLeft = localX - vdef.stats.width * 0.5;
  const hurtRight = localX + vdef.stats.width * 0.5;
  const relY = victim.y - attacker.y;
  const hurtTop = relY - vdef.stats.height;
  const hurtBottom = relY;
  return info.maxX >= hurtLeft && info.minX <= hurtRight && info.maxY >= hurtTop && info.minY <= hurtBottom;
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

function attackThreatens(attacker: Fighter, victim: Fighter, level: number): boolean {
  if (attacker.action !== "attack" || !attacker.move || attacker.frame < REACTION[level]) return false;
  const info = reachOf(attacker)[attacker.move];
  if (!info || attacker.frame > info.last + 1) return false;
  const startupLead = level >= 8 ? 5 : level >= 6 ? 3 : 1;
  if (attacker.frame + startupLead < info.first) return false;
  return moveNearReach(attacker, victim, attacker.move, attacker.moveFacing, 18 + level * 3);
}

function incomingProjectile(state: State, f: Fighter, range: number): boolean {
  for (const p of state.projectiles) {
    if (p.owner === f.slot || p.dead) continue;
    const dx = f.x - p.x, dy = f.y - defOf(f).stats.height * 0.5 - p.y;
    if (dx * dx + dy * dy > range * range) continue;
    if (p.vx * dx + p.vy * dy > 0) return true;
  }
  return false;
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

function disadvantageInput(state: State, f: Fighter, target: Fighter | null, level: number, stage: Stage): InputFrame {
  const out = blank();
  if (f.hitlag > 0 && f.pending) {
    const attacker = state.fighters[f.pending.attacker] ?? target;
    const main = mainBounds(state, stage);
    const nearEdge = profile(f).cautious && (f.x < main.x1 + 170 || f.x > main.x2 - 170);
    out.x = nearEdge ? sign((main.x1 + main.x2) * 0.5 - f.x) * 90 : attacker ? sign(f.x - attacker.x) * 85 : sign(-f.pending.vx) * 85;
    out.y = -100;
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
    if (level >= 4 && f.action === "tumble" && impendingCollision(state, f, stage)) {
      const chance = level >= 7 ? 92 : 28 + level * 8;
      if (hash(state, f, 0x51ed, 7) % 100 < chance) out.b = pulse(state, f.slot, B.SHIELD);
    }
    if (f.action === "tumble" && f.frame >= f.hitstun && level >= 6 && !f.airDodged && hash(state, f, 0xada, 45) % 100 < level * 5) {
      out.b = pulse(state, f.slot, B.SHIELD);
      out.x = -sign(f.vx) * 70;
    }
    return out;
  }
  return out;
}

function ledgeInput(state: State, f: Fighter, target: Fighter | null, level: number, stage: Stage): InputFrame {
  const out = blank();
  if (f.action === "ledgeGrab") return out;
  const wait = level >= 7 ? 8 + hash(state, f, 0x1ed9, 60) % 16 : 18 + hash(state, f, 0x1ed9, 90) % 35;
  if (f.ledgeTime < wait) return out;
  const ledge = stage.ledges[f.ledge];
  const close = target && Math.abs(target.x - f.x) < 145;
  const option = hash(state, f, 0x1ed6, 90) % 100;
  if (close && option < 28 + level * 3) out.b = pulse(state, f.slot, B.ATTACK);
  else if (option < 45) out.b = pulse(state, f.slot, B.SHIELD);
  else if (option < 70) out.b = pulse(state, f.slot, B.JUMP);
  else if (option < 92) out.x = -ledge.side * 55;
  else out.y = 100;
  return out;
}

function recoveryInput(state: State, f: Fighter, level: number, stage: Stage): InputFrame {
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
    if ((pursued || incomingProjectile(state, f, 260) || f.y > ledgeY + 280) && hash(state, f, 0xa1d0, 24) % 100 < 38 + level * 6) {
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

const SMASHES = ["fsmash", "usmash", "dsmash"] as const;

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

function killMove(state: State, f: Fighter, target: Fighter, facing: 1 | -1): "fsmash" | "usmash" | "dsmash" | null {
  if (moveCanReach(f, target, "usmash", facing) && likelyKills(state, f, target, "usmash", facing)) return "usmash";
  if (moveCanReach(f, target, "fsmash", facing) && likelyKills(state, f, target, "fsmash", facing)) return "fsmash";
  if (moveCanReach(f, target, "dsmash", facing) && likelyKills(state, f, target, "dsmash", facing)) return "dsmash";
  return null;
}

function handleCommitted(state: State, f: Fighter, target: Fighter | null, level: number, stage: Stage): InputFrame | null {
  if (f.action === "smashCharge") {
    const out = blank();
    const targetUnsafe = target && (target.action === "hitstun" || target.action === "tumble" || target.action === "knockdown" || target.action === "shieldBreak");
    const desired = targetUnsafe ? 12 + level * 3 : level >= 7 ? 8 : 2;
    if (f.charge < desired && (!target || Math.abs(target.x - f.x) > 95 || targetUnsafe)) out.b = B.ATTACK;
    return out;
  }
  if (f.action === "shield") {
    const out = blank();
    const danger = target && attackThreatens(target, f, level);
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
    if (offStage(state, f, stage)) return recoveryInput(state, f, level, stage);
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
        if (safe && hash(state, f, 0xc4a6) % 100 >= 6 - Math.floor(level / 3)) out.b = B.SPECIAL;
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

function ownsProjectile(state: State, f: Fighter): boolean {
  for (const p of state.projectiles) if (p.owner === f.slot && !p.dead) return true;
  return false;
}

function specialChoice(state: State, f: Fighter, target: Fighter, level: number, facing: 1 | -1, distance: number, stage: Stage): InputFrame | null {
  const p = profile(f), moves = defOf(f).moves;
  const committing = target.action === "attack" && target.frame >= REACTION[level];
  const dy = target.y - f.y;
  for (const [i, s] of NEUTRAL_SPECIALS.entries()) {
    const mv = moves[s], probe = p.specials[s];
    const aimed = s === "sspecial" || f.facing === facing;
    const roll = (salt: number, period: number) => hash(state, f, salt + i * 0x101, period) % 100;
    if (mv.counter) {
      if (committing && attackThreatens(target, f, level) && roll(0x71f0, 30) < 10 + level * 3) return startSpecial(state, f, s, facing);
      continue;
    }
    if (mv.helpless) continue;
    if (moveCanReach(f, target, s, facing) && roll(0x5e11, 25) < 10 + level * 3) return startSpecial(state, f, s, facing);
    if (!probe || !aimed || !landsOnStage(state, f, stage, probe.groundDx)) continue;
    if (probe.shotRange > 0 && distance > 140 && distance < probe.shotRange * 0.9 && Math.abs(dy) < 90 && !ownsProjectile(state, f) && roll(0x5106, 35) < 14 + level * 4) return startSpecial(state, f, s, facing);
    if (probe.groundDx > 150 && mv.hitboxes.length && distance > 150 && distance < probe.groundDx * 0.9 && Math.abs(dy) < 60 && roll(0x7a6e, 40) < 8 + level * 3) return startSpecial(state, f, s, facing);
    // a special that shows no hit, shot or movement (a stance, a transformation): now and then, from far away
    const inert = !mv.hitboxes.length && !probe.shotRange && Math.abs(probe.groundDx) < 40;
    if (inert && distance > 380 && roll(0x1a9e, 60) < 2 + level) return startSpecial(state, f, s, facing);
  }
  return null;
}

function edgeguardInput(state: State, f: Fighter, target: Fighter, level: number, stage: Stage): InputFrame | null {
  if (level < 5 || !offStage(state, target, stage) || !f.grounded) return null;
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
    const smash = killMove(state, f, target, facing);
    if (smash) return startSmash(state, f, smash, facing);
    return startTilt(state, f, "ftilt", facing);
  }
  const stockLead = f.stocks > target.stocks;
  const edgeRange = stockLead ? 330 : 210;
  const edgeDepth = stockLead ? 210 : 100;
  const edgeChance = stockLead ? 72 : 35;
  if (!profile(f).cautious && level >= 7 && targetDistance < edgeRange && target.y < main.y + edgeDepth && target.y > main.y - 190 && hash(state, f, 0xed6e, 45) % 100 < edgeChance) {
    const out = blank(); out.x = side * 80; out.b = pulse(state, f.slot, B.JUMP); return out;
  }
  return blank();
}

function aerialNeutral(state: State, f: Fighter, target: Fighter, level: number): InputFrame {
  const out = blank();
  const dx = target.x - f.x, dy = target.y - f.y;
  out.x = sign(dx) * (Math.abs(dx) > 45 ? 80 : 35);
  const facingToTarget = sign(dx) === f.facing;
  if (target.action === "tumble" || target.action === "hitstun") {
    if (dy < -35 && moveCanReach(f, target, "uair", f.facing)) return startAerial(state, f, "uair");
  }
  if (Math.abs(dx) < 90 && dy > 30 && moveCanReach(f, target, "dair", f.facing) && level >= 6) return startAerial(state, f, "dair");
  if (facingToTarget && moveCanReach(f, target, "fair", f.facing)) return startAerial(state, f, "fair");
  if (!facingToTarget && moveCanReach(f, target, "bair", f.facing)) return startAerial(state, f, "bair");
  if (moveCanReach(f, target, "nair", f.facing)) return startAerial(state, f, "nair");
  if (f.vy > 0 && f.y < target.y - 20 && level >= 4) out.y = 100;
  return out;
}

function groundNeutral(state: State, f: Fighter, target: Fighter, level: number, stage: Stage): InputFrame {
  const out = blank();
  const dx = target.x - f.x, dy = target.y - f.y;
  const distance = Math.abs(dx), facing = (dx >= 0 ? 1 : -1) as 1 | -1;
  const mistake = hash(state, f, 0xb07, 24) % 100 >= 50 + level * 5;

  if (attackThreatens(target, f, level)) {
    // a smash with armour from its first frames trades through the attack instead of shielding it
    const armoured = SMASHES.find((m) => { const a = defOf(f).moves[m].armour; return a && a.frames[0] <= 3 && a.threshold >= 8; });
    if (armoured && level >= 6 && moveNearReach(f, target, armoured, facing, 35) && hash(state, f, 0xb41c, 16) % 100 < 68) {
      return startSmash(state, f, armoured, facing);
    }
    const defendChance = level <= 3 ? 8 + level * 6 : 35 + level * 6;
    if (f.shield > 12 && hash(state, f, 0xdefe, 12) % 100 < defendChance) {
      out.b = B.SHIELD;
      if (level >= 7 && hash(state, f, 0xd0d6, 20) % 100 < 35) out.y = 100;
      return out;
    }
  }

  const edgeguard = edgeguardInput(state, f, target, level, stage);
  if (edgeguard) return edgeguard;

  const opponentMove = currentMove(target);
  const opponentInfo = target.move ? reachOf(target)[target.move] : null;
  const punishable = target.action === "attack" && opponentMove && opponentInfo && target.frame > opponentInfo.last && opponentMove.total - target.frame >= Math.max(4, REACTION[level] - 2);
  if (punishable && distance < 190 + level * 10) {
    if (distance < 90 && hash(state, f, 0x9a11, 20) % 100 < 30 + level * 5) return startTilt(state, f, "jab1", facing);
    if (moveCanReach(f, target, "ftilt", facing)) return startTilt(state, f, "ftilt", facing);
    out.x = facing * 100;
    return out;
  }

  if (target.percent > (level <= 3 ? 85 : 45)) {
    const smash = killMove(state, f, target, facing);
    const commits = level >= 4 ? (!mistake || level >= 8) : hash(state, f, 0x510a, 18) % 100 < 28 + level * 8;
    if (smash && commits) return startSmash(state, f, smash, facing);
  }

  const special = specialChoice(state, f, target, level, facing, distance, stage);
  if (special) return special;

  if (dy < -65) {
    if (moveCanReach(f, target, "utilt", facing)) return startTilt(state, f, "utilt", facing);
    if (distance < 180 + level * 8) { out.x = facing * 65; out.b = pulse(state, f.slot, B.JUMP); return out; }
  }

  const moveCycle = (f.moveInstance + hash(state, f, 0xa771, 30)) % 5;
  if (!mistake) {
    if (moveCycle === 0 && moveCanReach(f, target, "dtilt", facing)) return startTilt(state, f, "dtilt", facing);
    if (moveCycle === 1 && distance < 85) return startTilt(state, f, "jab1", facing);
    if (moveCycle === 2 && moveCanReach(f, target, "ftilt", facing)) return startTilt(state, f, "ftilt", facing);
    if (moveCycle === 3 && distance < 82) return startTilt(state, f, "jab1", facing);
    if (moveCycle === 4 && moveCanReach(f, target, "ftilt", facing)) return startTilt(state, f, "ftilt", facing);
  } else if (distance < 150 && state.frame % THINK[level] === 0) {
    return startTilt(state, f, moveCycle & 1 ? "jab1" : "ftilt", facing);
  }

  const ftilt = reachOf(f).ftilt ?? EMPTY_MOVE;
  const desired = Math.max(55, ftilt.maxX + defOf(target).stats.width * 0.35 - (level <= 3 ? 25 : 5));
  if (distance > desired + 28) {
    out.x = facing * (distance > desired + 110 ? 100 : 45);
    if (distance < 250 && f.action === "dash" && !mistake && hash(state, f, 0xda55, 18) % 100 < 20 + level * 4) out.b = pulse(state, f.slot, B.ATTACK);
    return out;
  }
  if (distance < desired - 24) {
    out.x = -facing * (level >= 5 ? 100 : 45);
    return out;
  }
  if (hash(state, f, 0xdace, 35) % 100 < 18 + level * 3) out.x = -facing * 100;
  else if (hash(state, f, 0x5a0b, 30) % 100 < 15 + level * 3) { out.x = facing * 60; out.b = pulse(state, f.slot, B.JUMP); }
  return out;
}

export function cpuInput(state: State, slot: number, rawLevel: number): InputFrame {
  const f = state.fighters[slot];
  if (!f || f.action === "dead") return blank();
  const level = Math.max(1, Math.min(9, rawLevel | 0));
  const stage = stageOf(state);
  const target = targetOf(state, f);

  if (f.hitlag > 0 || f.action === "grabbed" || f.action === "thrown" || f.action === "tumble" || f.action === "hitstun") {
    if (offStage(state, f, stage) && f.hitlag === 0 && f.action === "tumble" && f.frame >= f.hitstun) return recoveryInput(state, f, level, stage);
    return disadvantageInput(state, f, target, level, stage);
  }
  if (f.ledge >= 0) return ledgeInput(state, f, target, level, stage);
  if (offStage(state, f, stage)) return recoveryInput(state, f, level, stage);

  const committed = handleCommitted(state, f, target, level, stage);
  if (committed) return committed;
  if (!target) return blank();
  if (!f.grounded) return aerialNeutral(state, f, target, level);

  if (level <= 3 && state.frame % THINK[level] !== 0 && hash(state, f, 0x5107, THINK[level]) % 100 < 45) {
    const out = blank();
    if (Math.abs(target.x - f.x) > 170) out.x = sign(target.x - f.x) * 45;
    return out;
  }
  return groundNeutral(state, f, target, level, stage);
}
