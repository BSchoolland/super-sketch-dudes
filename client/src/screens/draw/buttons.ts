import type { MenuInput } from "../../input/devices";
import type { ViewPoint } from "../../input/pointer";
import { sfx } from "../../audio/audio";
import { card, label, title, INK } from "../ui";

export interface Button {
  id: string;
  x: number; y: number; w: number; h: number;
  text: string;
  size?: number;
  /** Left/right (or tapping the button's left/right half) steps a value instead of pressing. */
  step?: (dir: -1 | 1) => void;
  /** Drawn by the caller; the menu only focuses and hit-tests it. */
  custom?: boolean;
  disabled?: boolean;
}

export const inside = (p: ViewPoint, b: { x: number; y: number; w: number; h: number }): boolean => p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h;

/** Keyboard/gamepad focus plus tap hit-testing over whatever buttons a view lays out this frame. */
export class ButtonMenu {
  focus = 0;

  /** The id of the pressed button, if any. */
  update(buttons: Button[], m: MenuInput, taps: ViewPoint[]): string | null {
    const live = buttons.filter((b) => !b.disabled);
    for (const tap of taps) {
      const b = live.find((candidate) => inside(tap, candidate));
      if (!b) continue;
      this.focus = buttons.indexOf(b);
      if (b.step) { b.step(tap.x < b.x + b.w / 2 ? -1 : 1); sfx.menuMove(); continue; }
      sfx.menuConfirm();
      return b.id;
    }
    if (!live.length) return null;
    if (this.focus >= buttons.length || buttons[this.focus].disabled) this.focus = buttons.indexOf(live[0]);
    const focused = buttons[this.focus];
    const move = (dir: -1 | 1) => {
      let i = this.focus;
      do i = (i + dir + buttons.length) % buttons.length; while (buttons[i].disabled);
      this.focus = i;
      sfx.menuMove();
    };
    if (focused.step && (m.left || m.right)) { focused.step(m.left ? -1 : 1); sfx.menuMove(); }
    else if (m.left || m.up) move(-1);
    else if (m.right || m.down) move(1);
    if (m.confirm && !focused.step) { sfx.menuConfirm(); return focused.id; }
    return null;
  }

  draw(ctx: CanvasRenderingContext2D, buttons: Button[]): void {
    buttons.forEach((b, i) => {
      if (b.custom) return;
      const selected = i === this.focus;
      card(ctx, b.x, b.y, b.w, b.h, INK, selected && !b.disabled, b.disabled ? 0.45 : 1);
      const size = b.size ?? Math.min(40, b.h * 0.5);
      if (b.step) label(ctx, `◀  ${b.text}  ▶`, b.x + b.w / 2, b.y + b.h / 2 + size * 0.36, size, INK, "center", 800);
      else title(ctx, b.text, b.x + b.w / 2, b.y + b.h / 2 + size * 0.36, size, INK);
    });
  }

  /**
   * The first `count` buttons are a grid `cols` wide: up/down move a row there (and off its
   * edges onto the buttons around it). Returns the input with up/down spent, for update().
   */
  grid(m: MenuInput, cols: number, count: number, total: number): MenuInput {
    if (!(m.up || m.down) || !count) return m;
    const f = this.focus;
    const lastRow = Math.floor((count - 1) / cols);
    if (f >= count) this.focus = m.up ? count - 1 : (f + 1) % total;
    else if (m.up) this.focus = Math.max(f % cols, f - cols);
    else if (f + cols < count) this.focus = f + cols;
    else this.focus = Math.floor(f / cols) < lastRow ? count - 1 : count < total ? count : f;
    sfx.menuMove();
    return { ...m, up: false, down: false };
  }

  focused(buttons: Button[]): Button | null {
    return buttons[this.focus] ?? null;
  }
}
