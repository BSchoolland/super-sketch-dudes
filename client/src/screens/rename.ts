import { VIEW_W } from "../render/camera";
import { PENCIL } from "../render/paper";
import type { MenuInput } from "../input/devices";
import { consumeTaps } from "../input/pointer";
import { sfx } from "../audio/audio";
import { account, nameStanding, requestName } from "../account";
import { NAME_MAX, type NameStanding } from "../../../shared/account";
import { bg, card, hint, label, title, type Screen, INK } from "./ui";
import { RED } from "./character";
import { ButtonMenu, type Button } from "./buttons";
import { TextField } from "./textfield";

const FIELD = { x: VIEW_W / 2 - 420, y: 400, w: 840, h: 96 };
const POLL_S = 3;

/**
 * An account asks for the name other players see: on their characters, their maps and in rooms. The moderator
 * checks it first; until then the screen waits with them (they may leave), and says what came of it.
 */
export class RenameScreen implements Screen {
  t = 0;
  private menu = new ButtonMenu();
  private field: TextField | null = null;
  private standing: NameStanding | null = null;
  private asking = false;
  private polledAt = 0;
  private error = "";
  /** The name that was just approved, while they're still here. */
  private approved = "";
  private done = false;

  constructor(private onBack: () => Screen) {
    this.poll();
  }

  abandon(): void {
    this.field?.remove();
  }

  private get waiting(): boolean {
    return this.standing?.request?.status === "waiting";
  }

  private buttons(): Button[] {
    if (!this.standing || this.waiting) return [{ id: "back", x: VIEW_W / 2 - 200, y: 580, w: 400, h: 100, text: "BACK", size: 34 }];
    return [
      { id: "save", x: FIELD.x, y: 580, w: 400, h: 100, text: this.asking ? "…" : "SAVE", size: 34, disabled: this.asking },
      { id: "back", x: FIELD.x + 440, y: 580, w: 400, h: 100, text: "BACK", size: 34, disabled: this.asking },
    ];
  }

  update(dt: number, m: MenuInput): Screen | null {
    this.t += dt;
    if (this.done) { this.field?.remove(); return this.onBack(); }
    if (this.waiting && this.t - this.polledAt > POLL_S) this.poll();
    const pressed = this.menu.update(this.buttons(), m, consumeTaps());
    if (pressed === "save") this.submit();
    else if (pressed === "back" || (m.back && !this.asking)) { sfx.menuBack(); this.done = true; }
    return null;
  }

  draw(ctx: CanvasRenderingContext2D): void {
    bg(ctx, this.t);
    title(ctx, "YOUR NAME", VIEW_W / 2, 250, 72, INK);
    const request = this.standing?.request;
    if (request?.status === "waiting") {
      title(ctx, request.name, VIEW_W / 2, 450, 64, INK);
      label(ctx, this.standing!.checkerUp ? "Being checked: that usually takes under a minute." : "Waiting to be checked: the checker is away, so it may be a while.", VIEW_W / 2, 330, 30, INK);
      label(ctx, `Everyone sees ${account.player?.name ?? ""} until it's approved. You can leave this screen.`, VIEW_W / 2, 520, 26, PENCIL, "center", 600);
    } else if (this.standing) {
      label(ctx, "Other players see it on your characters, your maps and in rooms.", VIEW_W / 2, 330, 30, INK);
      card(ctx, FIELD.x, FIELD.y, FIELD.w, FIELD.h, INK, document.activeElement === this.field?.el);
      this.field?.place(FIELD.x + 20, FIELD.y + 14, FIELD.w - 40, FIELD.h - 28, 44);
      const said = this.error || (request?.status === "refused" ? `"${request.name}" wasn't allowed: ${request.reason}. Try another.` : "");
      if (said) label(ctx, said, VIEW_W / 2, 760, 28, RED);
      else if (this.approved) label(ctx, `Approved! Everyone sees you as ${this.approved} now.`, VIEW_W / 2, 760, 28, INK);
    }
    this.menu.draw(ctx, this.buttons());
    hint(ctx, this.waiting || !this.standing ? "Esc: back" : "Enter: save · Esc: back");
  }

  private show(standing: NameStanding): void {
    const was = this.standing?.request;
    this.standing = standing;
    if (was?.status === "waiting" && !standing.request && standing.player.name === was.name) { sfx.menuConfirm(); this.approved = was.name; }
    if (this.waiting) { this.field?.remove(); this.field = null; }
    else this.field ??= new TextField({ maxLength: NAME_MAX, value: account.player?.name ?? "", onSubmit: () => this.submit(), onCancel: () => { this.done = true; } });
  }

  private poll(): void {
    this.polledAt = this.t;
    nameStanding().then(
      (s) => { if (!this.done) this.show(s); },
      (error: unknown) => { console.error("checking on a name failed", error); this.error = error instanceof Error ? error.message : String(error); },
    );
  }

  private submit(): void {
    if (this.asking || !this.field) return;
    this.asking = true;
    this.error = "";
    this.approved = "";
    requestName(this.field.value).then(
      (s) => { sfx.menuConfirm(); this.asking = false; this.polledAt = this.t; this.show(s); },
      (error: unknown) => {
        console.error("asking for a name failed", error);
        this.error = error instanceof Error ? error.message : String(error);
        this.asking = false;
      },
    );
  }
}
