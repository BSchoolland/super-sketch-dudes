import { isNew } from "../account";
import type { Button } from "./buttons";
import { drawNewSticker } from "./sticker";
import { drawTabs, otherTabButton, tabAt, type Tabs } from "./tabs";

/** CHARACTERS has two tabs: your library, and everyone's public characters. */
export type CharTab = "mine" | "community";
const TABS: Tabs<CharTab> = { left: { id: "mine", text: "MINE" }, right: { id: "community", text: "COMMUNITY" } };

export const otherCharTab = (on: CharTab): Button => otherTabButton(TABS, on);

/** The tabs, with COMMUNITY's NEW sticker while it has one. */
export function drawCharTabs(ctx: CanvasRenderingContext2D, on: CharTab, otherFocused: boolean): void {
  drawTabs(ctx, TABS, on, otherFocused);
  if (!isNew("community")) return;
  const { x, active } = tabAt(TABS, "community", on);
  drawNewSticker(ctx, x + (active ? 200 : 140), active ? 34 : 40, active ? 1 : 0.85);
}
