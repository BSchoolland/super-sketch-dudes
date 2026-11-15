import { VIEW_H, VIEW_W } from "../render/camera";
import { PENCIL } from "../render/paper";
import type { MenuInput } from "../input/devices";
import { consumeTaps } from "../input/pointer";
import { fingers } from "../input/fingers";
import { sfx } from "../audio/audio";
import { bg, card, label, title, type Screen, INK } from "./ui";
import { ButtonMenu, type Button } from "./buttons";
import { forgeWords, RED } from "./character";
import { myLibrary, refreshLibrary } from "../fighters";
import { library } from "../account";
import { wrapped } from "./text";
import { DrawPad } from "./pad";
import { DESK_PAD, PadTools, TOUCH_PAD, type PadLayout } from "./padtools";
import type { CharacterHint, Nav } from "./nav";

export const PAD = DESK_PAD.pad;
/** Fewer lines than this and DONE DRAWING asks first: a stray stroke or two isn't a fighter yet. */
const FEW_LINES = 3;

/** The screen's own column, right of the pad: what to draw, the allowance, DONE DRAWING and BACK. */
interface Column {
  x: number; w: number;
  heading: { y: number; size: number };
  /** `plain`: where words with no heading go. */
  words: { y: number; size: number; textY: number; textSize: number; lines: number; plain: number };
  done: { y: number; h: number; size: number };
  back: { y: number; h: number; size: number };
  /** The wall's buttons. */
  reset: number; community: { y: number; h: number };
  confirm: { w: number; h: number; heading: number; body: number; button: { w: number; h: number; size: number } };
}

const DESK: Column = {
  x: 1490, w: 340,
  heading: { y: 160, size: 40 },
  words: { y: 250, size: 28, textY: 300, textSize: 26, lines: 9, plain: 220 },
  done: { y: 700, h: 130, size: 40 },
  back: { y: 860, h: 84, size: 36 },
  reset: 560, community: { y: 700, h: 130 },
  confirm: { w: 1000, h: 520, heading: 58, body: 32, button: { w: 400, h: 110, size: 38 } },
};

/** Big for a finger; DONE DRAWING at the bottom, as far from the tools as the screen goes. */
const TOUCH: Column = {
  x: 1496, w: 400,
  heading: { y: 390, size: 56 },
  words: { y: 460, size: 38, textY: 512, textSize: 34, lines: 4, plain: 460 },
  done: { y: 800, h: 240, size: 52 },
  back: { y: 660, h: 112, size: 44 },
  reset: 420, community: { y: 560, h: 180 },
  confirm: { w: 1400, h: 760, heading: 80, body: 48, button: { w: 600, h: 160, size: 54 } },
};

type Confirm = "send" | "leave";
/** Draws the pad's buttons under a question, none of them focused. */
const UNFOCUSED = Object.assign(new ButtonMenu(), { focus: -1 });

/**
 * NEW CHARACTER: the draw pad with no clock. DONE DRAWING goes on to naming and describing it, after asking when
 * there are only a line or two on the page; BACK asks before throwing a drawing away. How many characters the
 * player has left is beside the pad; when they can't send one, the pad isn't offered at all, unless they're back
 * from the describe page with a drawing on it. A finger gets the big layout (TOUCH_PAD), a mouse the classic one.
 */
export class CreateScreen implements Screen {
  t = 0;
  private tools: PadTools;
  private col: Column;
  private menu = new ButtonMenu();
  private problem = "";
  private next: Screen | null = null;
  /** The question over the pad, if one is up. */
  confirming: Confirm | null = null;

  constructor(private nav: Nav, private given?: DrawPad, private hint?: CharacterHint) {
    const touch = fingers();
    const layout: PadLayout = touch ? TOUCH_PAD : DESK_PAD;
    this.col = touch ? TOUCH : DESK;
    this.tools = new PadTools(given ?? new DrawPad(layout.pad), layout);
    this.tools.pad.locked = false;
  }

  enter(): void {
    this.tools.attach();
    void refreshLibrary();
  }

  private get words(): ReturnType<typeof forgeWords> | null {
    return myLibrary.forge && forgeWords(myLibrary.forge);
  }

  get walled(): boolean {
    return !this.given && this.tools.pad.blank && !!this.words?.blocked;
  }

  abandon(): void {
    this.tools.detach();
  }

  buttons(): Button[] {
    const c = this.col;
    if (!this.confirming) return this.padButtons();
    const b = c.confirm.button, y = (VIEW_H + this.confirmH()) / 2 - b.h - 50;
    return [
      { id: "keep", x: VIEW_W / 2 - b.w - 24, y, w: b.w, h: b.h, text: "KEEP DRAWING", size: b.size },
      this.confirming === "send"
        ? { id: "done", x: VIEW_W / 2 + 24, y, w: b.w, h: b.h, text: "I'M DONE", size: b.size }
        : { id: "leave", x: VIEW_W / 2 + 24, y, w: b.w, h: b.h, text: "THROW IT AWAY", size: b.size },
    ];
  }

  /** The buttons of the pad (or the wall), under any question. */
  private padButtons(): Button[] {
    const c = this.col;
    if (this.walled) return [
      ...(myLibrary.forge?.kind === "staff" && myLibrary.forge.wall === "day" ? [{ id: "reset", x: c.x, y: c.reset, w: c.w, h: 110, text: "RESET (ADMIN)", size: 32 }] : []),
      { id: "community", x: c.x, y: c.community.y, w: c.w, h: c.community.h, text: "COMMUNITY", size: c.done.size },
      { id: "back", x: c.x, y: c.back.y + (c === TOUCH ? 140 : 0), w: c.w, h: c.back.h, text: "BACK", size: c.back.size },
    ];
    return [
      ...this.tools.buttons(),
      { id: "done", x: c.x, y: c.done.y, w: c.w, h: c.done.h, text: "DONE DRAWING", size: c.done.size, disabled: this.tools.pad.blank },
      { id: "back", x: c.x, y: c.back.y, w: c.w, h: c.back.h, text: "BACK", size: c.back.size },
    ];
  }

  update(dt: number, m: MenuInput): Screen | null {
    this.t += dt;
    this.tools.pad.locked = this.walled || !!this.confirming;
    if (this.next) return this.leave(this.next);
    const pressed = this.menu.update(this.buttons(), m, consumeTaps());
    if (this.confirming) {
      if (pressed === "done") return this.leave(this.nav.describe(this.tools.pad, this.hint));
      if (pressed === "leave") return this.leave(this.nav.title());
      if (pressed === "keep" || m.back) { if (m.back) sfx.menuBack(); this.ask(null); }
      return null;
    }
    if (pressed === "community") return this.leave(this.nav.community());
    if (pressed === "reset") {
      sfx.menuConfirm();
      void library.resetAllowance().then(
        ({ forge }) => { myLibrary.forge = forge; },
        (error: unknown) => { console.error("allowance reset failed", error); this.problem = error instanceof Error ? error.message : String(error); },
      );
    }
    const pad = this.tools.pad;
    if (pressed === "done") {
      if (pad.lines < FEW_LINES) { this.ask("send"); return null; }
      return this.leave(this.nav.describe(pad, this.hint));
    }
    if (pressed === "back" || m.back) {
      if (!pad.blank && !this.walled) { this.ask("leave"); return null; }
      sfx.menuBack();
      return this.leave(this.nav.title());
    }
    if (pressed) this.tools.press(pressed);
    return null;
  }

  /** Puts a question over the pad (or takes it down), KEEP DRAWING first. */
  private ask(confirm: Confirm | null): void {
    this.confirming = confirm;
    this.menu.focus = 0;
    this.tools.pad.locked = !!confirm;
  }

  draw(ctx: CanvasRenderingContext2D): void {
    bg(ctx, this.t);
    const pad = this.tools.layout.pad, c = this.col, cx = c.x + c.w / 2;
    card(ctx, pad.x - 6, pad.y - 6, pad.w + 12, pad.h + 12, INK, false);
    const under = this.padButtons();
    const words = this.words;
    if (this.walled && words) {
      const touch = c === TOUCH, y = touch ? pad.y + 400 : pad.y + 380;
      title(ctx, words.title!, pad.x + pad.w / 2, y, touch ? 80 : 64, INK, "center", pad.w - 80);
      wrapped(ctx, words.text, pad.x + pad.w / 2, y + (touch ? 120 : 100), pad.w - 160, touch ? 48 : 36, INK, 5);
    } else {
      this.tools.pad.draw(ctx);
      label(ctx, "draw a fighter", cx, c.heading.y, c.heading.size, INK, "center", 900);
      if (words?.title) {
        label(ctx, words.title, cx, c.words.y, c.words.size, INK, "center", 900, c.w);
        wrapped(ctx, words.text, cx, c.words.textY, c.w + 40, c.words.textSize, PENCIL, c.words.lines);
      } else if (words?.text) wrapped(ctx, words.text, cx, c.words.plain, c.w + 40, c.words.size, PENCIL, 3);
      this.tools.draw(ctx, under, this.confirming ? undefined : this.menu.focused(under)?.id);
    }
    (this.confirming ? UNFOCUSED : this.menu).draw(ctx, under);
    if (this.confirming) {
      this.drawConfirm(ctx);
      this.menu.draw(ctx, this.buttons());
    }
    if (this.problem) {
      if (c === TOUCH) wrapped(ctx, this.problem, cx, c.heading.y - 56, c.w + 40, 30, RED, 1);
      else label(ctx, this.problem, pad.x + pad.w / 2, VIEW_H - 40, 28, RED);
    }
  }

  /** The question's card is shorter for a one-line question. */
  private confirmH(): number {
    const q = this.col.confirm;
    return this.confirming === "leave" ? q.h - q.body * 2.3 : q.h;
  }

  private drawConfirm(ctx: CanvasRenderingContext2D): void {
    const { w, heading, body } = this.col.confirm, h = this.confirmH(), x = (VIEW_W - w) / 2, y = (VIEW_H - h) / 2;
    ctx.save();
    ctx.fillStyle = "rgba(244,239,228,0.72)";
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    ctx.restore();
    card(ctx, x, y, w, h, INK, false);
    const [head, text] = this.confirming === "send"
      ? ["THAT'S ALL?", "There's only a line or two so far. Your fighter is made from this drawing: the more you draw, the better it turns out."]
      : ["THROW IT AWAY?", "Going back now loses this drawing."];
    title(ctx, head, VIEW_W / 2, y + heading * 1.6, heading, INK, "center", w - 80);
    wrapped(ctx, text, VIEW_W / 2, y + heading * 1.6 + body * 2.2, w - 160, body, INK, 4);
  }

  private leave(next: Screen): Screen {
    this.tools.detach();
    return next;
  }
}
