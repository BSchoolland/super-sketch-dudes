import { VIEW_H, VIEW_W } from "../../render/camera";
import { drawPaper, inkLine, FONT, PENCIL } from "../../render/paper";
import { viewBleed } from "../../input/pointer";
import { label, title, INK } from "../ui";

const TOP = 330, H = 400, SIZE = 300;
/** Where the band is: a press inside it fights. */
export const BAND = { top: TOP, bottom: TOP + H };
/** The band is in place this long after every slot has a fighter. */
export const BAND_IN = 0.4;

const ease = (k: number): number => 1 - Math.pow(1 - Math.min(1, Math.max(0, k)), 3);

/**
 * Every slot has a fighter: the lobby washes out under paper, and a band across the screen between two pairs of ink
 * lines says FIGHT!, double underlined. `age` is seconds since it came up: the lines sweep across, the word drops in,
 * then its underlines are drawn. `note` sits under it (the match loading).
 */
export function drawFightBand(ctx: CanvasRenderingContext2D, age: number, note = "", hot = false): void {
  const bleed = viewBleed(), left = -bleed.x - 10, right = VIEW_W + bleed.x + 10;
  ctx.save();
  ctx.fillStyle = `rgba(244,239,228,${0.72 * ease(age / 0.18)})`;
  ctx.fillRect(left, -bleed.y, right - left, VIEW_H + bleed.y * 2);
  ctx.restore();

  const open = ease(age / 0.22), top = TOP + (H / 2) * (1 - open), h = H * open;
  ctx.save();
  ctx.beginPath(); ctx.rect(left, top, right - left, h); ctx.clip();
  drawPaper(ctx, VIEW_W, VIEW_H);
  ctx.restore();
  ctx.save();
  ctx.fillStyle = "#f4efe4";
  if (left < 0) { ctx.fillRect(left, top, -left, h); ctx.fillRect(VIEW_W, top, right - VIEW_W, h); }
  ctx.restore();
  const sweep = left + (right - left) * ease(age / 0.25), bottom = top + h;
  const across = (y1: number, y2: number, width: number, color: string, seed: number) => inkLine(ctx, left, y1, sweep, y1 + (y2 - y1) * ((sweep - left) / (right - left)), color, width, seed);
  // hovered, it lifts like a selected card: heavier ink
  const ink = hot ? 5 : 3, pencil = hot ? 2.4 : 1.6;
  across(top + 6, top - 4, ink, INK, 1);
  across(top + 18, top + 10, pencil, PENCIL, 2);
  across(bottom - 6, bottom + 4, ink, INK, 3);
  across(bottom - 18, bottom - 8, pencil, PENCIL, 4);

  const drop = ease((age - 0.08) / 0.22);
  if (drop <= 0) return;
  const base = TOP + 310;
  ctx.save();
  ctx.globalAlpha = drop;
  ctx.translate(VIEW_W / 2, base - 120 * (1 - drop) - (hot ? 12 : 0));
  const s = (1 + 0.25 * (1 - drop)) * (hot ? 1.05 : 1);
  ctx.scale(s, s);
  title(ctx, "FIGHT!", 0, 0, SIZE, INK);
  ctx.restore();
  ctx.save();
  ctx.font = `900 ${SIZE}px ${FONT}`;
  const w = ctx.measureText("FIGHT!").width;
  ctx.restore();
  const x1 = VIEW_W / 2 - w / 2, x2 = VIEW_W / 2 + w / 2;
  const under = ease((age - 0.24) / 0.16);
  if (under > 0) {
    inkLine(ctx, x1 + 30, base + 10, x1 + 30 + (x2 - 20 - x1 - 30) * under, base + 10 - 10 * under, INK, 6, 5);
    inkLine(ctx, x1 + 60, base + 27, x1 + 60 + (x2 - 80 - x1 - 60) * under, base + 27 - 8 * under, INK, 2.5, 6);
  }
  if (note) label(ctx, note, VIEW_W / 2, base + 72, 34, PENCIL, "center", 400);
}
