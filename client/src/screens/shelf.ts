import { VIEW_W } from "../render/camera";
import { PENCIL } from "../render/paper";
import { allChoices, type FighterChoice } from "../fighters";
import { arrows, clicked, hover, label } from "./ui";
import { drawCharacterCell } from "./character";

const CELL = 170, GAP = 44, PER = 8;
/** How tall the shelf is, names included. */
export const SHELF_H = CELL + 50;

/**
 * Your ready characters in a row across the top of a battle setup, drawn like MY CHARACTERS;
 * clicking one picks it. Read live, so a library that's still loading fills in.
 */
export class CharacterShelf {
  private offset = 0;

  constructor(private y: number) {}

  get choices(): FighterChoice[] {
    return allChoices().mine;
  }

  /** Brings `id` into view (after a keyboard pick). */
  show(id: string): void {
    const i = this.choices.findIndex((c) => c.id === id);
    if (i < 0) return;
    if (i < this.offset) this.offset = i;
    if (i >= this.offset + PER) this.offset = i - PER + 1;
  }

  /** Draws the row with `picked` boxed; returns the character clicked this frame, unless `locked`. */
  draw(ctx: CanvasRenderingContext2D, t: number, picked: string | null, locked: boolean): FighterChoice | null {
    const choices = this.choices;
    if (!choices.length) { label(ctx, "no characters ready yet", VIEW_W / 2, this.y + CELL / 2, 32, PENCIL); return null; }
    const shown = Math.min(PER, choices.length);
    const x0 = (VIEW_W - (shown * CELL + (shown - 1) * GAP)) / 2;
    let out: FighterChoice | null = null;
    for (let slot = 0; slot < shown; slot++) {
      const choice = choices[this.offset + slot];
      const x = x0 + slot * (CELL + GAP);
      ctx.save();
      if (locked && choice.id !== picked) ctx.globalAlpha = 0.4;
      drawCharacterCell(ctx, choice.entry!, x, this.y, CELL, t + slot * 0.2, choice.id === picked);
      ctx.restore();
      if (locked) continue;
      if (hover(x, this.y, CELL, CELL)) document.body.style.cursor = "pointer";
      if (clicked(x, this.y, CELL, CELL)) out = choice;
    }
    if (choices.length > PER) {
      const d = arrows(ctx, VIEW_W / 2, this.y + CELL / 2, (shown * CELL + (shown - 1) * GAP) / 2 + 40, 44);
      if (d) this.offset = Math.max(0, Math.min(choices.length - PER, this.offset + d * PER));
    }
    return out;
  }
}
