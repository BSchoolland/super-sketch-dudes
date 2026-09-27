import { FONT, INK, PAPER, inkArc, paperCard } from "./paper";
import type { State } from "../../../shared/types";
import { roster } from "../../../shared/fighters/index";
import { tierName } from "../../../shared/cpu-skill";
import { VIEW_H, VIEW_W } from "./camera";

export const SLOT_COLORS = ["#e4483f", "#287ad4", "#ddb51d", "#329854"];

export interface HudState { bump: number[]; lastPercent: number[] }
export function createHud(n: number): HudState { return { bump: new Array(n).fill(0), lastPercent: new Array(n).fill(0) }; }

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
    paperCard(ctx, x, y, cardW, 120);
    // name
    ctx.fillStyle = SLOT_COLORS[i] ?? "#fff";
    ctx.font = `700 20px ${FONT}`;
    ctx.fillText(names[i] ?? `P${i + 1}`, x + 20, y + 34);
    ctx.fillStyle = INK;
    ctx.font = `600 14px ${FONT}`;
    ctx.fillText(def.name, x + 20, y + 54, cardW - 40);
    // stocks: dots up to five, a number past that
    const dots = Math.min(5, f.stocks);
    for (let s = 0; s < dots; s++) {
      ctx.fillStyle = SLOT_COLORS[i];
      ctx.beginPath(); ctx.arc(x + 28 + s * 24, y + 88, 8, 0, Math.PI * 2); ctx.fill();
      inkArc(ctx, x + 28 + s * 24, y + 88, 8, 0, Math.PI * 2, INK, 1.5);
    }
    if (f.stocks > 5) { ctx.fillStyle = INK; ctx.font = `700 16px ${FONT}`; ctx.textAlign = "left"; ctx.fillText(`×${f.stocks}`, x + 28 + dots * 24, y + 94); }
    // percent
    const shake = b * 6;
    const scale = 1 + b * 0.35;
    ctx.save();
    ctx.translate(x + cardW - 24 + (Math.random() - 0.5) * shake, y + 80 + (Math.random() - 0.5) * shake);
    ctx.scale(scale, scale);
    ctx.textAlign = "right";
    ctx.font = `900 58px ${FONT}`;
    ctx.lineWidth = 0.7; ctx.strokeStyle = INK; ctx.lineJoin = "round";
    const txt = `${Math.floor(f.percent)}`;
    ctx.strokeText(txt, 0, 0);
    ctx.fillStyle = INK;
    ctx.fillText(txt, 0, 0);
    ctx.font = `900 26px ${FONT}`;
    ctx.strokeText("%", 30, 0);
    ctx.fillText("%", 30, 0);
    ctx.restore();
    // bars: the fighter's own numbers, scaled by their max; a tripped latch draws its fill in paper
    let mi = 0;
    for (const k in def.bars) {
      const b = def.bars[k];
      if (b.show && !b.show(f)) continue;
      const mx = x + 20, my = y + 104 - mi++ * 9;
      ctx.fillStyle = INK; ctx.fillRect(mx - 1, my - 1, 122, 7);
      ctx.fillStyle = f.tripped[k] ? PAPER : SLOT_COLORS[i]; ctx.fillRect(mx, my, 120 * Math.max(0, Math.min(1, f.bars[k] / b.max)), 5);
      ctx.fillStyle = SLOT_COLORS[i]; ctx.font = `700 9px ${FONT}`; ctx.textAlign = "left";
      ctx.fillText(b.label, mx + 124, my + 6);
    }
    if (f.cpu) { ctx.fillStyle = INK; ctx.font = `600 12px ${FONT}`; ctx.textAlign = "left"; ctx.fillText(tierName(f.cpu), x + 120, y + 34); }
  });
  ctx.globalAlpha = 1;
  // timer
  if (state.rules.time > 0) {
    const secs = Math.max(0, Math.ceil(state.timer / 60));
    const m = Math.floor(secs / 60), s = secs % 60;
    ctx.textAlign = "center";
    ctx.font = `900 44px ${FONT}`;
    ctx.lineWidth = 0.7; ctx.strokeStyle = INK;
    const t = `${m}:${s.toString().padStart(2, "0")}`;
    ctx.strokeText(t, VIEW_W / 2, 64);
    ctx.fillStyle = INK;
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
  ctx.fillStyle = PAPER;
  ctx.globalAlpha = a * 0.95;
  ctx.fillRect(-VIEW_W, -90, VIEW_W * 2, 180);
  ctx.globalAlpha = a;
  ctx.font = `900 120px ${FONT}`;
  ctx.lineWidth = 1; ctx.strokeStyle = INK; ctx.lineJoin = "round";
  ctx.strokeText(text, 0, 30);
  ctx.fillStyle = color === "#fff" ? INK : color;
  ctx.fillText(text, 0, 30);
  if (sub) {
    ctx.font = `700 32px ${FONT}`;
    ctx.lineWidth = 0.6;
    ctx.strokeText(sub, 0, 76);
    ctx.fillStyle = INK;
    ctx.fillText(sub, 0, 76);
  }
  ctx.restore();
}
