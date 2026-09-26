import { VIEW_H } from "../render/camera";
import type { MenuInput } from "../input/devices";
import { consumeTaps } from "../input/pointer";
import { sfx } from "../audio/audio";
import { bg, card, label, type Screen, INK } from "./ui";
import { ButtonMenu, type Button } from "./draw/buttons";
import { RED } from "./draw/character";
import { DrawPad } from "./draw/pad";
import { PadTools } from "./draw/tools";
import type { CharacterHint, Nav } from "./nav";

const PAD = { x: 510, y: 90, w: 900, h: 900 };
const RIGHT = 1490, COL_W = 340;

/** NEW CHARACTER: the draw pad with no clock. DONE DRAWING goes on to naming and describing it. */
export class CreateScreen implements Screen {
  t = 0;
  private tools: PadTools;
  private menu = new ButtonMenu();
  private problem = "";
  private next: Screen | null = null;

  constructor(private nav: Nav, pad?: DrawPad, private hint?: CharacterHint) {
    this.tools = new PadTools(pad ?? new DrawPad(PAD));
    this.tools.pad.locked = false;
  }

  enter(): void {
    this.tools.attach();
  }

  abandon(): void {
    this.tools.detach();
  }

  private buttons(): Button[] {
    return [
      ...this.tools.buttons(),
      { id: "done", x: RIGHT, y: 700, w: COL_W, h: 130, text: "DONE DRAWING", size: 40, disabled: this.tools.pad.blank },
      { id: "back", x: RIGHT, y: 860, w: COL_W, h: 84, text: "BACK", size: 36 },
    ];
  }

  update(dt: number, m: MenuInput): Screen | null {
    this.t += dt;
    if (this.next) return this.leave(this.next);
    const pressed = this.menu.update(this.buttons(), m, consumeTaps());
    if (pressed === "done") { sfx.menuConfirm(); return this.leave(this.nav.describe(this.tools.pad, this.hint)); }
    else if (pressed === "back" || m.back) { sfx.menuBack(); return this.leave(this.nav.title()); }
    else if (pressed) this.tools.press(pressed);
    return null;
  }

  draw(ctx: CanvasRenderingContext2D): void {
    bg(ctx, this.t);
    card(ctx, PAD.x - 6, PAD.y - 6, PAD.w + 12, PAD.h + 12, INK, false);
    this.tools.pad.draw(ctx);
    label(ctx, "draw a fighter", RIGHT + COL_W / 2, 160, 40, INK, "center", 900);
    const buttons = this.buttons();
    this.tools.draw(ctx, buttons, this.menu.focused(buttons)?.id);
    this.menu.draw(ctx, buttons);
    if (this.problem) label(ctx, this.problem, PAD.x + PAD.w / 2, VIEW_H - 40, 28, RED);
  }

  private leave(next: Screen): Screen {
    this.tools.detach();
    return next;
  }
}
