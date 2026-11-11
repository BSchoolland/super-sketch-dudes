import { VIEW_W } from "../render/camera";
import type { MenuInput } from "../input/devices";
import { consumeTaps } from "../input/pointer";
import { sfx } from "../audio/audio";
import { account, rename } from "../account";
import { NAME_MAX } from "../../../shared/account";
import { bg, card, hint, label, title, type Screen, INK } from "./ui";
import { RED } from "./character";
import { ButtonMenu, type Button } from "./buttons";
import { TextField } from "./textfield";

const FIELD = { x: VIEW_W / 2 - 420, y: 400, w: 840, h: 96 };

/** An account types the name other players see: on their characters, their maps and in rooms. */
export class RenameScreen implements Screen {
  t = 0;
  private menu = new ButtonMenu();
  private field: TextField;
  private sending = false;
  private error = "";
  private done = false;

  constructor(private onBack: () => Screen) {
    this.field = new TextField({ maxLength: NAME_MAX, value: account.player?.name ?? "", onSubmit: () => this.submit(), onCancel: () => { this.done = true; } });
    this.field.el.select();
  }

  abandon(): void {
    this.field.remove();
  }

  private buttons(): Button[] {
    return [
      { id: "save", x: FIELD.x, y: 580, w: 400, h: 100, text: this.sending ? "…" : "SAVE", size: 34, disabled: this.sending },
      { id: "back", x: FIELD.x + 440, y: 580, w: 400, h: 100, text: "BACK", size: 34, disabled: this.sending },
    ];
  }

  update(dt: number, m: MenuInput): Screen | null {
    this.t += dt;
    if (this.done) { this.field.remove(); return this.onBack(); }
    const pressed = this.menu.update(this.buttons(), m, consumeTaps());
    if (pressed === "save") this.submit();
    else if (pressed === "back" || (m.back && !this.sending)) { sfx.menuBack(); this.done = true; }
    return null;
  }

  draw(ctx: CanvasRenderingContext2D): void {
    bg(ctx, this.t);
    title(ctx, "YOUR NAME", VIEW_W / 2, 250, 72, INK);
    label(ctx, "Other players see it on your characters, your maps and in rooms.", VIEW_W / 2, 330, 30, INK);
    card(ctx, FIELD.x, FIELD.y, FIELD.w, FIELD.h, INK, document.activeElement === this.field.el);
    this.field.place(FIELD.x + 20, FIELD.y + 14, FIELD.w - 40, FIELD.h - 28, 44);
    this.menu.draw(ctx, this.buttons());
    if (this.error) label(ctx, this.error, VIEW_W / 2, 760, 28, RED);
    hint(ctx, "Enter: save · Esc: back");
  }

  private submit(): void {
    if (this.sending) return;
    this.sending = true;
    this.error = "";
    rename(this.field.value).then(
      () => { sfx.menuConfirm(); this.done = true; },
      (error: unknown) => {
        console.error("renaming failed", error);
        this.error = error instanceof Error ? error.message : String(error);
        this.sending = false;
      },
    );
  }
}
