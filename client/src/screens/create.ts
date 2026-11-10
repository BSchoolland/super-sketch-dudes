import { VIEW_H } from "../render/camera";
import { PENCIL } from "../render/paper";
import type { MenuInput } from "../input/devices";
import { consumeTaps } from "../input/pointer";
import { sfx } from "../audio/audio";
import { bg, card, label, title, type Screen, INK } from "./ui";
import { ButtonMenu, type Button } from "./buttons";
import { forgeWords, RED } from "./character";
import { myLibrary, refreshLibrary } from "../fighters";
import { wrapped } from "./text";
import { DrawPad } from "./pad";
import { PadTools } from "./padtools";
import type { CharacterHint, Nav } from "./nav";

export const PAD = { x: 510, y: 90, w: 900, h: 900 };
const RIGHT = 1490, COL_W = 340;

/**
 * NEW CHARACTER: the draw pad with no clock. DONE DRAWING goes on to naming and describing it. How many forges the
 * player has left is beside the pad; when they can't send one, the pad isn't offered at all, unless they're
 * back from the describe page with a drawing on it.
 */
export class CreateScreen implements Screen {
  t = 0;
  private tools: PadTools;
  private menu = new ButtonMenu();
  private problem = "";
  private next: Screen | null = null;

  constructor(private nav: Nav, private given?: DrawPad, private hint?: CharacterHint) {
    this.tools = new PadTools(given ?? new DrawPad(PAD));
    this.tools.pad.locked = false;
  }

  enter(): void {
    this.tools.attach();
    void refreshLibrary();
  }

  private get words(): ReturnType<typeof forgeWords> | null {
    return myLibrary.forge && forgeWords(myLibrary.forge);
  }

  private get walled(): boolean {
    return !this.given && this.tools.pad.blank && !!this.words?.blocked;
  }

  abandon(): void {
    this.tools.detach();
  }

  private buttons(): Button[] {
    if (this.walled) return [
      { id: "community", x: RIGHT, y: 700, w: COL_W, h: 130, text: "COMMUNITY", size: 40 },
      { id: "back", x: RIGHT, y: 860, w: COL_W, h: 84, text: "BACK", size: 36 },
    ];
    return [
      ...this.tools.buttons(),
      { id: "done", x: RIGHT, y: 700, w: COL_W, h: 130, text: "DONE DRAWING", size: 40, disabled: this.tools.pad.blank },
      { id: "back", x: RIGHT, y: 860, w: COL_W, h: 84, text: "BACK", size: 36 },
    ];
  }

  update(dt: number, m: MenuInput): Screen | null {
    this.t += dt;
    this.tools.pad.locked = this.walled;
    if (this.next) return this.leave(this.next);
    const pressed = this.menu.update(this.buttons(), m, consumeTaps());
    if (pressed === "community") return this.leave(this.nav.community());
    if (pressed === "done") { sfx.menuConfirm(); return this.leave(this.nav.describe(this.tools.pad, this.hint)); }
    else if (pressed === "back" || m.back) { sfx.menuBack(); return this.leave(this.nav.title()); }
    else if (pressed) this.tools.press(pressed);
    return null;
  }

  draw(ctx: CanvasRenderingContext2D): void {
    bg(ctx, this.t);
    card(ctx, PAD.x - 6, PAD.y - 6, PAD.w + 12, PAD.h + 12, INK, false);
    const buttons = this.buttons();
    const words = this.words;
    if (this.walled && words) {
      title(ctx, words.title!, PAD.x + PAD.w / 2, PAD.y + 380, 64);
      wrapped(ctx, words.text, PAD.x + PAD.w / 2, PAD.y + 480, PAD.w - 160, 36, INK, 5);
    } else {
      this.tools.pad.draw(ctx);
      label(ctx, "draw a fighter", RIGHT + COL_W / 2, 160, 40, INK, "center", 900);
      if (words?.title) {
        label(ctx, words.title, RIGHT + COL_W / 2, 250, 28, INK, "center", 900);
        wrapped(ctx, words.text, RIGHT + COL_W / 2, 300, COL_W + 40, 26, PENCIL, 9);
      } else if (words?.text) label(ctx, words.text, RIGHT + COL_W / 2, 220, 28, PENCIL);
      this.tools.draw(ctx, buttons, this.menu.focused(buttons)?.id);
    }
    this.menu.draw(ctx, buttons);
    if (this.problem) label(ctx, this.problem, PAD.x + PAD.w / 2, VIEW_H - 40, 28, RED);
  }

  private leave(next: Screen): Screen {
    this.tools.detach();
    return next;
  }
}
