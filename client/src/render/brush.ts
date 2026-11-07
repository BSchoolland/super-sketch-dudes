import type { Fighter, FighterDef, Move, Projectile } from "../../../shared/types";
import { hitboxWorld } from "../../../shared/hits";
import { hatch, inkPath, INK, PAPER, noise } from "./paper";
import { cellImages } from "./sprite";

export type Pt = [number, number];

/** Where a fighter's cell was drawn on one sim frame: `m` maps cell-local units (origin at the feet) to world. */
export interface Placed {
  m: DOMMatrix;
  url: string;
  px: number;
  u: number;
  feet: number;
  move: string | null;
  frame: number;
}

interface MarkOpts { color?: string; alpha?: number }
interface FillOpts extends MarkOpts { ink?: string; hatch?: boolean }

/**
 * What a fighter's `draws.<name>(g)` gets, every frame of a move whose `draw` names it, and every frame of a
 * projectile whose `kind` names it (frame = its age; hit(0) is the projectile; at() measures from it). Everything is in world
 * units and world space; angles are degrees the way hitboxes take them (0 forward, 90 up), already
 * mirrored for facing. Marks boil (redraw their wobble) every few frames, like hand-drawn animation.
 */
export interface DrawKit {
  frame: number;
  total: number;
  facing: 1 | -1;
  /** The fighter's (or the projectile's) velocity, world units per frame. */
  vx: number;
  vy: number;
  /** The fighter's bars (charge, ammo), read-only. */
  bars: Readonly<Record<string, number>>;
  /** The fighter's marker colour, outline ink, and the paper. */
  color: string;
  ink: string;
  paper: string;
  /** 0 up to frame a, 1 from frame b, linear between. */
  span(a: number, b: number): number;
  /** Hitbox i of this move in world space, and whether it is live this frame. */
  hit(i: number): HitView;
  /** Fighter space (+x forward, +y down, origin at the feet) to world. */
  at(x: number, y: number): Pt;
  /** A pixel of the cell on screen to world, through the pose's stretch, tilt and bounce. */
  pose(px: number, py: number): Pt;
  /** Points on a circle round c from angle a to angle b. */
  arc(c: Pt, r: number, a: number, b: number, n?: number): Pt[];
  toward(p: Pt, deg: number, d: number): Pt;
  lerp(a: Pt, b: Pt, t: number): Pt;
  noise(n: number): number;
  /** A wobbly ink line through the points. */
  line(pts: Pt[], o?: MarkOpts & { width?: number }): void;
  /** A filled, outlined stroke along the points; `width` may be a function of 0..1 along it. `core` draws a thin line of that colour down the middle. */
  ribbon(pts: Pt[], o: FillOpts & { width: number | ((s: number) => number); core?: string }): void;
  /** A lumpy filled shape round c. */
  blob(c: Pt, r: number, o?: FillOpts & { lumpy?: number; seed?: number }): void;
  /** Ink dashes flying out from c as t goes 0 to 1, fading as they go. */
  flecks(c: Pt, o: { t: number; n?: number; dist?: number; deg?: number; spread?: number; len?: number; width?: number; seed?: number } & MarkOpts): void;
  /** Part of a cell of the sheet (crop = [x, y, w, h] in cell pixels, default the whole cell) drawn centred on c, its long side `size` units, turned `deg` (0 = as drawn, facing forward). */
  cell(name: string, c: Pt, o?: { crop?: [number, number, number, number]; size?: number; deg?: number; alpha?: number; flip?: boolean }): void;
  /** Whatever `marks` draws goes under the fighter instead of over it. */
  under(marks: () => void): void;
  /** Pencil echoes of the fighter's last few frames of this move, drawn behind it. */
  smear(o?: { count?: number; alpha?: number }): void;
}

/** What a draw is drawing: a move (frames of the move, its hitboxes) or a projectile (its age, its one hitbox). */
export interface DrawSource {
  label: string;
  frame: number;
  total: number;
  facing: 1 | -1;
  /** Where at() measures from: the fighter's feet, or the projectile. */
  x: number;
  y: number;
  vx: number;
  vy: number;
  bars: Readonly<Record<string, number>>;
  hit(i: number): HitView;
  placed?: Placed;
  /** Earlier frames of this move, for `smear`; empty for a projectile. */
  trail: readonly Placed[];
}
export type HitView = { x1: number; y1: number; x2: number; y2: number; r: number; live: boolean; frames: [number, number] };

export function moveSource(f: Fighter, mv: Move, def: FighterDef, pos: { x: number; y: number }, placed: Placed | undefined, trail: readonly Placed[]): DrawSource {
  return {
    label: `${def.id}.${mv.id}`, frame: f.frame, total: mv.total, facing: f.moveFacing, x: pos.x, y: pos.y, vx: f.vx, vy: f.vy, bars: f.bars,
    hit(i) {
      const hb = mv.hitboxes[i];
      if (!hb) throw new Error(`${def.id}.${mv.id} draw asked for hitbox ${i}; the move has ${mv.hitboxes.length}`);
      return { ...hitboxWorld({ ...f, x: pos.x, y: pos.y }, hb), live: f.frame >= hb.frames[0] && f.frame <= hb.frames[1], frames: hb.frames };
    },
    placed, trail: trail.filter((t) => t.move === f.move && t.frame < f.frame),
  };
}

export function projectileSource(p: Projectile, owner: Fighter, def: FighterDef, x: number, y: number, placed: Placed | undefined): DrawSource {
  return {
    label: `${def.id} projectile ${p.kind}`, frame: p.age, total: p.age + p.life, facing: p.facing, x, y, vx: p.vx, vy: p.vy, bars: owner.bars,
    hit(i) {
      if (i !== 0) throw new Error(`${def.id} projectile ${p.kind} draw asked for hitbox ${i}; a projectile has only hit(0)`);
      return { x1: x, y1: y, x2: x, y2: y, r: p.hb.r, live: p.hb.frames[0] <= p.age && p.age <= p.hb.frames[1], frames: p.hb.frames };
    },
    placed, trail: [],
  };
}

/**
 * Runs one pass of a draw: the back pass (under the fighter) draws `smear` and what's inside `under`; the
 * front pass the rest. A projectile is drawn in one pass ("only"), under every fighter already.
 */
export function runDraw(ctx: CanvasRenderingContext2D, def: FighterDef, name: string, src: DrawSource, pass: "back" | "front" | "only"): void {
  const draw = def.draws?.[name];
  if (!draw) throw new Error(`${src.label} names draw "${name}" which isn't in draws`);
  const { facing, placed, trail } = src;
  const pos = { x: src.x, y: src.y };
  const boil = Math.floor(src.frame / 3) * 101;
  let below = false;
  const live = () => pass === "only" || (pass === "front") !== below;
  const p = def.palette as { colors: Record<string, string>; accent?: string; outline: string };
  const color = (p.accent && p.colors[p.accent]) || Object.values(p.colors)[0] || p.outline || INK;
  const ink = p.outline || INK;
  const rad = (deg: number): Pt => [Math.cos(deg * Math.PI / 180) * facing, -Math.sin(deg * Math.PI / 180)];
  const alphaOf = (a?: number) => ctx.globalAlpha * Math.max(0, Math.min(1, a ?? 1));
  let seq = 0;

  const fill = (poly: Pt[], o: FillOpts, smooth: boolean) => {
    const seed = boil + (seq++) * 977;
    ctx.save();
    ctx.globalAlpha = alphaOf(o.alpha);
    inkPath(ctx, poly, true, seed, false);
    if (smooth) ctx.lineJoin = "round";
    ctx.fillStyle = o.color ?? color; ctx.fill();
    if (o.hatch) {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const [x, y] of poly) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
      ctx.save(); ctx.clip(); ctx.globalAlpha *= 0.55; hatch(ctx, x0, y0, x1 - x0, y1 - y0, o.ink ?? ink); ctx.restore();
      inkPath(ctx, poly, true, seed, false);
    }
    ctx.strokeStyle = o.ink ?? ink; ctx.lineWidth = 2.4; ctx.lineJoin = "round"; ctx.stroke();
    ctx.restore();
  };

  const g: DrawKit = {
    frame: src.frame,
    total: src.total,
    facing,
    vx: src.vx,
    vy: src.vy,
    bars: src.bars,
    color, ink, paper: PAPER,
    span: (a, b) => (b <= a ? (src.frame >= b ? 1 : 0) : Math.max(0, Math.min(1, (src.frame - a) / (b - a)))),
    hit: (i) => src.hit(i),
    at: (x, y) => [pos.x + x * facing, pos.y + y],
    pose(px, py) {
      if (!placed) return [pos.x, pos.y];
      const q = placed.m.transformPoint(new DOMPoint((px - placed.px / 2) * placed.u, (py - placed.feet) * placed.u));
      return [q.x, q.y];
    },
    arc(c, r, a, b, n = 24) {
      const out: Pt[] = [];
      for (let i = 0; i <= n; i++) { const [dx, dy] = rad(a + (b - a) * i / n); out.push([c[0] + dx * r, c[1] + dy * r]); }
      return out;
    },
    toward(pt, deg, d) { const [dx, dy] = rad(deg); return [pt[0] + dx * d, pt[1] + dy * d]; },
    lerp: (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t],
    noise,
    line(pts, o = {}) {
      if (!live() || pts.length < 2) return;
      ctx.save();
      ctx.globalAlpha = alphaOf(o.alpha);
      ctx.strokeStyle = o.color ?? ink; ctx.lineWidth = o.width ?? 2.4; ctx.lineCap = "round"; ctx.lineJoin = "round";
      inkPath(ctx, pts, false, boil + (seq++) * 977, false); ctx.stroke();
      ctx.restore();
    },
    ribbon(pts, o) {
      if (!live() || pts.length < 2) return;
      const lens = [0];
      for (let i = 1; i < pts.length; i++) lens.push(lens[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
      const total = lens[lens.length - 1] || 1;
      const w = typeof o.width === "number" ? (() => o.width as number) : o.width;
      const left: Pt[] = [], right: Pt[] = [];
      for (let i = 0; i < pts.length; i++) {
        const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
        const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
        const nx = -dy / l, ny = dx / l, h = Math.max(0, w(lens[i] / total)) / 2;
        left.push([pts[i][0] + nx * h, pts[i][1] + ny * h]);
        right.push([pts[i][0] - nx * h, pts[i][1] - ny * h]);
      }
      fill([...left, ...right.reverse()], o, true);
      if (o.core) {
        const wmax = Math.max(...pts.map((_, i) => w(lens[i] / total)));
        const inner = pts.filter((_, i) => w(lens[i] / total) > wmax * 0.35);
        if (inner.length > 1) g.line(inner, { color: o.core, width: Math.max(1.5, wmax * 0.16), alpha: o.alpha });
      }
    },
    blob(c, r, o = {}) {
      if (!live()) return;
      const seed = o.seed ?? boil, lumpy = o.lumpy ?? 0.25, pts: Pt[] = [];
      for (let j = 0; j < 14; j++) {
        const a = j * Math.PI * 2 / 14, rr = r * (1 - lumpy / 2 + noise(seed + j * 13) * lumpy);
        pts.push([c[0] + Math.cos(a) * rr, c[1] + Math.sin(a) * rr]);
      }
      fill(pts, o, true);
    },
    flecks(c, o) {
      if (!live() || o.t <= 0 || o.t >= 1) return;
      const n = o.n ?? 7, seed = o.seed ?? 7, dist = o.dist ?? 60, len = o.len ?? 14, spread = o.spread ?? 360;
      const out = 1 - (1 - o.t) * (1 - o.t);
      ctx.save();
      ctx.globalAlpha = alphaOf((o.alpha ?? 1) * (1 - o.t));
      ctx.strokeStyle = o.color ?? ink; ctx.lineWidth = o.width ?? 2.6; ctx.lineCap = "round";
      for (let i = 0; i < n; i++) {
        const deg = (o.deg ?? 0) + (n === 1 ? 0 : (i / (n - 1) - 0.5) * spread) + (noise(seed + i * 31) - 0.5) * 18;
        const d = dist * out * (0.55 + noise(seed + i * 17) * 0.45), l = len * (1 - o.t * 0.7);
        const a = g.toward(c, deg, d), b = g.toward(c, deg, d + l);
        ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
      }
      ctx.restore();
    },
    cell(name, c, o = {}) {
      if (!live()) return;
      const url = def.sprite.cells[name];
      if (!url) throw new Error(`${src.label} draw asked for cell "${name}", which the sheet doesn't have`);
      const img = cellImages(url).base;
      if (!img) return;
      const px = def.sprite.px, [cx, cy, cw, ch] = o.crop ?? [0, 0, px, px];
      const size = o.size ?? Math.max(cw, ch) * def.stats.height / def.sprite.heightPx, k = size / Math.max(cw, ch), q = img.width / px;
      ctx.save();
      ctx.globalAlpha = alphaOf(o.alpha);
      ctx.translate(c[0], c[1]);
      ctx.scale(facing, 1);
      ctx.rotate(-(o.deg ?? 0) * Math.PI / 180);
      if (o.flip) ctx.scale(-1, 1);
      ctx.drawImage(img, cx * q, cy * q, cw * q, ch * q, -cw * k / 2, -ch * k / 2, cw * k, ch * k);
      ctx.restore();
    },
    under(marks) {
      below = true;
      try { marks(); } finally { below = false; }
    },
    smear(o = {}) {
      if (pass !== "back") return;
      const mine = trail.slice(-(o.count ?? 3));
      mine.forEach((t, i) => {
        const img = cellImages(t.url).base;
        if (!img) return;
        ctx.save();
        ctx.globalAlpha = alphaOf((o.alpha ?? 0.3) * (i + 1) / (mine.length + 1));
        ctx.transform(t.m.a, t.m.b, t.m.c, t.m.d, t.m.e, t.m.f);
        ctx.drawImage(img, -t.px / 2 * t.u, -t.feet * t.u, t.px * t.u, t.px * t.u);
        ctx.restore();
      });
    },
  };
  draw(g);
}
