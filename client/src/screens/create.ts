import { VIEW_H } from "../render/camera";
import type { MenuInput } from "../input/devices";
import { consumeTaps } from "../input/pointer";
import { sfx } from "../audio/audio";
import { library } from "../account";
import { bg, card, label, type Screen, INK } from "./ui";
import { ButtonMenu, type Button } from "./draw/buttons";
import { RED } from "./draw/character";
import { DrawPad } from "./draw/pad";
import { padPng, PadTools } from "./draw/tools";
import type { Nav } from "./nav";

const PAD = { x: 510, y: 90, w: 900, h: 900 };
const RIGHT = 1490, COL_W = 340;

/** NEW CHARACTER: the draw pad with no clock. DONE sends it to the forge. */
export class CreateScreen implements Screen {
  t = 0;
  private tools: PadTools;
  private menu = new ButtonMenu();
  private sending = false;
  private problem = "";
  private next: Screen | null = null;

  constructor(private nav: Nav, pad?: DrawPad) {
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
      { id: "done", x: RIGHT, y: 700, w: COL_W, h: 130, text: this.sending ? "…" : "DONE", size: 56, disabled: this.sending || this.tools.pad.blank },
      { id: "back", x: RIGHT, y: 860, w: COL_W, h: 84, text: "BACK", size: 36, disabled: this.sending },
    ];
  }

  update(dt: number, m: MenuInput): Screen | null {
    this.t += dt;
    if (this.next) return this.leave(this.next);
    const pressed = this.menu.update(this.buttons(), m, consumeTaps());
    if (pressed === "done") this.send();
    else if (pressed === "back" || (m.back && !this.sending)) { sfx.menuBack(); return this.leave(this.nav.title()); }
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

  private send(): void {
    const out = padPng(this.tools.pad);
    if ("problem" in out) { this.problem = out.problem; console.error(out.problem); return; }
    this.sending = true;
    this.problem = "";
    library.create(out.png).then(
      ({ character }) => { sfx.menuConfirm(); this.next = this.nav.forge(character, this.tools.pad); },
      (error: unknown) => {
        console.error("character upload failed", error);
        this.problem = error instanceof Error ? error.message : String(error);
        this.sending = false;
      },
    );
  }
}
