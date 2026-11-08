import type { BrushKit, HitView, Pt } from "./brush";

interface Look { color?: string; ink?: string; core?: string; hatch?: boolean; alpha?: number }
/** When a stroke shows: it sweeps in over `lead` frames before `s`, holds until `e`, and fades over `lag` after. */
interface Timing { lead?: number; lag?: number }
interface SweepOpts extends Look, Timing {
  /** Thickness of the stroke at its widest. */
  width?: number;
  /** How much of the path stays drawn behind the head, 0..1 (1: all of it). */
  len?: number;
}

/**
 * Ready-made strokes on top of the brush: the common ways a hit is drawn, already timed to the hitbox (arrive as
 * it comes out, hold while it's live, thin away after). Use them, mix them, or write your own from the brush.
 * Colours default to the fighter's marker (as the ink) over a pale tint of it.
 */
export interface Strokes {
  ease(t: number): number;
  dist(a: Pt, b: Pt): number;
  /** The angle from p to q, in the kit's degrees (0 forward, 90 up). */
  angle(p: Pt, q: Pt): number;
  /** Hitbox i's ends: `near` (x, y) and `far` (x2, y2; the same as near for a circle). */
  ends(i: number): { near: Pt; far: Pt; h: HitView };
  /** A blade's crescent swept along `path(deg, off)` (a point at angle deg, `off` units outward) from angle a to b, timed to frames [s, e]. */
  sweep(path: (deg: number, off: number) => Pt, a: number, b: number, s: number, e: number, o?: SweepOpts): void;
  /** sweep on a circle of radius r round pivot. */
  swing(pivot: Pt, r: number, a: number, b: number, s: number, e: number, o?: SweepOpts): void;
  /** sweep on an oval round (cx, cy) in fighter space: a level swing seen from the side (270 is the near side, 90 the far). */
  level(cx: number, cy: number, rx: number, ry: number, a: number, b: number, s: number, e: number, o?: SweepOpts): void;
  /** A cut through hitbox i: an arc round pivot ending at the hitbox's far end, `arc` degrees long (+ comes down from above, - up from below), timed to the hitbox. */
  cut(i: number, pivot: Pt, arc: number, o?: SweepOpts): void;
  /** A thrust along hitbox i (from `from`, default its near end): shoots out to a point, holds, pulls back in. Speed lines behind it. */
  thrust(i: number, o?: SweepOpts & { from?: Pt }): void;
  /** The point landing: a flash and a pop of dashes at hitbox i's far end as it comes out. */
  pop(i: number, o?: Look & { n?: number; dist?: number; len?: number; frames?: number }): void;
  /** A jagged bolt of lightning from a to b that re-forks every other frame. */
  bolt(a: Pt, b: Pt, o?: Look & { width?: number; amp?: number; forks?: boolean; seed?: number }): void;
  /** Short crackling arcs round c. */
  crackle(c: Pt, r: number, o?: Look & { n?: number; deg?: number }): void;
  /** An electric strike along hitbox i (from `from`, default its near end): bolts reach out as it comes out, crackle while live, flicker out. */
  zap(i: number, o?: Look & Timing & { from?: Pt; width?: number; amp?: number; strands?: number }): void;
  /** Fire pouring from tip back to tail: flickering tongues with a hot core. */
  flame(tail: Pt, tip: Pt, width: number, o?: { alpha?: number; seed?: number; color?: string; ink?: string; core?: string }): void;
  /** Spinning rings round c stacked `height` tall; the far half of each passes behind the fighter. */
  whirl(c: Pt, rx: number, height: number, o?: Look & { rings?: number; spin?: number; width?: number }): void;
  /** A shockwave out from c as t goes 0 to 1: a ring growing to r and dashes flying. */
  burst(c: Pt, r: number, t: number, o?: Look & { n?: number; width?: number; seed?: number }): void;
  /** Dust puffs along the floor between fighter-space x0 and x1, from frame s. */
  dust(x0: number, x1: number, s: number, o?: { n?: number; alpha?: number }): void;
}

const ease = (t: number) => 1 - (1 - t) * (1 - t);
const bump = (t: number) => Math.sin(Math.PI * Math.max(0, Math.min(1, t)));
const dist = (a: Pt, b: Pt) => Math.hypot(b[0] - a[0], b[1] - a[1]);
const unit = (a: Pt, b: Pt): Pt => { const l = dist(a, b) || 1; return [(b[0] - a[0]) / l, (b[1] - a[1]) / l]; };

/** `color` lightened toward white by k (0..1). */
function tint(color: string, k: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(color);
  if (!m) return "#ffffff";
  const n = parseInt(m[1], 16), mix = (c: number) => Math.round(c + (255 - c) * k);
  return `rgb(${mix(n >> 16)}, ${mix((n >> 8) & 255)}, ${mix(n & 255)})`;
}

export function strokes(g: BrushKit): Strokes {
  const pale = tint(g.color, 0.78);
  const fill = (o: Look) => o.color ?? pale, inkOf = (o: Look) => o.ink ?? g.color;
  const angle = (p: Pt, q: Pt) => Math.atan2(-(q[1] - p[1]), (q[0] - p[0]) * g.facing) * 180 / Math.PI;
  const ends = (i: number) => { const h = g.hit(i); return { near: [h.x1, h.y1] as Pt, far: [h.x2, h.y2] as Pt, h }; };

  const s: Strokes = {
    ease, dist, angle, ends,
    sweep(path, a, b, s0, e, o = {}) {
      const w = o.width ?? 26, lag = o.lag ?? 8, lead = o.lead ?? 4;
      const head = ease(g.span(s0 - lead, s0)), fade = g.span(e, e + lag);
      if (head <= 0 || fade >= 1) return;
      const tail = Math.max(head - (o.len ?? 1), fade * 0.6);
      const ha = a + (b - a) * head, ta = a + (b - a) * tail;
      const along = (from: number, to: number, off: number, n: number) => { const pts: Pt[] = []; for (let k = 0; k <= n; k++) pts.push(path(from + (to - from) * k / n, off)); return pts; };
      const thin = (1 - fade) * (1 - fade);
      g.ribbon(along(ta, ha, -w * 0.35, 30), { width: (t) => w * thin * bump(t * Math.sqrt(t)), color: fill(o), ink: inkOf(o), hatch: o.hatch, core: o.core ?? "#ffffff", alpha: (o.alpha ?? 1) * (1 - fade) });
      const span = ha - ta;
      for (const k of [-1, 1]) g.line(along(ta + span * 0.3, ha - span * 0.1, -w * 0.35 + k * w * 0.8, 18), { color: inkOf(o), width: 1.6, alpha: (o.alpha ?? 1) * 0.8 * thin });
    },
    swing(pivot, r, a, b, s0, e, o) { s.sweep((deg, off) => g.toward(pivot, deg, r + off), a, b, s0, e, o); },
    level(cx, cy, rx, ry, a, b, s0, e, o) {
      const rad = Math.PI / 180;
      s.sweep((deg, off) => g.at(cx + Math.cos(deg * rad) * (rx + off), cy - Math.sin(deg * rad) * (ry + off * ry / rx)), a, b, s0, e, o);
    },
    cut(i, pivot, arc, o = {}) {
      const { far, h } = ends(i), end = angle(pivot, far), r = dist(pivot, far) + h.r * 0.6;
      s.swing(pivot, r, end + arc, end - 12 * Math.sign(arc), h.frames[0], h.frames[1], { width: h.r * 1.5, ...o });
    },
    thrust(i, o = {}) {
      const { near, far, h } = ends(i), [s0, e] = h.frames, lag = o.lag ?? 6, lead = o.lead ?? 2;
      if (g.frame < s0 - lead) return;
      const fade = g.span(e, e + lag);
      if (fade >= 1) return;
      const a = o.from ?? near, d = unit(a, far), n: Pt = [-d[1], d[0]], len = dist(a, far) || 1;
      const tip: Pt = [far[0] + d[0] * h.r * 0.9, far[1] + d[1] * h.r * 0.9];
      const head = g.lerp(a, tip, ease(g.span(s0 - lead, s0))), base = g.lerp(a, head, fade);
      const pts: Pt[] = []; for (let k = 0; k <= 8; k++) pts.push(g.lerp(base, head, k / 8));
      const w = o.width ?? h.r * 1.1;
      g.ribbon(pts, { width: (t) => w * (1 - fade * 0.6) * (t < 0.8 ? 0.35 + t * 0.8 : (1 - t) * 5), color: fill(o), ink: inkOf(o), core: o.core ?? "#ffffff", hatch: o.hatch, alpha: o.alpha });
      for (const k of [-2, -1, 1, 2]) {
        const off = k * w * 0.42, back = len * (0.25 + g.noise(k * 7 + s0) * 0.35);
        const p0: Pt = [base[0] + n[0] * off - d[0] * back, base[1] + n[1] * off - d[1] * back];
        g.line([p0, g.lerp(p0, [head[0] + n[0] * off * 0.6, head[1] + n[1] * off * 0.6], 0.55)], { color: inkOf(o), width: 1.5, alpha: (o.alpha ?? 1) * 0.75 * (1 - fade) });
      }
    },
    pop(i, o = {}) {
      const { far, h } = ends(i), s0 = h.frames[0];
      g.flecks(far, { t: g.span(s0, s0 + (o.frames ?? 10)), n: o.n ?? 9, dist: o.dist ?? 46, len: o.len ?? 16, color: inkOf(o), width: 2.4, seed: s0 * 13, alpha: o.alpha });
      if (g.frame >= s0 && g.frame <= s0 + 2) g.blob(far, h.r * (0.6 + 0.25 * (g.frame - s0)), { color: o.color ?? "#ffffff", ink: inkOf(o), alpha: 0.9 * (o.alpha ?? 1) });
    },
    bolt(a, b, o = {}) {
      const len = dist(a, b) || 1, d = unit(a, b), n: Pt = [-d[1], d[0]];
      const segs = Math.max(3, Math.round(len / 18)), amp = o.amp ?? 10, tick = Math.floor(g.frame / 2), seed = o.seed ?? 0;
      const pts: Pt[] = [];
      for (let k = 0; k <= segs; k++) {
        const off = k === 0 || k === segs ? 0 : (g.noise(seed + k * 17 + tick * 31) - 0.5) * 2 * amp, p = g.lerp(a, b, k / segs);
        pts.push([p[0] + n[0] * off, p[1] + n[1] * off]);
      }
      g.ribbon(pts, { width: o.width ?? 7, color: fill(o), ink: inkOf(o), core: o.core ?? "#ffffff", alpha: o.alpha });
      if (o.forks) for (let k = 1; k < segs; k += 2) {
        const p = pts[k], dir = g.noise(seed + k * 7 + tick) > 0.5 ? 1 : -1, l = amp * (1.2 + g.noise(seed + k * 3 + tick * 5));
        const q: Pt = [p[0] + (d[0] * 0.6 + n[0] * dir) * l, p[1] + (d[1] * 0.6 + n[1] * dir) * l];
        g.line([p, g.lerp(p, q, 0.5), q], { color: inkOf(o), width: 1.8, alpha: (o.alpha ?? 1) * 0.85 });
      }
    },
    crackle(c, r, o = {}) {
      const n = o.n ?? 5, tick = Math.floor(g.frame / 2);
      for (let k = 0; k < n; k++) {
        const a = (o.deg ?? 0) + k * (360 / n) + g.noise(k * 13 + tick * 7) * 50;
        g.line([g.toward(c, a, r * 0.6), g.toward(c, a + 14, r * 0.85), g.toward(c, a - 10, r * 1.05), g.toward(c, a + 6, r * 1.3)], { color: inkOf(o), width: 2.2, alpha: o.alpha });
      }
    },
    zap(i, o = {}) {
      const { near, far, h } = ends(i), [s0, e] = h.frames, lead = o.lead ?? 2, lag = o.lag ?? 6;
      const grow = ease(g.span(s0 - lead, s0)), fade = g.span(e, e + lag);
      if (grow <= 0 || fade >= 1) return;
      const a = o.from ?? near, d = unit(a, far), b: Pt = [far[0] + d[0] * h.r * 0.7, far[1] + d[1] * h.r * 0.7], tip = g.lerp(a, b, grow);
      const alpha = (o.alpha ?? 1) * (1 - fade), strands = o.strands ?? 2;
      for (let k = 0; k < strands; k++) s.bolt(a, tip, { ...o, width: (o.width ?? h.r * 0.5) * (k ? 0.55 : 1) * (1 - fade * 0.5), amp: o.amp ?? h.r * 0.6, seed: k * 101 + s0, alpha, forks: !k });
      s.crackle(tip, h.r * (0.9 + 0.4 * fade), { ...o, alpha });
      if (g.frame >= s0 && g.frame <= s0 + 2) g.blob(tip, h.r * (0.7 + 0.2 * (g.frame - s0)), { color: "#ffffff", ink: inkOf(o), alpha: 0.9 * alpha });
    },
    flame(tail, tip, w, o = {}) {
      const d = unit(tail, tip), n: Pt = [-d[1], d[0]], seed = o.seed ?? 11, alpha = o.alpha ?? 1;
      const tongue = (k: number, scale: number, color: string, ink: string) => {
        const pts: Pt[] = [], wob = w * 0.5 * scale, start = 0.12 * k;
        for (let j = 0; j <= 12; j++) {
          const t = start + (1 - start) * j / 12;
          const side = (g.noise(seed + k * 71 + j * 13 + g.frame * 29) - 0.5) * wob * (1 - t) * 2 + (k - 1.5) * w * 0.18 * (1 - t);
          const p = g.lerp(tail, tip, t);
          pts.push([p[0] + n[0] * side, p[1] + n[1] * side]);
        }
        g.ribbon(pts, { width: (t) => w * scale * Math.sqrt(t) * (t > 0.85 ? (1 - t) / 0.15 : 1), color, ink, alpha });
      };
      for (let k = 0; k < 4; k++) tongue(k, 0.55 - k * 0.06, o.color ?? "#ff8a2a", o.ink ?? "#c93a1c");
      tongue(1, 0.42, "#ffb43a", o.color ?? "#ff8a2a");
      tongue(2, 0.26, o.core ?? "#fff2a8", "#ffb43a");
    },
    whirl(c, rx, height, o = {}) {
      const rings = o.rings ?? 4, alpha = o.alpha ?? 1, rad = Math.PI / 180;
      for (let k = 0; k < rings; k++) {
        const y = c[1] - height / 2 + height * k / Math.max(1, rings - 1), r = rx * (0.75 + 0.35 * k / rings);
        const a0 = g.frame * (o.spin ?? 38) + k * 83;
        const at = (a: number): Pt => [c[0] + Math.cos(a * rad) * r, y + Math.sin(a * rad) * r * 0.28];
        let run: Pt[] = [], far = Math.sin(a0 * rad) < 0;
        const flush = () => {
          if (run.length < 2) return;
          const pts = run, behind = far;
          const mark = () => g.ribbon(pts, { width: (t) => (o.width ?? 12) * bump(t), color: fill(o), ink: inkOf(o), alpha: alpha * (behind ? 0.7 : 1) });
          if (behind) g.under(mark); else mark();
        };
        for (let j = 0; j <= 20; j++) {
          const a = a0 + j * 11, side = Math.sin(a * rad) < 0;
          if (side !== far) { run.push(at(a)); flush(); run = [at(a)]; far = side; } else run.push(at(a));
        }
        flush();
      }
    },
    burst(c, r, t, o = {}) {
      if (t <= 0 || t >= 1) return;
      g.ribbon(g.arc(c, r * (0.55 + 0.45 * ease(t)), 0, 360, 36), { width: (o.width ?? 16) * (1 - t), color: fill(o), ink: inkOf(o), alpha: (o.alpha ?? 1) * (1 - t) });
      g.flecks(c, { t, n: o.n ?? 12, dist: r * 1.35, len: 22, color: inkOf(o), seed: o.seed ?? 5, alpha: o.alpha });
    },
    dust(x0, x1, s0, o = {}) {
      const t = g.span(s0, s0 + 16), n = o.n ?? 4;
      if (t <= 0 || t >= 1) return;
      for (let k = 0; k < n; k++) g.blob(g.at(x0 + (x1 - x0) * k / Math.max(1, n - 1), -6 - t * 8), 5 + t * 9 + g.noise(k * 5) * 4, { color: "#efe9dc", ink: "#b3ab9a", alpha: (o.alpha ?? 0.6) * (1 - t), seed: k * 31 + s0 });
    },
  };
  return s;
}
