import { aboutOpen, onAbout } from "./about";

/**
 * The stage (#stage in index.html: the canvas and the DOM laid over it) is the size of the window, except on a phone
 * or tablet held upright: there it is turned a quarter clockwise at the screen's full size, so the game is always
 * landscape and the player just turns the phone. The about sections are a web page, read upright: while they're open
 * nothing is turned. Pointer events still arrive in screen coordinates; `toStage` turns them back.
 */
const root = document.documentElement;
let handheld = false;
let size = { w: innerWidth, h: innerHeight };
const watchers = new Set<() => void>();

/** A phone or tablet on the website's own page (bars.ts decides): from now on, upright turns the stage. */
export function turnUpright(): void {
  if (handheld) throw new Error("turnUpright ran twice");
  handheld = true;
  layout();
}

/** The stage is turned. */
export const turned = (): boolean => root.classList.contains("turned");

/** The stage's size in CSS pixels, as the game sees it (wider than tall when turned). */
export function stageSize(): { w: number; h: number } {
  return size;
}

/** Client coordinates (a pointer event's) to the stage's CSS pixels. */
export function toStage(x: number, y: number): { x: number; y: number } {
  return turned() ? { x: y, y: size.h - x } : { x, y };
}

/** `fn` runs whenever the stage changes size or turns. Returns its removal. */
export function onStage(fn: () => void): () => void {
  watchers.add(fn);
  return () => watchers.delete(fn);
}

/** On every resize, as the window's own resize listeners did; otherwise only when the stage turned. */
function layout(e?: Event): void {
  const w = innerWidth, h = innerHeight;
  const turn = handheld && h > w && !aboutOpen();
  if (!e && turn === turned()) return;
  size = turn ? { w: h, h: w } : { w, h };
  root.classList.toggle("turned", turn);
  if (handheld) {
    const stage = document.getElementById("stage");
    if (!stage) throw new Error("#stage missing from the page");
    stage.style.width = turn ? `${size.w}px` : "";
    stage.style.height = turn ? `${size.h}px` : "";
  }
  for (const fn of watchers) fn();
}

window.addEventListener("resize", layout);
onAbout(layout);
