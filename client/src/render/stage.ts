import type { Stage, State } from "../../../shared/types";
import { platformOffset } from "../../../shared/physics";
import type { Camera } from "./camera";
import { VIEW_H, VIEW_W } from "./camera";

const INK = "#12101a";

export function drawBackdrop(ctx: CanvasRenderingContext2D, stage: Stage, cam: Camera, time: number): void {
  // sky
  const g = ctx.createLinearGradient(0, 0, 0, VIEW_H);
  if (stage.theme === "proving") {
    g.addColorStop(0, "#1a0f3a"); g.addColorStop(0.55, "#4a1a6e"); g.addColorStop(1, "#ff5f6d");
  } else {
    g.addColorStop(0, "#0b1030"); g.addColorStop(1, "#2a1a4e");
  }
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  // far parallax: sun and rings
  const px = -cam.x * 0.08, py = -cam.y * 0.05;
  ctx.save();
  ctx.translate(VIEW_W / 2 + px, VIEW_H * 0.62 + py);
  ctx.fillStyle = "#ffb347";
  ctx.beginPath(); ctx.arc(0, 0, 260, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#ff7a59";
  for (let i = 0; i < 6; i++) { ctx.fillRect(-300, -120 + i * 44 + Math.sin(time * 0.6 + i) * 4, 600, 12); }
  ctx.strokeStyle = "rgba(255,255,255,0.25)";
  ctx.lineWidth = 6;
  for (let i = 1; i <= 3; i++) { ctx.beginPath(); ctx.arc(0, 0, 320 + i * 90 + Math.sin(time * 0.4 + i) * 6, 0, Math.PI * 2); ctx.stroke(); }
  ctx.restore();
  // mid parallax: ink pillars
  ctx.save();
  ctx.translate(VIEW_W / 2 - cam.x * 0.25 * cam.zoom, VIEW_H / 2 - cam.y * 0.25 * cam.zoom + 140);
  ctx.fillStyle = "#2b1544";
  for (let i = -6; i <= 6; i++) {
    const h = 260 + ((i * 7919) % 5) * 60;
    const w = 70 + ((i * 104729) % 3) * 30;
    ctx.fillRect(i * 320 - w / 2, 120 - h, w, h + 600);
    ctx.fillStyle = "#3a1d5c";
    ctx.fillRect(i * 320 - w / 2 - 12, 120 - h - 24, w + 24, 26);
    ctx.fillStyle = "#2b1544";
  }
  ctx.restore();
}

export function drawStage(ctx: CanvasRenderingContext2D, state: State, stage: Stage): void {
  stage.platforms.forEach((p, i) => {
    const o = platformOffset(state, i);
    const x1 = p.x1 + o.dx, x2 = p.x2 + o.dx, y = p.y + o.dy;
    if (p.solid) {
      const bottom = p.bottom! + o.dy;
      // slab
      ctx.fillStyle = INK;
      ctx.beginPath(); ctx.roundRect(x1 - 6, y - 6, x2 - x1 + 12, bottom - y + 12, 10); ctx.fill();
      const g = ctx.createLinearGradient(0, y, 0, bottom);
      g.addColorStop(0, "#5b2a86"); g.addColorStop(0.08, "#3a1a5e"); g.addColorStop(1, "#1b0f2e");
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.roundRect(x1, y, x2 - x1, bottom - y, 6); ctx.fill();
      // top face
      ctx.fillStyle = "#f7d6ff";
      ctx.fillRect(x1, y - 4, x2 - x1, 10);
      ctx.fillStyle = "#ff8fb1";
      ctx.fillRect(x1, y + 6, x2 - x1, 4);
      // edge markers
      ctx.fillStyle = "#ffe066";
      ctx.fillRect(x1, y - 4, 26, 10); ctx.fillRect(x2 - 26, y - 4, 26, 10);
      // stripes on the front face
      ctx.fillStyle = "rgba(255,255,255,0.05)";
      for (let sx = x1 + 40; sx < x2; sx += 120) ctx.fillRect(sx, y + 30, 40, bottom - y - 60);
    } else {
      ctx.fillStyle = INK;
      ctx.beginPath(); ctx.roundRect(x1 - 5, y - 5, x2 - x1 + 10, 24, 8); ctx.fill();
      ctx.fillStyle = "#f7d6ff";
      ctx.beginPath(); ctx.roundRect(x1, y - 2, x2 - x1, 16, 5); ctx.fill();
      ctx.fillStyle = "#c77dff";
      ctx.beginPath(); ctx.roundRect(x1, y + 6, x2 - x1, 8, 4); ctx.fill();
    }
  });
}

/** Soft shadow on the nearest surface below the fighter. */
export function drawShadow(ctx: CanvasRenderingContext2D, state: State, stage: Stage, x: number, y: number, w: number): void {
  let best = Infinity;
  stage.platforms.forEach((p, i) => {
    const o = platformOffset(state, i);
    if (x >= p.x1 + o.dx && x <= p.x2 + o.dx && p.y + o.dy >= y - 1 && p.y + o.dy < best) best = p.y + o.dy;
  });
  if (!isFinite(best)) return;
  const d = Math.min(1, (best - y) / 500);
  ctx.save();
  ctx.globalAlpha = 0.35 * (1 - d * 0.7);
  ctx.fillStyle = INK;
  ctx.beginPath(); ctx.ellipse(x, best + 2, w * (1 - d * 0.5), 7 * (1 - d * 0.5), 0, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}
