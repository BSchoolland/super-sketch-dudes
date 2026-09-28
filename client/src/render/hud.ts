import { FONT, INK, PAPER, canvas2d, inkArc, paperCard } from "./paper";
import type { State } from "../../../shared/types";
import { roster } from "../../../shared/fighters/index";
import { tierName } from "../../../shared/cpu-skill";
import { VIEW_H, VIEW_W } from "./camera";

export const SLOT_COLORS = ["#e4483f", "#287ad4", "#ddb51d", "#329854"];

export interface HudState { bump: number[]; lastPercent: number[]; cards: ({ key: string; canvas: HTMLCanvasElement } | null)[] }
export function createHud(n: number): HudState { return { bump: new Array(n).fill(0), lastPercent: new Array(n).fill(0), cards: new Array(n).fill(null) }; }

const CARD_W = 300, CARD_H = 120, CARD_PAD = 12;

/**
 * A player's card, name, fighter and stock dots change a few times a match, so they are drawn once into a
 * bitmap at the canvas scale and blitted; the wobbly card border and dot rings cost more per frame than
 * the fight did. The live percent and bars go on top.
 */
function playerCard(hud: HudState, i: number, key: string, s: number, name: string, fighter: string, stocks: number): HTMLCanvasElement {
  const have = hud.cards[i];
  if (have && have.key === key) return have.canvas;
  const [canvas, g] = canvas2d(Math.ceil((CARD_W + CARD_PAD * 2) * s), Math.ceil((CARD_H + CARD_PAD * 2) * s));
  g.scale(s, s);
  g.translate(CARD_PAD, CARD_PAD);
  paperCard(g, 0, 0, CARD_W, CARD_H);
  g.textAlign = "left";
  g.fillStyle = SLOT_COLORS[i] ?? "#fff";
  g.font = `700 20px ${FONT}`;
  g.fillText(name, 20, 34);
  g.fillStyle = INK;
  g.font = `600 14px ${FONT}`;
  g.fillText(fighter, 20, 54, CARD_W - 40);
  const dots = Math.min(5, stocks);
  for (let d = 0; d < dots; d++) {
    g.fillStyle = SLOT_COLORS[i];
    g.beginPath(); g.arc(28 + d * 24, 88, 8, 0, Math.PI * 2); g.fill();
    inkArc(g, 28 + d * 24, 88, 8, 0, Math.PI * 2, INK, 1.5);
  }
  if (stocks > 5) { g.fillStyle = INK; g.font = `700 16px ${FONT}`; g.fillText(`×${stocks}`, 28 + dots * 24, 94); }
  hud.cards[i] = { key, canvas };
  return canvas;
}

export function drawHud(ctx: CanvasRenderingContext2D, state: State, hud: HudState, dt: number, names: string[]): void {
  const n = state.fighters.length;
  const cardW = CARD_W, gap = 40;
  const total = n * cardW + (n - 1) * gap;
  const x0 = (VIEW_W - total) / 2;
  const y = VIEW_H - 150;
  const s = Math.min(2, Math.max(0.5, Math.round(ctx.getTransform().a * 4) / 4));
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
    const name = names[i] ?? `P${i + 1}`;
    const card = playerCard(hud, i, `${name}|${def.name}|${f.stocks}|${s}`, s, name, def.name, f.stocks);
    ctx.drawImage(card, x - CARD_PAD, y - CARD_PAD, CARD_W + CARD_PAD * 2, CARD_H + CARD_PAD * 2);
    // percent
    const shake = b * 6;
    const scale = 1 + b * 0.35;
    ctx.save();
    ctx.translate(x + cardW - 24 + (Math.random() - 0.5) * shake, y + 80 + (Math.random() - 0.5) * shake);
    ctx.scale(scale, scale);
    ctx.textAlign = "right";
    ctx.font = `900 58px ${FONT}`;
    ctx.fillStyle = INK;
    ctx.fillText(`${Math.floor(f.percent)}`, 0, 0);
    ctx.font = `900 26px ${FONT}`;
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
    const m = Math.floor(secs / 60), sec = secs % 60;
    ctx.textAlign = "center";
    ctx.font = `900 44px ${FONT}`;
    ctx.fillStyle = INK;
    ctx.fillText(`${m}:${sec.toString().padStart(2, "0")}`, VIEW_W / 2, 64);
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
