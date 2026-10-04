import { VIEW_H, VIEW_W } from "../render/camera";
import { PENCIL } from "../render/paper";
import type { MenuInput } from "../input/devices";
import { consumeTaps } from "../input/pointer";
import { sfx } from "../audio/audio";
import { api } from "../account";
import { classTime } from "../classtime";
import { bg, card, label, title, type Screen, INK } from "./ui";
import { ButtonMenu, type Button } from "./buttons";
import { RED } from "./character";
import { TextField } from "./textfield";
import { wrapLines } from "./text";
import { DrawPad } from "./pad";
import { PadTools, padPng } from "./padtools";

const NOTE_W = 1240, NOTE_X = (VIEW_W - NOTE_W) / 2, SIZE = 27, LINE = SIZE * 1.3, GAP = 18;

function note(characters: number | null): string[] {
  return [
    "Hey guys, Ben here.",
    `Awesome to see how much you're liking the game! There've been ${characters ?? "lots of"} characters created already. Very exciting! I have big plans to improve the game and add more cool stuff.`,
    "But… you really shouldn't be playing so much in class ;)",
    "So I've blocked the game during school (at least while you're at school on a Chromebook) before you get caught and it gets blocked anyway. You'll be able to play again at 3:00.",
    "In the meantime, I added this feedback system. You can use it to say anything you want about the game, your ideas for it, or things you want to see changed or added! I'll be reading these.",
    "Anyways, thanks for the support and for playing the game so much! I hope you all keep playing, just not in class :P",
  ];
}

/** What a school Chromebook sees during class instead of the game; it lets go when class time ends. */
export class ClassScreen implements Screen {
  t = 0;
  private menu = new ButtonMenu();
  private feedbackY = 0;
  constructor(private onDone: () => Screen) {}

  private buttons(): Button[] {
    return [{ id: "feedback", x: VIEW_W / 2 - 260, y: this.feedbackY, w: 520, h: 84, text: "SEND FEEDBACK", size: 34 }];
  }

  update(dt: number, m: MenuInput): Screen | null {
    this.t += dt;
    if (!classTime.blocked) return this.onDone();
    if (this.feedbackY && this.menu.update(this.buttons(), m, consumeTaps()) === "feedback") return new FeedbackScreen(() => this);
    return null;
  }

  draw(ctx: CanvasRenderingContext2D): void {
    bg(ctx, this.t);
    title(ctx, "To keep this site from getting banned…", VIEW_W / 2, 100, 56);
    let y = 170;
    for (const para of note(classTime.characters)) {
      const lines = wrapLines(ctx, para, NOTE_W, SIZE, 6, 600);
      lines.forEach((l, i) => label(ctx, l, NOTE_X, y + i * LINE, SIZE, INK, "left", 600));
      y += lines.length * LINE + GAP;
    }
    this.feedbackY = Math.min(y + 4, VIEW_H - 110);
    this.menu.draw(ctx, this.buttons());
  }
}

const BOX = { x: 160, y: 240, w: 1040, h: 460 };
const THUMB = { x: 1260, y: 240, w: 460, h: 460 };
const FEEDBACK_MAX = 2000;

/** Anything a player wants to tell Ben about the game, with an optional sketch; it lands in feedback.jsonl on the server. */
export class FeedbackScreen implements Screen {
  t = 0;
  private menu = new ButtonMenu();
  private field: TextField;
  private pad = new DrawPad(SKETCH_PAD);
  private sending = false;
  private sent = false;
  private problem = "";

  constructor(private onBack: () => Screen) {
    this.field = new TextField({ maxLength: FEEDBACK_MAX, multiline: true, onSubmit: () => this.send(), onCancel: () => this.field.el.blur() });
  }

  enter(): void { this.field.el.style.display = this.sent ? "none" : ""; }
  abandon(): void { this.field.remove(); }

  private buttons(): Button[] {
    const y = BOX.y + BOX.h + 60;
    if (this.sent) return [{ id: "back", x: VIEW_W / 2 - 220, y, w: 440, h: 100, text: "DONE", size: 34 }];
    return [
      { id: "sketch", ...THUMB, text: "", custom: true, disabled: this.sending },
      { id: "send", x: VIEW_W / 2 - 460, y, w: 440, h: 100, text: this.sending ? "…" : "SEND", size: 34, disabled: this.sending || (!this.field.value.trim() && this.pad.blank) },
      { id: "back", x: VIEW_W / 2 + 20, y, w: 440, h: 100, text: "BACK", size: 34, disabled: this.sending },
    ];
  }

  update(dt: number, m: MenuInput): Screen | null {
    this.t += dt;
    const typing = document.activeElement === this.field.el;
    const pressed = this.menu.update(this.buttons(), typing ? { ...m, confirm: false, left: false, right: false, up: false, down: false } : m, consumeTaps());
    if (pressed === "send") this.send();
    if (pressed === "sketch") { this.field.el.style.display = "none"; return new SketchScreen(this.pad, () => this); }
    if (pressed === "back" || (m.back && !typing && !this.sending)) { sfx.menuBack(); this.field.remove(); return this.onBack(); }
    return null;
  }

  draw(ctx: CanvasRenderingContext2D): void {
    bg(ctx, this.t);
    title(ctx, "FEEDBACK", VIEW_W / 2, 100, 60);
    const buttons = this.buttons();
    if (this.sent) {
      label(ctx, "Thanks! Ben will read it.", VIEW_W / 2, BOX.y + BOX.h / 2, 40, INK, "center", 800);
    } else {
      label(ctx, "Anything about the game: ideas, bugs, what you want changed or added.", BOX.x, BOX.y - 30, 28, PENCIL, "left", 700);
      card(ctx, BOX.x, BOX.y, BOX.w, BOX.h, INK, document.activeElement === this.field.el);
      this.field.place(BOX.x + 24, BOX.y + 20, BOX.w - 48, BOX.h - 40, 30);
      label(ctx, `${this.field.value.length} / ${FEEDBACK_MAX}`, BOX.x + BOX.w, BOX.y + BOX.h + 32, 20, PENCIL, "right", 600);
      label(ctx, "Draw what you mean (optional)", THUMB.x, THUMB.y - 30, 28, PENCIL, "left", 700);
      card(ctx, THUMB.x, THUMB.y, THUMB.w, THUMB.h, INK, this.menu.focused(buttons)?.id === "sketch");
      if (this.pad.blank) label(ctx, "+ ADD A SKETCH", THUMB.x + THUMB.w / 2, THUMB.y + THUMB.h / 2 + 12, 34, INK, "center", 900);
      else {
        ctx.save(); ctx.translate(THUMB.x, THUMB.y); ctx.scale(THUMB.w / this.pad.rect.w, THUMB.h / this.pad.rect.h); ctx.translate(-this.pad.rect.x, -this.pad.rect.y); this.pad.draw(ctx); ctx.restore();
        label(ctx, "click to change it", THUMB.x + THUMB.w, THUMB.y + THUMB.h + 32, 20, PENCIL, "right", 600);
      }
    }
    this.menu.draw(ctx, buttons);
    if (this.problem) label(ctx, this.problem, VIEW_W / 2, VIEW_H - 40, 28, RED);
  }

  private send(): void {
    const text = this.field.value.trim();
    if (this.sending || this.sent || (!text && this.pad.blank)) return;
    let png: string | undefined;
    if (!this.pad.blank) {
      const out = padPng(this.pad);
      if ("problem" in out) { this.problem = out.problem; return; }
      png = out.png;
    }
    this.sending = true;
    this.problem = "";
    api<void>("/feedback", { method: "POST", body: JSON.stringify({ text, png }) }).then(
      () => { this.sent = true; this.sending = false; this.field.el.style.display = "none"; this.menu.focus = 0; sfx.menuConfirm(); },
      (e: unknown) => { console.error("feedback failed", e); this.problem = e instanceof Error ? e.message : String(e); this.sending = false; },
    );
  }
}

const SKETCH_PAD = { x: 510, y: 90, w: 900, h: 900 };
const RIGHT = 1490, COL_W = 340;

/** The character creator's pad and tools, for a feedback sketch. */
export class SketchScreen implements Screen {
  t = 0;
  private tools: PadTools;
  private menu = new ButtonMenu();
  constructor(pad: DrawPad, private onDone: () => Screen) {
    this.tools = new PadTools(pad);
  }

  enter(): void { this.tools.attach(); }
  abandon(): void { this.tools.detach(); }

  private buttons(): Button[] {
    return [...this.tools.buttons(), { id: "done", x: RIGHT, y: 820, w: COL_W, h: 130, text: "DONE", size: 40 }];
  }

  update(dt: number, m: MenuInput): Screen | null {
    this.t += dt;
    const pressed = this.menu.update(this.buttons(), m, consumeTaps());
    if (pressed === "done" || m.back) { sfx.menuConfirm(); this.tools.detach(); return this.onDone(); }
    if (pressed) this.tools.press(pressed);
    return null;
  }

  draw(ctx: CanvasRenderingContext2D): void {
    bg(ctx, this.t);
    card(ctx, SKETCH_PAD.x - 6, SKETCH_PAD.y - 6, SKETCH_PAD.w + 12, SKETCH_PAD.h + 12, INK, false);
    this.tools.pad.draw(ctx);
    label(ctx, "sketch your idea", RIGHT + COL_W / 2, 160, 36, INK, "center", 900);
    const buttons = this.buttons();
    this.tools.draw(ctx, buttons, this.menu.focused(buttons)?.id);
    this.menu.draw(ctx, buttons);
  }
}
