// Every CPU's way out of trouble: holding on through hits, getting off the ledge, and getting back to the stage.
import { sign } from "./fixed";
import { defOf } from "./fighter";
import { B, type InputFrame } from "./input";
import { SPECIALS, type Profile, type SpecialId } from "./cpu-profile";
import { at, type Skill } from "./cpu-skill";
import { blank, hash, incomingShot, mainBounds, profile, pulse, spammed, startSpecial, targetOf } from "./cpu-kit";
import type { Fighter, Stage, State } from "./types";

export function impendingCollision(state: State, f: Fighter, stage: Stage): boolean {
  if (f.vy > 0.5) {
    for (let i = 0; i < stage.platforms.length; i++) {
      const p = stage.platforms[i], o = state.platOffsets[i];
      const x1 = p.x1 + (o?.dx ?? 0), x2 = p.x2 + (o?.dx ?? 0), y = p.y + (o?.dy ?? 0);
      if (f.x >= x1 && f.x <= x2 && f.y <= y && y - f.y <= f.vy * 18 + 18) return true;
    }
  }
  const main = mainBounds(state, stage, f.x, f.y);
  const halfW = defOf(f).stats.width * 0.5;
  const insideWallY = f.y > main.y && f.y - defOf(f).stats.height < main.bottom;
  if (insideWallY && ((f.vx > 0 && f.x < main.x1 - halfW && main.x1 - halfW - f.x < f.vx * 18 + 12) ||
    (f.vx < 0 && f.x > main.x2 + halfW && f.x - main.x2 - halfW < -f.vx * 18 + 12))) return true;
  return false;
}

export function disadvantageInput(state: State, f: Fighter, target: Fighter | null, sk: Skill, stage: Stage): InputFrame {
  const out = blank();
  if (f.hitlag > 0 && f.pending) {
    const attacker = state.fighters[f.pending.attacker] ?? target;
    const main = mainBounds(state, stage, f.x, f.y);
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
    const main = mainBounds(state, stage, f.x, f.y);
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

export function ledgeInput(state: State, f: Fighter, target: Fighter | null, sk: Skill, stage: Stage): InputFrame {
  const out = blank();
  if (f.action === "ledgeGrab") return out;
  const wait = sk.c >= 0.8 ? 8 + hash(state, f, 0x1ed9, 60) % 16 : 18 + hash(state, f, 0x1ed9, 90) % 35;
  if (f.ledgeTime < wait) return out;
  const ledge = stage.ledges[f.ledge];
  const close = target && Math.abs(target.x - f.x) < 145;
  const option = hash(state, f, 0x1ed6, 90) % 100;
  if (close && option < at(sk, 31, 55) && !spammed(f, "ledgeAttack")) out.b = pulse(state, f.slot, B.ATTACK);
  else if (option < 45) out.b = pulse(state, f.slot, B.SHIELD);
  else if (option < 70) out.b = pulse(state, f.slot, B.JUMP);
  else if (option < 92) out.x = -ledge.side * 55;
  else out.y = 100;
  return out;
}

export function recoveryInput(state: State, f: Fighter, sk: Skill, stage: Stage): InputFrame {
  const out = blank();
  const def = defOf(f), main = mainBounds(state, stage, f.x, f.y);
  const side: 1 | -1 = f.x < (main.x1 + main.x2) * 0.5 ? -1 : 1;
  const ledgeX = side < 0 ? main.x1 : main.x2, ledgeY = main.y;
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
    if (s === "uspecial" || !probe || spammed(f, s) || moves[s].helpless || probe.airDrop > probe.airDx * 0.5 || probe.airDx <= far) continue;
    best = s; far = probe.airDx;
  }
  return best;
}
