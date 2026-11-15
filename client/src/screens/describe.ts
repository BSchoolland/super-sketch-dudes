import { VIEW_H, VIEW_W } from "../render/camera";
import { PENCIL } from "../render/paper";
import type { MenuInput } from "../input/devices";
import { consumeTaps } from "../input/pointer";
import { fingers } from "../input/fingers";
import { uncoveredView } from "../input/keyboard";
import { sfx } from "../audio/audio";
import { HINT_DESCRIPTION_MAX, HINT_NAME_MAX } from "../../../shared/account";
import { library, playingAsGuest } from "../account";
import { bg, card, label, title, type Screen, INK } from "./ui";
import { ButtonMenu, inside, type Button } from "./buttons";
import { forgeOpens, RED } from "./character";
import { myLibrary } from "../fighters";
import type { DrawPad } from "./pad";
import { padPng } from "./padtools";
import { TextField } from "./textfield";
import type { CharacterHint, Nav } from "./nav";
import { tourBegin } from "./tour";
import { wrapped } from "./text";

interface Rect { x: number; y: number; w: number; h: number }
interface Field extends Rect { font: number }
interface Layout {
  art: Rect;
  form: { x: number; w: number };
  label: number;
  name: Field;
  desc: Field;
  /** "leave both empty…", and the line about paused characters. */
  hint: { y: number; size: number };
  resting: { x: number; y: number; w: number; size: number };
  pub: Rect & { size: number };
  send: Rect & { size: number };
  /** KEEP DRAWING's x; the rest as `send`. */
  backX: number;
}

const DESK: Layout = {
  art: { x: 120, y: 150, w: 720, h: 720 },
  form: { x: 960, w: 840 },
  label: 26,
  name: { x: 960, y: 200, w: 840, h: 96, font: 44 },
  desc: { x: 960, y: 380, w: 840, h: 250, font: 26 },
  hint: { y: 668, size: 24 },
  resting: { x: 960, y: 960, w: 960, size: 24 },
  pub: { x: 960, y: 690, w: 480, h: 80, size: 32 },
  send: { x: 960, y: 800, w: 400, h: 110, size: 34 },
  backX: 1400,
};

/** A finger's: the form takes most of the screen, its words big enough to read on a phone. */
const TOUCH: Layout = {
  art: { x: 50, y: 160, w: 600, h: 600 },
  form: { x: 720, w: 1150 },
  label: 40,
  name: { x: 720, y: 196, w: 1150, h: 130, font: 64 },
  desc: { x: 720, y: 426, w: 1150, h: 300, font: 46 },
  hint: { y: 778, size: 34 },
  resting: { x: 50, y: 820, w: 600, size: 30 },
  pub: { x: 720, y: 800, w: 640, h: 100, size: 40 },
  send: { x: 720, y: 930, w: 560, h: 130, size: 46 },
  backX: 1310,
};

const NAME_CAPTION = "NAME (optional)";
const DESC_CAPTION = "WHAT IS IT? WHAT DOES IT DO? (optional)";

/**
 * Between the pad and creation: an optional name and a line or two about the character, so the
 * player can steer the design ("it's a tank, the barrel shoots", "the tail is a whip").
 */
export class DescribeScreen implements Screen {
  t = 0;
  private menu = new ButtonMenu();
  private name: TextField;
  private description: TextField;
  private sending = false;
  /** Listed in COMMUNITY for anyone to save. */
  private pub = true;
  private problem = "";
  private next: Screen | null = null;
  private L: Layout;

  constructor(private nav: Nav, private pad: DrawPad, hint?: CharacterHint) {
    pad.locked = true;
    const touch = fingers();
    this.L = touch ? TOUCH : DESK;
    // on a phone the keyboard would cover the page before it's been seen: it comes up when a field is tapped
    this.name = new TextField({ maxLength: HINT_NAME_MAX, upper: true, quiet: touch, value: hint?.name, onSubmit: () => this.description.el.focus(), onCancel: () => this.back() });
    this.description = new TextField({ maxLength: HINT_DESCRIPTION_MAX, multiline: true, quiet: true, value: hint?.description, onSubmit: () => this.send(), onCancel: () => this.back() });
    this.menu.focus = playingAsGuest() ? 0 : 1;
  }

  abandon(): void {
    this.dispose();
  }

  buttons(): Button[] {
    const { pub, send, backX } = this.L;
    return [
      // a guest's characters stay out of COMMUNITY until they sign in
      ...(playingAsGuest() ? [] : [{ id: "public", ...pub, text: "SHARE WITH EVERYONE", checked: this.pub, disabled: this.sending }]),
      { id: "send", ...send, text: this.sending ? "…" : "CREATE CHARACTER", disabled: this.sending },
      { id: "back", ...send, x: backX, text: "KEEP DRAWING", disabled: this.sending },
    ];
  }

  /** The field being typed into while a phone's keyboard covers part of the screen, and where it goes instead. */
  private typing(): { field: TextField; at: Field; caption: string; open: Rect } | null {
    if (this.L !== TOUCH) return null;
    const field = [this.name, this.description].find((f) => document.activeElement === f.el);
    const open = field && uncoveredView();
    if (!field || !open) return null;
    const desc = field === this.description, base = desc ? this.L.desc : this.L.name;
    const w = Math.min(base.w, open.w - 80), y = open.y + Math.min(110, open.h * 0.2);
    const h = desc ? Math.max(base.font * 2.4, Math.min(base.h, open.y + open.h - y - 30)) : base.h;
    return { field, at: { x: open.x + (open.w - w) / 2, y, w, h, font: base.font }, caption: desc ? DESC_CAPTION : NAME_CAPTION, open };
  }

  update(dt: number, m: MenuInput): Screen | null {
    this.t += dt;
    if (this.next) { this.dispose(); return this.next; }
    const taps = consumeTaps();
    const typing = this.typing();
    if (typing) {
      // a tap off the field puts the keyboard away
      if (taps.some((p) => !inside(p, typing.at))) typing.field.el.blur();
      return null;
    }
    const pressed = this.menu.update(this.buttons(), m, taps);
    if (pressed === "public") this.pub = !this.pub;
    else if (pressed === "send") this.send();
    else if (pressed === "back" || (m.back && !this.sending)) return this.back();
    return null;
  }

  draw(ctx: CanvasRenderingContext2D): void {
    bg(ctx, this.t);
    const L = this.L, typing = this.typing();
    this.name.el.style.visibility = this.description.el.style.visibility = "";
    if (typing) {
      (typing.field === this.name ? this.description : this.name).el.style.visibility = "hidden";
      this.field(ctx, typing.field, typing.caption, typing.at);
      // the drawing, in what room is left under the field
      const { at, open } = typing, top = at.y + at.h + 40, size = Math.min(520, open.y + open.h - top - 30, open.w - 80);
      if (size >= 240) this.drawArt(ctx, { x: open.x + (open.w - size) / 2, y: top, w: size, h: size });
      return;
    }
    title(ctx, "WHO IS THIS?", VIEW_W / 2, 90, L === TOUCH ? 64 : 56);
    this.drawArt(ctx, L.art);
    this.field(ctx, this.name, NAME_CAPTION, L.name);
    this.field(ctx, this.description, DESC_CAPTION, L.desc);
    if (!this.name.value && !this.description.value) label(ctx, "leave both empty and it's all read from the drawing", L.form.x, L.hint.y, L.hint.size, PENCIL, "left");
    const buttons = this.buttons();
    this.menu.draw(ctx, buttons);
    const resting = myLibrary.forge?.resting;
    if (resting) wrapped(ctx, `New characters are paused: this one waits in line until they're back${resting.until ? ` ${forgeOpens(resting.until)}` : ""}`, L.resting.x, L.resting.y, L.resting.w, L.resting.size, PENCIL, 2, "left");
    if (this.problem) label(ctx, this.problem, VIEW_W / 2, VIEW_H - 40, L === TOUCH ? 36 : 28, RED);
  }

  private drawArt(ctx: CanvasRenderingContext2D, art: Rect): void {
    card(ctx, art.x - 6, art.y - 6, art.w + 12, art.h + 12, INK, false);
    this.pad.draw(ctx, art);
  }

  /** A field's caption and card, with its <input> laid over the card. */
  private field(ctx: CanvasRenderingContext2D, field: TextField, caption: string, at: Field): void {
    const desc = field === this.description, pad = desc ? 16 : 14;
    label(ctx, caption, at.x, at.y - 22, this.L.label, PENCIL, "left", 800);
    card(ctx, at.x, at.y, at.w, at.h, INK, document.activeElement === field.el);
    field.place(at.x + 20, at.y + pad, at.w - 40, at.h - pad * 2, at.font);
  }

  private back(): Screen {
    sfx.menuBack();
    const hint = { name: this.name.value.trim(), description: this.description.value.trim() };
    this.dispose();
    this.pad.locked = false;
    return this.nav.create(this.pad, hint);
  }

  private dispose(): void {
    this.name.remove();
    this.description.remove();
  }

  private send(): void {
    if (this.sending) return;
    this.sending = true;
    this.problem = "";
    const hint = { name: this.name.value.trim(), description: this.description.value.trim() };
    (async () => {
      const out = await padPng(this.pad);
      if ("problem" in out) throw new Error(out.problem);
      return library.create(out.png, hint, this.pub);
    })().then(
      ({ character, forge }) => {
        const hadOwn = (myLibrary.entries ?? []).some((e) => !e.starter && !e.saved);
        myLibrary.forge = forge;
        if (myLibrary.entries) myLibrary.entries = [character, ...myLibrary.entries];
        sfx.menuConfirm();
        tourBegin(character, hadOwn);
        this.next = this.nav.library();
      },
      (error: unknown) => {
        console.error("character upload failed", error);
        this.problem = error instanceof Error ? error.message : String(error);
        this.sending = false;
      },
    );
  }
}
