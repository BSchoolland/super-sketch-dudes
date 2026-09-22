import { drawPaper, paperCard, INK, FONT } from "../render/paper";
export { INK, FONT } from "../render/paper";
import { VIEW_H, VIEW_W } from "../render/camera";
import type { MenuInput } from "../input/devices";

export interface Screen {
  update(dt: number, menu: MenuInput): Screen | null;
  draw(ctx: CanvasRenderingContext2D, dt: number): void;
  /** Called when the screen becomes active. */
  enter?(): void;
}

export function bg(ctx: CanvasRenderingContext2D, _t: number): void {
  drawPaper(ctx, VIEW_W, VIEW_H);
}

export function title(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, color = INK, align: CanvasTextAlign = "center"): void {
  ctx.save();
  ctx.textAlign = align;
  ctx.font = `900 ${size}px ${FONT}`;
  ctx.lineJoin = "round";
  ctx.lineWidth = Math.max(0.5, size * 0.009);
  ctx.strokeStyle = INK;
  ctx.strokeText(text, x, y);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
  ctx.restore();
}

export function label(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, color = INK, align: CanvasTextAlign = "center", weight = 700): void {
  ctx.save();
  ctx.textAlign = align;
  ctx.font = `${weight} ${size}px ${FONT}`;
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
  ctx.restore();
}

export function card(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, _color: string, selected: boolean, alpha = 1): void {
  ctx.save();
  ctx.globalAlpha = alpha;
  paperCard(ctx, x, y, w, h, selected);
  ctx.restore();
}

export function hint(ctx: CanvasRenderingContext2D, text: string): void {
  label(ctx, text, VIEW_W / 2, VIEW_H - 36, 22, "rgba(41,39,34,0.8)");
}

export interface Settings { volume: number; music: number; shake: number; tapJump: boolean; rumble: boolean; stocks: number; time: number; cpuLevel: number; name: string }
export const settings: Settings = { volume: 0.8, music: 0.5, shake: 1, tapJump: true, rumble: true, stocks: 3, time: 0, cpuLevel: 5, name: "" };
export function loadSettings(): void {
  try { Object.assign(settings, JSON.parse(localStorage.getItem("sketchbattle.settings") ?? "{}")); } catch { /* ignore */ }
}
export function saveSettings(): void {
  localStorage.setItem("sketchbattle.settings", JSON.stringify(settings));
}
