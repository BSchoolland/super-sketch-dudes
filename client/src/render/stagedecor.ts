import type { Stage, State } from "../../../shared/types";
import { platformOffset } from "../../../shared/physics";
import { WHEEL } from "../../../shared/stages/fairground";
import { NEST } from "../../../shared/stages/ship";
import { PENCIL } from "./paper";

/**
 * The pencil stages' scenery, in plain strokes (cheap every frame): what sits in the world with the platforms, drawn
 * before them, and faint doodles on each backdrop layer.
 */

/**
 * World-space scenery under the platforms: water in Islands' gaps, the cables the Elevators' lifts hang from, the
 * Fairground's wheel, the Pirate Ship's sea and mast.
 */
export function drawStageDecor(ctx: CanvasRenderingContext2D, state: State, stage: Stage): void {
  if (stage.theme === "islands") water(ctx, state, stage);
  else if (stage.theme === "elevators") cables(ctx, state, stage);
  else if (stage.theme === "fairground") wheel(ctx, state, stage);
  else if (stage.theme === "ship") { water(ctx, state, stage); mast(ctx, state, stage); }
}

function water(ctx: CanvasRenderingContext2D, state: State, stage: Stage): void {
  const solids = stage.platforms.filter((p) => p.solid).sort((a, b) => a.x1 - b.x1);
  // the open water: from the blast zone's edge to the first island, between islands, past the last
  const spans: [number, number][] = [];
  let x = stage.blast.left;
  for (const p of solids) { if (p.x1 > x) spans.push([x, p.x1]); x = Math.max(x, p.x2); }
  spans.push([x, stage.blast.right]);
  const t = state.frame / 60;
  ctx.save();
  ctx.strokeStyle = PENCIL; ctx.lineWidth = 2.2; ctx.lineCap = "round";
  ctx.beginPath();
  for (const [row, y] of [170, 215, 265, 320].entries()) {
    const amp = 7 - row, len = 70 + row * 12, drift = Math.sin(t * 0.8 + row) * 18;
    for (const [a, b] of spans) {
      const x0 = a + 10 + (row % 2) * len * 0.5, x1 = b - 10;
      for (let wx = x0; wx < x1; wx += len) {
        const end = Math.min(x1, wx + len * 0.7);
        if (end - wx < 20) continue;
        ctx.moveTo(wx + drift, y);
        ctx.quadraticCurveTo((wx + end) / 2 + drift, y - amp * 2, end + drift, y);
      }
    }
  }
  ctx.globalAlpha = 0.55;
  ctx.stroke();
  ctx.restore();
}

function cables(ctx: CanvasRenderingContext2D, state: State, stage: Stage): void {
  ctx.save();
  ctx.strokeStyle = PENCIL; ctx.lineCap = "round";
  stage.platforms.forEach((p, i) => {
    const m = p.motion;
    if (m?.kind !== "line" || m.dx !== 0) return;
    const o = platformOffset(state, i);
    const cx = (p.x1 + p.x2) / 2, top = p.y + Math.min(0, m.dy) - 420;
    // the shaft the lift runs in, faint
    ctx.globalAlpha = 0.28; ctx.lineWidth = 1.5; ctx.setLineDash([10, 12]);
    ctx.beginPath();
    ctx.moveTo(p.x1 - 8, top + 30); ctx.lineTo(p.x1 - 8, p.y + Math.max(0, m.dy) + 60);
    ctx.moveTo(p.x2 + 8, top + 30); ctx.lineTo(p.x2 + 8, p.y + Math.max(0, m.dy) + 60);
    ctx.stroke();
    ctx.setLineDash([]);
    // the cable and its pulley
    ctx.globalAlpha = 0.8; ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx - 40, p.y + o.dy); ctx.lineTo(cx, p.y + o.dy - 50); ctx.lineTo(cx + 40, p.y + o.dy);
    ctx.moveTo(cx, p.y + o.dy - 50); ctx.lineTo(cx, top + 22);
    ctx.moveTo(cx + 22, top); ctx.arc(cx, top, 22, 0, Math.PI * 2);
    ctx.moveTo(cx, top - 22); ctx.lineTo(cx, top - 70);
    ctx.stroke();
  });
  ctx.restore();
}

/** The Ferris wheel: an A-frame, a double rim turning with the gondolas, spokes, and each gondola's hanger. */
function wheel(ctx: CanvasRenderingContext2D, state: State, stage: Stage): void {
  // each gondola hangs this far under its point on the rim
  const HANG = 60;
  const hx = WHEEL.x, hy = WHEEL.y - HANG;
  const cars: { x: number; y: number; half: number }[] = [];
  stage.platforms.forEach((p, i) => {
    if (p.motion?.kind !== "orbit") return;
    const o = platformOffset(state, i);
    cars.push({ x: (p.x1 + p.x2) / 2 + o.dx, y: p.y + o.dy, half: (p.x2 - p.x1) / 2 });
  });
  const turn = cars.length ? Math.atan2(cars[0].y - WHEEL.y, cars[0].x - WHEEL.x) : 0;
  ctx.save();
  ctx.strokeStyle = PENCIL; ctx.lineCap = "round"; ctx.lineJoin = "round";
  ctx.globalAlpha = 0.5; ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(hx - 230, 0); ctx.lineTo(hx, hy); ctx.lineTo(hx + 230, 0);
  ctx.moveTo(hx - 150, -130); ctx.lineTo(hx + 150, -130);
  ctx.stroke();
  ctx.globalAlpha = 0.55; ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(hx + WHEEL.r, hy); ctx.arc(hx, hy, WHEEL.r, 0, Math.PI * 2);
  ctx.moveTo(hx + WHEEL.r * 0.86, hy); ctx.arc(hx, hy, WHEEL.r * 0.86, 0, Math.PI * 2);
  for (let k = 0; k < 8; k++) {
    const a = turn + (k * Math.PI) / 4;
    ctx.moveTo(hx, hy); ctx.lineTo(hx + Math.cos(a) * WHEEL.r, hy + Math.sin(a) * WHEEL.r);
  }
  ctx.moveTo(hx + 18, hy); ctx.arc(hx, hy, 18, 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha = 0.75; ctx.lineWidth = 2;
  ctx.beginPath();
  for (const c of cars) {
    const top = c.y - HANG, yoke = top + 16;
    ctx.moveTo(c.x, top); ctx.lineTo(c.x, yoke);
    ctx.moveTo(c.x - c.half + 12, yoke); ctx.lineTo(c.x + c.half - 12, yoke);
    ctx.moveTo(c.x - c.half + 12, yoke); ctx.lineTo(c.x - c.half, c.y);
    ctx.moveTo(c.x + c.half - 12, yoke); ctx.lineTo(c.x + c.half, c.y);
  }
  ctx.stroke();
  ctx.restore();
}

/** The mast, leaning with the crow's nest it carries: two sails, the rigging down to the deck's ends, a pirate flag. */
function mast(ctx: CanvasRenderingContext2D, state: State, stage: Stage): void {
  const i = stage.platforms.findIndex((p) => p.motion);
  const nx = (NEST.x1 + NEST.x2) / 2 + platformOffset(state, i).dx;
  // a point up the mast: 0 at the deck, 1 at the nest
  const at = (u: number): [number, number] => [nx * u, NEST.y * u];
  const deck = stage.platforms[0];
  const [tx, ty] = at(1.3);
  const wave = Math.sin(state.frame / 9) * 8;
  ctx.save();
  ctx.strokeStyle = PENCIL; ctx.lineCap = "round"; ctx.lineJoin = "round";
  ctx.globalAlpha = 0.4; ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (const x of [deck.x1 + 20, deck.x2 - 20]) { ctx.moveTo(...at(0.95)); ctx.lineTo(x, deck.y); }
  ctx.stroke();
  ctx.globalAlpha = 0.6; ctx.lineWidth = 7;
  ctx.beginPath(); ctx.moveTo(0, deck.y); ctx.lineTo(tx, ty); ctx.stroke();
  ctx.globalAlpha = 0.5; ctx.lineWidth = 2.5;
  ctx.beginPath();
  // each sail bellies out from a sagging top edge: a straight one reads as a platform to land on
  for (const [top, bottom, half] of [[0.88, 0.55, 170], [0.48, 0.12, 230]]) {
    const [ax, ay] = at(top), [bx, by] = at(bottom);
    ctx.moveTo(ax + half, ay); ctx.quadraticCurveTo(ax, ay + 22, ax - half, ay);
    ctx.quadraticCurveTo(bx - half * 1.15, (ay + by) / 2, bx - half, by);
    ctx.quadraticCurveTo(bx, by + 26, bx + half, by);
    ctx.quadraticCurveTo(bx + half * 1.15, (ay + by) / 2, ax + half, ay);
  }
  // the flag: a pennant on the masthead with a skull and crossbones
  const fx = tx + 4, fy = ty + 8;
  ctx.moveTo(fx, fy); ctx.lineTo(fx + 90, fy + 6 + wave); ctx.lineTo(fx + 86, fy + 62 + wave); ctx.lineTo(fx, fy + 56);
  const cx = fx + 44, cy = fy + 30 + wave / 2;
  ctx.moveTo(cx + 9, cy - 6); ctx.arc(cx, cy - 6, 9, 0, Math.PI * 2);
  ctx.moveTo(cx - 14, cy + 4); ctx.lineTo(cx + 14, cy + 18);
  ctx.moveTo(cx + 14, cy + 4); ctx.lineTo(cx - 14, cy + 18);
  ctx.stroke();
  ctx.restore();
}

/**
 * Faint doodles on one backdrop layer (already translated to the layer's origin, stroke style set), for the themes
 * that have them; false for the rest, which keep the plain construction lines.
 */
export function drawBackdropDoodles(ctx: CanvasRenderingContext2D, theme: string, depth: number): boolean {
  const k = 1 - depth;
  if (theme === "playground") {
    ctx.beginPath();
    // a swing set, a slide and a tree, spread differently on each layer
    const sx = -700 + depth * 900, gy = 160 + depth * 300;
    ctx.moveTo(sx, gy); ctx.lineTo(sx + 90 * k, gy - 260 * k); ctx.lineTo(sx + 180 * k, gy);
    ctx.moveTo(sx + 90 * k, gy - 260 * k); ctx.lineTo(sx + 420 * k, gy - 260 * k);
    ctx.moveTo(sx + 330 * k, gy); ctx.lineTo(sx + 420 * k, gy - 260 * k); ctx.lineTo(sx + 510 * k, gy);
    for (const s of [190, 300]) { ctx.moveTo(sx + s * k, gy - 260 * k); ctx.lineTo(sx + s * k, gy - 90 * k); ctx.moveTo(sx + (s - 30) * k, gy - 90 * k); ctx.lineTo(sx + (s + 30) * k, gy - 90 * k); }
    const lx = 350 - depth * 700;
    ctx.moveTo(lx, gy); ctx.lineTo(lx, gy - 220 * k); ctx.lineTo(lx + 60 * k, gy - 220 * k); ctx.lineTo(lx + 60 * k, gy);
    for (let r = 1; r < 5; r++) { ctx.moveTo(lx, gy - r * 44 * k); ctx.lineTo(lx + 60 * k, gy - r * 44 * k); }
    ctx.moveTo(lx + 60 * k, gy - 220 * k); ctx.quadraticCurveTo(lx + 160 * k, gy - 200 * k, lx + 300 * k, gy);
    const tx = -250 + depth * 1400;
    ctx.moveTo(tx, gy); ctx.lineTo(tx, gy - 180 * k);
    ctx.moveTo(tx + 110 * k, gy - 250 * k); ctx.arc(tx, gy - 250 * k, 110 * k, 0, Math.PI * 2);
    ctx.moveTo(-1500, gy); ctx.lineTo(1500, gy);
    ctx.stroke();
    return true;
  }
  if (theme === "islands") {
    ctx.beginPath();
    // the horizon, a far island with a palm, clouds
    const hy = 120 + depth * 260;
    ctx.moveTo(-1600, hy); ctx.lineTo(1600, hy);
    const ix = depth === 0.22 ? -620 : depth === 0.35 ? 760 : 80;
    ctx.moveTo(ix - 220 * k, hy); ctx.quadraticCurveTo(ix, hy - 90 * k, ix + 220 * k, hy);
    ctx.moveTo(ix, hy - 60 * k); ctx.quadraticCurveTo(ix + 20 * k, hy - 160 * k, ix - 10 * k, hy - 240 * k);
    for (const a of [-2.6, -2.0, -1.2, -0.5]) { ctx.moveTo(ix - 10 * k, hy - 240 * k); ctx.quadraticCurveTo(ix - 10 * k + Math.cos(a) * 60 * k, hy - 270 * k + Math.sin(a) * 20 * k, ix - 10 * k + Math.cos(a) * 110 * k, hy - 230 * k + Math.abs(Math.sin(a)) * 30 * k); }
    const cx = -300 + depth * 1200, cy = -380 + depth * 200;
    for (const [dx, r] of [[0, 50], [60, 70], [130, 45]]) { ctx.moveTo(cx + dx + r, cy); ctx.arc(cx + dx, cy, r, Math.PI, 0); }
    ctx.moveTo(cx - 50, cy); ctx.lineTo(cx + 175, cy);
    ctx.stroke();
    return true;
  }
  if (theme === "fairground") {
    ctx.beginPath();
    // striped tents, bunting between poles, a horizon
    const gy = 150 + depth * 280;
    ctx.moveTo(-1600, gy); ctx.lineTo(1600, gy);
    for (const [i, tx] of [-900 + depth * 500, 250 + depth * 900, 1100 - depth * 300].entries()) {
      const w = (160 + i * 40) * k, h = (190 + i * 30) * k;
      ctx.moveTo(tx - w, gy); ctx.lineTo(tx, gy - h); ctx.lineTo(tx + w, gy);
      for (const f of [-0.5, 0, 0.5]) { ctx.moveTo(tx, gy - h); ctx.lineTo(tx + f * w, gy); }
      ctx.moveTo(tx, gy - h); ctx.lineTo(tx, gy - h - 50 * k); ctx.lineTo(tx + 34 * k, gy - h - 40 * k); ctx.lineTo(tx, gy - h - 30 * k);
    }
    const by = gy - 330 * k;
    for (let x = -1400; x < 1400; x += 280) {
      ctx.moveTo(x, by); ctx.quadraticCurveTo(x + 140, by + 60 * k, x + 280, by);
      for (let f = 0.2; f < 0.9; f += 0.2) { const fx = x + f * 280, fy = by + 2 * f * (1 - f) * 60 * k; ctx.moveTo(fx - 12 * k, fy); ctx.lineTo(fx, fy + 26 * k); ctx.lineTo(fx + 12 * k, fy); }
    }
    ctx.stroke();
    return true;
  }
  if (theme === "ship") {
    ctx.beginPath();
    // the horizon, a far ship under sail, gulls
    const hy = 140 + depth * 260;
    ctx.moveTo(-1600, hy); ctx.lineTo(1600, hy);
    const sx = depth === 0.22 ? 700 : depth === 0.35 ? -820 : 0;
    if (sx) {
      ctx.moveTo(sx - 150 * k, hy - 30 * k); ctx.quadraticCurveTo(sx, hy + 30 * k, sx + 150 * k, hy - 30 * k); ctx.lineTo(sx - 150 * k, hy - 30 * k);
      ctx.moveTo(sx, hy - 30 * k); ctx.lineTo(sx, hy - 260 * k);
      ctx.moveTo(sx, hy - 250 * k); ctx.quadraticCurveTo(sx + 120 * k, hy - 160 * k, sx, hy - 60 * k);
      ctx.moveTo(sx, hy - 250 * k); ctx.quadraticCurveTo(sx - 90 * k, hy - 170 * k, sx, hy - 90 * k);
    }
    const gx = -400 + depth * 1300, gy = -300 + depth * 150;
    for (const [dx, dy] of [[0, 0], [90, -40], [170, 10]]) {
      const x = gx + dx, y = gy + dy;
      ctx.moveTo(x - 30, y); ctx.quadraticCurveTo(x - 15, y - 16, x, y); ctx.quadraticCurveTo(x + 15, y - 16, x + 30, y);
    }
    ctx.stroke();
    return true;
  }
  if (theme === "elevators") {
    ctx.beginPath();
    // a building's floors and windows behind the shafts
    const w = 900 - depth * 900, x = -w / 2, top = -700 + depth * 400;
    ctx.rect(x, top, w, 1200);
    for (let y = top + 160; y < 500; y += 160) { ctx.moveTo(x, y); ctx.lineTo(x + w, y); }
    for (let y = top + 50; y < 500; y += 160) for (let wx = x + 60; wx < x + w - 80; wx += 150) ctx.rect(wx, y, 60, 70);
    ctx.stroke();
    return true;
  }
  return false;
}
