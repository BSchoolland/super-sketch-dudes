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

/** Pointer in logical view coordinates; main.ts feeds it, endPointerFrame clears the click. */
export const pointer = { x: -1, y: -1, clicked: false, present: false };
export function endPointerFrame(): void { pointer.clicked = false; }
export function hover(x: number, y: number, w: number, h: number): boolean {
  return pointer.present && pointer.x >= x && pointer.x <= x + w && pointer.y >= y && pointer.y <= y + h;
}
export function clicked(x: number, y: number, w: number, h: number): boolean {
  return pointer.clicked && hover(x, y, w, h);
}

/** A screen can hand off to another screen from inside draw (button handlers run there). */
let handoff: Screen | null = null;
export function goTo(s: Screen): void { handoff = s; }
export function takeHandoff(): Screen | null { const s = handoff; handoff = null; return s; }

/** Draws a labelled paper button; returns true on the frame it is clicked. `focused` = keyboard focus. */
export function button(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, text: string, opts: { focused?: boolean; key?: string; size?: number; disabled?: boolean } = {}): boolean {
  const over = !opts.disabled && hover(x, y, w, h);
  card(ctx, x, y, w, h, "", !!opts.focused || over, opts.disabled ? 0.45 : 1);
  const size = opts.size ?? Math.min(30, h * 0.46);
  label(ctx, text, x + w / 2, y + h / 2 + size * 0.36, size, INK, "center", 900);
  if (opts.key) label(ctx, opts.key, x + w - 10, y + h - 8, Math.max(11, size * 0.42), "rgba(41,39,34,0.65)", "right", 700);
  if (over) document.body.style.cursor = "pointer";
  return !opts.disabled && clicked(x, y, w, h);
}

/** ◀ / ▶ arrow hit targets around a value; returns -1, 0 or 1 for the frame's click. */
export function arrows(ctx: CanvasRenderingContext2D, cx: number, cy: number, halfSpan: number, size = 30): number {
  const boxes: [number, number][] = [[cx - halfSpan - size * 0.9, -1], [cx + halfSpan - size * 0.1, 1]];
  let out = 0;
  for (const [bx, dir] of boxes) {
    const over = hover(bx, cy - size * 0.9, size, size * 1.2);
    label(ctx, dir < 0 ? "◀" : "▶", bx + size / 2, cy, size * (over ? 1.15 : 1), over ? "#c8402c" : INK);
    if (over) document.body.style.cursor = "pointer";
    if (clicked(bx, cy - size * 0.9, size, size * 1.2)) out = dir;
  }
  return out;
}

/** Common bottom-left BACK button; returns true when pressed by click. */
export function backButton(ctx: CanvasRenderingContext2D, text = "BACK"): boolean {
  return button(ctx, 40, VIEW_H - 100, 200, 64, text, { key: "Esc", size: 26 });
}
