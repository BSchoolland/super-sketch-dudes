import { VIEW_H, VIEW_W } from "../render/camera";
import type { MenuInput } from "../input/devices";

export const INK = "#12101a";
export const FONT = "'Trebuchet MS', 'Segoe UI', system-ui, sans-serif";

export interface Screen {
  update(dt: number, menu: MenuInput): Screen | null;
  draw(ctx: CanvasRenderingContext2D, dt: number): void;
  /** Called when the screen becomes active. */
  enter?(): void;
}

export function bg(ctx: CanvasRenderingContext2D, t: number): void {
  const g = ctx.createLinearGradient(0, 0, VIEW_W, VIEW_H);
  g.addColorStop(0, "#1a0f3a"); g.addColorStop(0.6, "#3a1560"); g.addColorStop(1, "#ff5f6d");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  // drifting ink shapes
  ctx.save();
  ctx.globalAlpha = 0.12;
  ctx.fillStyle = "#fff";
  for (let i = 0; i < 14; i++) {
    const x = ((i * 733 + t * (20 + i * 3)) % (VIEW_W + 400)) - 200;
    const y = (i * 419) % VIEW_H;
    const r = 30 + (i % 5) * 22;
    ctx.beginPath(); ctx.arc(x, y + Math.sin(t + i) * 20, r, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

export function title(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, color = "#fff", align: CanvasTextAlign = "center"): void {
  ctx.save();
  ctx.textAlign = align;
  ctx.font = `900 ${size}px ${FONT}`;
  ctx.lineJoin = "round";
  ctx.lineWidth = Math.max(4, size * 0.12);
  ctx.strokeStyle = INK;
  ctx.strokeText(text, x, y);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
  ctx.restore();
}

export function label(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, color = "#fff", align: CanvasTextAlign = "center", weight = 700): void {
  ctx.save();
  ctx.textAlign = align;
  ctx.font = `${weight} ${size}px ${FONT}`;
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
  ctx.restore();
}

export function card(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string, selected: boolean, alpha = 1): void {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = INK;
  ctx.beginPath(); ctx.roundRect(x - 6, y - 6, w + 12, h + 12, 18); ctx.fill();
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.roundRect(x, y, w, h, 14); ctx.fill();
  if (selected) {
    ctx.strokeStyle = "#fff"; ctx.lineWidth = 6;
    ctx.beginPath(); ctx.roundRect(x - 3, y - 3, w + 6, h + 6, 16); ctx.stroke();
  }
  ctx.restore();
}

export function hint(ctx: CanvasRenderingContext2D, text: string): void {
  label(ctx, text, VIEW_W / 2, VIEW_H - 36, 22, "rgba(255,255,255,0.8)");
}

export interface Settings { volume: number; music: number; shake: number; tapJump: boolean; rumble: boolean; stocks: number; time: number; cpuLevel: number; name: string }
export const settings: Settings = { volume: 0.8, music: 0.5, shake: 1, tapJump: true, rumble: true, stocks: 3, time: 0, cpuLevel: 5, name: "" };
export function loadSettings(): void {
  try { Object.assign(settings, JSON.parse(localStorage.getItem("ringout.settings") ?? "{}")); } catch { /* ignore */ }
}
export function saveSettings(): void {
  localStorage.setItem("ringout.settings", JSON.stringify(settings));
}
