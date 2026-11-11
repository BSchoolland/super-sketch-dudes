import { EMPTY_INPUT, type InputFrame } from "../../../shared/input";
import { VIEW_H, VIEW_W } from "../render/camera";
import { claimPress, toView, viewScale } from "./pointer";
import { TouchPad, touchLayout } from "./touchpad";

/**
 * The on-screen controls on the page: which fingers reach the TouchPad, when the controls are up, and whether the
 * player is on touch at all. Keyboard 1 reads them (devices.ts): on a touchscreen they are the player's device, and a
 * key, a mouse button or a gamepad hands keyboard 1 back to the keys until the next touch.
 */
export type TouchSetting = "auto" | "always" | "off";
const config: { setting: TouchSetting; size: number } = { setting: "auto", size: 1 };
/** The last thing the player pressed was the screen. */
let touching = false;
export const pad = new TouchPad(touchLayout(VIEW_W, VIEW_H, 1, 1));

/** What a match screen said on its latest tick (`at`): whether the controls take fingers and have a pause button. */
let match = { live: false, pauseable: false, at: -2 };
let tick = 0;
/** This tick's input, once read: a match that steps twice in a tick reads the same frame twice, like the keys. */
let read: InputFrame | null = null;

export function setTouchSettings(setting: TouchSetting, size: number): void {
  config.setting = setting;
  config.size = size;
}

/** A key, a mouse button or a gamepad was used. */
export function stopTouch(): void {
  touching = false;
}

/** Keyboard 1 is the touchscreen right now. */
export function touchInUse(): boolean {
  return config.setting !== "off" && touching;
}

/** A match shows the controls (when keyboard 1 plays in it). */
export function touchShown(): boolean {
  return config.setting === "always" || touchInUse();
}

/** The screen is taller than wide: a match asks for the phone turned sideways. */
export function portrait(): boolean {
  return innerHeight > innerWidth;
}

/** The controls' layout on this screen at the player's size. */
export function currentLayout() {
  return touchLayout(VIEW_W, VIEW_H, viewScale(), config.size);
}

/** A match screen, every tick it is up: `live` while fingers play (not paused, over or turned sideways). */
export function armTouch(live: boolean, pauseable: boolean): void {
  if (match.live && !live) pad.clear();
  match = { live, pauseable, at: tick };
  pad.layout = currentLayout();
  pad.pauseable = pauseable;
}

/** A match screen is up (as of its last tick). */
export function inMatch(): boolean {
  return match.at >= tick - 1;
}

export function touchLive(): boolean {
  return inMatch() && match.live;
}

/** The touchscreen as keyboard 1's input this tick. */
export function touchFrame(): InputFrame {
  if (!touchLive()) return { ...EMPTY_INPUT };
  read ??= pad.frame();
  return { ...read };
}

export function endTouchTick(): void {
  tick++;
  read = null;
  // the screen that armed the controls is gone
  if (match.live && !inMatch()) { pad.clear(); match.live = false; }
}

export function attachTouch(canvas: HTMLCanvasElement): () => void {
  const ac = new AbortController();
  const signal = ac.signal;
  // anywhere on the page, menus too: whatever was pressed last is what the player is using
  window.addEventListener("pointerdown", (e) => { if (e.pointerType === "touch") touching = true; }, { capture: true, signal });
  canvas.addEventListener("pointerdown", (e) => {
    if (e.pointerType !== "touch" || !touchLive()) return;
    const p = toView(e.clientX, e.clientY);
    // a finger on the controls is never a tap on whatever its lift lands on
    if (pad.down(e.pointerId, p.x, p.y)) claimPress();
  }, { signal });
  canvas.addEventListener("pointermove", (e) => {
    if (e.pointerType !== "touch" || !touchLive()) return;
    const p = toView(e.clientX, e.clientY);
    pad.move(e.pointerId, p.x, p.y);
  }, { signal });
  const up = (e: PointerEvent) => { if (e.pointerType === "touch") pad.up(e.pointerId); };
  canvas.addEventListener("pointerup", up, { signal });
  canvas.addEventListener("pointercancel", up, { signal });
  // touch-action: none keeps the browser's gestures off the canvas; in a match nothing else gets a say either
  // (iOS's pinch, a long press's callout, the double-tap zoom)
  const hold = (e: Event) => { if (inMatch()) e.preventDefault(); };
  for (const type of ["touchstart", "touchmove", "touchend"] as const) canvas.addEventListener(type, hold, { passive: false, signal });
  document.addEventListener("gesturestart", hold, { passive: false, signal });
  return () => ac.abort();
}
