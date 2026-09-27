import { PENCIL } from "../../render/paper";
import type { MenuInput } from "../../input/devices";
import { sfx } from "../../audio/audio";
import { choiceDef, type FighterChoice } from "../../fighters";
import { label, title, INK } from "../ui";
import type { Button, ButtonMenu } from "../buttons";
import { drawFighterPortrait } from "../portrait";

const PER = 7, CELL = 200, GAP = 30, ROW_H = 300, X0 = 250;

export interface GridRow { label: string; choices: FighterChoice[] }

/**
 * Rows of fighters to pick from (yours, the house), laid out as ButtonMenu buttons so keyboard,
 * gamepad and touch all work. Long rows scroll sideways with the focus, or their ◀ ▶ buttons.
 */
export class FighterGrid {
  private offsets: number[];

  constructor(public rows: GridRow[], private top: number) {
    this.rows = rows.filter((r) => r.choices.length);
    this.offsets = this.rows.map(() => 0);
  }

  /** How many of the menu's buttons are cells (they come first). */
  get count(): number {
    return this.rows.reduce((n, r) => n + r.choices.length, 0);
  }

  get height(): number {
    return this.rows.length * ROW_H;
  }

  buttons(): Button[] {
    const b: Button[] = [];
    this.rows.forEach((row, r) => {
      const y = this.top + r * ROW_H;
      row.choices.forEach((_, i) => {
        const slot = i - this.offsets[r];
        const visible = slot >= 0 && slot < PER;
        b.push({ id: `f${r}:${i}`, x: X0 + slot * (CELL + GAP), y: visible ? y : -9999, w: CELL, h: CELL, text: "", custom: true });
      });
    });
    this.rows.forEach((row, r) => {
      if (row.choices.length <= PER) return;
      const y = this.top + r * ROW_H + CELL / 2 - 40;
      b.push({ id: `l${r}`, x: X0 - 90, y, w: 70, h: 80, text: "◀", size: 36, disabled: this.offsets[r] === 0 });
      b.push({ id: `r${r}`, x: X0 + PER * (CELL + GAP) - GAP + 20, y, w: 70, h: 80, text: "▶", size: 36, disabled: this.offsets[r] + PER >= row.choices.length });
    });
    return b;
  }

  private flat(r: number, i: number): number {
    let n = i;
    for (let k = 0; k < r; k++) n += this.rows[k].choices.length;
    return n;
  }

  private at(flat: number): { r: number; i: number } | null {
    let n = flat;
    for (let r = 0; r < this.rows.length; r++) {
      if (n < this.rows[r].choices.length) return { r, i: n };
      n -= this.rows[r].choices.length;
    }
    return null;
  }

  /** Up/down between rows while the focus is on a cell (down off the last row: the first button after the grid); returns the input with those spent. */
  nav(menu: ButtonMenu, m: MenuInput): MenuInput {
    const here = this.at(menu.focus);
    if (!here || !(m.up || m.down)) return m;
    const to = here.r + (m.down ? 1 : -1);
    if (to < 0) return { ...m, up: false };
    if (to >= this.rows.length) {
      menu.focus = this.count + this.rows.filter((r) => r.choices.length > PER).length * 2;
      sfx.menuMove();
      return { ...m, down: false };
    }
    menu.focus = this.flat(to, Math.min(here.i, this.rows[to].choices.length - 1));
    sfx.menuMove();
    return { ...m, up: false, down: false };
  }

  /** Call after the menu's update: scrolls to the focus, and handles the row arrows. Returns the picked fighter, if any. */
  pressed(menu: ButtonMenu, id: string | null): FighterChoice | null {
    if (id?.startsWith("l") || id?.startsWith("r")) {
      const r = Number(id.slice(1));
      this.offsets[r] = Math.max(0, Math.min(this.rows[r].choices.length - PER, this.offsets[r] + (id[0] === "l" ? -PER : PER)));
      return null;
    }
    const here = this.at(menu.focus);
    if (here) {
      const off = this.offsets[here.r];
      if (here.i < off) this.offsets[here.r] = here.i;
      if (here.i >= off + PER) this.offsets[here.r] = here.i - PER + 1;
    }
    if (!id?.startsWith("f")) return null;
    const [r, i] = id.slice(1).split(":").map(Number);
    return this.rows[r].choices[i];
  }

  /** The focused fighter, when the focus is on a cell. */
  focused(menu: ButtonMenu): FighterChoice | null {
    const here = this.at(menu.focus);
    return here ? this.rows[here.r].choices[here.i] : null;
  }

  /** Draws the cells; `tags` puts a word over chosen fighters (P1, CPU). */
  draw(ctx: CanvasRenderingContext2D, buttons: Button[], menu: ButtonMenu, t: number, tags: Map<string, string> = new Map()): void {
    this.rows.forEach((row, r) => label(ctx, row.label, X0 - 30, this.top + r * ROW_H + CELL + 44, 26, PENCIL, "right", 800));
    const focus = menu.focus;
    buttons.slice(0, this.count).forEach((b, n) => {
      if (b.y < 0) return;
      const here = this.at(n)!;
      const choice = this.rows[here.r].choices[here.i];
      const { def, load } = choiceDef(choice);
      if (def) drawFighterPortrait(ctx, def, t + n * 0.31, false, { x: b.x, y: b.y, w: b.w, h: b.h });
      else label(ctx, load.state === "failed" ? "didn't load" : "…", b.x + b.w / 2, b.y + b.h / 2, 24, load.state === "failed" ? "#c0392b" : PENCIL);
      if (n === focus) {
        ctx.save(); ctx.strokeStyle = INK; ctx.lineWidth = 5;
        ctx.strokeRect(b.x - 6, b.y - 6, b.w + 12, b.h + 12);
        ctx.restore();
      }
      const tag = tags.get(choice.id);
      if (tag) title(ctx, tag, b.x + 10, b.y + 40, 34, "#c8402c", "left");
      label(ctx, choice.name, b.x + b.w / 2, b.y + b.h + 36, 28, INK, "center", 800, b.w + 16);
    });
  }
}
