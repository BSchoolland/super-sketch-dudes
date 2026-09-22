import { C } from "./config";
import { cosDeg, sinDeg, atan2Deg } from "./fixed";
import { currentMove, defOf, setAction, shieldBreak } from "./fighter";
import type { Fighter, Hitbox, Projectile, State } from "./types";

export interface Capsule { x1: number; y1: number; x2: number; y2: number; r: number }

export function hitboxWorld(f: Fighter, hb: Hitbox): Capsule {
  const fx = f.moveFacing;
  const x1 = f.x + hb.x * fx, y1 = f.y + hb.y;
  const x2 = hb.x2 === undefined ? x1 : f.x + hb.x2 * fx;
  const y2 = hb.y2 === undefined ? y1 : f.y + hb.y2;
  return { x1, y1, x2, y2, r: hb.r };
}

export function hurtbox(f: Fighter): Capsule {
  const s = defOf(f).stats;
  const crouched = f.action === "crouch" || f.action === "knockdown" || f.action === "spotDodge";
  const h = crouched ? s.crouchHeight : s.height;
  const r = s.width / 2;
  return { x1: f.x, y1: f.y - r, x2: f.x, y2: f.y - h + r, r };
}

export function shieldCircle(f: Fighter): { x: number; y: number; r: number } {
  const s = defOf(f).stats;
  return { x: f.x, y: f.y - s.height * 0.5, r: 18 + (s.height * 0.5) * (f.shield / C.SHIELD_MAX) };
}

function segDist2(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number): number {
  // squared distance between segments AB and CD (sampled: exact for point-segment, good enough for short capsules)
  const pts = [[cx, cy], [dx, dy], [(cx + dx) / 2, (cy + dy) / 2]];
  let best = Infinity;
  for (const [px, py] of pts) best = Math.min(best, pointSeg2(px, py, ax, ay, bx, by));
  const pts2 = [[ax, ay], [bx, by], [(ax + bx) / 2, (ay + by) / 2]];
  for (const [px, py] of pts2) best = Math.min(best, pointSeg2(px, py, cx, cy, dx, dy));
  return best;
}
function pointSeg2(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const abx = bx - ax, aby = by - ay;
  const l2 = abx * abx + aby * aby;
  let t = l2 === 0 ? 0 : ((px - ax) * abx + (py - ay) * aby) / l2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const qx = ax + abx * t - px, qy = ay + aby * t - py;
  return qx * qx + qy * qy;
}
export function capsulesOverlap(a: Capsule, b: Capsule): boolean {
  const r = a.r + b.r;
  return segDist2(a.x1, a.y1, a.x2, a.y2, b.x1, b.y1, b.x2, b.y2) <= r * r;
}
export function capsuleCircle(a: Capsule, x: number, y: number, r: number): boolean {
  const rr = a.r + r;
  return pointSeg2(x, y, a.x1, a.y1, a.x2, a.y2) <= rr * rr;
}

export function knockback(percentAfter: number, damage: number, weight: number, growth: number, base: number): number {
  return ((percentAfter / 10 + (percentAfter * damage) / 20) * (200 / (weight + 100)) * 1.4 + 18) * (growth / 100) + base;
}

function canBeHit(v: Fighter): boolean {
  return v.action !== "dead" && v.action !== "respawn" && v.invuln === 0 && v.stocks > 0;
}
function sameTeam(state: State, a: Fighter, b: Fighter): boolean {
  return state.rules.teams && a.team === b.team;
}

/** Resolve one hit of `hb` from attacker `a` on victim `v` at contact point (px, py). */
export function hitOf(state: State, a: Fighter, v: Fighter, hb: Hitbox, px: number, py: number, isThrow = false): void {
  const vdef = defOf(v);
  const adef = defOf(a);
  const amv = currentMove(a);
  let damage = hb.damage * state.rules.damageRatio;
  if (a.action === "attack" && amv?.smash) damage *= a.chargeMul;
  if (amv?.counterStrike) damage = Math.max(damage, a.counterDmg);
  damage = Math.round(damage * 10) / 10;

  // counters
  const vmv = currentMove(v);
  if (!isThrow && vmv?.counter && v.action === "attack" && v.frame >= vmv.counter.frames[0] && v.frame <= vmv.counter.frames[1] && !hb.grab) {
    v.counterDmg = Math.max(vmv.counter.min, damage * vmv.counter.mul);
    v.facing = (a.x >= v.x ? 1 : -1) as 1 | -1;
    v.moveFacing = v.facing;
    a.hitlag = Math.max(a.hitlag, 12);
    v.hitlag = Math.max(v.hitlag, 8);
    v.action = "attack"; v.frame = 0; v.move = vmv.counter.move; v.moveInstance++; v.hitsThisMove = 0;
    state.events.push({ t: "parry", frame: state.frame, slot: v.slot, x: v.x, y: v.y - 60 });
    state.events.push({ t: "move", frame: state.frame, slot: v.slot, move: vmv.counter.move, x: v.x, y: v.y });
    return;
  }

  // armour
  const armour = vmv?.armour && v.action === "attack" && v.frame >= vmv.armour.frames[0] && v.frame <= vmv.armour.frames[1] ? vmv.armour.threshold : 0;
  const armoured = !isThrow && !hb.grab && damage < armour;

  if (hb.wind) {
    const ang = hb.angle;
    v.vx += cosDeg(ang) * a.moveFacing * hb.base * 0.05;
    v.vy -= sinDeg(ang) * hb.base * 0.05;
    if (v.grounded && v.vy < -0.5) { v.grounded = false; v.platform = -1; }
    return;
  }

  const hitlag = Math.min(C.HITLAG_MAX, Math.floor((damage * C.HITLAG_PER_DMG + C.HITLAG_BASE) * (hb.hitlagMul ?? 1) * (hb.electric ? 1.5 : 1)));
  v.percent = Math.min(999, Math.round((v.percent + damage) * 10) / 10);
  v.lastDamage = damage;
  v.lastHitBy = a.slot;
  v.lastHitFrame = state.frame;
  a.dealt += damage;
  a.hitsThisMove++;
  if (!isThrow) a.hitlag = Math.max(a.hitlag, hitlag);

  const kb = armoured ? 0 : knockback(v.percent, damage, vdef.stats.weight, hb.growth, hb.base);
  let angle = hb.angle;
  if (hb.radial) angle = atan2Deg(-(py - (a.y - adef.stats.height / 2)), (px - a.x) * a.moveFacing);
  const dirx = cosDeg(angle) * a.moveFacing;
  const diry = -sinDeg(angle);
  const speed = kb * C.KB_TO_VEL;
  state.events.push({ t: "hit", frame: state.frame, attacker: a.slot, victim: v.slot, damage, kb, x: px, y: py, fx: hb.fx ?? (damage >= 14 ? "heavy" : "hit"), angle, facing: a.moveFacing });
  adef.onHit?.({ state, f: a, input: state.inputs[a.slot], prev: state.inputs[a.slot] }, v, hb);
  vdef.onHurt?.({ state, f: v, input: state.inputs[v.slot], prev: state.inputs[v.slot] }, a, damage);

  if (armoured) { v.hitlag = Math.max(v.hitlag, Math.floor(hitlag * 0.5)); return; }

  // grabbed victims break free when someone else hits them
  if (v.grabbedBy >= 0 && v.grabbedBy !== a.slot) {
    const g = state.fighters[v.grabbedBy];
    if (g) { g.grabbing = -1; setAction(g, "idle"); }
    v.grabbedBy = -1;
  }
  if (v.action === "grabHold" && v.grabbing >= 0) {
    const held = state.fighters[v.grabbing];
    if (held) { held.grabbedBy = -1; setAction(held, held.grounded ? "idle" : "air"); }
    v.grabbing = -1;
  }
  if (v.ledge >= 0) { v.ledge = -1; v.ledgeCooldown = C.LEDGE_COOLDOWN; }
  v.hitlag = Math.max(v.hitlag, isThrow ? 0 : hitlag);
  v.pending = { vx: dirx * speed, vy: diry * speed, angle, kb, hitstun: Math.floor(kb * C.HITSTUN_MUL), attacker: a.slot };
  v.hitstun = 0;
  v.shieldHeld = false;
  v.action = kb >= C.TUMBLE_KB ? "tumble" : "hitstun";
  v.frame = 0;
  v.move = null;
  v.charge = 0;
  if (v.hitlag === 0) {
    // throws apply immediately
    v.vx = v.pending.vx; v.vy = v.pending.vy; v.hitstun = v.pending.hitstun; v.pending = null;
    if (v.vy < -0.8 || kb >= C.TUMBLE_KB) { v.grounded = false; v.platform = -1; }
  }
}

function shieldHit(state: State, a: Fighter, v: Fighter, hb: Hitbox, px: number, py: number): void {
  let damage = hb.damage * state.rules.damageRatio;
  const amv = currentMove(a);
  if (amv?.smash) damage *= a.chargeMul;
  if (v.shieldFrames <= C.PARRY_WINDOW) {
    // parry
    setAction(v, "parry");
    v.shieldHeld = false;
    a.hitlag = Math.max(a.hitlag, 14);
    state.events.push({ t: "parry", frame: state.frame, slot: v.slot, x: px, y: py });
    return;
  }
  v.shield -= damage * C.SHIELD_HIT_MUL;
  const stun = Math.floor(damage * 0.8 + 2);
  const lag = Math.min(C.HITLAG_MAX, Math.floor(damage * 0.5 + 3));
  a.hitlag = Math.max(a.hitlag, lag);
  v.hitlag = Math.max(v.hitlag, lag);
  state.events.push({ t: "shieldHit", frame: state.frame, victim: v.slot, x: px, y: py, damage });
  if (v.shield <= 0) { shieldBreak(state, v); return; }
  v.action = "shieldStun";
  v.frame = 0;
  v.hitstun = stun;
  v.vx = (v.x >= a.x ? 1 : -1) * Math.min(8, damage * 0.45);
  a.vx += (a.x >= v.x ? 1 : -1) * Math.min(3, damage * 0.15);
}

function grabHit(state: State, a: Fighter, v: Fighter, hb: Hitbox): void {
  if (v.grabbedBy >= 0 || v.action === "grabHold") return;
  const command = hb.unblockable === true;
  if (!v.grounded && !command) return;
  const adef = defOf(a);
  a.grabbing = v.slot;
  v.grabbedBy = a.slot;
  v.grounded = a.grounded;
  v.platform = a.platform;
  v.vx = 0; v.vy = 0;
  v.action = "grabbed"; v.frame = 0; v.move = null; v.hitstun = 0; v.pending = null;
  v.shieldHeld = false;
  if (v.ledge >= 0) { v.ledge = -1; v.ledgeCooldown = C.LEDGE_COOLDOWN; }
  a.grabTimer = Math.max(C.GRAB_TIMER_MIN, C.GRAB_TIMER_BASE - Math.floor(v.percent * 0.4));
  if (!command) { setAction(a, "grabHold"); a.frame = 0; }
  state.events.push({ t: "grab", frame: state.frame, attacker: a.slot, victim: v.slot, x: v.x, y: v.y - adef.stats.height * 0.5 });
}

function tryHit(state: State, a: Fighter, v: Fighter, hb: Hitbox, cap: Capsule, key: string, log: Record<string, number>, rehit: number | undefined): boolean {
  const last = log[key];
  if (last !== undefined && (rehit === undefined || state.frame - last < rehit)) return false;
  const hurt = hurtbox(v);
  const px = (cap.x1 + cap.x2) / 2 * 0.5 + v.x * 0.5;
  const py = (cap.y1 + cap.y2) / 2 * 0.5 + (v.y - defOf(v).stats.height * 0.5) * 0.5;
  if (hb.grab) {
    if (!capsulesOverlap(cap, hurt)) return false;
    log[key] = state.frame;
    grabHit(state, a, v, hb);
    return true;
  }
  if (v.shieldHeld && !hb.unblockable) {
    const sc = shieldCircle(v);
    if (capsuleCircle(cap, sc.x, sc.y, sc.r)) {
      log[key] = state.frame;
      shieldHit(state, a, v, hb, px, py);
      return true;
    }
  }
  if (!capsulesOverlap(cap, hurt)) return false;
  log[key] = state.frame;
  hitOf(state, a, v, hb, px, py);
  return true;
}

export function resolveHits(state: State): void {
  const fs = state.fighters;
  for (const a of fs) {
    if (a.action !== "attack" || a.hitlag > 0) continue;
    const mv = currentMove(a);
    if (!mv) continue;
    // active hitboxes this frame, sorted by priority
    const active: Hitbox[] = [];
    for (const hb of mv.hitboxes) if (a.frame >= hb.frames[0] && a.frame <= hb.frames[1]) active.push(hb);
    if (!active.length) continue;
    active.sort((p, q) => (p.priority ?? 1) - (q.priority ?? 1));
    for (const v of fs) {
      if (v === a || !canBeHit(v) || sameTeam(state, a, v)) continue;
      if (v.hitlag > 0 && v.pending) continue;
      for (const hb of active) {
        const key = `${a.slot}:${a.moveInstance}:${hb.group ?? 0}`;
        const cap = hitboxWorld(a, hb);
        if (tryHit(state, a, v, hb, cap, key, v.hitLog, hb.rehit)) break;
      }
    }
    // reflectors, and hittable projectiles (debris chunks) that any attack can launch
    for (const p of state.projectiles) {
      if (p.dead) continue;
      const canReflect = mv.reflect && p.owner !== a.slot;
      const canHit = p.data.hittable && !(p.hitLog[`h${a.slot}:${a.moveInstance}`]);
      if (!canReflect && !canHit) continue;
      for (const hb of active) {
        if (hb.grab) continue;
        const cap = hitboxWorld(a, hb);
        if (!capsuleCircle(cap, p.x, p.y, p.hb.r)) continue;
        if (canReflect) {
          p.owner = a.slot;
          p.vx = -p.vx * 1.2;
          p.facing = (-p.facing) as 1 | -1;
          p.reflected++;
          p.hitLog = {};
          p.hb = { ...p.hb, damage: p.hb.damage * 1.3 };
          state.events.push({ t: "parry", frame: state.frame, slot: a.slot, x: p.x, y: p.y });
        } else {
          const speed = 6 + hb.damage * 0.7;
          p.owner = a.slot;
          p.facing = a.moveFacing;
          p.vx = cosDeg(hb.angle) * a.moveFacing * speed;
          p.vy = -sinDeg(hb.angle) * speed;
          p.hitLog = { [`h${a.slot}:${a.moveInstance}`]: state.frame };
          p.hb = { ...p.hb, damage: Math.max(p.hb.damage, 9), base: 40, growth: 70 };
          p.data.bounces = 0;
          p.age = Math.min(p.age, p.life - 90);
          a.hitlag = Math.max(a.hitlag, 4);
          state.events.push({ t: "hit", frame: state.frame, attacker: a.slot, victim: -1, damage: 4, kb: 0, x: p.x, y: p.y, fx: "heavy", angle: hb.angle, facing: a.moveFacing });
        }
        break;
      }
    }
  }
  // reflector projectiles (the crescent wave) turn other projectiles around
  for (const p of state.projectiles) {
    if (p.dead || !p.data.reflector) continue;
    for (const q of state.projectiles) {
      if (q === p || q.dead || q.owner === p.owner || q.data.reflector) continue;
      const dx = q.x - p.x, dy = q.y - p.y;
      if (dx * dx + dy * dy > (p.hb.r + q.hb.r) * (p.hb.r + q.hb.r)) continue;
      q.owner = p.owner; q.vx = -q.vx * 1.2; q.facing = (-q.facing) as 1 | -1; q.reflected++; q.hitLog = {};
      state.events.push({ t: "parry", frame: state.frame, slot: p.owner, x: q.x, y: q.y });
    }
  }
  // projectiles
  for (const p of state.projectiles) {
    if (p.dead) continue;
    const owner = fs[p.owner];
    const cap: Capsule = { x1: p.x, y1: p.y, x2: p.x, y2: p.y, r: p.hb.r };
    for (const v of fs) {
      if (v.slot === p.owner || !canBeHit(v) || sameTeam(state, owner, v)) continue;
      if (v.hitlag > 0 && v.pending) continue;
      const key = `p${p.id}:${p.hb.group ?? 0}`;
      const saveFacing = owner.moveFacing;
      const saveX = owner.x, saveY = owner.y;
      // hits come from the projectile's position and direction, not the owner's
      owner.moveFacing = p.facing;
      owner.x = p.x; owner.y = p.y;
      const hit = tryHit(state, owner, v, p.hb, cap, key, p.hitLog, p.hb.rehit);
      owner.moveFacing = saveFacing; owner.x = saveX; owner.y = saveY;
      if (hit) {
        owner.hitlag = 0; // projectiles don't freeze their owner
        if (!p.hb.rehit) p.dead = true;
        break;
      }
    }
  }
}

export function spawnProjectile(state: State, owner: Fighter, kind: string, x: number, y: number, vx: number, vy: number, life: number, hb: Hitbox, data: Record<string, number> = {}): Projectile {
  const p: Projectile = { id: state.nextProjectile++, owner: owner.slot, kind, x, y, vx, vy, life, age: 0, hb, hitLog: {}, facing: owner.moveFacing, data, reflected: 0, dead: false };
  state.projectiles.push(p);
  state.events.push({ t: "projectile", frame: state.frame, slot: owner.slot, kind, x, y });
  return p;
}
