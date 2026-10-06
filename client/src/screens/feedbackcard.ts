import { VIEW_H, VIEW_W } from "../render/camera";
import { inkLine, inkPath, PAPER, PENCIL } from "../render/paper";
import type { MenuInput } from "../input/devices";
import { sfx } from "../audio/audio";
import { consumeTaps } from "../input/pointer";
import { feedbackSketch, markSeen } from "../feedback";
import type { FeedbackItem } from "../../../shared/feedback";
import { drawImageIn } from "./images";
import { wrapLines } from "./text";
import { card, hover, label, title, INK } from "./ui";

const LINE = 1.25;

/** Every line of `text` (its own line breaks kept) at the largest size from `size` down to `min` that fits `maxH`; cut with "…" if even `min` doesn't. */
function fitLines(ctx: CanvasRenderingContext2D, text: string, w: number, maxH: number, size: number, min: number): { lines: string[]; size: number } {
  for (let s = size; ; s -= 2) {
    const lines = text.split("\n").flatMap((p) => (p.trim() ? wrapLines(ctx, p, w, s, 999, 500) : [""]));
    const fits = Math.floor(maxH / (s * LINE));
    if (lines.length <= fits) return { lines, size: s };
    if (s - 2 < min) return { lines: [...lines.slice(0, fits - 1), `${lines[fits - 1].replace(/\s*\S*$/, "")}…`], size: s };
  }
}

type Fit = { lines: string[]; size: number };
const fitHeight = (f: Fit): number => f.lines.length * f.size * LINE + f.size * 0.3;

function drawFit(ctx: CanvasRenderingContext2D, f: Fit, x: number, y: number): void {
  f.lines.forEach((l, i) => label(ctx, l, x, y + f.size + i * f.size * LINE, f.size, INK, "left", 500));
}

export function drawSketch(ctx: CanvasRenderingContext2D, name: string, x: number, y: number, size: number): void {
  const s = feedbackSketch(name);
  card(ctx, x - 6, y - 6, size + 12, size + 12, INK, false);
  if (s === "loading") drawImageIn(ctx, null, x, y, size, "…");
  else if ("error" in s) drawImageIn(ctx, null, x, y, size, s.error);
  else drawImageIn(ctx, s.url, x, y, size);
}

interface Exchange { text: Fit | null; sketch: number; line: number; response: Fit | null; height: number }

/** What the player wrote (up to `top` tall) beside their sketch, the line under it, and Ben's response in up to `bottom` (0: none). */
function layout(ctx: CanvasRenderingContext2D, item: FeedbackItem, w: number, top: number, bottom: number): Exchange {
  const sketch = item.sketch ? Math.min(top, 360) : 0;
  const text = item.text ? fitLines(ctx, item.text, sketch ? w - sketch - 40 : w, top, 30, 18) : null;
  const line = Math.max(text ? fitHeight(text) : 0, sketch) + 30;
  const response = bottom && item.response ? fitLines(ctx, item.response.text, w, bottom, 30, 18) : null;
  return { text, sketch, line, response, height: line + (!bottom ? 0 : response ? 30 + fitHeight(response) : 90) };
}

/** Draws `layout`'s exchange at x, y; returns where the line is. */
export function drawExchange(ctx: CanvasRenderingContext2D, item: FeedbackItem, x: number, y: number, w: number, top: number, bottom: number, at = layout(ctx, item, w, top, bottom)): number {
  if (at.text) drawFit(ctx, at.text, x, y);
  if (item.sketch) drawSketch(ctx, item.sketch, x + w - at.sketch, y + 6, at.sketch - 12);
  const lineY = y + at.line;
  inkLine(ctx, x, lineY, x + w, lineY + 4, INK, 3);
  if (at.response) drawFit(ctx, at.response, x, lineY + 30);
  else if (bottom) label(ctx, "No response yet.", x, lineY + 70, 28, PENCIL, "left", 600);
  return lineY;
}

const W = 1300, X = (VIEW_W - W) / 2, PAD = 70, HEAD = 140, FOOT = 170;
const OK_W = 300, OK_H = 90;

/** Ben's responses this player hasn't seen, one card each, over the title screen. */
export class FeedbackResponseCard {
  /** The OK button as last drawn: the card is as tall as what's on it. */
  private ok = { x: VIEW_W / 2 - OK_W / 2, y: 0, w: OK_W, h: OK_H };
  constructor(private items: FeedbackItem[]) {}

  /** True once the last card is closed. */
  update(_dt: number, m: MenuInput): boolean {
    const ok = this.ok;
    const tapped = consumeTaps().some((t) => t.x >= ok.x && t.x <= ok.x + ok.w && t.y >= ok.y && t.y <= ok.y + ok.h);
    if (!(m.confirm || m.start || m.back || tapped)) return false;
    sfx.menuConfirm();
    markSeen(this.items.shift()!);
    return !this.items.length;
  }

  draw(ctx: CanvasRenderingContext2D): void {
    const item = this.items[0];
    if (!item) return;
    const at = layout(ctx, item, W - 2 * PAD, 330, 270);
    const h = HEAD + at.height + FOOT, y = (VIEW_H - h) / 2;
    ctx.fillStyle = "rgba(41,39,34,0.45)";
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    inkPath(ctx, [[X, y], [X + W, y], [X + W, y + h], [X, y + h]], true, 17);
    ctx.fillStyle = PAPER; ctx.fill();
    ctx.lineWidth = 3; ctx.strokeStyle = INK; ctx.stroke();
    title(ctx, "Feedback response", VIEW_W / 2, y + 95, 64);
    drawExchange(ctx, item, X + PAD, y + HEAD, W - 2 * PAD, 330, 270, at);
    const ok = this.ok;
    ok.y = y + h - OK_H - 40;
    if (hover(ok.x, ok.y, ok.w, ok.h)) document.body.style.cursor = "pointer";
    card(ctx, ok.x, ok.y, ok.w, ok.h, INK, true);
    title(ctx, "OK", VIEW_W / 2, ok.y + ok.h / 2 + 16, 46);
  }
}
