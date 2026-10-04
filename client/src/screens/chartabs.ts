import { VIEW_W } from "../render/camera";
import { inkLine, PENCIL } from "../render/paper";
import { isNew } from "../account";
import type { Button } from "./buttons";
import { drawNewSticker } from "./sticker";
import { title, INK } from "./ui";

/** CHARACTERS has two tabs: your library, and everyone's public characters. */
export type CharTab = "mine" | "community";
const TABS: Record<CharTab, { text: string; x: number }> = {
  mine: { text: "MINE", x: VIEW_W / 2 - 190 },
  community: { text: "COMMUNITY", x: VIEW_W / 2 + 150 },
};
const W = 340, H = 90, Y = 40;

/** The tab you're not on, as a button (id "tab") that goes to it. */
export function otherTabButton(on: CharTab): Button {
  const other = on === "mine" ? "community" : "mine";
  return { id: "tab", x: TABS[other].x - W / 2, y: Y, w: W, h: H, text: "", custom: true };
}

/** The heading: the tab you're on big and underlined, the other smaller in pencil (bold when focused). */
export function drawCharTabs(ctx: CanvasRenderingContext2D, on: CharTab, otherFocused: boolean): void {
  for (const id of ["mine", "community"] as const) {
    const t = TABS[id], active = id === on;
    title(ctx, t.text, t.x, 100, active ? 72 : 48, active || otherFocused ? INK : PENCIL);
    if (active) inkLine(ctx, t.x - W / 2 + 30, 118, t.x + W / 2 - 30, 113, INK, 5);
    else if (otherFocused) inkLine(ctx, t.x - W / 2 + 70, 114, t.x + W / 2 - 70, 111, INK, 3);
    if (id === "community" && isNew("community")) drawNewSticker(ctx, t.x + (active ? 200 : 140), active ? 34 : 40, active ? 1 : 0.85);
  }
}
