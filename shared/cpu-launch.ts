// Where a hit would send someone, for the showman CPU: the launch the sim would give it (hits.ts), flown forward with
// the sim's own launch decay, gravity and fall speed (fighter.ts), until it is spent. Ignores DI and drifting, and
// counts only the side and top blast lines: a fighter knocked below the stage is one that can still recover.
import { C } from "./config";
import { cosDeg, sinDeg } from "./fixed";
import { defOf } from "./fighter";
import { knockback } from "./hits";
import { stageOf } from "./sim";
import type { Fighter, Hitbox, State } from "./types";

const FLIGHT_FRAMES = 300;

/**
 * Whether `hb`, landing on `target` now from an attacker facing `facing` (damage times `mul`, a smash's charge), would
 * carry it past `margin` of the way to a blast line.
 */
export function launchKills(state: State, target: Fighter, hb: Hitbox, facing: 1 | -1, mul: number, margin: number): boolean {
  const def = defOf(target), stage = stageOf(state);
  const k = stage.gravity ?? 1, gravity = def.stats.gravity * k, fall = def.stats.fallSpeed * Math.sqrt(k);
  const damage = hb.damage * mul;
  const kb = knockback(target.percent + damage, damage, def.stats.weight, hb.growth, hb.base);
  const speed = kb * C.KB_TO_VEL;
  let vx = cosDeg(hb.angle) * facing * speed, vy = -sinDeg(hb.angle) * speed;
  const left = (target.x - stage.blast.left) * margin, right = (stage.blast.right - target.x) * margin;
  const up = (target.y - def.stats.height - stage.blast.top) * margin;
  let dx = 0, dy = 0;
  for (let i = 0; i < FLIGHT_FRAMES; i++) {
    if (vy > fall) vy = Math.max(fall, vy + gravity - C.SPIKE_DECAY);
    else vy = Math.min(fall, vy + gravity);
    vx = vx > 0 ? Math.max(0, vx - C.LAUNCH_DECAY) : Math.min(0, vx + C.LAUNCH_DECAY);
    dx += vx; dy += vy;
    if (dx > right || -dx > left || -dy > up) return true;
    // spent: falling at its own pace with nothing left sideways, it can get back
    if (vx === 0 && vy >= fall) return false;
  }
  return false;
}
