import { VIEW_H, VIEW_W } from "../render/camera";
import { PENCIL } from "../render/paper";
import type { MenuInput } from "../input/devices";
import { consumeTaps } from "../input/pointer";
import { sfx } from "../audio/audio";
import { library } from "../account";
import { bg, card, label, title, type Screen, INK } from "./ui";
import { ButtonMenu, type Button } from "./draw/buttons";
import { RED } from "./draw/character";
import type { DrawPad } from "./draw/pad";
import { padPng } from "./draw/tools";
import { TextField } from "./draw/textfield";
import type { Nav } from "./nav";

const ART = { x: 120, y: 150, w: 720, h: 720 };
const FORM_X = 960, FORM_W = 840;
const NAME = { x: FORM_X, y: 240, w: FORM_W, h: 96 };
const DESC = { x: FORM_X, y: 440, w: FORM_W, h: 220 };
export const NAME_MAX = 14, DESCRIPTION_MAX = 240;

/**
 * Between the pad and the forge: an optional name and a line or two about the character, so the
 * player can steer the design ("it's a tank, the barrel shoots", "the tail is a whip").
 */
export class DescribeScreen implements Screen {
  t = 0;
  private menu = new ButtonMenu();
  private name: TextField;
  private description: TextField;
  private sending = false;
  private problem = "";
  private next: Screen | null = null;

  constructor(private nav: Nav, private pad: DrawPad) {
    pad.locked = true;
    this.name = new TextField({ maxLength: NAME_MAX, upper: true, onSubmit: () => this.description.el.focus(), onCancel: () => this.back() });
    this.description = new TextField({ maxLength: DESCRIPTION_MAX, multiline: true, quiet: true, onSubmit: () => this.send(), onCancel: () => this.back() });
    this.menu.focus = 0;
  }

  abandon(): void {
    this.dispose();
  }

  private buttons(): Button[] {
    return [
      { id: "send", x: FORM_X, y: 760, w: 400, h: 110, text: this.sending ? "…" : "SEND TO THE FORGE", size: 34, disabled: this.sending },
      { id: "back", x: FORM_X + 440, y: 760, w: 400, h: 110, text: "BACK TO THE PAD", size: 34, disabled: this.sending },
    ];
  }

  update(dt: number, m: MenuInput): Screen | null {
    this.t += dt;
    if (this.next) { this.dispose(); return this.next; }
    const pressed = this.menu.update(this.buttons(), m, consumeTaps());
    if (pressed === "send") this.send();
    else if (pressed === "back" || (m.back && !this.sending)) return this.back();
    return null;
  }

  draw(ctx: CanvasRenderingContext2D): void {
    bg(ctx, this.t);
    title(ctx, "WHO IS THIS?", VIEW_W / 2, 90, 56);
    card(ctx, ART.x - 6, ART.y - 6, ART.w + 12, ART.h + 12, INK, false);
    ctx.save(); ctx.translate(ART.x, ART.y); ctx.scale(ART.w / this.pad.rect.w, ART.h / this.pad.rect.h); ctx.translate(-this.pad.rect.x, -this.pad.rect.y); this.pad.draw(ctx); ctx.restore();
    label(ctx, "NAME (optional)", NAME.x, NAME.y - 22, 26, PENCIL, "left", 800);
    card(ctx, NAME.x, NAME.y, NAME.w, NAME.h, INK, document.activeElement === this.name.el);
    this.name.place(NAME.x + 20, NAME.y + 14, NAME.w - 40, NAME.h - 28, 44);
    label(ctx, "WHAT IS IT? WHAT DOES IT DO? (optional, the forge reads this)", DESC.x, DESC.y - 22, 26, PENCIL, "left", 800);
    card(ctx, DESC.x, DESC.y, DESC.w, DESC.h, INK, document.activeElement === this.description.el);
    this.description.place(DESC.x + 20, DESC.y + 16, DESC.w - 40, DESC.h - 32, 28);
    if (!this.name.value && !this.description.value) label(ctx, "leave both empty and the forge decides from the drawing alone", FORM_X, DESC.y + DESC.h + 44, 24, PENCIL, "left");
    const buttons = this.buttons();
    this.menu.draw(ctx, buttons);
    if (this.problem) label(ctx, this.problem, VIEW_W / 2, VIEW_H - 40, 28, RED);
  }

  private back(): Screen {
    sfx.menuBack();
    this.dispose();
    this.pad.locked = false;
    return this.nav.create(this.pad);
  }

  private dispose(): void {
    this.name.remove();
    this.description.remove();
  }

  private send(): void {
    if (this.sending) return;
    const out = padPng(this.pad);
    if ("problem" in out) { this.problem = out.problem; console.error(out.problem); return; }
    this.sending = true;
    this.problem = "";
    library.create(out.png, { name: this.name.value.trim(), description: this.description.value.trim() }).then(
      ({ character }) => { sfx.menuConfirm(); this.next = this.nav.forge(character, this.pad); },
      (error: unknown) => {
        console.error("character upload failed", error);
        this.problem = error instanceof Error ? error.message : String(error);
        this.sending = false;
      },
    );
  }
}
