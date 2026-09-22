import type { State } from "../../../shared/types";
import { roster } from "../../../shared/fighters/index";
import { VIEW_H, VIEW_W } from "./camera";

export const SLOT_COLORS = ["#ff4d4d", "#4da6ff", "#ffd23f", "#4dff88"];
const INK = "#12101a";

export interface HudState { bump: number[]; lastPercent: number[] }
export function createHud(n: number): HudState { return { bump: new Array(n).fill(0), lastPercent: new Array(n).fill(0) }; }

function percentColor(p: number): string {
  if (p < 50) return "#ffffff";
  if (p < 100) return "#ffe066";
  if (p < 150) return "#ff9f43";
  return "#ff3b3b";
}

export function drawHud(ctx: CanvasRenderingContext2D, state: State, hud: HudState, dt: number, names: string[]): void {
  const n = state.fighters.length;
  const cardW = 300, gap = 40;
  const total = n * cardW + (n - 1) * gap;
  const x0 = (VIEW_W - total) / 2;
  const y = VIEW_H - 150;
  ctx.save();
  ctx.textAlign = "left";
  state.fighters.forEach((f, i) => {
    const def = roster[f.id];
    const x = x0 + i * (cardW + gap);
    if (f.percent !== hud.lastPercent[i]) { hud.bump[i] = 1; hud.lastPercent[i] = f.percent; }
    hud.bump[i] = Math.max(0, hud.bump[i] - dt * 4);
    const b = hud.bump[i];
    const dead = f.stocks <= 0;
    ctx.globalAlpha = dead ? 0.35 : 1;
    // card
    ctx.fillStyle = INK;
    ctx.beginPath(); ctx.roundRect(x - 6, y - 6, cardW + 12, 132, 16); ctx.fill();
    ctx.fillStyle = SLOT_COLORS[i] ?? "#fff";
    ctx.beginPath(); ctx.roundRect(x, y, cardW, 120, 12); ctx.fill();
    ctx.fillStyle = "rgba(18,16,26,0.82)";
    ctx.beginPath(); ctx.roundRect(x + 8, y + 8, cardW - 16, 104, 8); ctx.fill();
    // name
    ctx.fillStyle = SLOT_COLORS[i] ?? "#fff";
    ctx.font = "700 20px 'Trebuchet MS', sans-serif";
    ctx.fillText(names[i] ?? `P${i + 1}`, x + 20, y + 34);
    ctx.fillStyle = "#cfc8e0";
    ctx.font = "600 14px 'Trebuchet MS', sans-serif";
    ctx.fillText(def.name, x + 20, y + 54);
    // stocks: dots up to five, a number past that
    const dots = Math.min(5, f.stocks);
    for (let s = 0; s < dots; s++) {
      ctx.fillStyle = def.palette.colors[def.palette.accent] ?? "#fff";
      ctx.beginPath(); ctx.arc(x + 28 + s * 24, y + 88, 8, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = INK; ctx.lineWidth = 3; ctx.stroke();
    }
    if (f.stocks > 5) { ctx.fillStyle = "#fff"; ctx.font = "700 16px 'Trebuchet MS', sans-serif"; ctx.textAlign = "left"; ctx.fillText(`×${f.stocks}`, x + 28 + dots * 24, y + 94); }
    // percent
    const shake = b * 6;
    const scale = 1 + b * 0.35;
    ctx.save();
    ctx.translate(x + cardW - 24 + (Math.random() - 0.5) * shake, y + 80 + (Math.random() - 0.5) * shake);
    ctx.scale(scale, scale);
    ctx.textAlign = "right";
    ctx.font = "900 58px 'Trebuchet MS', sans-serif";
    ctx.lineWidth = 8; ctx.strokeStyle = INK; ctx.lineJoin = "round";
    const txt = `${Math.floor(f.percent)}`;
    ctx.strokeText(txt, 0, 0);
    ctx.fillStyle = percentColor(f.percent);
    ctx.fillText(txt, 0, 0);
    ctx.font = "900 26px 'Trebuchet MS', sans-serif";
    ctx.strokeText("%", 30, 0);
    ctx.fillText("%", 30, 0);
    ctx.restore();
    // meters
    const meters = def.meters ?? [];
    meters.forEach((m, mi) => {
      const mx = x + 20, my = y + 102 - mi * 8 - (meters.length - 1) * 0;
      ctx.fillStyle = INK; ctx.fillRect(mx - 1, my - 1, 122, 6);
      ctx.fillStyle = m.color; ctx.fillRect(mx, my, 120 * Math.max(0, Math.min(1, m.get(f))), 4);
    });
    if (f.cpu) { ctx.fillStyle = "#cfc8e0"; ctx.font = "600 12px 'Trebuchet MS', sans-serif"; ctx.textAlign = "left"; ctx.fillText(`CPU ${f.cpu}`, x + 120, y + 34); }
  });
  ctx.globalAlpha = 1;
  // timer
  if (state.rules.time > 0) {
    const secs = Math.max(0, Math.ceil(state.timer / 60));
    const m = Math.floor(secs / 60), s = secs % 60;
    ctx.textAlign = "center";
    ctx.font = "900 44px 'Trebuchet MS', sans-serif";
    ctx.lineWidth = 8; ctx.strokeStyle = INK;
    const t = `${m}:${s.toString().padStart(2, "0")}`;
    ctx.strokeText(t, VIEW_W / 2, 64);
    ctx.fillStyle = secs <= 10 ? "#ff3b3b" : "#fff";
    ctx.fillText(t, VIEW_W / 2, 64);
  }
  ctx.restore();
}

export function drawBanner(ctx: CanvasRenderingContext2D, text: string, sub: string, color: string, t: number): void {
  const a = Math.min(1, t * 3);
  ctx.save();
  ctx.globalAlpha = a;
  ctx.textAlign = "center";
  ctx.translate(VIEW_W / 2, VIEW_H / 2 - 40);
  const s = 1 + (1 - a) * 0.6;
  ctx.scale(s, s);
  ctx.fillStyle = INK;
  ctx.globalAlpha = a * 0.7;
  ctx.fillRect(-VIEW_W, -90, VIEW_W * 2, 180);
  ctx.globalAlpha = a;
  ctx.font = "900 120px 'Trebuchet MS', sans-serif";
  ctx.lineWidth = 14; ctx.strokeStyle = INK; ctx.lineJoin = "round";
  ctx.strokeText(text, 0, 30);
  ctx.fillStyle = color;
  ctx.fillText(text, 0, 30);
  if (sub) {
    ctx.font = "700 32px 'Trebuchet MS', sans-serif";
    ctx.lineWidth = 6;
    ctx.strokeText(sub, 0, 76);
    ctx.fillStyle = "#fff";
    ctx.fillText(sub, 0, 76);
  }
  ctx.restore();
}
