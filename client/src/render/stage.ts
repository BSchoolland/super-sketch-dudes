import type { Stage, State } from "../../../shared/types";
import { platformOffset } from "../../../shared/physics";
import type { Camera } from "./camera";
import { VIEW_H, VIEW_W } from "./camera";
import { drawPaper, hatch, inkArc, inkLine, inkRect, INK, PAPER, PENCIL, noise } from "./paper";

export function drawBackdrop(ctx: CanvasRenderingContext2D, stage: Stage, cam: Camera): void {
  drawPaper(ctx, VIEW_W, VIEW_H);
  for (const depth of [0.08, 0.22, 0.35]) {
    ctx.save();
    ctx.translate(VIEW_W / 2 - cam.x * depth * cam.zoom, VIEW_H / 2 - cam.y * depth * cam.zoom * 0.5);
    ctx.globalAlpha = depth === 0.35 ? 0.23 : 0.12;
    if (stage.theme === "rooftops") {
      for (let i = -6; i <= 6; i++) {
        const x = i * 255 + depth * 280, h = 120 + noise(i + Math.round(depth * 100)) * 240;
        inkRect(ctx, x, 210 - h, 125, h + 210, PENCIL, 1.2);
        inkLine(ctx, x - 5, 210 - h, x + 131, 208 - h, PENCIL, 1.4);
        for (let j = 0; j < 3; j++) {
          inkRect(ctx, x + 18 + j * 34, 230 - h, 14, 22, PENCIL, 0.8);
          inkLine(ctx, x + 12 + j * 8, 280 - h, x + 12 + j * 8, 380 - h, PENCIL, 0.7);
        }
        inkLine(ctx, x + 65, 210 - h, x + 63, 180 - h, PENCIL, 1);
      }
    } else {
      ctx.setLineDash([9, 12]);
      inkLine(ctx, -850, depth * 500, 850, depth * 500, PENCIL, 1);
      inkLine(ctx, -600 + depth * 1000, -350, -600 + depth * 1000, 360, PENCIL, 1);
      inkLine(ctx, 600 - depth * 1000, -350, 600 - depth * 1000, 360, PENCIL, 1);
      ctx.setLineDash([]);
      inkArc(ctx, 0, 100, 160 + depth * 500, Math.PI, Math.PI * 1.6, PENCIL, 1);
    }
    ctx.restore();
  }
}

export function drawStage(ctx: CanvasRenderingContext2D, state: State, stage: Stage): void {
  stage.platforms.forEach((p, i) => {
    if (p.hidden) return;
    const o = platformOffset(state, i);
    const x = p.x1 + o.dx, y = p.y + o.dy, w = p.x2 - p.x1;
    const h = p.solid ? p.bottom! - p.y : p.motion ? 42 : 16;
    ctx.fillStyle = PAPER; ctx.fillRect(x, y, w, h);
    ctx.save(); ctx.globalAlpha = 0.36; hatch(ctx, x, y + 3, w, h - 3); ctx.restore();
    inkRect(ctx, x, y, w, h, PENCIL, 1.8);
    inkLine(ctx, x, y, x + w, y, INK, 3, i);
    inkLine(ctx, x + 3, y + 4, x + w - 3, y + 4, PENCIL, 1, i + 4);
    inkLine(ctx, x, y - 3, x, y + 11, INK, 2);
    inkLine(ctx, x + w, y - 3, x + w, y + 11, INK, 2);
  });
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
