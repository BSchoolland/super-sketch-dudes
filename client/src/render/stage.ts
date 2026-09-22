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
  } else if (stage.theme === "rooftops") {
    g.addColorStop(0, "#070a1f"); g.addColorStop(0.6, "#1b1547"); g.addColorStop(1, "#5a2a7a");
  } else {
    g.addColorStop(0, "#03040f"); g.addColorStop(0.7, "#0e1440"); g.addColorStop(1, "#2a1a4e");
  }
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  if (stage.theme === "rooftops") { drawRooftopsBackdrop(ctx, cam, time); return; }
  if (stage.theme === "kessler") { drawKesslerBackdrop(ctx, cam, time); return; }
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
      if (stage.theme === "rooftops") { g.addColorStop(0, "#3a2f6e"); g.addColorStop(0.08, "#26204d"); g.addColorStop(1, "#12101f"); }
      else if (stage.theme === "kessler") { g.addColorStop(0, "#4b6b8a"); g.addColorStop(0.08, "#2e4560"); g.addColorStop(1, "#111a2a"); }
      else { g.addColorStop(0, "#5b2a86"); g.addColorStop(0.08, "#3a1a5e"); g.addColorStop(1, "#1b0f2e"); }
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
    } else if (p.motion) {
      // orbiting debris chunk: an angular slab with a lit top
      ctx.fillStyle = INK;
      ctx.beginPath(); ctx.moveTo(x1 - 6, y - 6); ctx.lineTo(x2 + 6, y - 6); ctx.lineTo(x2 - 4, y + 44); ctx.lineTo(x1 + 30, y + 58); ctx.lineTo(x1 - 14, y + 30); ctx.closePath(); ctx.fill();
      ctx.fillStyle = "#7fa6c7";
      ctx.beginPath(); ctx.moveTo(x1, y); ctx.lineTo(x2, y); ctx.lineTo(x2 - 8, y + 38); ctx.lineTo(x1 + 28, y + 50); ctx.lineTo(x1 - 8, y + 26); ctx.closePath(); ctx.fill();
      ctx.fillStyle = "#eef7ff";
      ctx.fillRect(x1, y - 2, x2 - x1, 8);
      ctx.fillStyle = "#ff8c1a";
      ctx.fillRect(x1 + 10, y + 16, 14, 8);
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

function hash(i: number): number { return ((i * 2654435761) >>> 0) % 1000 / 1000; }

function drawRooftopsBackdrop(ctx: CanvasRenderingContext2D, cam: Camera, time: number): void {
  // stars
  ctx.save();
  ctx.fillStyle = "#fff";
  for (let i = 0; i < 80; i++) {
    const x = (hash(i) * VIEW_W * 1.4 - cam.x * 0.03) % VIEW_W, y = hash(i + 99) * VIEW_H * 0.6;
    ctx.globalAlpha = 0.3 + hash(i + 7) * 0.6 * (0.6 + 0.4 * Math.sin(time * 2 + i));
    ctx.fillRect(((x % VIEW_W) + VIEW_W) % VIEW_W, y, 2, 2);
  }
  ctx.restore();
  // moon
  ctx.save();
  ctx.translate(VIEW_W * 0.78 - cam.x * 0.05, VIEW_H * 0.22 - cam.y * 0.03);
  ctx.fillStyle = "#fff1a8";
  ctx.beginPath(); ctx.arc(0, 0, 90, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#e8d48a";
  ctx.beginPath(); ctx.arc(-30, 20, 14, 0, Math.PI * 2); ctx.arc(25, -25, 9, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  // skyline layers with neon signs
  const layers = [
    { p: 0.12, y: VIEW_H * 0.55, color: "#0d0f33", h: 220, w: 140, gap: 30, neon: false },
    { p: 0.22, y: VIEW_H * 0.62, color: "#181a4a", h: 300, w: 120, gap: 26, neon: true },
    { p: 0.35, y: VIEW_H * 0.72, color: "#241d5e", h: 360, w: 160, gap: 40, neon: true },
  ];
  const neonColors = ["#ff4d8d", "#35e0ff", "#ffc43a", "#4dff88"];
  for (const L of layers) {
    ctx.save();
    const shift = -cam.x * L.p * cam.zoom;
    ctx.translate(VIEW_W / 2 + shift, VIEW_H / 2 - cam.y * L.p * cam.zoom * 0.5);
    for (let i = -10; i <= 10; i++) {
      const w = L.w + hash(i + 50) * 60, h = L.h + hash(i + 3) * 260;
      const x = i * (L.w + L.gap + 60) - w / 2;
      const top = L.y - VIEW_H / 2 - h;
      ctx.fillStyle = L.color;
      ctx.fillRect(x, top, w, h + 800);
      // windows
      ctx.fillStyle = "rgba(255,241,168,0.18)";
      for (let wy = top + 24; wy < top + h; wy += 34) for (let wx = x + 14; wx < x + w - 14; wx += 26) if (hash((wx * 7 + wy) | 0) > 0.55) ctx.fillRect(wx, wy, 12, 16);
      if (L.neon && hash(i + 21) > 0.5) {
        ctx.fillStyle = neonColors[Math.abs(i) % neonColors.length];
        ctx.globalAlpha = 0.75 + 0.25 * Math.sin(time * 3 + i);
        ctx.fillRect(x + w * 0.2, top + 40, w * 0.6, 14);
        ctx.globalAlpha = 1;
      }
    }
    ctx.restore();
  }
}

function drawKesslerBackdrop(ctx: CanvasRenderingContext2D, cam: Camera, time: number): void {
  ctx.save();
  ctx.fillStyle = "#fff";
  for (let i = 0; i < 160; i++) {
    const x = ((hash(i) * VIEW_W * 1.5 - cam.x * 0.02) % VIEW_W + VIEW_W) % VIEW_W, y = hash(i + 99) * VIEW_H;
    ctx.globalAlpha = 0.25 + hash(i + 7) * 0.7 * (0.7 + 0.3 * Math.sin(time * 1.5 + i));
    const s = hash(i + 13) > 0.9 ? 3 : 2;
    ctx.fillRect(x, y, s, s);
  }
  ctx.restore();
  // a big ringed planet, far back
  ctx.save();
  ctx.translate(VIEW_W * 0.25 - cam.x * 0.04, VIEW_H * 0.3 - cam.y * 0.03);
  ctx.fillStyle = "#35e0ff";
  ctx.beginPath(); ctx.arc(0, 0, 150, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#1d8fb0";
  ctx.beginPath(); ctx.arc(40, -30, 40, 0, Math.PI * 2); ctx.arc(-50, 50, 26, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.7)"; ctx.lineWidth = 12;
  ctx.beginPath(); ctx.ellipse(0, 0, 260, 60, -0.3, 0, Math.PI * 2); ctx.stroke();
  ctx.restore();
  // orbiting debris specks
  ctx.save();
  ctx.fillStyle = "#7fa6c7";
  for (let i = 0; i < 40; i++) {
    const a = time * (0.1 + hash(i) * 0.2) + i;
    const rx = 500 + hash(i + 5) * 700, ry = 120 + hash(i + 9) * 200;
    const x = VIEW_W / 2 + Math.cos(a) * rx - cam.x * 0.1 * cam.zoom, y = VIEW_H * 0.55 + Math.sin(a) * ry - cam.y * 0.1 * cam.zoom;
    ctx.globalAlpha = 0.5;
    ctx.fillRect(x, y, 4 + hash(i + 2) * 6, 4 + hash(i + 3) * 6);
  }
  ctx.restore();
}
