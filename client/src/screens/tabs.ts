import { VIEW_W } from "../render/camera";
import { inkLine, PENCIL } from "../render/paper";
import type { Button } from "./buttons";
import { title, INK } from "./ui";

/** A screen's pair of tabs across the top, left then right. */
export interface Tabs<T extends string> { left: { id: T; text: string }; right: { id: T; text: string } }

const W = 340, H = 90, Y = 40;
const X = { left: VIEW_W / 2 - 190, right: VIEW_W / 2 + 150 } as const;

function sides<T extends string>(tabs: Tabs<T>): { id: T; text: string; x: number }[] {
  return [{ ...tabs.left, x: X.left }, { ...tabs.right, x: X.right }];
}

/** Where the tab `id` is drawn: its centre x, and whether it's the one you're on. */
export function tabAt<T extends string>(tabs: Tabs<T>, id: T, on: T): { x: number; active: boolean } {
  return { x: id === tabs.left.id ? X.left : X.right, active: id === on };
}

/** The tab you're not on, as a button (id "tab") that goes to it. */
export function otherTabButton<T extends string>(tabs: Tabs<T>, on: T): Button {
  const other = sides(tabs).find((t) => t.id !== on)!;
  return { id: "tab", x: other.x - W / 2, y: Y, w: W, h: H, text: "", custom: true };
}

/** The tab you're on big and underlined, the other smaller in pencil (bold when focused). */
export function drawTabs<T extends string>(ctx: CanvasRenderingContext2D, tabs: Tabs<T>, on: T, otherFocused: boolean): void {
  for (const t of sides(tabs)) {
    const active = t.id === on;
    title(ctx, t.text, t.x, 100, active ? 72 : 48, active || otherFocused ? INK : PENCIL);
    if (active) inkLine(ctx, t.x - W / 2 + 30, 118, t.x + W / 2 - 30, 113, INK, 5);
    else if (otherFocused) inkLine(ctx, t.x - W / 2 + 70, 114, t.x + W / 2 - 70, 111, INK, 3);
  }
}
