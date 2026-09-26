import type { Fighter, FighterDef, Hitbox, Look, Move } from "../../../shared/types";
import { hitboxWorld } from "../../../shared/hits";
import { defOf, currentMove } from "../../../shared/fighter";
import { inkArc, inkLine, inkPath, INK, PAPER, PENCIL } from "./paper";
import { drawLook, lookOf } from "./looks";

const LINGER = 6;

/** The character's own marker colour, for speed lines and accents. */
function markerOf(def: FighterDef): string {
  const p = def.palette as { colors: Record<string, string>; accent?: string; outline: string };
  return (p.accent && p.colors[p.accent]) || Object.values(p.colors)[0] || p.outline || INK;
}

/**
 * Strikes are drawn the way a cartoonist draws a swing: one tapered swoosh tracing the attacking
 * part's path from the fighter's pivot, a few speed lines behind it, in the character's own ink.
 * The drawing itself shows the sword or the fist; this only says "it moved, fast".
 */
export function drawStrikes(ctx: CanvasRenderingContext2D, f: Fighter, pos: { x: number; y: number }, slotColor: string, time: number): void {
  if (f.action !== "attack") return;
  const mv = currentMove(f);
  if (!mv || mv.throwFrame) return;
  const def = defOf(f);
  const marker = markerOf(def);
  for (const hb of mv.hitboxes) {
    if (f.frame < hb.frames[0] || f.frame > hb.frames[1] + LINGER) continue;
    const c = hitboxWorld({ ...f, x: pos.x, y: pos.y }, hb);
    const active = hb.frames[1] - hb.frames[0] + 1;
    const since = f.frame - hb.frames[0];
    const t = Math.min(1, (since + 1) / active);          // swing progress over the active frames
    const fade = since < active ? 1 : 1 - (since - active + 1) / (LINGER + 1);
    ctx.save();
    ctx.globalAlpha = 0.9 * fade;
    const look = lookOf(def, hb.fx);
    if (hb.grab) {
      ctx.setLineDash([5, 5]); inkArc(ctx, c.x1, c.y1, c.r, 0, Math.PI * 2, slotColor, 2.5);
    } else if (look) {
      const len = Math.hypot(c.x2 - c.x1, c.y2 - c.y1);
      const angle = len > 0 ? Math.atan2(c.y2 - c.y1, c.x2 - c.x1) : f.moveFacing === 1 ? 0 : Math.PI;
      drawLook(ctx, def, look, { x: len > 0 && !look.cell ? c.x1 : (c.x1 + c.x2) / 2, y: len > 0 && !look.cell ? c.y1 : (c.y1 + c.y2) / 2, angle, r: c.r, len: look.cell ? 0 : len, facing: f.moveFacing, frame: since, alpha: look.cell ? 1 : 0.75 });
    } else {
      const family = hb.fx ?? "hit";
      if (family === "fire") drawFlame(ctx, c, time);
      else {
        // the swoosh says "it moved"; the filled shape says "this is where it hits"
        drawSwing(ctx, f, def, pos, c, family, t, since < active, marker);
        drawFamily(ctx, f, def, c, family, since, marker);
      }
    }
    ctx.restore();
  }
}

type Capsule = { x1: number; y1: number; x2: number; y2: number; r: number };

/** The built-in families as bold capsule-filling looks in the character's own colours. */
function drawFamily(ctx: CanvasRenderingContext2D, f: Fighter, def: FighterDef, c: Capsule, family: string, since: number, marker: string): void {
  const ink = def.palette.outline || INK;
  const look: Look = family === "slash" || family === "tip" ? { shape: "slash", color: marker, ink, texture: "solid" }
    : family === "energy" ? { shape: "bolt", color: marker, ink, texture: "glow" }
    : family === "heavy" ? { shape: "bar", color: marker, ink, texture: "hatch" }
    : { shape: "bar", color: marker, ink, texture: "dots" };
  const len = Math.hypot(c.x2 - c.x1, c.y2 - c.y1);
  const angle = len > 0 ? Math.atan2(c.y2 - c.y1, c.x2 - c.x1) : f.moveFacing === 1 ? 0 : Math.PI;
  // thin hitboxes (a rapier tip) still get a readable shape
  drawLook(ctx, def, look, { x: c.x1, y: c.y1, angle, r: Math.max(c.r, 14), len, facing: f.moveFacing, frame: since, alpha: 0.92 });
}

function drawSwing(ctx: CanvasRenderingContext2D, f: Fighter, def: FighterDef, pos: { x: number; y: number }, c: Capsule, family: string, t: number, active: boolean, marker: string): void {
  const px = pos.x, py = pos.y - def.stats.height * 0.55;
  // the swoosh follows the far end of the hitbox around the fighter's pivot
  const d1 = Math.hypot(c.x1 - px, c.y1 - py), d2 = Math.hypot(c.x2 - px, c.y2 - py);
  const ex = d2 >= d1 ? c.x2 : c.x1, ey = d2 >= d1 ? c.y2 : c.y1;
  const R = Math.max(d1, d2) + c.r * 0.6;
  const heavy = family === "heavy", blade = family === "slash" || family === "tip", energy = family === "energy";
  if (R < 40) { drawBurst(ctx, ex, ey, c.r, heavy, marker); return; }
  const dir = Math.atan2(ey - py, ex - px);
  const sweep = Math.min(1.25, 0.45 + c.r * 1.6 / R) * (0.55 + 0.45 * t);
  const sign = f.moveFacing;                                    // the swing comes from behind and above the fighter
  const a0 = dir - sweep * sign, a1 = dir;
  const width = c.r * (heavy ? 1.1 : blade ? 0.9 : 0.7);
  // tapered crescent: thin at the tail, full at the leading edge
  const n = 18, outer: [number, number][] = [], inner: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const k = i / n, a = a0 + (a1 - a0) * k, w = width * Math.pow(k, 0.7);
    outer.push([px + Math.cos(a) * (R + w * 0.5), py + Math.sin(a) * (R + w * 0.5)]);
    inner.push([px + Math.cos(a) * (R - w * 0.5), py + Math.sin(a) * (R - w * 0.5)]);
  }
  const ink = def.palette.outline || INK;
  const body = energy ? marker : ink;
  inkPath(ctx, [...outer, ...inner.reverse()], true, 3);
  ctx.fillStyle = body; ctx.globalAlpha *= blade ? 0.8 : 0.9; ctx.fill();
  ctx.globalAlpha /= blade ? 0.8 : 0.9;
  // the gleam: a paper-coloured line down the middle of a blade, a pencil line otherwise
  const midR = R, ga = a0 + (a1 - a0) * 0.35;
  inkArc(ctx, px, py, midR, ga, a1, blade ? PAPER : PENCIL, Math.max(1.2, width * (blade ? 0.22 : 0.12)), 7);
  if (heavy) inkArc(ctx, px, py, R + width * 0.5 + 7, a0 + (a1 - a0) * 0.3, a1, marker, 3, 11);
  if (energy) { ctx.setLineDash([6, 8]); inkArc(ctx, px, py, R - width * 0.5 - 6, a0 + (a1 - a0) * 0.2, a1, marker, 2, 13); ctx.setLineDash([]); }
  // speed lines trailing the swing
  for (let j = 0; j < 3; j++) {
    const rr = R * (0.5 + j * 0.2), b0 = a0 - 0.12 * sign * (j + 1), b1 = a0 + (a1 - a0) * (0.18 + j * 0.06);
    inkArc(ctx, px, py, rr, Math.min(b0, b1), Math.max(b0, b1), marker, 2.6 + (heavy ? 1.2 : 0), 17 + j);
  }
  if (family === "tip" && active) drawStar(ctx, ex + Math.cos(dir) * c.r * 0.4, ey + Math.sin(dir) * c.r * 0.4, 8 + c.r * 0.25, ink);
  if (heavy && active) {
    for (let j = 0; j < 3; j++) {
      const a = dir + (j - 1) * 0.6, rr = c.r * (0.9 + j * 0.3);
      inkArc(ctx, ex + Math.cos(a) * rr, ey + Math.sin(a) * rr, 4 + j * 2, Math.PI * 1.1, Math.PI * 1.9, PENCIL, 1.5, 23 + j);
    }
  }
}

/** Attacks that burst out of the fighter's own body (spins, shockwaves) get an expanding ink ring. */
function drawBurst(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, heavy: boolean, marker: string): void {
  inkArc(ctx, x, y, r, 0, Math.PI * 2, INK, heavy ? 4 : 2.5, 5);
  inkArc(ctx, x + 3, y - 2, r * 0.8, 0.3, 2.9, marker, 1.5, 6);
  for (let j = 0; j < 6; j++) { const a = j * Math.PI / 3 + 0.3; inkLine(ctx, x + Math.cos(a) * (r + 6), y + Math.sin(a) * (r + 6), x + Math.cos(a) * (r + 16), y + Math.sin(a) * (r + 16), INK, 2, j); }
}

function drawStar(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string): void {
  const pts: [number, number][] = [];
  for (let j = 0; j < 8; j++) { const a = j * Math.PI / 4, rr = j % 2 ? r * 0.35 : r; pts.push([x + Math.cos(a) * rr, y + Math.sin(a) * rr]); }
  inkPath(ctx, pts, true, 29); ctx.fillStyle = PAPER; ctx.fill(); ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.stroke();
}

function drawFlame(ctx: CanvasRenderingContext2D, c: Capsule, time: number): void {
  const n = Math.max(1, Math.ceil(Math.hypot(c.x2 - c.x1, c.y2 - c.y1) / Math.max(10, c.r)));
  for (let i = 0; i <= n; i++) {
    const x = c.x1 + (c.x2 - c.x1) * i / n, y = c.y1 + (c.y2 - c.y1) * i / n;
    const points: [number, number][] = [];
    for (let j = 0; j <= 26; j++) {
      const a = j / 26 * Math.PI * 2;
      const r = c.r * (j % 2 ? 0.72 : 1) + Math.sin(j * 7 + Math.floor(time * 6)) * 2;
      points.push([x + Math.cos(a) * r, y + Math.sin(a) * r]);
    }
    inkPath(ctx, points, true); ctx.fillStyle = "#ffd22b"; ctx.fill();
    ctx.strokeStyle = "#ef4823"; ctx.lineWidth = 3.5; ctx.stroke();
    for (let j = -2; j <= 2; j++) inkLine(ctx, x - c.r * 0.5, y + j * c.r * 0.22, x + c.r * 0.5, y + (j - 1) * c.r * 0.22, "#f16a22", 2, j, true);
  }
}

/** True while the move has not yet reached its first active frame (windup). */
export function inWindup(f: Fighter, mv: Move): boolean {
  const first = Math.min(...mv.hitboxes.filter((h: Hitbox) => !h.grab).map((h) => h.frames[0]));
  return isFinite(first) && f.frame < first;
}
