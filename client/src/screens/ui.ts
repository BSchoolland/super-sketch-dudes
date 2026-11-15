import { DEFAULT_TIER } from "../../../shared/cpu-skill";
import { drawPaper, paperCard, INK, FONT } from "../render/paper";
export { INK, FONT } from "../render/paper";
import { VIEW_H, VIEW_W } from "../render/camera";
import type { MenuInput } from "../input/devices";
import { bindingsOf, overridesOf, setOverrides, type KeyBindings } from "../input/bindings";
import { noteControls } from "../telemetry/events";
import { pointer, viewScale } from "../input/pointer";
import { onTouchscreen, setTouchSettings, type TouchSetting } from "../input/touch";

export interface Screen {
  update(dt: number, menu: MenuInput): Screen | null;
  draw(ctx: CanvasRenderingContext2D, dt: number): void;
  /** Called when the screen becomes active. */
  enter?(): void;
  /** The app is dropping this screen without its say (the account signed out): release what it holds. */
  abandon?(): void;
}

export function bg(ctx: CanvasRenderingContext2D, _t: number): void {
  drawPaper(ctx, VIEW_W, VIEW_H);
}

/** Sets the font, shrunk so the text fits maxW when given. Returns the size used. */
function fitFont(ctx: CanvasRenderingContext2D, text: string, weight: number, size: number, maxW?: number): number {
  ctx.font = `${weight} ${size}px ${FONT}`;
  const w = maxW ? ctx.measureText(text).width : 0;
  if (maxW && w > maxW) { size *= maxW / w; ctx.font = `${weight} ${size}px ${FONT}`; }
  return size;
}

export function title(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, color = INK, align: CanvasTextAlign = "center", maxW?: number): void {
  ctx.save();
  ctx.textAlign = align;
  size = fitFont(ctx, text, 900, size, maxW);
  ctx.lineJoin = "round";
  ctx.lineWidth = Math.max(0.5, size * 0.009);
  ctx.strokeStyle = INK;
  ctx.strokeText(text, x, y);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
  ctx.restore();
}

export function label(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, color = INK, align: CanvasTextAlign = "center", weight = 700, maxW?: number): void {
  ctx.save();
  ctx.textAlign = align;
  fitFont(ctx, text, weight, size, maxW);
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

/** Key and gamepad words (Esc, Enter, arrows) mean something: the player isn't on the touchscreen. */
export const keysInHand = (): boolean => !onTouchscreen();

/** What a pointer press is called to this player. */
export const tapWord = (): string => (onTouchscreen() ? "tap" : "click");

/** The view is drawn under half size (a phone, a small window): text and tap targets grow to stay readable and tappable. */
export const small = (): boolean => viewScale() < 0.5;

/** `size` in view pixels, grown on a small screen to show at least `css` CSS pixels. */
export function grow(size: number, css: number): number {
  return small() ? Math.max(size, css / viewScale()) : size;
}

export function hint(ctx: CanvasRenderingContext2D, text: string): void {
  label(ctx, text, VIEW_W / 2, VIEW_H - 36, grow(22, 12), "rgba(41,39,34,0.8)", "center", 700, small() ? VIEW_W - 640 : undefined);
}

/** A hint about keys or a gamepad: only for a player using them. */
export function keyHint(ctx: CanvasRenderingContext2D, text: string): void {
  if (keysInHand()) hint(ctx, text);
}

export interface Settings {
  volume: number; music: number;
  /** Index into MAYHEM: how often a new fighter drops into the title screen fight. */
  mayhem: number; tapJump: boolean; rumble: boolean; stocks: number; time: number; cpuTier: number;
  /** The draw pad's ADVANCED toggle: the colour wheel. */
  advanced: boolean;
  /** The stages drawn from art (Stadium, Forest, Cliffs, Final Draft) in the stage picker. */
  extraStages: boolean;
  /** Keyboard player 1's rebound actions; everything else keeps its default key. */
  keys: Partial<KeyBindings>;
  /** Keyboard player 2's, the same way. */
  keys2: Partial<KeyBindings>;
  /** The on-screen controls in a match: while the player is on the touchscreen, always, or never. */
  touch: TouchSetting;
  /** Their size, 1 = 100%. */
  touchSize: number;
}
/** MENU MAYHEM's steps: seconds between fighters dropping into the title screen fight. */
export const MAYHEM: { name: string; seconds: number }[] = [
  { name: "CALM", seconds: 20 }, { name: "LIVELY", seconds: 10 }, { name: "ROWDY", seconds: 6 }, { name: "MAYHEM", seconds: 3 },
];
export const settings: Settings = { volume: 0.8, music: 0.5, mayhem: 3, tapJump: true, rumble: true, stocks: 3, time: 0, cpuTier: DEFAULT_TIER, advanced: false, extraStages: false, keys: {}, keys2: {}, touch: "auto", touchSize: 1 };
export function loadSettings(): void {
  try { Object.assign(settings, JSON.parse(localStorage.getItem("sketchbattle.settings") ?? "{}")); } catch { /* ignore */ }
  applyKeys();
}
export function saveSettings(): void {
  localStorage.setItem("sketchbattle.settings", JSON.stringify(settings));
  applyKeys();
}
function applyKeys(): void {
  setOverrides("kb1", settings.keys);
  setOverrides("kb2", settings.keys2);
  // drops keys saved for actions that are gone
  settings.keys = overridesOf("kb1", bindingsOf("kb1"));
  settings.keys2 = overridesOf("kb2", bindingsOf("kb2"));
  noteControls(settings.keys, settings.keys2);
  setTouchSettings(settings.touch, settings.touchSize);
}

export function hover(x: number, y: number, w: number, h: number): boolean {
  return pointer.present && pointer.x >= x && pointer.x <= x + w && pointer.y >= y && pointer.y <= y + h;
}
export function clicked(x: number, y: number, w: number, h: number): boolean {
  return pointer.clicked && pointer.tapX >= x && pointer.tapX <= x + w && pointer.tapY >= y && pointer.tapY <= y + h;
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
  if (opts.key && keysInHand()) label(ctx, opts.key, x + w - 10, y + h - 8, Math.max(11, size * 0.42), "rgba(41,39,34,0.65)", "right", 700);
  if (over) document.body.style.cursor = "pointer";
  return !opts.disabled && clicked(x, y, w, h);
}

/**
 * ◀ / ▶ arrow hit targets around a value; returns -1, 0 or 1 for the frame's click. `hit`: each arrow's target is
 * instead the `hit.w` beside the middle on its side, `hit.h` tall (a bigger target for a finger).
 */
export function arrows(ctx: CanvasRenderingContext2D, cx: number, cy: number, halfSpan: number, size = 30, hit?: { w: number; h: number }): number {
  const boxes: [number, number][] = [[cx - halfSpan - size * 0.9, -1], [cx + halfSpan - size * 0.1, 1]];
  let out = 0;
  for (const [bx, dir] of boxes) {
    const r = hit ? { x: dir < 0 ? cx - hit.w : cx, y: cy - size * 0.3 - hit.h / 2, w: hit.w, h: hit.h } : { x: bx, y: cy - size * 0.9, w: size, h: size * 1.2 };
    const over = hover(r.x, r.y, r.w, r.h);
    label(ctx, dir < 0 ? "◀" : "▶", bx + size / 2, cy, size * (over ? 1.15 : 1), over ? "#c8402c" : INK);
    if (over) document.body.style.cursor = "pointer";
    if (clicked(r.x, r.y, r.w, r.h)) out = dir;
  }
  return out;
}

/** Where the common BACK button sits: bottom left, bigger on a small screen. */
export function backRect(): { x: number; y: number; w: number; h: number } {
  return small() ? { x: 30, y: VIEW_H - 140, w: 260, h: 120 } : { x: 40, y: VIEW_H - 100, w: 200, h: 64 };
}

/** Common bottom-left BACK button; returns true when pressed by click. */
export function backButton(ctx: CanvasRenderingContext2D, text = "BACK"): boolean {
  const r = backRect();
  return button(ctx, r.x, r.y, r.w, r.h, text, { key: "Esc", size: small() ? 40 : 26 });
}
