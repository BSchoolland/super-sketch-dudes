import type { Stage, State } from "../../../shared/types";
import { platformOffset } from "../../../shared/physics";
import { PENCIL } from "./paper";

/**
 * The pencil stages' scenery, in plain strokes (cheap every frame): what sits in the world with the platforms, drawn
 * before them, and faint doodles on each backdrop layer.
 */

/** World-space scenery under the platforms: water in Islands' gaps, the cables the Elevators' lifts hang from. */
export function drawStageDecor(ctx: CanvasRenderingContext2D, state: State, stage: Stage): void {
  if (stage.theme === "islands") water(ctx, state, stage);
  else if (stage.theme === "elevators") cables(ctx, state, stage);
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
