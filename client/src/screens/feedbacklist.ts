import { VIEW_H, VIEW_W } from "../render/camera";
import { PENCIL } from "../render/paper";
import type { MenuInput } from "../input/devices";
import { consumeTaps } from "../input/pointer";
import { sfx } from "../audio/audio";
import { feedbackApi, feedbackSketchImage, markSeen } from "../feedback";
import { RESPONSE_MAX, type FeedbackItem } from "../../../shared/feedback";
import { bg, card, label, title, type Screen, INK } from "./ui";
import { ButtonMenu, type Button } from "./buttons";
import { RED } from "./character";
import { TextField } from "./textfield";
import { drawExchange, drawSketch } from "./feedbackcard";
import { DrawPad } from "./pad";
import { padPng } from "./padtools";
import { SketchScreen, SKETCH_PAD } from "./classtime";

const day = (id: string): string => new Date(id).toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

const ROWS = 6, ROW_H = 118, ROW_GAP = 16, X = 200, W = VIEW_W - 2 * X - 120, TOP = 170;
const BACK = { id: "back", x: 40, y: VIEW_H - 130, w: 240, h: 90, text: "BACK", size: 40 };

/**
 * Feedback as rows, newest first: a player's own (PAST FEEDBACK), or for Ben everyone's (INBOX), where
 * the filter starts on the ones he hasn't answered. A row opens the feedback and its response.
 */
export class FeedbackListScreen implements Screen {
  t = 0;
  private menu = new ButtonMenu();
  private scroll = 0;
  private unanswered: boolean;

  constructor(private items: FeedbackItem[], private admin: boolean, private onBack: () => Screen) {
    this.unanswered = admin;
  }

  private get shown(): FeedbackItem[] {
    return this.unanswered ? this.items.filter((i) => i.player && !i.response) : this.items;
  }

  private buttons(): Button[] {
    const shown = this.shown;
    const b: Button[] = shown.map((_, i) => {
      const row = i - this.scroll;
      return { id: `f${i}`, x: X, y: row >= 0 && row < ROWS ? TOP + row * (ROW_H + ROW_GAP) : -9999, w: W, h: ROW_H, text: "", custom: true };
    });
    if (this.scroll > 0) b.push({ id: "up", x: X + W + 40, y: TOP, w: 80, h: 80, text: "▲", size: 40 });
    if (this.scroll + ROWS < shown.length) b.push({ id: "down", x: X + W + 40, y: TOP + ROWS * (ROW_H + ROW_GAP) - 96, w: 80, h: 80, text: "▼", size: 40 });
    if (this.admin) b.push({ id: "filter", x: VIEW_W - 560, y: VIEW_H - 130, w: 520, h: 90, text: this.unanswered ? "UNANSWERED" : "ALL", size: 34, step: () => { this.unanswered = !this.unanswered; this.scroll = 0; } });
    b.push(BACK);
    return b;
  }

  update(dt: number, m: MenuInput): Screen | null {
    this.t += dt;
    const shown = this.shown;
    const pressed = this.menu.update(this.buttons(), m, consumeTaps());
    const f = this.menu.focus;
    if (f < shown.length) {
      if (f < this.scroll) this.scroll = f;
      if (f >= this.scroll + ROWS) this.scroll = f - ROWS + 1;
    }
    if (pressed === "back" || m.back) { sfx.menuBack(); return this.onBack(); }
    if (pressed === "up") this.scroll--;
    if (pressed === "down") this.scroll++;
    if (pressed?.startsWith("f")) return new FeedbackDetailScreen(shown[Number(pressed.slice(1))], this.admin, () => this);
    return null;
  }

  draw(ctx: CanvasRenderingContext2D): void {
    bg(ctx, this.t);
    title(ctx, this.admin ? "INBOX" : "PAST FEEDBACK", VIEW_W / 2, 100, 60);
    const buttons = this.buttons();
    const focused = this.menu.focused(buttons)?.id;
    const shown = this.shown;
    if (!shown.length) label(ctx, this.unanswered ? "All answered." : "Nothing here yet.", VIEW_W / 2, VIEW_H / 2, 36, PENCIL);
    shown.forEach((item, i) => {
      const b = buttons[i];
      if (b.y < 0) return;
      card(ctx, b.x, b.y, b.w, b.h, INK, focused === b.id);
      let tx = b.x + 24;
      if (item.sketch) { drawSketch(ctx, item.sketch, b.x + 18, b.y + 15, ROW_H - 30); tx += ROW_H; }
      const who = this.admin ? `${item.player?.name ?? "signed out"} · ${day(item.id)}` : day(item.id);
      label(ctx, who, tx, b.y + 40, 24, PENCIL, "left", 700);
      label(ctx, item.text.replace(/\s+/g, " ") || "(just a sketch)", tx, b.y + 86, 30, INK, "left", 500, b.x + b.w - tx - 230);
      const tag = !item.response ? (this.admin && item.player ? "needs a response" : "") : !this.admin && !item.response.seenAt ? "NEW RESPONSE" : "responded";
      label(ctx, tag, b.x + b.w - 24, b.y + 70, 26, tag === "NEW RESPONSE" ? RED : PENCIL, "right", 800);
    });
    this.menu.draw(ctx, buttons);
  }
}

const BODY = { x: 200, y: 170, w: VIEW_W - 400 };
const TOP_H = 420, BOTTOM_H = 230, REPLY_H = 220;

/** One feedback and its response; Ben writes or rewrites the response here, with a drawing or attached image beside it. */
export class FeedbackDetailScreen implements Screen {
  t = 0;
  private menu = new ButtonMenu();
  private field: TextField | null = null;
  private pad: DrawPad | null = null;
  /** The pad's revision when it last matched the sent response. */
  private sentRevision = 0;
  /** The sent response's image, still being laid on the pad. */
  private loadingImage = false;
  private sending = false;
  private problem = "";
  /** Where the reply box is, as last drawn: it sits under however tall the feedback is. */
  private replyY = 0;

  constructor(private item: FeedbackItem, private admin: boolean, private onBack: () => Screen) {
    if (admin && item.player) {
      this.field = new TextField({ maxLength: RESPONSE_MAX, multiline: true, value: item.response?.text ?? "", onSubmit: () => this.send(), onCancel: () => this.field?.el.blur() });
      this.pad = new DrawPad(SKETCH_PAD);
      if (item.response?.sketch) this.loadImage(item.response.sketch);
    }
    if (!admin) markSeen(item);
  }

  private loadImage(name: string): void {
    const pad = this.pad!;
    this.loadingImage = true;
    feedbackSketchImage(name).then(
      (img) => { pad.startFrom(img); this.sentRevision = pad.revision; this.loadingImage = false; },
      (e: unknown) => { console.error(`response image ${name} failed`, e); this.problem = `your image failed to load: ${e instanceof Error ? e.message : String(e)}`; },
    );
  }

  enter(): void { if (this.field) this.field.el.style.display = ""; }
  abandon(): void { this.field?.remove(); }

  private get thumb() {
    return { x: BODY.x + BODY.w - REPLY_H, y: this.replyY, w: REPLY_H, h: REPLY_H };
  }

  private buttons(): Button[] {
    const y = VIEW_H - 130;
    const b: Button[] = [{ ...BACK, disabled: this.sending }];
    if (this.field && this.pad) {
      const empty = !this.field.value.trim() && this.pad.blank;
      const unchanged = this.field.value.trim() === (this.item.response?.text ?? "") && this.pad.revision === this.sentRevision;
      b.push({ id: "send", x: VIEW_W - 480, y, w: 440, h: 90, text: this.sending ? "…" : this.item.response ? "UPDATE RESPONSE" : "SEND RESPONSE", size: 32, disabled: this.sending || this.loadingImage || empty || unchanged });
      if (this.replyY) b.push({ id: "image", ...this.thumb, text: "", custom: true, disabled: this.sending || this.loadingImage });
    }
    return b;
  }

  update(dt: number, m: MenuInput): Screen | null {
    this.t += dt;
    const typing = !!this.field && document.activeElement === this.field.el;
    const pressed = this.menu.update(this.buttons(), typing ? { ...m, confirm: false, left: false, right: false, up: false, down: false } : m, consumeTaps());
    if (pressed === "send") this.send();
    if (pressed === "image" && this.pad) { this.field!.el.style.display = "none"; return new SketchScreen(this.pad, () => this, { prompt: "draw your answer", attach: true }); }
    if (pressed === "back" || (m.back && !typing && !this.sending)) { sfx.menuBack(); this.field?.remove(); return this.onBack(); }
    return null;
  }

  draw(ctx: CanvasRenderingContext2D): void {
    bg(ctx, this.t);
    const it = this.item;
    title(ctx, this.admin ? (it.player?.name ?? "Signed out") : "YOUR FEEDBACK", VIEW_W / 2, 100, 56);
    label(ctx, day(it.id), BODY.x + BODY.w, 100, 24, PENCIL, "right", 700);
    const [top, bottom] = !this.admin && it.response?.sketch ? [300, 380] : [TOP_H, this.admin ? 0 : BOTTOM_H];
    const lineY = drawExchange(ctx, this.admin ? { ...it, response: null } : it, BODY.x, BODY.y, BODY.w, top, bottom);
    this.replyY = lineY + 30;
    const reply = { x: BODY.x, y: this.replyY, w: BODY.w - REPLY_H - 30, h: REPLY_H };
    if (this.field && this.pad) {
      card(ctx, reply.x, reply.y, reply.w, reply.h, INK, document.activeElement === this.field.el);
      this.field.place(reply.x + 24, reply.y + 16, reply.w - 48, reply.h - 32, 30);
      const t = this.thumb;
      card(ctx, t.x, t.y, t.w, t.h, INK, this.menu.focused(this.buttons())?.id === "image");
      if (this.loadingImage) label(ctx, "…", t.x + t.w / 2, t.y + t.h / 2 + 10, 30, PENCIL);
      else if (this.pad.blank) label(ctx, "+ DRAW / IMAGE", t.x + t.w / 2, t.y + t.h / 2 + 10, 26, INK, "center", 900);
      else this.pad.draw(ctx, t);
      label(ctx, `${this.field.value.length} / ${RESPONSE_MAX}`, reply.x + reply.w, reply.y + reply.h + 30, 20, PENCIL, "right", 600);
      if (!this.loadingImage && !this.pad.blank) label(ctx, "click to change it", t.x + t.w, t.y + t.h + 30, 20, PENCIL, "right", 600);
      if (it.response) label(ctx, it.response.seenAt ? `${it.player!.name} saw this ${day(it.response.seenAt)}` : `Sent. ${it.player!.name} hasn't seen it yet.`, reply.x, reply.y + reply.h + 30, 22, PENCIL, "left", 600);
    } else if (this.admin) label(ctx, "Sent signed out: there's no account to respond to.", BODY.x, reply.y + 40, 28, PENCIL, "left", 600);
    this.menu.draw(ctx, this.buttons());
    if (this.problem) label(ctx, this.problem, VIEW_W / 2, VIEW_H - 160, 28, RED);
  }

  private send(): void {
    const pad = this.pad;
    if (!this.field || !pad || this.sending || this.loadingImage) return;
    const text = this.field.value.trim();
    if (!text && pad.blank) return;
    let png: string | undefined;
    if (!pad.blank) {
      const out = padPng(pad);
      if ("problem" in out) { this.problem = out.problem; return; }
      png = out.png;
    }
    const revision = pad.revision;
    this.sending = true;
    this.problem = "";
    feedbackApi.respond(this.item.id, text, png).then(
      ({ item }) => { Object.assign(this.item, item); this.sentRevision = revision; this.sending = false; sfx.menuConfirm(); },
      (e: unknown) => { console.error("feedback response failed", e); this.problem = e instanceof Error ? e.message : String(e); this.sending = false; },
    );
  }
}
