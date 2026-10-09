import type { Stage, State } from "../../../shared/types";
import { platformOffset } from "../../../shared/physics";
import type { Camera } from "./camera";
import { VIEW_H, VIEW_W } from "./camera";
import { drawPaper, hatch, inkArc, inkLine, inkRect, ICE, INK, PAPER, PENCIL, noise } from "./paper";
import { drawBackdropDoodles, drawStageDecor } from "./stagedecor";

const DEPTHS = [0.08, 0.22, 0.35];
const buildings = new Map<string, { canvas: HTMLCanvasElement; x: number; y: number; w: number; h: number }>();

/**
 * One backdrop building drawn once into a bitmap at the canvas's pixel scale, in layer space.
 * Buildings, not whole layers: the gaps between them stay unpainted, which matters when Chrome rasterizes in software.
 */
function building(i: number, depth: number, scale: number) {
  const key = `${i} ${depth} ${scale}`;
  let b = buildings.get(key);
  if (b) return b;
  const x = i * 255 + depth * 280, h = 120 + noise(i + Math.round(depth * 100)) * 240;
  const box = { x: x - 10, y: 175 - h, w: 150, h: h + 250 };
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(box.w * scale); canvas.height = Math.ceil(box.h * scale);
  const c = canvas.getContext("2d");
  if (!c) throw new Error("Canvas 2D is required for the backdrop");
  c.setTransform(scale, 0, 0, scale, -box.x * scale, -box.y * scale);
  c.globalAlpha = depth === 0.35 ? 0.23 : 0.12;
  inkRect(c, x, 210 - h, 125, h + 210, PENCIL, 1.2);
  inkLine(c, x - 5, 210 - h, x + 131, 208 - h, PENCIL, 1.4);
  for (let j = 0; j < 3; j++) {
    inkRect(c, x + 18 + j * 34, 230 - h, 14, 22, PENCIL, 0.8);
    inkLine(c, x + 12 + j * 8, 280 - h, x + 12 + j * 8, 380 - h, PENCIL, 0.7);
  }
  inkLine(c, x + 65, 210 - h, x + 63, 180 - h, PENCIL, 1);
  if (buildings.size >= 13 * 3 * 3) buildings.clear();
  b = { canvas, ...box };
  buildings.set(key, b);
  return b;
}

export function drawBackdrop(ctx: CanvasRenderingContext2D, stage: Stage, cam: Camera): void {
  drawPaper(ctx, VIEW_W, VIEW_H);
  const m = ctx.getTransform(), scale = m.a;
  for (const depth of DEPTHS) {
    const ox = VIEW_W / 2 - cam.x * depth * cam.zoom, oy = VIEW_H / 2 - cam.y * depth * cam.zoom * 0.5;
    if (stage.theme === "rooftops") {
      for (let i = -6; i <= 6; i++) {
        const b = building(i, depth, scale);
        if (ox + b.x > VIEW_W || ox + b.x + b.w < 0 || oy + b.y > VIEW_H || oy + b.y + b.h < 0) continue;
        // at whole device pixels and 1:1, so the draw is a plain copy with no filtering
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.drawImage(b.canvas, Math.round((ox + b.x) * scale + m.e), Math.round((oy + b.y) * scale + m.f));
        ctx.restore();
      }
      continue;
    }
    ctx.save();
    ctx.translate(ox, oy);
    ctx.globalAlpha = depth === 0.35 ? 0.23 : 0.12;
    // faint enough that the pencil wobble never showed: plain strokes
    ctx.strokeStyle = PENCIL; ctx.lineWidth = 1;
    if (drawBackdropDoodles(ctx, stage.theme, depth)) { ctx.restore(); continue; }
    ctx.setLineDash([9, 12]);
    ctx.beginPath();
    ctx.moveTo(-850, depth * 500); ctx.lineTo(850, depth * 500);
    ctx.moveTo(-600 + depth * 1000, -350); ctx.lineTo(-600 + depth * 1000, 360);
    ctx.moveTo(600 - depth * 1000, -350); ctx.lineTo(600 - depth * 1000, 360);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath(); ctx.arc(0, 100, 160 + depth * 500, Math.PI, Math.PI * 1.6); ctx.stroke();
    ctx.restore();
  }
}

export function drawStage(ctx: CanvasRenderingContext2D, state: State, stage: Stage): void {
  drawStageDecor(ctx, state, stage);
  stage.platforms.forEach((p, i) => {
    if (p.hidden) return;
    const o = platformOffset(state, i);
    const x = p.x1 + o.dx, y = p.y + o.dy, w = p.x2 - p.x1;
    const h = p.solid ? p.bottom! - p.y : p.motion ? 42 : 16;
    ctx.fillStyle = PAPER; ctx.fillRect(x, y, w, 3);
    hatch(ctx, x, y + 3, w, h - 3, PENCIL, 0.36);
    if (p.grip) drawIce(ctx, x, y, w);
    inkRect(ctx, x, y, w, h, PENCIL, 1.8);
    inkLine(ctx, x, y, x + w, y, INK, 3, i);
    inkLine(ctx, x + 3, y + 4, x + w - 3, y + 4, PENCIL, 1, i + 4);
    inkLine(ctx, x, y - 3, x, y + 11, INK, 2);
    inkLine(ctx, x + w, y - 3, x + w, y + 11, INK, 2);
  });
}

/** A slippery top: a pale blue band with skate scratches and a few glints. */
function drawIce(ctx: CanvasRenderingContext2D, x: number, y: number, w: number): void {
  ctx.save();
  ctx.fillStyle = ICE; ctx.fillRect(x, y, w, 30);
  ctx.strokeStyle = "#8fb8cf"; ctx.lineWidth = 1.5; ctx.lineCap = "round";
  ctx.beginPath();
  for (let sx = x + 60; sx < x + w - 160; sx += 230) { ctx.moveTo(sx, y + 20); ctx.quadraticCurveTo(sx + 70, y + 8, sx + 150, y + 16); }
  ctx.stroke();
  ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 2.5;
  ctx.beginPath();
  for (let gx = x + 140; gx < x + w - 40; gx += 310) { ctx.moveTo(gx, y + 24); ctx.lineTo(gx + 14, y + 8); ctx.moveTo(gx + 12, y + 25); ctx.lineTo(gx + 20, y + 15); }
  ctx.stroke();
  ctx.restore();
}

export function drawShadow(ctx: CanvasRenderingContext2D, state: State, stage: Stage, x: number, y: number, w: number): void {
  let best = Infinity;
  stage.platforms.forEach((p, i) => {
    const o = platformOffset(state, i);
    if (x >= p.x1 + o.dx && x <= p.x2 + o.dx && p.y + o.dy >= y - 1 && p.y + o.dy < best) best = p.y + o.dy;
  });
  if (!isFinite(best)) return;
  const d = Math.min(1, (best - y) / 500);
  ctx.save(); ctx.globalAlpha = 0.35 * (1 - d * 0.7);
  for (let i = 0; i < 5; i++) inkLine(ctx, x - w + i * 3, best + i, x + w - i * 4, best + i - 2, PENCIL, 0.8, i);
  ctx.restore();
}
