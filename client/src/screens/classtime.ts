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
    title(ctx, "CLASS IS IN SESSION", VIEW_W / 2, 100, 60);
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

const BOX = { x: (VIEW_W - 1200) / 2, y: 240, w: 1200, h: 440 };
const FEEDBACK_MAX = 2000;

/** Anything a player wants to tell Ben about the game; it lands in feedback.jsonl on the server. */
export class FeedbackScreen implements Screen {
  t = 0;
  private menu = new ButtonMenu();
  private field: TextField;
  private sending = false;
  private sent = false;
  private problem = "";

  constructor(private onBack: () => Screen) {
    this.field = new TextField({ maxLength: FEEDBACK_MAX, multiline: true, onSubmit: () => this.send(), onCancel: () => this.field.el.blur() });
  }

  abandon(): void { this.field.remove(); }

  private buttons(): Button[] {
    if (this.sent) return [{ id: "back", x: VIEW_W / 2 - 220, y: BOX.y + BOX.h + 60, w: 440, h: 100, text: "DONE", size: 34 }];
    return [
      { id: "send", x: VIEW_W / 2 - 460, y: BOX.y + BOX.h + 60, w: 440, h: 100, text: this.sending ? "…" : "SEND", size: 34, disabled: this.sending },
      { id: "back", x: VIEW_W / 2 + 20, y: BOX.y + BOX.h + 60, w: 440, h: 100, text: "BACK", size: 34, disabled: this.sending },
    ];
  }

  update(dt: number, m: MenuInput): Screen | null {
    this.t += dt;
    const typing = document.activeElement === this.field.el;
    const pressed = this.menu.update(this.buttons(), typing ? { ...m, confirm: false, left: false, right: false, up: false, down: false } : m, consumeTaps());
    if (pressed === "send") this.send();
    if (pressed === "back" || (m.back && !typing && !this.sending)) { sfx.menuBack(); this.field.remove(); return this.onBack(); }
    return null;
  }

  draw(ctx: CanvasRenderingContext2D): void {
    bg(ctx, this.t);
    title(ctx, "FEEDBACK", VIEW_W / 2, 100, 60);
    if (this.sent) {
      this.field.el.style.display = "none";
      label(ctx, "Thanks! Ben will read it.", VIEW_W / 2, BOX.y + BOX.h / 2, 40, INK, "center", 800);
    } else {
      label(ctx, "Anything about the game: ideas, bugs, what you want changed or added.", VIEW_W / 2, BOX.y - 30, 28, PENCIL, "center", 700);
      card(ctx, BOX.x, BOX.y, BOX.w, BOX.h, INK, document.activeElement === this.field.el);
      this.field.place(BOX.x + 24, BOX.y + 20, BOX.w - 48, BOX.h - 40, 30);
      label(ctx, `${this.field.value.length} / ${FEEDBACK_MAX}`, BOX.x + BOX.w, BOX.y + BOX.h + 32, 20, PENCIL, "right", 600);
    }
    this.menu.draw(ctx, this.buttons());
    if (this.problem) label(ctx, this.problem, VIEW_W / 2, VIEW_H - 40, 28, RED);
  }

  private send(): void {
    const text = this.field.value.trim();
    if (this.sending || this.sent || !text) return;
    this.sending = true;
    this.problem = "";
    api<void>("/feedback", { method: "POST", body: JSON.stringify({ text }) }).then(
      () => { this.sent = true; this.sending = false; this.menu.focus = 0; sfx.menuConfirm(); },
      (e: unknown) => { console.error("feedback failed", e); this.problem = e instanceof Error ? e.message : String(e); this.sending = false; },
    );
  }
}
