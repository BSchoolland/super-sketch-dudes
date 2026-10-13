import { VIEW_W } from "../render/camera";
import { PENCIL } from "../render/paper";
import { allChoices, type FighterChoice } from "../fighters";
import { clicked, hover, label } from "./ui";
import { drawCharacterCell } from "./character";
import { ScrollView } from "./scroll";

const CELL = 170, GAP = 44, COLS = 8, ROW_H = CELL + 56;
/** Room above the first row for the drawing pinned to a fighter's corner. */
const PAD_TOP = 16;
/** How tall the shelf is, names included. */
export const SHELF_H = 410;

/**
 * Your ready characters in a grid across the top of a battle setup, drawn like MY CHARACTERS, scrolling
 * down when there are more than fit; clicking one picks it. Read live, so a library that's still loading fills in.
 */
export class CharacterShelf {
  private scroll: ScrollView;
  private drawnAt = -1;

  constructor(y: number) {
    const w = COLS * CELL + (COLS - 1) * GAP;
    this.scroll = new ScrollView({ x: (VIEW_W - w) / 2, y, w, h: SHELF_H });
  }

  get choices(): FighterChoice[] {
    return allChoices().mine;
  }

  /** Brings `id` into view (after a keyboard pick). */
  show(id: string): void {
    const i = this.choices.findIndex((c) => c.id === id);
    if (i < 0) return;
    const top = PAD_TOP + Math.floor(i / COLS) * ROW_H;
    this.scroll.reveal(top - PAD_TOP, top + ROW_H - 10, 0);
  }

  /** Draws the grid with `picked` boxed; returns the character clicked this frame, unless `locked`. */
  draw(ctx: CanvasRenderingContext2D, t: number, picked: string | null, locked: boolean): FighterChoice | null {
    const choices = this.choices, scroll = this.scroll, v = scroll.view;
    scroll.tick(this.drawnAt < 0 ? 0 : Math.min(0.1, t - this.drawnAt), PAD_TOP + Math.ceil(choices.length / COLS) * ROW_H);
    this.drawnAt = t;
    if (!choices.length) { label(ctx, "no characters ready yet", VIEW_W / 2, v.y + v.h / 2, 32, PENCIL); return null; }
    // fewer than a row: centred
    const shown = Math.min(COLS, choices.length);
    const x0 = (VIEW_W - (shown * CELL + (shown - 1) * GAP)) / 2;
    let out: FighterChoice | null = null;
    scroll.draw(ctx, () => choices.forEach((choice, i) => {
      const x = x0 + (i % COLS) * (CELL + GAP), top = PAD_TOP + Math.floor(i / COLS) * ROW_H;
      if (!scroll.shows(top - PAD_TOP, ROW_H)) return;
      ctx.save();
      if (locked && choice.id !== picked) ctx.globalAlpha = 0.4;
      drawCharacterCell(ctx, choice.entry!, x, scroll.at(top), CELL, t + i * 0.2, choice.id === picked);
      ctx.restore();
      if (locked) return;
      const hit = scroll.button("", { x, y: top, w: CELL, h: CELL });
      if (hover(hit.x, hit.y, hit.w, hit.h)) document.body.style.cursor = "pointer";
      if (clicked(hit.x, hit.y, hit.w, hit.h)) out = choice;
    }));
    return out;
  }
}
