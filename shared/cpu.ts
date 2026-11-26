import { sign } from "./fixed";
import { currentMove, defOf, isActionable } from "./fighter";
import { B, type InputFrame } from "./input";
import { EMPTY_MOVE, type Plan, type SpecialId, type Spot } from "./cpu-profile";
import { SHOWMAN_TIER, at, skillOf, type Skill } from "./cpu-skill";
import { showmanInput } from "./cpu-showman";
import { stageOf } from "./sim";
import {
  NEUTRAL_SPECIALS, SMASHES, attackThreatens, blank, hash, incomingShot, killMove, landsOnStage, likelyKills, mainBounds, moveCanReach,
  moveNearReach, navInput, nearEdge, offStage, ownsProjectile, perceived, profile, pulse, reachOf, routeTo, shotAnswer, shotAt, shotReach,
  spammed, startAerial, startSmash, startSpecial, startTilt, strongestHitbox, targetOf, wouldHit,
} from "./cpu-kit";
import { disadvantageInput, ledgeInput, recoveryInput } from "./cpu-survive";
import type { Fighter, Stage, State } from "./types";

/** Whether one of its smashes would finish the target if it landed, reach aside: time to go in for it. */
function finishable(state: State, f: Fighter, target: Fighter, facing: 1 | -1): boolean {
  const moves = defOf(f).moves, p = profile(f);
  return SMASHES.some((m) => {
    if (spammed(f, m)) return false;
    const hb = strongestHitbox(moves[m]);
    if (hb && likelyKills(state, f, target, hb, true, facing)) return true;
    return (p.shots[m] ?? []).some((path) => path.hit && likelyKills(state, f, target, path.hit, false, facing));
  });
}

/** Where the target stands for a plan started now: a side special turns to face it, the others fire the way the fighter faces. */
function spotOf(f: Fighter, target: Fighter, move: SpecialId): Spot {
  const dx = target.x - f.x;
  if (move !== "sspecial" && sign(dx) !== f.facing) return "behind";
  return Math.abs(dx) < 250 ? "near" : "far";
}

/** A measured plan that KO'd a dummy standing where the target stands now. */
function planAgainst(f: Fighter, target: Fighter): Plan | null {
  return profile(f).plans.find((p) => !spammed(f, p.move) && p.kos.includes(spotOf(f, target, p.move))) ?? null;
}

/** Going for a plan while nobody is close or swinging, more readily the stronger the CPU. */
function planInput(state: State, f: Fighter, target: Fighter, sk: Skill, distance: number): InputFrame | null {
  if (distance < 250 || attackThreatens(target, f, sk)) return null;
  const plan = planAgainst(f, target);
  if (!plan || hash(state, f, 0x91a2, 30) % 100 >= at(sk, 15, 70)) return null;
  return startSpecial(state, f, plan.move, sign(target.x - f.x) as 1 | -1);
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
    // a special with a measured payoff: hold it as long as the study did, letting go only if someone gets in its face
    const plan = profile(f).plans.find((p) => p.move === f.move);
    if (plan) {
      const danger = target && (Math.abs(target.x - f.x) < 110 || attackThreatens(target, f, sk));
      if (state.frame - f.streakLast < plan.hold && !danger) {
        out.b = B.SPECIAL;
        if (f.move === "sspecial") out.x = f.moveFacing * 100;
        else if (f.move === "dspecial") out.y = 100;
      }
      return out;
    }
    if (probe?.held) {
      if (f.move === "uspecial") { out.b = B.SPECIAL; out.y = -100; }
      else if (Math.abs(probe.groundDx) > 100) {
        // a flight: keep going while the target is still ahead
        if (target && sign(target.x - f.x) === f.moveFacing && Math.abs(target.x - f.x) > 40) out.b = B.SPECIAL;
      } else {
        // a charge: let go the moment the tapped shot would land; keep loading while only a charged one would,
        // or while it's safe to, letting go at a random moment
        const tapped = target && shotAt(profile(f), f.move!, f, target, f.moveFacing, 0);
        const charged = target && !tapped && shotAt(profile(f), f.move!, f, target, f.moveFacing);
        const safe = target && (Math.abs(target.x - f.x) > 190 || target.action === "hitstun" || target.action === "tumble");
        if (charged || (!tapped && safe && hash(state, f, 0xc4a6) % 100 >= Math.round(at(sk, 6, 3)))) out.b = B.SPECIAL;
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

function specialChoice(state: State, f: Fighter, target: Fighter, sk: Skill, facing: 1 | -1, distance: number, stage: Stage): InputFrame | null {
  const p = profile(f), moves = defOf(f).moves;
  for (const [i, s] of NEUTRAL_SPECIALS.entries()) {
    const mv = moves[s], probe = p.specials[s];
    if (spammed(f, s)) continue;
    const aimed = s === "sspecial" || f.facing === facing;
    const roll = (salt: number, period: number) => hash(state, f, salt + i * 0x101, period) % 100;
    if (mv.counter) {
      if (attackThreatens(target, f, sk) && roll(0x71f0, 30) < at(sk, 13, 37)) return startSpecial(state, f, s, facing);
      continue;
    }
    if (mv.helpless || !aimed || !landsOnStage(state, f, stage, probe.groundDx)) continue;
    // the study says it lands on someone standing where the target is: up close like any attack, from
    // range as a shot (or a lunge, a pounce, a lock-on) as often as the fighter lives by them
    const hits = wouldHit(state, f, target, p, s, facing);
    if (hits && distance <= 140 && roll(0x5e11, 25) < at(sk, 13, 37)) return startSpecial(state, f, s, facing);
    if (hits && distance > (p.zoning >= 0.5 ? 90 : 140) && roll(0x5106, 35) < at(sk, 18, 50) * (0.6 + p.zoning)) return startSpecial(state, f, s, facing);
    // a special that shows no hit, shot or movement (a stance, a transformation): now and then, from far away
    const inert = !mv.hitboxes.length && !probe.shotRange && Math.abs(probe.groundDx) < 40;
    if (inert && distance > 380 && roll(0x1a9e, 60) < at(sk, 3, 11)) return startSpecial(state, f, s, facing);
  }
  return null;
}

function edgeguardInput(state: State, f: Fighter, target: Fighter, sk: Skill, stage: Stage): InputFrame | null {
  if (sk.c < 0.5 || !offStage(state, target, stage) || !f.grounded) return null;
  const main = mainBounds(state, stage, target.x, target.y);
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
  // shots from the air: a special whose probe from up here puts a projectile on the target (fireballs rained
  // down, a lob off a platform), or an aerial that fires something
  const p = profile(f);
  for (const [i, s] of NEUTRAL_SPECIALS.entries()) {
    const mv = defOf(f).moves[s];
    if (mv.helpless || mv.counter) continue;
    const facing = s === "sspecial" ? ((sign(dx) || f.facing) as 1 | -1) : f.facing;
    if (p.zoning < 0.3 && dy < 60) continue;
    if (wouldHit(state, f, target, p, s, facing) && hash(state, f, 0xa1f2 + i * 0x101, 30) % 100 < at(sk, 15, 45) * (0.6 + p.zoning)) return startSpecial(state, f, s, facing);
  }
  for (const a of ["nair", "fair", "bair", "uair", "dair"] as const) {
    if (wouldHit(state, f, target, p, a, f.facing) && hash(state, f, 0xa2f3 + a.length, 24) % 100 < at(sk, 25, 60)) return startAerial(state, f, a);
  }
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
    const armoured = SMASHES.find((m) => { const a = defOf(f).moves[m].armour; return a && a.frames[0] <= 3 && a.threshold >= 8 && !spammed(f, m); });
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

  const plan = planInput(state, f, target, sk, distance);
  if (plan) return plan;

  // what it sees is `delay` frames old, so the move has that much less left than it looks
  const opponentMove = currentMove(target);
  const opponentInfo = target.move ? reachOf(target)[target.move] : null;
  const punishable = target.action === "attack" && opponentMove && opponentInfo && target.frame > opponentInfo.last && opponentMove.total - target.frame - sk.delay >= 4;
  if (punishable && distance < at(sk, 200, 280)) {
    if (distance < 90 && !spammed(f, "jab1") && hash(state, f, 0x9a11, 20) % 100 < at(sk, 35, 75)) return startTilt(state, f, "jab1", facing);
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

  // normals that fire something (a fire lord's embers): thrown when the target sits on their path
  const p = profile(f);
  for (const t of ["ftilt", "utilt", "dtilt"] as const) {
    if (distance > 90 && wouldHit(state, f, target, p, t, facing) && hash(state, f, 0x7e11 + t.length, 24) % 100 < at(sk, 25, 60)) return startTilt(state, f, t, facing);
  }

  // keep-away: a fighter whose shots are its best damage holds the range they land at instead of rushing in,
  // backs off when the target closes, and only brawls when it has no room left behind it
  // ...but not while losing (a stock down, or well behind on percent, it has to go and get them), nor once
  // a smash would finish the target: chip damage doesn't take stocks
  const losing = f.stocks < target.stocks || (f.stocks === target.stocks && f.percent > target.percent + 30);
  if (p.zoning >= 0.5 && sk.c >= 0.3 && !losing && !finishable(state, f, target, facing)) {
    const keep = Math.max(200, Math.min(420, shotReach(p) * 0.6));
    const main = mainBounds(state, stage, f.x, f.y), behind = f.x - facing * 150;
    const room = behind > main.x1 + 30 && behind < main.x2 - 30;
    const brawl = distance < 90 && (moveCanReach(f, target, "jab1", facing, sk.slack) || moveCanReach(f, target, "ftilt", facing, sk.slack));
    if (!brawl) {
      if (distance < keep - 40 && room) { out.x = -facing * 100; return out; }
      if (distance > keep + 80) { out.x = facing * 45; return out; }
      if (distance >= keep - 40) {
        // in the pocket: the shot fires from specialChoice. Meanwhile, ahead: shuffle a little so it isn't a
        // statue; even or behind on percent: creep in, so two of these don't stare at each other all match
        const ahead = f.percent < target.percent - 10;
        if (ahead) { if (hash(state, f, 0x2e0a, 30) % 100 < 20) out.x = -facing * 45; }
        else if (hash(state, f, 0x2e0b, 30) % 100 < 50) out.x = facing * 45;
        return out;
      }
    }
  }

  // chasing a zoner: run in while its shot is out or it's stuck in a move, and hop the last stretch
  const zoning = p.zoning < 0.5 && (ownsProjectile(state, target, sk.delay) || target.action === "attack");
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
    if ((moveCycle === 1 || moveCycle === 3) && distance < close && !spammed(f, "jab1")) return startTilt(state, f, "jab1", facing);
    if ((moveCycle === 2 || moveCycle === 4) && moveCanReach(f, target, "ftilt", facing, sk.slack)) return startTilt(state, f, "ftilt", facing);
  } else if (distance < 150 && state.frame % thinkEvery(sk) === 0) {
    const flail = moveCycle & 1 ? "jab1" : "ftilt";
    return startTilt(state, f, spammed(f, flail) ? (flail === "jab1" ? "ftilt" : "jab1") : flail, facing);
  }

  const ftilt = reachOf(f).ftilt ?? EMPTY_MOVE;
  const desired = Math.max(55, ftilt.maxX + defOf(target).stats.width * 0.35 - (sk.c < 0.3 ? 25 : 5));
  if (distance > desired + 28) {
    out.x = facing * (distance > desired + 110 ? 100 : 45);
    if (distance < 250 && f.action === "dash" && !mistake && !spammed(f, "dashAttack") && hash(state, f, 0xda55, 18) % 100 < at(sk, 24, 56)) out.b = pulse(state, f.slot, B.ATTACK);
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
  return Math.max(1, Math.round(at(sk, 12, 2)));
}

/** `tier` is 1 (PATHETIC) to 5 (UNFAIR), or SHOWMAN_TIER; see cpu-skill.ts. */
export function cpuInput(state: State, slot: number, tier: number): InputFrame {
  if (tier === SHOWMAN_TIER) return showmanInput(state, slot);
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
  if (f.action === "shieldBreak") {
    // mash out of the stun: every stick reversal and button press counts
    const out = blank();
    out.x = state.frame & 1 ? 100 : -100;
    out.b = pulse(state, f.slot, B.JUMP);
    return out;
  }

  const committed = handleCommitted(state, f, target, sk, stage);
  if (committed) return committed;
  if (!target) return blank();
  if (!f.grounded) return aerialNeutral(state, f, target, sk, stage);

  if (hash(state, f, 0x5107, 40) % 100 < sk.idle) {
    // dawdling: stand around, or wander off in whatever direction it picked
    const out = blank();
    const wander = hash(state, f, 0x3a1d, 40) % 3;
    if (wander < 2 && !nearEdge(state, f, stage, 120)) out.x = (wander ? 1 : -1) * 40;
    return out;
  }
  return groundNeutral(state, f, target, sk, stage);
}
