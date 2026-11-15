import { VIEW_H, VIEW_W } from "../render/camera";
import { toView } from "./pointer";

/**
 * The part of the view still on the screen while something covers the rest (a phone's on-screen keyboard shrinks
 * the visual viewport, not the window), or null when nothing does. A browser that shrinks the window instead has
 * already fitted the whole game above the keyboard.
 */
export function uncoveredView(): { x: number; y: number; w: number; h: number } | null {
  const vv = window.visualViewport;
  if (!vv || (vv.height > innerHeight - 60 && vv.width > innerWidth - 60)) return null;
  const a = toView(vv.offsetLeft, vv.offsetTop), b = toView(vv.offsetLeft + vv.width, vv.offsetTop + vv.height);
  const x = Math.max(0, Math.min(a.x, b.x)), y = Math.max(0, Math.min(a.y, b.y));
  return { x, y, w: Math.min(VIEW_W, Math.max(a.x, b.x)) - x, h: Math.min(VIEW_H, Math.max(a.y, b.y)) - y };
}
