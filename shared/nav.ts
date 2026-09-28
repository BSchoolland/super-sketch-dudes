import type { Fighter, Stage, State } from "./types";
import { defOf } from "./fighter";

/**
 * Where a CPU can stand and how it gets between those places: every platform top is a surface,
 * and two surfaces connect when a jump (or a drop) can cross the gap. Moving platforms count at
 * their best orbit position, so a route can wait for one to come round.
 */
export interface Surface {
  i: number;
  x1: number; x2: number; y: number;
  /** The extent the platform sweeps over its orbit (static: the same as x1/x2/y). */
  xMin: number; xMax: number; yMin: number; yMax: number;
  moving: boolean;
  /** A solid platform sits right above it (the inside of a stack of blocks): nobody stands here. */
  covered: boolean;
}

export function surfaces(state: State, stage: Stage): Surface[] {
  const out: Surface[] = stage.platforms.map((p, i) => {
    const o = state.platOffsets[i] ?? { dx: 0, dy: 0 };
    const m = p.motion;
    const s: Surface = { i, x1: p.x1 + o.dx, x2: p.x2 + o.dx, y: p.y + o.dy, xMin: 0, xMax: 0, yMin: 0, yMax: 0, moving: !!m, covered: false };
    if (m?.kind === "orbit") {
      const cx = m.cx - (p.x1 + p.x2) / 2;
      s.xMin = p.x1 + cx - m.rx; s.xMax = p.x2 + cx + m.rx;
      s.yMin = m.cy - m.ry; s.yMax = m.cy + m.ry;
    } else if (m) {
      s.xMin = p.x1 + Math.min(0, m.dx); s.xMax = p.x2 + Math.max(0, m.dx);
      s.yMin = p.y + Math.min(0, m.dy); s.yMax = p.y + Math.max(0, m.dy);
    } else { s.xMin = s.x1; s.xMax = s.x2; s.yMin = s.y; s.yMax = s.y; }
    return s;
  });
  for (const s of out) {
    for (let j = 0; j < stage.platforms.length; j++) {
      const p = stage.platforms[j];
      if (j === s.i || !p.solid) continue;
      const o = state.platOffsets[j] ?? { dx: 0, dy: 0 };
      const bottom = p.bottom! + o.dy;
      const overlap = Math.min(s.x2, p.x2 + o.dx) - Math.max(s.x1, p.x1 + o.dx);
      if (bottom <= s.y && s.y - bottom < 100 && overlap > (s.x2 - s.x1) * 0.6) { s.covered = true; break; }
    }
  }
  return out;
}

/** The surface a point would land on: the nearest top at or below it that spans its x. */
export function surfaceUnder(surfs: Surface[], x: number, y: number): Surface | null {
  let best: Surface | null = null;
  for (const s of surfs) {
    if (s.covered || x < s.x1 || x > s.x2 || s.y < y - 6) continue;
    if (!best || s.y < best.y) best = s;
  }
  return best;
}

interface Legs { rise: number; reach: number }

/** How high and how far a fighter's jumps carry it. */
export function legs(f: Fighter): Legs {
  const st = defOf(f).stats;
  const rise = (st.fullHop * st.fullHop + Math.max(0, st.jumps - 1) * st.doubleJump * st.doubleJump) / (2 * st.gravity) * 0.9;
  return { rise, reach: st.airSpeed * 70 + 40 };
}

/** Can a fighter standing on `a` get onto `b`? `now` judges moving platforms where they are, else where they will be at best. */
export function canCross(a: Surface, b: Surface, l: Legs, now: boolean): boolean {
  if (b.covered) return false;
  const aTop = now || !a.moving ? a.y : a.yMin, bTop = now || !b.moving ? b.y : b.yMax;
  const ax1 = now || !a.moving ? a.x1 : a.xMin, ax2 = now || !a.moving ? a.x2 : a.xMax;
  const bx1 = now || !b.moving ? b.x1 : b.xMin, bx2 = now || !b.moving ? b.x2 : b.xMax;
  const rise = aTop - bTop;
  if (rise > l.rise) return false;
  const gap = Math.max(0, bx1 - ax2, ax1 - bx2);
  const drop = Math.max(0, -rise);
  return gap <= l.reach + drop * 0.6;
}

/** Breadth-first over surfaces; the path starts at `from` and ends at `to`, or null. */
export function route(surfs: Surface[], from: Surface, to: Surface, l: Legs): Surface[] | null {
  if (from.i === to.i) return [from];
  const prev = new Map<number, number>([[from.i, -1]]);
  const queue = [from];
  for (let q = 0; q < queue.length; q++) {
    const a = queue[q];
    for (const b of surfs) {
      if (prev.has(b.i) || !canCross(a, b, l, false)) continue;
      prev.set(b.i, a.i);
      if (b.i === to.i) {
        const path: Surface[] = [];
        for (let i: number = b.i; i !== -1; i = prev.get(i)!) path.push(surfs[i]);
        return path.reverse();
      }
      queue.push(b);
    }
  }
  return null;
}
