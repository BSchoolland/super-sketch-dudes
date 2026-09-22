import type { Fighter, Hitbox, Move } from "../../../shared/types";
import { hitboxWorld } from "../../../shared/hits";
import { defOf, currentMove } from "../../../shared/fighter";

const INK = "#12101a";

/**
 * Attack shapes: every live hitbox is drawn as a stylised strike in the world, in the fighter's
 * fx family, so the picture and the hit are the same thing. Called inside the camera transform,
 * after fighters, before particles.
 */
export function drawStrikes(ctx: CanvasRenderingContext2D, f: Fighter, pos: { x: number; y: number }, slotColor: string, time: number): void {
  if (f.action !== "attack") return;
  const mv = currentMove(f);
  if (!mv) return;
  const def = defOf(f);
  const accent = def.palette.colors[def.palette.accent] ?? slotColor;
  const family = mv.hitboxes[0]?.fx ?? "hit";
  const cx = pos.x, cy = pos.y - def.stats.height * 0.55;
  const LINGER = 6; // frames the shape keeps fading after the hitbox is gone, so short windows still read
  for (const hb of mv.hitboxes) {
    if (f.frame < hb.frames[0] || f.frame > hb.frames[1] + LINGER) continue;
    if (mv.throwFrame) continue;
    const c = hitboxWorld({ ...f, x: pos.x, y: pos.y } as Fighter, hb);
    const life = hb.frames[1] - hb.frames[0] + 1 + LINGER;
    const t = (f.frame - hb.frames[0] + 1) / life; // 0..1 through the active window and its fade
    if (hb.grab) { drawGrab(ctx, c, t, accent); continue; }
    ctx.save();
    const main = Object.values(def.palette.colors)[0] ?? slotColor;
    switch (hb.fx ?? family) {
      case "slash": case "tip": drawSlash(ctx, cx, cy, c, t, hb.fx === "tip", accent, f.moveFacing); break;
      case "heavy": drawHeavy(ctx, c, t, main, f.moveFacing, hb.spike === true, time); break;
      case "fire": drawFire(ctx, c, t, time); break;
      case "energy": drawEnergy(ctx, c, t, accent, time); break;
      default: drawSoft(ctx, c, t, slotColor); break;
    }
    ctx.restore();
  }
}

interface Cap { x1: number; y1: number; x2: number; y2: number; r: number }

function capsulePath(ctx: CanvasRenderingContext2D, c: Cap, grow = 0): void {
  const r = c.r + grow;
  ctx.beginPath();
  if (c.x1 === c.x2 && c.y1 === c.y2) { ctx.arc(c.x1, c.y1, r, 0, Math.PI * 2); return; }
  const ang = Math.atan2(c.y2 - c.y1, c.x2 - c.x1);
  ctx.arc(c.x1, c.y1, r, ang + Math.PI / 2, ang - Math.PI / 2);
  ctx.arc(c.x2, c.y2, r, ang - Math.PI / 2, ang + Math.PI / 2);
  ctx.closePath();
}

/** A crescent sweeping around the attacker's chest out to the blade's reach; tippers get a white spark at the far end. */
function drawSlash(ctx: CanvasRenderingContext2D, cx: number, cy: number, c: Cap, t: number, tip: boolean, accent: string, facing: number): void {
  const fx = (c.x1 + c.x2) / 2, fy = (c.y1 + c.y2) / 2;
  const len = Math.hypot(c.x2 - c.x1, c.y2 - c.y1);
  const far = Math.max(Math.hypot(c.x1 - cx, c.y1 - cy), Math.hypot(c.x2 - cx, c.y2 - cy)) + c.r;
  // a sweep band, not a pie: thrusts (long capsules) get a long thin band, arcs (round hits) a short wide one
  const band = Math.max(c.r * 2.2, Math.min(len * 0.55 + c.r * 2, far * 0.6));
  const near = Math.max(16, far - band);
  const dir = Math.atan2(fy - cy, fx - cx);
  const spread = Math.min(1.3, 0.28 + (c.r * 2.4) / Math.max(40, far - c.r));
  const sweep = -facing; // trailing edge is behind the swing
  const a0 = dir - spread * 0.5 * (1 - t * 0.3), a1 = dir + spread * 0.5 * (1 - t * 0.3);
  const alpha = 0.95 - t * 0.55;
  const arc = (r0: number, r1: number, color: string, al: number) => {
    ctx.globalAlpha = al;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(cx, cy, r1, a0, a1);
    ctx.arc(cx, cy, r0, a1, a0, true);
    ctx.closePath(); ctx.fill();
  };
  arc(near - 4, far + 4, INK, alpha * 0.8);
  arc(near, far, "#ffffff", alpha * 0.9);
  arc(near + band * 0.15, far - band * 0.18, accent, alpha * 0.8);
  arc(near + band * 0.32, far - band * 0.36, "#ffffff", alpha);
  // trailing smear lines
  ctx.globalAlpha = alpha * 0.7;
  ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 3; ctx.lineCap = "round";
  for (let i = 1; i <= 3; i++) {
    const a = dir + sweep * spread * (0.5 + i * 0.18);
    ctx.beginPath(); ctx.arc(cx, cy, far - 10 - i * 12, a - 0.25, a); ctx.stroke();
  }
  if (tip) {
    const tx = cx + Math.cos(dir) * (far - c.r * 0.6), ty = cy + Math.sin(dir) * (far - c.r * 0.6);
    ctx.globalAlpha = 1;
    ctx.fillStyle = INK; star(ctx, tx, ty, c.r * 1.6 + 4, 4);
    ctx.fillStyle = "#ffffff"; star(ctx, tx, ty, c.r * 1.6, 4);
  }
}

function star(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, points: number): void {
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const a = (i * Math.PI) / points - Math.PI / 2;
    const rr = i % 2 === 0 ? r : r * 0.35;
    ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  ctx.closePath(); ctx.fill();
}

/** A chunky wedge with speed lines: BRICK's fists and every heavy hit. */
function drawHeavy(ctx: CanvasRenderingContext2D, c: Cap, t: number, accent: string, facing: number, spike: boolean, time: number): void {
  const alpha = 0.95 - t * 0.5;
  const grow = 2 + (1 - t) * 6;
  ctx.globalAlpha = alpha;
  ctx.fillStyle = INK; capsulePath(ctx, c, grow + 5); ctx.fill();
  ctx.fillStyle = "#ffffff"; capsulePath(ctx, c, grow + 1); ctx.fill();
  ctx.fillStyle = accent; capsulePath(ctx, c, grow - 3); ctx.fill();
  // a bright streak along the hit, not a full white core
  ctx.strokeStyle = "#ffffff"; ctx.lineWidth = Math.max(3, c.r * 0.35); ctx.lineCap = "round";
  ctx.beginPath(); ctx.moveTo(c.x1, c.y1 - c.r * 0.3); ctx.lineTo(c.x2 === c.x1 ? c.x1 + c.r * 0.6 : c.x2, c.y2 - c.r * 0.3); ctx.stroke();
  // speed lines radiating from the far side of the hit
  const mx = (c.x1 + c.x2) / 2, my = (c.y1 + c.y2) / 2;
  const dir = spike ? Math.PI / 2 : Math.atan2(c.y2 - c.y1 || 0, (c.x2 - c.x1) * facing || facing);
  ctx.strokeStyle = INK; ctx.lineWidth = 5; ctx.lineCap = "round";
  for (let i = -2; i <= 2; i++) {
    const a = dir + i * 0.32 + Math.sin(time * 50) * 0.03;
    const r0 = c.r + grow + 6, r1 = r0 + 22 + (1 - t) * 20 + Math.abs(i) * -4;
    ctx.beginPath(); ctx.moveTo(mx + Math.cos(a) * r0, my + Math.sin(a) * r0); ctx.lineTo(mx + Math.cos(a) * r1, my + Math.sin(a) * r1); ctx.stroke();
  }
  ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 2.5;
  for (let i = -2; i <= 2; i++) {
    const a = dir + i * 0.32 + Math.sin(time * 50) * 0.03;
    const r0 = c.r + grow + 6, r1 = r0 + 22 + (1 - t) * 20 + Math.abs(i) * -4;
    ctx.beginPath(); ctx.moveTo(mx + Math.cos(a) * r0, my + Math.sin(a) * r0); ctx.lineTo(mx + Math.cos(a) * r1, my + Math.sin(a) * r1); ctx.stroke();
  }
}

/** Overlapping flame blobs along the hit, flickering. */
function drawFire(ctx: CanvasRenderingContext2D, c: Cap, t: number, time: number): void {
  const alpha = 1 - t * 0.4;
  const n = 5;
  const blobs: { x: number; y: number; r: number }[] = [];
  for (let i = 0; i < n; i++) {
    const k = i / (n - 1);
    const wob = Math.sin(time * 40 + i * 1.7) * c.r * 0.25;
    blobs.push({ x: c.x1 + (c.x2 - c.x1) * k + wob, y: c.y1 + (c.y2 - c.y1) * k - Math.abs(wob) * 0.6, r: c.r * (0.7 + 0.5 * Math.abs(Math.sin(time * 30 + i))) });
  }
  const layer = (color: string, scale: number, dy: number) => {
    ctx.fillStyle = color;
    for (const b of blobs) { ctx.beginPath(); ctx.ellipse(b.x, b.y + dy, b.r * scale, b.r * scale * 1.35, 0, 0, Math.PI * 2); ctx.fill(); }
  };
  ctx.globalAlpha = alpha;
  layer(INK, 1.18, 0);
  layer("#ff4d2e", 1.0, 0);
  layer("#ffc43a", 0.7, 2);
  layer("#fff1a8", 0.38, 4);
}

/** A glowing bar of light with a bright core and sparkle ticks: PILOT's crescent and slugs. */
function drawEnergy(ctx: CanvasRenderingContext2D, c: Cap, t: number, accent: string, time: number): void {
  const alpha = 1 - t * 0.5;
  ctx.globalAlpha = alpha * 0.9;
  ctx.fillStyle = INK; capsulePath(ctx, c, 6); ctx.fill();
  ctx.fillStyle = accent; capsulePath(ctx, c, 2); ctx.fill();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = "#ffffff"; capsulePath(ctx, c, -c.r * 0.5); ctx.fill();
  ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 2;
  const mx = (c.x1 + c.x2) / 2, my = (c.y1 + c.y2) / 2;
  for (let i = 0; i < 4; i++) {
    const a = time * 12 + i * (Math.PI / 2);
    const r0 = c.r + 6, r1 = c.r + 14 + (1 - t) * 10;
    ctx.beginPath(); ctx.moveTo(mx + Math.cos(a) * r0, my + Math.sin(a) * r0); ctx.lineTo(mx + Math.cos(a) * r1, my + Math.sin(a) * r1); ctx.stroke();
  }
}

function drawSoft(ctx: CanvasRenderingContext2D, c: Cap, t: number, color: string): void {
  ctx.globalAlpha = 0.8 - t * 0.4;
  ctx.fillStyle = INK; capsulePath(ctx, c, 5); ctx.fill();
  ctx.fillStyle = color; capsulePath(ctx, c, 1); ctx.fill();
  ctx.fillStyle = "#ffffff"; capsulePath(ctx, c, -c.r * 0.5); ctx.fill();
}

function drawGrab(ctx: CanvasRenderingContext2D, c: Cap, t: number, accent: string): void {
  ctx.save();
  ctx.globalAlpha = 0.9 - t * 0.3;
  ctx.setLineDash([6, 5]);
  ctx.lineWidth = 4; ctx.strokeStyle = INK;
  ctx.beginPath(); ctx.arc(c.x1, c.y1, c.r + 4, 0, Math.PI * 2); ctx.stroke();
  ctx.lineWidth = 2; ctx.strokeStyle = accent;
  ctx.beginPath(); ctx.arc(c.x1, c.y1, c.r + 4, 0, Math.PI * 2); ctx.stroke();
  ctx.restore();
}

/** True while the move has not yet reached its first active frame (windup). */
export function inWindup(f: Fighter, mv: Move): boolean {
  const first = Math.min(...mv.hitboxes.filter((h: Hitbox) => !h.grab).map((h) => h.frames[0]));
  return isFinite(first) && f.frame < first;
}
