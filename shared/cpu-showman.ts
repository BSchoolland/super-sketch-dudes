// The showman: a CPU that fights to put on a show, for promo clips, not to win. It throws its specials, smashes and
// biggest hits far more than a CPU trying to win would, mixes its moves up, stays in the opponent's face, gives an
// opponent that is charging something room to finish and then walks into it, takes the big hits instead of dodging
// them, and holds the KO back until the fight has had time to be a fight. Two showmen read each other straight off
// the state (no reaction delay, no guessing): they are choreographing the fight together. Its survival (DI, the
// ledge, recovery) is the UNFAIR CPU's, so it never throws the fight off the side of the stage.
import { C } from "./config";
import { sign } from "./fixed";
import { currentMove, defOf, isActionable } from "./fighter";
import { B, type InputFrame } from "./input";
import { type SpecialId } from "./cpu-profile";
import { skillOf } from "./cpu-skill";
import { fullMeter, isShowpiece, showMove, showOf, type ShowMove } from "./cpu-show";
import { stageOf } from "./sim";
import {
  attackThreatens, blank, hash, incomingShot, justFired, landsOnStage, mainBounds, moveCanReach, moveNearReach, navInput, offStage,
  profile, pulse, reachOf, shotAnswer, shotAt, spammed, startAerial, startSmash, startSpecial, startTilt, strongestHitbox, targetOf,
} from "./cpu-kit";
import { launchKills } from "./cpu-launch";
import { disadvantageInput, ledgeInput, recoveryInput } from "./cpu-survive";
import type { Fighter, Hitbox, Stage, State } from "./types";

const SK = skillOf(5);
/** Before this nobody goes for the KO; after FINALE both do. */
const OPEN = 25 * C.FPS;
const FINALE = 34 * C.FPS;
const CURTAIN = 42 * C.FPS;

type Aerial = "nair" | "fair" | "bair" | "uair" | "dair";
type Tilt = "jab1" | "ftilt" | "utilt" | "dtilt";
type Smash = "fsmash" | "usmash" | "dsmash";

export function showmanInput(state: State, slot: number): InputFrame {
  const f = state.fighters[slot];
  if (!f || f.action === "dead") return blank();
  const stage = stageOf(state);
  const target = targetOf(state, f);
  if (f.hitlag > 0 || f.action === "grabbed" || f.action === "thrown" || f.action === "tumble" || f.action === "hitstun") {
    if (offStage(state, f, stage) && f.hitlag === 0 && f.action === "tumble" && f.frame >= f.hitstun) return recoveryInput(state, f, SK, stage);
    // late on, a launch is ridden out as it comes: the fight is meant to end
    if (state.frame >= FINALE && f.hitlag > 0) return blank();
    return disadvantageInput(state, f, target, SK, stage);
  }
  if (f.ledge >= 0) return ledgeInput(state, f, target, SK, stage);
  if (offStage(state, f, stage)) return recoveryInput(state, f, SK, stage);
  if (f.action === "shieldBreak") {
    const out = blank();
    out.x = state.frame & 1 ? 100 : -100;
    out.b = pulse(state, f.slot, B.JUMP);
    return out;
  }
  const committed = committedInput(state, f, target, stage);
  if (committed) return committed;
  if (!target) return blank();
  const react = reaction(state, f, target, stage);
  if (react) return react;
  return f.grounded ? groundInput(state, f, target, stage) : airInput(state, f, target, stage);
}

/** Whether `f` may knock `target` out now: not in the first part of the fight, unless the fight has turned into a rout. */
function killAllowed(state: State, f: Fighter, target: Fighter): boolean {
  return state.frame >= OPEN || target.percent - f.percent > 90;
}

/** The hardest hit `move` lands: its strongest hitbox, or the strongest shot it fires. */
function hitOf(f: Fighter, move: string): { hb: Hitbox; smash: boolean } | null {
  const mv = defOf(f).moves[move];
  if (!mv) return null;
  let hb = strongestHitbox(mv);
  for (const path of profile(f).shots[move] ?? []) if (path.hit && (!hb || path.hit.damage > hb.damage)) hb = path.hit;
  return hb ? { hb, smash: !!mv.smash } : null;
}

/**
 * How much of the way to a blast line a launch (flown without DI) has to go: to be a finisher (FINISH); to be held back
 * before the fight may end (HOLD), or once the opponent has taken more than it should have by now (CAREFUL).
 */
const FINISH = 0.9;
const HOLD = 0.55;
const CAREFUL = 0.45;

/** Whether `move` landing now would KO the target. */
function kills(state: State, f: Fighter, target: Fighter, move: string, margin = FINISH): boolean {
  const h = hitOf(f, move);
  return !!h && launches(state, target, h, (sign(target.x - f.x) || f.facing) as 1 | -1, margin);
}

function launches(state: State, target: Fighter, h: { hb: Hitbox; smash: boolean }, facing: 1 | -1, margin: number): boolean {
  return launchKills(state, target, h.hb, facing, h.smash ? 1.15 : 1, margin);
}

/** Damage the opponent should have taken by now, at most, for the fight to still be going when the KO is allowed. */
function overBudget(state: State, foe: Fighter): boolean {
  return state.frame < OPEN && foe.percent > 25 + state.frame * 3.2 / C.FPS;
}

/** Too early for `m` to land: it would send the opponent too far. */
function holdsBack(state: State, f: Fighter, foe: Fighter, m: ShowMove): boolean {
  if (killAllowed(state, f, foe)) return false;
  // its biggest hit still comes out when the opponent can see it coming and shield it (reaction does)
  if (m === showOf(defOf(f)).big && foe.grounded && foe.shield > 30 && isActionable(foe) && Math.abs(foe.x - f.x) > 220) return false;
  return kills(state, f, foe, m.id, overBudget(state, foe) ? CAREFUL : HOLD);
}

/** How far ahead `f` is on damage: positive when the opponent has taken more. */
function lead(f: Fighter, target: Fighter): number {
  return target.percent - f.percent;
}

/** How long `f` charges a smash, or holds a special that charges, this time: from a quick one to the full thing. */
function chargeGoal(state: State, f: Fighter): number {
  return 6 + hash(state, f, 0xc4a6, 1 << 30) % 40;
}

/** Frames since `f` last started a move (how long it has held the one it is in, if it still is). */
function sinceStarted(state: State, f: Fighter): number {
  return state.frame - f.streakLast;
}

/** The opponent is winding up something: a smash charging, or a special held down. */
function charging(state: State, foe: Fighter): { left: number } | null {
  // a quick smash isn't worth making room for
  if (foe.action === "smashCharge") return chargeGoal(state, foe) >= 24 ? { left: chargeGoal(state, foe) - foe.charge } : null;
  if (foe.action !== "attack" || !foe.move || !(state.inputs[foe.slot].b & B.SPECIAL)) return null;
  const p = profile(foe), plan = p.plans.find((x) => x.move === foe.move);
  if (plan) return { left: plan.hold - sinceStarted(state, foe) };
  if (!p.specials[foe.move as SpecialId]?.held) return null;
  return { left: holdGoal(state, foe) - sinceStarted(state, foe) };
}

function holdGoal(state: State, f: Fighter): number {
  return 30 + chargeGoal(state, f) * 2;
}

/** Long past the finale and still going: the one who has taken more damage is the one going down. */
function curtain(state: State, f: Fighter, foe: Fighter): boolean {
  return state.frame >= CURTAIN && f.percent >= foe.percent;
}

/**
 * What it does about the opponent's attacks and shots, and about an opponent winding something up: a showpiece is
 * taken on the chin (unless it would end the fight too early), the small stuff sometimes shielded, a charge given
 * room until it is nearly done and then walked into.
 */
function reaction(state: State, f: Fighter, foe: Fighter, stage: Stage): InputFrame | null {
  const out = blank();
  const toward = (sign(foe.x - f.x) || f.facing) as 1 | -1, distance = Math.abs(foe.x - f.x);
  const foeDef = defOf(foe);
  // the last act: the one who has taken more stops getting out of the way
  if (curtain(state, f, foe)) return null;
  const early = (hb: Hitbox, smash: boolean) => !killAllowed(state, foe, f) && launches(state, f, { hb, smash }, foe.moveFacing, overBudget(state, f) ? CAREFUL : HOLD);

  const winding = charging(state, foe);
  if (winding && !offStage(state, foe, stage)) {
    const h = foe.move ? hitOf(foe, foe.move) : null;
    const deadly = h && early(h.hb, h.smash);
    if (winding.left <= 10 && !deadly) {
      // nearly there: step into it
      if (f.grounded && distance > 70) out.x = toward * 60;
      return out;
    }
    // give it room: keep a little out of its reach and do something of its own meanwhile
    const room = Math.max(160, (reachOf(foe)[foe.move!]?.maxX ?? 120) + 90);
    if (f.grounded && distance < room) { out.x = -toward * 100; if (nearWall(state, f, stage, -toward as 1 | -1)) out.b = pulse(state, f.slot, B.JUMP); return out; }
    return null;
  }

  // the opponent winding up its biggest hit, too early for it to land: shield it from the start, and watch it go off
  if (foe.action === "attack" && foe.move === showOf(foeDef).big.id) {
    const h = hitOf(foe, foe.move);
    if (h && early(h.hb, h.smash)) return guard(state, f);
  }

  if (attackThreatens(foe, f, SK) && foe.move) {
    const mv = showMove(foeDef, foe.move);
    const big = isShowpiece(foeDef, foe, foe.move) || (mv?.power ?? 0) >= 13;
    const h = hitOf(foe, foe.move);
    if (h && early(h.hb, h.smash)) return guard(state, f);
    if (big && !overBudget(state, f)) { if (f.grounded && distance > 60) out.x = toward * 40; return out; }
    // the small stuff: shielded more the further behind it is
    const odds = lead(f, foe) < -25 || overBudget(state, f) ? 35 : lead(f, foe) > 25 ? 6 : 18;
    if (f.grounded && hash(state, f, 0xdefe, 14) % 100 < odds) return guard(state, f);
    return null;
  }

  const shot = incomingShot(state, f, SK);
  if (shot) {
    const big = shot.p.hb.damage >= 12 || shot.p.hb.damage >= showOf(foeDef).big.power * 0.8;
    if (early(shot.p.hb, false)) return shotAnswer(state, f, SK) ?? guard(state, f);
    if (big && !overBudget(state, f)) return null;
    if (overBudget(state, f) || hash(state, f, 0x5407 + shot.p.id * 0x9e37, 1 << 20) % 100 < 30) return shotAnswer(state, f, SK);
  }
  return null;
}

function guard(state: State, f: Fighter): InputFrame | null {
  if (!f.grounded || f.shield <= 15) return null;
  const out = blank();
  out.b = B.SHIELD;
  return out;
}

function nearWall(state: State, f: Fighter, stage: Stage, dir: 1 | -1): boolean {
  const main = mainBounds(state, stage, f.x, f.y);
  return dir < 0 ? f.x < main.x1 + 140 : f.x > main.x2 - 140;
}

function committedInput(state: State, f: Fighter, foe: Fighter | null, stage: Stage): InputFrame | null {
  const out = blank();
  if (f.action === "smashCharge") {
    // charge to its goal, then a little longer for the opponent to walk in
    const near = foe && moveNearReach(f, foe, f.move!, f.facing, 10);
    if (f.charge < chargeGoal(state, f) || (foe && !near && f.charge < chargeGoal(state, f) + 20)) out.b = B.ATTACK;
    return out;
  }
  if (f.action === "shield") {
    if (foe && (attackThreatens(foe, f, SK) || (incomingShot(state, f, SK)?.t ?? 99) < 14) && f.shield > 10) out.b = B.SHIELD;
    return out;
  }
  if (f.action === "grabHold") {
    if (f.frame <= 3) return out;
    const dir = hash(state, f, 0x7a20, 1 << 30) % 4;
    if (dir === 0) out.x = f.facing * 100; else if (dir === 1) out.x = -f.facing * 100; else out.y = dir === 2 ? -100 : 100;
    out.b = pulse(state, f.slot, B.SPECIAL);
    return out;
  }
  if (f.action === "jumpSquat") {
    if (foe) out.x = sign(foe.x - f.x) * 80;
    return out;
  }
  if (f.action === "attack") {
    if (offStage(state, f, stage)) return recoveryInput(state, f, SK, stage);
    const move = currentMove(f);
    if (!move) return out;
    const p = profile(f), probe = p.specials[f.move as SpecialId];
    const plan = p.plans.find((x) => x.move === f.move);
    const inFace = foe && Math.abs(foe.x - f.x) < 90;
    if (plan || probe?.held) {
      // a stream (a machine gun, a flamethrower) is let go sooner than a charge
      const hold = plan ? plan.hold : justFired(state, f, 12) ? Math.min(45, holdGoal(state, f)) : holdGoal(state, f);
      if (f.move === "uspecial") { out.b = B.SPECIAL; out.y = -100; }
      else if (probe && Math.abs(probe.groundDx) > 100 && !plan) {
        // a flight: keep going while the target is still ahead and it stays over the stage
        if (foe && sign(foe.x - f.x) === f.moveFacing && Math.abs(foe.x - f.x) > 40 && landsOnStage(state, f, stage, 60)) out.b = B.SPECIAL;
      } else if (sinceStarted(state, f) < hold && !inFace) {
        out.b = B.SPECIAL;
        if (f.move === "sspecial") out.x = f.moveFacing * 100;
        else if (f.move === "dspecial") out.y = 100;
      }
      if (foe && !f.grounded) out.x = sign(foe.x - f.x) * 45;
      return out;
    }
    if (move.next && f.hitsThisMove > 0 && f.frame >= (move.nextFrom ?? 1)) out.b = pulse(state, f.slot, B.ATTACK);
    if (!f.grounded && foe) out.x = sign(foe.x - f.x) * 55;
    return out;
  }
  if (!isActionable(f)) return blank();
  return null;
}

/** Whether `m` makes sense to throw now at all. */
function usable(state: State, f: Fighter, foe: Fighter, stage: Stage, m: ShowMove): boolean {
  if (spammed(f, m.id)) return false;
  const mv = defOf(f).moves[m.id];
  if (m.kind === "special") {
    if (mv.helpless || mv.counter) return false;
    const probe = profile(f).specials[m.id as SpecialId];
    if (!landsOnStage(state, f, stage, f.grounded ? probe.groundDx : probe.airDx)) return false;
    if (profile(f).plans.some((x) => x.move === m.id) && !killAllowed(state, f, foe)) return false;
  }
  if (m.inert && Math.abs(foe.x - f.x) < 220) return false;
  // a full meter's payoff is the finish: it waits for the fight to be allowed to end
  if (fullMeter(defOf(f), f)?.payoff === m.id && !killAllowed(state, f, foe)) return false;
  return true;
}

/**
 * Its setlist for the match, in an order of its own: three showpieces (its specials and smashes, each twice, and its
 * biggest hit once more) for every one of the rest of its moveset.
 */
function setlist(state: State, f: Fighter): ShowMove[] {
  const show = showOf(defOf(f));
  const isBig = (m: ShowMove) => m.kind === "special" || m.kind === "smash";
  const big = show.moves.filter(isBig).flatMap((m) => [m, m]);
  big.push(show.big);
  if (!isBig(show.big)) big.push(show.big);
  const rest = show.moves.filter((m) => !isBig(m) && m !== show.big);
  shuffle(state, f, big, 1);
  shuffle(state, f, rest, 2);
  const list: ShowMove[] = [];
  for (let i = 0, j = 0; i < big.length || j < rest.length;) {
    if (i < big.length) list.push(big[i++]);
    if (i < big.length) list.push(big[i++]);
    if (i < big.length) list.push(big[i++]);
    if (j < rest.length) list.push(rest[j++]);
  }
  return list;
}

function shuffle<T>(state: State, f: Fighter, xs: T[], salt: number): void {
  for (let i = xs.length - 1; i > 0; i--) {
    let h = Math.imul(state.seed ^ Math.imul(f.slot + 1, 0x27d4eb2d) ^ Math.imul(i + 1, 0x165667b1) ^ Math.imul(salt, 0x2c1b3c6d), 0x9e3779b1);
    h = (h ^ (h >>> 15)) >>> 0;
    const j = h % (i + 1);
    [xs[i], xs[j]] = [xs[j], xs[i]];
  }
}

/**
 * What it is going for: the next move on its setlist it can throw (never the one it just threw), held until it throws
 * something or gives up on it for the one after. A full meter calls for its payoff; once the fight may end, now and
 * then the move that would end it, and late in the fight mostly that.
 */
function intentOf(state: State, f: Fighter, foe: Fighter, stage: Stage): ShowMove {
  const def = defOf(f), list = setlist(state, f);
  const meter = fullMeter(def, f);
  const stale = Math.floor(sinceStarted(state, f) / 180);
  const allowed = killAllowed(state, f, foe);
  const fits = (m: ShowMove) => m.id !== f.streakMove && usable(state, f, foe, stage, m) && !holdsBack(state, f, foe, m);
  if (meter?.payoff && allowed) {
    const payoff = list.find((m) => m.id === meter.payoff)!;
    if (usable(state, f, foe, stage, payoff)) return payoff;
  }
  const from = f.moveInstance + stale;
  // its biggest hit is best seen while it can land without ending the fight: early, at low damage
  const big = showOf(def).big;
  if (!allowed && fits(big) && hash(state, f, 0xb16, 1 << 30) % 100 < 30) return big;
  const odds = foe.percent > 150 ? 100 : state.frame >= FINALE ? 75 : 30;
  if (allowed && hash(state, f, 0xf1a1, 1 << 30) % 100 < odds) {
    // the finish: its biggest hit if that would do it, else whatever would
    if (fits(big) && kills(state, f, foe, big.id)) return big;
    for (let i = 0; i < list.length; i++) { const m = list[(from + i) % list.length]; if (fits(m) && kills(state, f, foe, m.id)) return m; }
  }
  for (let i = 0; i < list.length; i++) { const m = list[(from + i) % list.length]; if (fits(m)) return m; }
  // nothing fresh it can throw safely: anything it can throw at all
  const any = list.find((m) => usable(state, f, foe, stage, m));
  if (!any) throw new Error(`showman: ${def.id} has nothing it can throw`);
  return any;
}

/** Whether the intended move would connect if started now, and which way it has to face. */
function inRange(state: State, f: Fighter, foe: Fighter, m: ShowMove, facing: 1 | -1, slack: number): boolean {
  const p = profile(f);
  if (m.inert) return true;
  if (p.hits[m.id] && shotAt(p, m.id, f, foe, facing)) return true;
  if (m.kind === "special") {
    // a shot is worth throwing down the opponent's line even if the study says it would just miss: it flies on screen
    const probe = p.specials[m.id as SpecialId], distance = Math.abs(foe.x - f.x);
    if (probe.shotRange && distance > 80 && distance < probe.shotRange + 40 && Math.abs(foe.y - f.y) < 90) return true;
    return moveCanReach(f, foe, m.id, facing, slack + 14);
  }
  return moveCanReach(f, foe, m.id, facing, slack);
}

/** Going for the finish: only another finisher will stand in for the intended move. */
function finishing(state: State, f: Fighter, foe: Fighter, intent: ShowMove): boolean {
  return killAllowed(state, f, foe) && kills(state, f, foe, intent.id);
}

/** What can stand in for what: any showpiece for a showpiece, a tilt or jab for either. */
const FAMILY: Record<string, string> = { special: "show", smash: "show", aerial: "aerial", tilt: "tilt", jab: "tilt", dash: "dash" };

/**
 * The intended move if it connects from here, or else another of its family that does (a shot for a smash while the
 * opponent is out of reach); in the air, only what can be thrown there. Its biggest hit is only stood in for by moves
 * of its own kind: that is the one to land.
 */
function fitted(state: State, f: Fighter, foe: Fighter, stage: Stage, intent: ShowMove, facing: 1 | -1, air = false): ShowMove | null {
  const throwable = (m: ShowMove) => !air || m.kind === "special" || m.kind === "aerial";
  if (throwable(intent) && inRange(state, f, foe, intent, facing, 8)) return intent;
  const list = setlist(state, f), big = intent === showOf(defOf(f)).big;
  const finish = finishing(state, f, foe, intent);
  for (let i = 0; i < list.length; i++) {
    const m = list[(f.moveInstance + i) % list.length];
    const kin = big ? m.kind === intent.kind : FAMILY[m.kind] === FAMILY[intent.kind];
    if (m === intent || m.id === f.streakMove || !kin || !throwable(m) || !usable(state, f, foe, stage, m) || (finish && !kills(state, f, foe, m.id))) continue;
    if (inRange(state, f, foe, m, facing, 8) && !holdsBack(state, f, foe, m)) return m;
  }
  return null;
}

function press(state: State, f: Fighter, m: ShowMove, facing: 1 | -1): InputFrame {
  switch (m.kind) {
    case "smash": return startSmash(state, f, m.id as Smash, facing);
    case "aerial": return startAerial(state, f, m.id as Aerial);
    case "special": {
      if (m.id !== "sspecial" && f.facing !== facing && f.grounded) { const out = blank(); out.x = facing * 30; return out; }
      return startSpecial(state, f, m.id as SpecialId, facing);
    }
    case "dash": { const out = blank(); out.x = facing * 100; if (f.action === "dash" || f.action === "run") out.b = pulse(state, f.slot, B.ATTACK); return out; }
    default: return startTilt(state, f, m.id as Tilt, facing);
  }
}

/** Something that reaches the opponent right now while it is reeling (an aerial if airborne): a follow-up, the intended move first. */
function followUp(state: State, f: Fighter, foe: Fighter, stage: Stage, intent: ShowMove, facing: 1 | -1): ShowMove | null {
  if ((foe.action !== "hitstun" && foe.action !== "tumble") || overBudget(state, foe)) return null;
  const air = !f.grounded;
  const finish = finishing(state, f, foe, intent);
  const fits = (m: ShowMove) => (m.kind === "aerial") === air && m.kind !== "dash" && usable(state, f, foe, stage, m) && inRange(state, f, foe, m, facing, 6) &&
    !holdsBack(state, f, foe, m) && (!finish || kills(state, f, foe, m.id));
  if (fits(intent)) return intent;
  const list = setlist(state, f);
  for (let i = 0; i < list.length; i++) { const m = list[(f.moveInstance + i) % list.length]; if (m.id !== f.streakMove && fits(m)) return m; }
  return null;
}

function groundInput(state: State, f: Fighter, foe: Fighter, stage: Stage): InputFrame {
  const out = blank();
  const dx = foe.x - f.x, dy = foe.y - f.y, distance = Math.abs(dx), facing = (dx >= 0 ? 1 : -1) as 1 | -1;

  // the opponent is getting back to the stage: wait for it a little way in from the edge, not on it
  if (offStage(state, foe, stage) || foe.ledge >= 0) {
    const main = mainBounds(state, stage, foe.x, foe.y);
    const side = foe.x < (main.x1 + main.x2) / 2 ? -1 : 1;
    const spot = (side < 0 ? main.x1 : main.x2) - side * 230;
    if (Math.abs(spot - f.x) > 30) { out.x = sign(spot - f.x) * 60; return out; }
    // and strike a pose meanwhile: a smash charged up for its return, a stance, a power-up
    const intent = intentOf(state, f, foe, stage);
    if ((intent.kind === "smash" || intent.inert) && hash(state, f, 0x40c, 30) % 3 === 0) return press(state, f, intent, side as 1 | -1);
    if (hash(state, f, 0x40b, 20) % 4 === 0) out.b = pulse(state, f.slot, B.JUMP);
    return out;
  }

  const intent = intentOf(state, f, foe, stage);
  const combo = followUp(state, f, foe, stage, intent, facing);
  if (combo) return press(state, f, combo, facing);

  const nav = navInput(state, f, foe, stage);
  if (nav) return nav;

  if (intent.kind === "aerial") {
    if (distance < 160 && Math.abs(dy) < 260) {
      out.x = facing * 70;
      out.b = dy < -60 || hash(state, f, 0x4a1, 1 << 30) % 2 ? B.JUMP : pulse(state, f.slot, B.JUMP);
      return out;
    }
    out.x = facing * 100;
    return out;
  }

  // it presses, unless it is well ahead (and has thrown something lately) or the opponent has taken too much too soon
  const quiet = sinceStarted(state, f);
  const tempo = overBudget(state, foe) ? 20 : lead(f, foe) > 35 && quiet < 150 ? 55 : 100;
  const now = fitted(state, f, foe, stage, intent, facing);
  if (now) {
    // an attack pressed on the run comes out as the dash attack: let go of the stick and stop first
    if ((f.action === "dash" || f.action === "run") && (now.kind === "tilt" || now.kind === "jab" || now.kind === "smash")) return out;
    if (hash(state, f, 0x7e3, 6) % 100 < tempo) return press(state, f, now, facing);
    return out;
  }
  if (intent.kind === "dash") {
    out.x = facing * 100;
    if (distance < 170) out.b = pulse(state, f.slot, B.ATTACK);
    return out;
  }
  // a long way off: a shot on the way in
  if (distance > 260 && hash(state, f, 0x5407, 20) % 2 === 0) {
    const shot = showOf(defOf(f)).moves.find((m) => m.kind === "special" && m.shoots && m.id !== f.streakMove && usable(state, f, foe, stage, m) &&
      !holdsBack(state, f, foe, m) && !finishing(state, f, foe, intent) && inRange(state, f, foe, m, facing, 8));
    if (shot) return press(state, f, shot, facing);
  }
  // closing in on its range: run when far, walk the last stretch, back up if it is too close for it
  const reach = reachOf(f)[intent.id];
  const want = intent.kind === "special" && profile(f).hits[intent.id] ? 260 : Math.max(50, reach.maxX);
  if (distance > want) {
    out.x = facing * (distance > want + 40 ? 100 : 55);
    if (dy < -90 && distance < 200) out.b = pulse(state, f.slot, B.JUMP);
  } else if (distance < Math.max(30, reach.minX)) out.x = -facing * 60;
  else if (dy < -60) { out.x = facing * 60; out.b = pulse(state, f.slot, B.JUMP); }
  return out;
}

function airInput(state: State, f: Fighter, foe: Fighter, stage: Stage): InputFrame {
  const out = blank();
  const dx = foe.x - f.x, dy = foe.y - f.y;
  const toward = (sign(dx) || f.facing) as 1 | -1;
  const main = mainBounds(state, stage, f.x, f.y);
  // drift at the opponent, never off the stage after it
  out.x = toward * (Math.abs(dx) > 45 ? 80 : 30);
  if ((f.x < main.x1 + 30 && out.x < 0) || (f.x > main.x2 - 30 && out.x > 0)) out.x = sign((main.x1 + main.x2) / 2 - f.x) * 60;

  const intent = intentOf(state, f, foe, stage);
  const facing = f.facing;
  const combo = followUp(state, f, foe, stage, intent, facing);
  if (combo) return startAerial(state, f, combo.id as Aerial);
  if (intent.kind === "special" || intent.kind === "aerial") {
    const now = fitted(state, f, foe, stage, intent, intent.id === "sspecial" ? toward : facing, true);
    if (now?.kind === "special") return startSpecial(state, f, now.id as SpecialId, toward);
    if (now?.kind === "aerial") return startAerial(state, f, now.id as Aerial);
  }
  // falling, and what it wants to throw is thrown from the ground: get down there
  const overStage = f.x > main.x1 + 20 && f.x < main.x2 - 20;
  if (f.vy > 0 && overStage && (intent.kind !== "aerial" || (dy > 40 && Math.abs(dx) < 120))) out.y = 100;
  return out;
}
