import { B, EMPTY_INPUT, type InputFrame } from "./input";
import { defOf } from "./fighter";
import { stageOf } from "./sim";
import type { Fighter, State } from "./types";

/**
 * A placeholder brawler bot: approaches, attacks in range, recovers when off stage.
 * Pure function of the state so every client computes the same CPU inputs. `level` 1..9.
 */
export function cpuInput(state: State, slot: number, level: number): InputFrame {
  const f = state.fighters[slot];
  if (!f || f.action === "dead") return { ...EMPTY_INPUT };
  const stage = stageOf(state);
  const main = stage.platforms[0];
  let h = (state.frame * 374761393 + slot * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  const noise = ((h ^ (h >>> 16)) >>> 0) % 100;
  const think = level >= 7 ? 2 : level >= 4 ? 4 : 8;
  if (state.frame % think !== 0 && f.action !== "tumble" && f.action !== "hitstun" && f.grounded) return prevOr(state, slot);

  let target: Fighter | null = null, bd = Infinity;
  for (const o of state.fighters) {
    if (o.slot === slot || o.stocks <= 0 || o.action === "dead" || o.action === "respawn") continue;
    if (state.rules.teams && o.team === f.team) continue;
    const d = Math.abs(o.x - f.x) + Math.abs(o.y - f.y) * 0.5;
    if (d < bd) { bd = d; target = o; }
  }
  const inp: InputFrame = { x: 0, y: 0, cx: 0, cy: 0, b: 0 };
  const s = defOf(f).stats;
  const offStage = f.x < main.x1 - 10 || f.x > main.x2 + 10;

  if (f.ledge >= 0) {
    if (noise < 50) inp.x = f.x < 0 ? 100 : -100; else inp.b |= B.JUMP;
    return inp;
  }
  if (offStage || (!f.grounded && f.y > 80)) {
    // recover: drift toward the stage, jump, then up special
    inp.x = f.x < 0 ? 100 : -100;
    if (f.action === "air" || f.action === "tumble") {
      if (f.jumpsLeft > 0 && f.vy > 2) inp.b |= B.JUMP;
      else if (f.jumpsLeft === 0 && !f.usedUpSpecial && f.vy > 0) { inp.b |= B.SPECIAL; inp.y = -100; }
    }
    return inp;
  }
  if (!target) return inp;
  const dx = target.x - f.x, dy = target.y - f.y;
  const adx = Math.abs(dx);
  const dir = dx > 0 ? 100 : -100;
  const reach = 60 + level * 8;
  const inRange = adx < reach + 40 && Math.abs(dy) < 90;
  const grabRange = adx < 75;
  const shieldChance = level * 4;

  if (f.grounded) {
    if (target.action === "attack" && adx < 200 && noise < shieldChance) { inp.b |= B.SHIELD; return inp; }
    if (inRange) {
      const r = noise % 10;
      if (r < 3) { inp.b |= B.ATTACK; inp.x = dir * 0.5; }
      else if (r < 5) { inp.b |= B.ATTACK; }
      else if (r < 6 && target.percent > 80) { inp.b |= B.SMASH | B.ATTACK; inp.x = dir; }
      else if (r < 7 && grabRange) { inp.b |= B.GRAB; }
      else if (r < 7) { inp.x = dir; }
      else if (r < 8 && dy < -60) { inp.b |= B.ATTACK; inp.y = -100; }
      else if (r < 9) { inp.b |= B.SPECIAL; }
      else { inp.x = -dir; }
      if (dy < -60 && noise < 40) { inp.b |= B.JUMP; }
    } else {
      inp.x = dir;
      if (adx < 260 && noise < 10 + level * 2) inp.b |= B.JUMP;
      if (target.y < f.y - 100 && adx < 200 && noise < 30) inp.b |= B.JUMP;
    }
  } else {
    inp.x = adx > 40 ? dir : 0;
    if (inRange && noise < 40 + level * 5) { inp.b |= B.ATTACK; if (dy > 40) inp.y = 100; }
    if (f.vy > 0 && f.y < -10 && target.y >= f.y - 20 && noise < 30 + level * 4) inp.y = 100;
  }
  void s;
  return inp;
}

function prevOr(state: State, slot: number): InputFrame {
  const p = state.inputs[slot];
  return { x: p.x, y: p.y, cx: 0, cy: 0, b: p.b & ~(B.JUMP | B.SPECIAL | B.GRAB) };
}
