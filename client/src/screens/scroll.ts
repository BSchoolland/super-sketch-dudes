import { claimPress, pointer, wheelDelta } from "../input/pointer";
import { inkLine, PENCIL } from "../render/paper";
import { INK } from "./ui";
import type { Button } from "./buttons";

export interface Rect { x: number; y: number; w: number; h: number }

/** The bar sits this far right of the view, and a press this wide around it grabs it. */
const BAR_GAP = 28, BAR_GRAB = 44;
/** A press that travels this far is a drag, not a tap. */
const DRAG_START = 12;

/**
 * A window onto content taller than it: wheel and touchpad scroll it by the pixel, a press dragged on
 * it scrolls it (flung on release), and an ink scrollbar beside it can be grabbed. Content is laid out
 * in its own coordinates, 0 at the view's top; `at` turns those into the screen's.
 */
export class ScrollView {
  offset = 0;
  private target = 0;
  private content = 0;
  private drag: { mode: "content" | "bar"; from: number; y: number; t: number; velocity: number } | null = null;
  /** The press under way started on the view (or its bar) and hasn't been resolved into a drag or a tap. */
  private pressed = false;
  private t = 0;

  constructor(public view: Rect) {}

  get max(): number {
    return Math.max(0, this.content - this.view.h);
  }

  /** Once a frame: takes the wheel and the pointer, then eases toward where they asked for. */
  tick(dt: number, content: number): void {
    this.t += dt;
    this.content = content;
    const wheel = wheelDelta();
    if (wheel) this.target += wheel;
    this.pointer();
    if (!this.drag) {
      this.target = Math.max(0, Math.min(this.max, this.target));
      this.offset += (this.target - this.offset) * (1 - Math.exp(-dt * 16));
      if (Math.abs(this.target - this.offset) < 0.5) this.offset = this.target;
    }
  }

  private pointer(): void {
    const v = this.view, bar = this.bar();
    if (!pointer.down) {
      if (this.drag?.mode === "content") this.target = this.offset - this.drag.velocity * 0.3;
      this.drag = null;
      this.pressed = false;
      return;
    }
    if (!this.drag && !this.pressed) {
      this.pressed = true;
      if (bar && Math.abs(pointer.downX - (bar.x + bar.w / 2)) < BAR_GRAB / 2 && pointer.downY >= v.y && pointer.downY <= v.y + v.h) {
        claimPress();
        // grabbing the track off the thumb brings the thumb's middle there first
        if (pointer.downY < bar.y || pointer.downY > bar.y + bar.h) this.offset = this.target = this.fromBar(pointer.downY - bar.h / 2);
        this.drag = { mode: "bar", from: this.offset, y: pointer.downY, t: this.t, velocity: 0 };
      }
    }
    if (!this.drag) {
      if (!this.max || Math.abs(pointer.y - pointer.downY) < DRAG_START || !this.inView(pointer.downX, pointer.downY)) return;
      claimPress();
      this.drag = { mode: "content", from: this.offset, y: pointer.y, t: this.t, velocity: 0 };
    }
    const d = this.drag;
    if (d.mode === "bar") {
      this.offset = this.target = Math.max(0, Math.min(this.max, d.from + ((pointer.y - d.y) * this.max) / (this.view.h - this.thumbH)));
      return;
    }
    const was = this.offset;
    this.offset = this.target = Math.max(0, Math.min(this.max, d.from - (pointer.y - d.y)));
    const dt = this.t - d.t;
    if (dt > 0) d.velocity = d.velocity * 0.6 + ((was - this.offset) / dt) * 0.4;
    d.t = this.t;
  }

  private inView(x: number, y: number): boolean {
    const v = this.view;
    return x >= v.x && x <= v.x + v.w && y >= v.y && y <= v.y + v.h;
  }

  private get thumbH(): number {
    return Math.max(60, (this.view.h * this.view.h) / this.content);
  }

  /** The thumb, or null when everything fits. */
  private bar(): Rect | null {
    if (!this.max) return null;
    const v = this.view, h = this.thumbH;
    return { x: v.x + v.w + BAR_GAP - 5, y: v.y + (this.offset / this.max) * (v.h - h), w: 10, h };
  }

  /** The offset that puts the thumb's top at screen `y`. */
  private fromBar(y: number): number {
    const v = this.view, h = this.thumbH;
    return Math.max(0, Math.min(this.max, ((y - v.y) / (v.h - h)) * this.max));
  }

  /** Scrolls just enough that content from `top` to `bottom` is on screen, `margin` clear of the edges. */
  reveal(top: number, bottom: number, margin = 24): void {
    if (top - margin < this.target) this.target = top - margin;
    else if (bottom + margin > this.target + this.view.h) this.target = bottom + margin - this.view.h;
  }

  /** Content `y` on screen. */
  at(y: number): number {
    return this.view.y + y - this.offset;
  }

  /** Whether content from `y` to `y + h` shows at all. */
  shows(y: number, h: number): boolean {
    return y + h > this.offset && y < this.offset + this.view.h;
  }

  /** Within `px` of the end: time to fetch more. */
  nearEnd(px: number): boolean {
    return this.offset + this.view.h >= this.content - px;
  }

  /** A button for content at `r`: tappable only where it shows, so a tap above or below the view misses it. */
  button(id: string, r: Rect): Button {
    const top = Math.max(this.at(r.y), this.view.y), bottom = Math.min(this.at(r.y + r.h), this.view.y + this.view.h);
    return bottom > top ? { id, x: r.x, y: top, w: r.w, h: bottom - top, text: "", custom: true } : { id, x: r.x, y: -9999, w: r.w, h: r.h, text: "", custom: true };
  }

  /** Draws `body` clipped to the view (a little wider, for card shadows), then the bar. */
  draw(ctx: CanvasRenderingContext2D, body: () => void): void {
    const v = this.view;
    ctx.save();
    ctx.beginPath(); ctx.rect(v.x - 40, v.y, v.w + 80, v.h); ctx.clip();
    body();
    ctx.restore();
    const bar = this.bar();
    if (!bar) return;
    const x = bar.x + bar.w / 2;
    inkLine(ctx, x, v.y, x + 1, v.y + v.h, PENCIL, 1.5);
    const hot = this.drag?.mode === "bar" || (pointer.present && Math.abs(pointer.x - x) < BAR_GRAB / 2 && pointer.y >= v.y && pointer.y <= v.y + v.h);
    ctx.save();
    ctx.fillStyle = INK;
    ctx.beginPath(); ctx.roundRect(x - (hot ? 7 : 5), bar.y, hot ? 14 : 10, bar.h, 7); ctx.fill();
    ctx.restore();
    if (hot) document.body.style.cursor = "pointer";
  }
}
