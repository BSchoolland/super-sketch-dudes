import { C } from "./config";
import { cosDeg, sinDeg } from "./fixed";
import { defOf, grabLedge, hitWall, land, setAction } from "./fighter";
import { fx } from "./fx";
import type { InputFrame } from "./input";
import { STICK_RUN } from "./input";
import type { Fighter, Platform, Stage, State } from "./types";

export function platformOffset(state: State, i: number): { dx: number; dy: number } {
  return state.platOffsets[i] ?? { dx: 0, dy: 0 };
}

/** Where a platform's motion has carried it on `frame`, relative to its rest position. */
export function platformMotion(p: Platform, frame: number): { dx: number; dy: number } {
  const m = p.motion;
  if (!m) return { dx: 0, dy: 0 };
  const a = ((frame + m.phase) * 360) / m.period;
  if (m.kind === "orbit") return { dx: m.cx + cosDeg(a) * m.rx - (p.x1 + p.x2) / 2, dy: m.cy + sinDeg(a) * m.ry - p.y };
  const s = (1 - cosDeg(a)) / 2;
  return { dx: m.dx * s + 0, dy: m.dy * s + 0 };
}

export function updatePlatforms(state: State, stage: Stage): void {
  for (let i = 0; i < stage.platforms.length; i++) {
    const p = stage.platforms[i];
    const prev = state.platOffsets[i] ?? { dx: 0, dy: 0 };
    const { dx, dy } = platformMotion(p, state.frame);
    state.platOffsets[i] = { dx, dy };
    // carry riders
    for (const f of state.fighters) if (f.grounded && f.platform === i) { f.x += dx - prev.dx; f.y += dy - prev.dy; }
  }
}

function platTop(state: State, stage: Stage, i: number): { x1: number; x2: number; y: number; p: Platform } {
  const p = stage.platforms[i];
  const o = platformOffset(state, i);
  return { x1: p.x1 + o.dx, x2: p.x2 + o.dx, y: p.y + o.dy, p };
}

const FALL_THROUGH_ACTIONS = new Set(["air", "helpless", "tumble", "hitstun", "attack", "airDodge", "thrown", "shieldBreak", "wallTech", "respawn"]);

export function stepPhysics(state: State, f: Fighter, input: InputFrame, stage: Stage): void {
  if (f.action === "dead" || f.hitlag > 0) return;
  if (f.action === "respawn") { f.x = stage.respawn.x; f.y = stage.respawn.y; f.vx = 0; f.vy = 0; return; }
  if (f.ledge >= 0) return;
  if (f.action === "grabbed" || f.action === "thrown") return;
  const def = defOf(f);
  const s = def.stats;
  const halfW = s.width * 0.5;

  const px = f.x, py = f.y;
  f.x += f.vx;
  if (f.grounded) f.y = platTop(state, stage, f.platform).y;
  else f.y += f.vy;

  // walls: a body beside a solid block (feet below its top, head above its bottom) is pushed clear of it.
  // Flying into it, or walking into it, is a wall hit; coming down beside it is just a push.
  for (let i = 0; i < stage.platforms.length; i++) {
    if (f.grounded && i === f.platform) continue;
    const t = platTop(state, stage, i);
    if (!t.p.solid) continue;
    const bottom = t.p.bottom! + platformOffset(state, i).dy;
    if (f.y <= t.y + 1 || f.y - s.height >= bottom) continue;
    const overlaps = f.x + halfW > t.x1 && f.x - halfW < t.x2;
    const crossed = (px < t.x1 && f.x > t.x2) || (px > t.x2 && f.x < t.x1);
    if (!overlaps && !crossed) continue;
    const inside = f.x >= t.x1 && f.x <= t.x2, wasInside = px >= t.x1 && px <= t.x2;
    // under the block (a ceiling matter), or feet came from above its top (a landing): not a wall
    if ((inside || crossed) && (wasInside || py <= t.y + 0.01)) continue;
    const fromLeft = inside || crossed ? px < t.x1 : f.x < t.x1;
    const flew = fromLeft ? px + halfW <= t.x1 + 0.5 : px - halfW >= t.x2 - 0.5;
    f.x = fromLeft ? t.x1 - halfW : t.x2 + halfW;
    if (flew || f.grounded) hitWall(state, f, def, fromLeft ? 1 : -1, input);
  }

  if (f.grounded) {
    const t = platTop(state, stage, f.platform);
    if (f.x < t.x1 - 2 || f.x > t.x2 + 2) {
      // a top at the same height under the new spot is the same ground (a seam between blocks)
      for (let i = 0; i < stage.platforms.length; i++) {
        if (i === f.platform) continue;
        const n = platTop(state, stage, i);
        if (Math.abs(n.y - t.y) <= 1 && f.x >= n.x1 && f.x <= n.x2) { f.platform = i; f.y = n.y; return; }
      }
      // walk off the edge
      const keep = f.action === "attack" || f.action === "hitstun" || f.action === "roll" || f.action === "techRoll" || f.action === "getupRoll" || f.action === "ledgeRoll";
      if (f.action === "dash" || f.action === "run" || f.action === "walk" || f.action === "idle" || f.action === "skid" || f.action === "runTurn") {
        // idle-ish states teeter instead of falling unless moving
        if (f.action !== "run" && f.action !== "dash" && Math.abs(f.vx) < 1.5) { f.x = f.x < t.x1 ? t.x1 : t.x2; f.vx = 0; return; }
      }
      if (keep && (f.action === "roll" || f.action === "techRoll" || f.action === "getupRoll" || f.action === "ledgeRoll")) { f.x = f.x < t.x1 ? t.x1 : t.x2; f.vx = 0; return; }
      f.grounded = false;
      f.platform = -1;
      f.jumpsLeft = s.jumps - 1;
      if (!keep) setAction(f, "air");
      if (f.action === "hitstun") setAction(f, "air");
    }
    return;
  }

  // ceilings
  for (let i = 0; i < stage.platforms.length; i++) {
    const t = platTop(state, stage, i);
    if (!t.p.solid) continue;
    const bottom = t.p.bottom! + platformOffset(state, i).dy;
    if (f.vy < 0 && f.x > t.x1 && f.x < t.x2 && py - s.height >= bottom && f.y - s.height < bottom) { f.y = bottom + s.height; f.vy = 0; }
  }
  // landing
  if (f.vy >= 0) {
    let best = -1, bestY = Infinity;
    for (let i = 0; i < stage.platforms.length; i++) {
      const t = platTop(state, stage, i);
      if (f.x < t.x1 || f.x > t.x2) continue;
      if (!t.p.solid && (f.dropTimer > 0 || (input.y >= STICK_RUN && (f.action === "air" || f.action === "helpless") && f.flickY > 0 && f.flickT > 0))) continue;
      if (py <= t.y + 0.01 && f.y >= t.y && t.y < bestY) { best = i; bestY = t.y; }
    }
    if (best >= 0 && (FALL_THROUGH_ACTIONS.has(f.action) || f.action === "air")) {
      f.y = bestY;
      f.x = Math.max(platTop(state, stage, best).x1, Math.min(platTop(state, stage, best).x2, f.x));
      if (f.action === "hitstun" && f.pending === null && f.hitstun > 0 && f.vy > 3) { f.vy = 0; }
      if (f.action === "tumble" && f.frame < f.hitstun && f.techWindow === 0 && f.vy > C.GROUND_BOUNCE_SPEED) {
        state.events.push({ t: "land", frame: state.frame, slot: f.slot, x: f.x, y: f.y, hard: true });
        fx(state, f, "shake", f.x, f.y, 0, undefined, Math.min(1, f.vy / 30));
        f.vy = -f.vy * C.GROUND_BOUNCE;
        f.vx *= 0.8;
        return;
      }
      land(state, f, best);
      return;
    }
  }
  // ledges
  if (f.ledgeCooldown === 0 && f.vy > -2.5) {
    const ok = f.action === "air" || f.action === "helpless" || (f.action === "airDodge" && f.frame > 20) || (f.action === "tumble" && f.frame >= f.hitstun) || (f.action === "attack" && (defOf(f).moves[f.move!]?.ledgeOk ?? false));
    if (ok) {
      for (let i = 0; i < stage.ledges.length; i++) {
        const L = stage.ledges[i];
        const o = platformOffset(state, L.platform);
        const lx = L.x + o.dx, ly = L.y + o.dy;
        // the fighter must be outside the stage on the ledge's side
        const outside = L.side === -1 ? f.x <= lx + 6 && f.x >= lx - 48 : f.x >= lx - 6 && f.x <= lx + 48;
        const handsY = f.y - s.height * 0.75;
        const inY = handsY >= ly - s.ledgeReach && handsY <= ly + s.height * 0.6;
        if (!outside || !inY) continue;
        // ledge trump
        for (const other of state.fighters) {
          if (other !== f && other.ledge === i) {
            other.ledge = -1;
            other.ledgeCooldown = C.LEDGE_COOLDOWN;
            setAction(other, "air");
            other.vx = L.side * 2;
            other.vy = -3;
            other.invuln = Math.max(other.invuln, 12);
          }
        }
        grabLedge(state, f, i, stage);
        return;
      }
    }
  }
}

export function stepProjectiles(state: State, stage: Stage): void {
  for (const p of state.projectiles) {
    if (p.dead) continue;
    p.age++;
    if (p.data.g) p.vy += p.data.g;
    if (p.data.homing && state.fighters.length) {
      // turn toward the nearest opponent, rate in degrees per frame; uses only arithmetic
      let best: Fighter | null = null, bd = Infinity;
      for (const f of state.fighters) {
        if (f.slot === p.owner || f.action === "dead" || f.action === "respawn") continue;
        if (state.rules.teams && f.team === state.fighters[p.owner].team) continue;
        const dx = f.x - p.x, dy = f.y - 60 - p.y;
        const d = dx * dx + dy * dy;
        if (d < bd) { bd = d; best = f; }
      }
      if (best && p.age < (p.data.homeFrames ?? 60)) {
        const dx = best.x - p.x, dy = best.y - 60 - p.y;
        const dl = Math.sqrt(dx * dx + dy * dy) || 1;
        const sp = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
        const k = p.data.homing;
        let vx = p.vx + (dx / dl) * sp * k, vy = p.vy + (dy / dl) * sp * k;
        const nl = Math.sqrt(vx * vx + vy * vy) || 1;
        p.vx = (vx / nl) * sp; p.vy = (vy / nl) * sp;
        p.facing = (p.vx >= 0 ? 1 : -1) as 1 | -1;
      }
    }
    p.x += p.vx;
    p.y += p.vy;
    if (p.data.bounce) {
      for (let i = 0; i < stage.platforms.length; i++) {
        const t = platTop(state, stage, i);
        if (p.x >= t.x1 && p.x <= t.x2 && p.y >= t.y && p.y - p.vy < t.y && p.vy > 0) {
          p.y = t.y; p.vy = -p.vy * 0.55; p.vx *= 0.8; p.data.bounces = (p.data.bounces ?? 0) + 1;
          if (p.data.bounces > p.data.bounce) p.dead = true;
        }
      }
    } else {
      for (let i = 0; i < stage.platforms.length; i++) {
        const t = platTop(state, stage, i);
        if (!t.p.solid) continue;
        const bottom = t.p.bottom! + platformOffset(state, i).dy;
        if (p.x >= t.x1 && p.x <= t.x2 && p.y >= t.y && p.y <= bottom) p.dead = true;
      }
    }
    if (p.age >= p.life) p.dead = true;
    const b = stage.blast;
    if (p.x < b.left || p.x > b.right || p.y < b.top || p.y > b.bottom) p.dead = true;
  }
  state.projectiles = state.projectiles.filter((p) => !p.dead);
}
