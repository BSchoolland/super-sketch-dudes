import { DRAW_PNG_MAX_BYTES } from "../../../shared/account";
import { card, label, title, INK, settings, saveSettings } from "./ui";
import { PENCIL } from "../render/paper";
import { onPointer, type PointerStroke } from "../input/pointer";
import type { Button } from "./buttons";
import { DrawPad, COLORS, SIZES } from "./pad";
import { ColorWheel } from "./colorwheel";
import { decodePng, isPng, type Pixels } from "./png";

interface Rect { x: number; y: number; w: number; h: number }
/** A row of equal cards across `w`, `gap` apart. */
interface Row extends Rect { gap: number }

/** Where a draw pad and its tools go, in view pixels. */
export interface PadLayout {
  pad: Rect;
  /** The swatches: a grid of `w`-wide cells from (x, y), `cols` across (one more with ADVANCED's wheel swatch); `dot` is a swatch's radius. */
  colors: { x: number; y: number; w: number; h: number; cols: number; advancedCols: number; dot: number };
  tools: Row & { font: number };
  /** The brush sizes: `cols` to a row (all five by default), `h` each row's height. */
  sizes: Row & { cols?: number };
  history: Row & { font: number };
  clear: Rect & { font: number };
  advanced: Rect & { font: number };
  wheel: { cx: number; cy: number; r: number };
  /** Where "fill leaks to the edge" is said. */
  leak: { x: number; y: number };
}

/** A mouse's: tools in a column left of the pad, the colour wheel over the screen's right column. */
export const DESK_PAD: PadLayout = {
  pad: { x: 510, y: 90, w: 900, h: 900 },
  colors: { x: 90, y: 100, w: 340, h: 64, cols: 8, advancedCols: 9, dot: 14 },
  tools: { x: 90, y: 214, w: 340, h: 84, gap: 8, font: 30 },
  sizes: { x: 90, y: 422, w: 340, h: 90, gap: 10 },
  history: { x: 90, y: 590, w: 340, h: 84, gap: 8, font: 36 },
  clear: { x: 90, y: 700, w: 340, h: 84, font: 36 },
  advanced: { x: 90, y: 810, w: 340, h: 70, font: 30 },
  wheel: { cx: 1660, cy: 405, r: 170 },
  leak: { x: 260, y: 924 },
};

/**
 * A finger's: the pad as tall as the screen allows (clear of its edges, where phones keep their back gestures), the
 * colours, tools, sizes and wheel in big cards left of it, UNDO, REDO and CLEAR top right.
 */
export const TOUCH_PAD: PadLayout = {
  pad: { x: 460, y: 40, w: 1000, h: 1000 },
  colors: { x: 24, y: 40, w: 412, h: 230, cols: 4, advancedCols: 5, dot: 26 },
  tools: { x: 24, y: 284, w: 412, h: 116, gap: 10, font: 40 },
  sizes: { x: 24, y: 414, w: 412, h: 108, gap: 10, cols: 3 },
  history: { x: 1496, y: 40, w: 400, h: 124, gap: 12, font: 44 },
  clear: { x: 1496, y: 184, w: 400, h: 110, font: 40 },
  advanced: { x: 24, y: 936, w: 412, h: 104, font: 38 },
  wheel: { cx: 230, cy: 788, r: 140 },
  leak: { x: 960, y: 110 },
};

const row = (r: Row, n: number, i: number): Rect => {
  const w = (r.w - r.gap * (n - 1)) / n;
  return { x: r.x + i * (w + r.gap), y: r.y, w, h: r.h };
};
/** Tool cards: the eyedropper takes a fourth slot in advanced mode. */
const TOOLS = () => (settings.advanced ? ["pencil", "eraser", "fill", "pick"] : ["pencil", "eraser", "fill"]);

/**
 * The tools beside a draw pad: colours, a custom colour, pencil, eraser, fill, sizes, undo, redo, clear, laid out by
 * a PadLayout. The ADVANCED toggle adds a colour wheel, a swatch holding its last pick, and an eyedropper that sets
 * the wheel from the drawing. Ctrl+Z undoes and Ctrl+Shift+Z or Ctrl+Y redoes while attached.
 */
export class PadTools {
  private readonly onKey = (e: KeyboardEvent) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    if (e.code === "KeyY" || (e.code === "KeyZ" && e.shiftKey)) { e.preventDefault(); this.pad.redo(); }
    else if (e.code === "KeyZ") { e.preventDefault(); this.pad.undo(); }
  };

  private wheel: ColorWheel;
  /** The last colour picked on the wheel, kept for its swatch. */
  private custom: string | null = null;
  private unsubscribe: (() => void) | null = null;

  /** The tool the eyedropper hands back to once it has picked. */
  private beforePick: "pen" | "fill" = "pen";

  constructor(readonly pad: DrawPad, readonly layout: PadLayout = DESK_PAD) {
    pad.rect = layout.pad;
    this.wheel = new ColorWheel(layout.wheel.cx, layout.wheel.cy, layout.wheel.r);
    pad.onPick = (r, g, b) => {
      this.wheel.setRgb(r, g, b);
      this.custom = this.wheel.color;
      pad.tool = { kind: this.beforePick, color: this.custom };
    };
  }

  attach(): void {
    this.pad.attach();
    window.addEventListener("keydown", this.onKey);
    if (!this.unsubscribe) this.unsubscribe = onPointer((e) => this.pointer(e));
  }

  detach(): void {
    this.pad.detach();
    window.removeEventListener("keydown", this.onKey);
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  private pointer(e: PointerStroke): void {
    if (settings.advanced && this.wheel.pointer(e)) { this.custom = this.wheel.color; this.pick(this.custom); }
  }

  private pick(color: string): void {
    this.pad.tool = { kind: this.pad.tool.kind === "fill" ? "fill" : "pen", color };
  }

  /** A swatch press: the colour, with the wheel moved to it. */
  private choose(color: string): void {
    const n = parseInt(color.slice(1), 16);
    this.wheel.setRgb(n >> 16, (n >> 8) & 255, n & 255);
    this.pick(color);
  }

  buttons(): Button[] {
    const L = this.layout, b: Button[] = [];
    const cols = settings.advanced ? L.colors.advancedCols : L.colors.cols;
    const rows = Math.ceil((COLORS.length + (settings.advanced ? 1 : 0)) / cols);
    const sw = L.colors.w / cols, sh = L.colors.h / rows;
    const swatch = (id: string, i: number) => b.push({ id, x: L.colors.x + (i % cols) * sw, y: L.colors.y + Math.floor(i / cols) * sh, w: sw, h: sh, text: "", custom: true });
    COLORS.forEach((_, i) => swatch(`color${i}`, i));
    if (settings.advanced) swatch("wheel", COLORS.length);
    const tools = TOOLS();
    tools.forEach((id, i) => b.push({ id, ...row(L.tools, tools.length, i), text: "", custom: true }));
    const per = L.sizes.cols ?? SIZES.length;
    SIZES.forEach((_, i) => {
      const at = row(L.sizes, per, i % per);
      b.push({ id: `size${i}`, ...at, y: at.y + Math.floor(i / per) * (L.sizes.h + L.sizes.gap), text: "", custom: true });
    });
    b.push({ id: "undo", ...row(L.history, 2, 0), text: "UNDO", size: L.history.font, disabled: !this.pad.canUndo });
    b.push({ id: "redo", ...row(L.history, 2, 1), text: "REDO", size: L.history.font, disabled: !this.pad.canRedo });
    b.push({ id: "clear", ...L.clear, text: "CLEAR", size: L.clear.font, disabled: this.pad.blank });
    b.push({ id: "advanced", ...L.advanced, text: "ADVANCED", size: L.advanced.font, checked: settings.advanced });
    return b;
  }

  /** Handles a pressed tool button; false if the id isn't one of ours. */
  press(id: string): boolean {
    const pad = this.pad;
    if (id === "pencil") pad.tool = { kind: "pen", color: pad.tool.color };
    else if (id === "eraser") pad.tool = { kind: "eraser", color: pad.tool.color };
    else if (id === "fill") pad.tool = { kind: "fill", color: pad.tool.color };
    else if (id === "pick") {
      if (pad.tool.kind === "pen" || pad.tool.kind === "fill") this.beforePick = pad.tool.kind;
      pad.tool = { kind: "pick", color: pad.tool.color };
    }
    else if (id.startsWith("color")) this.choose(COLORS[Number(id.slice(5))]);
    else if (id === "wheel") this.choose(this.custom ?? this.wheel.color);
    else if (id.startsWith("size")) pad.size = Number(id.slice(4));
    else if (id === "undo") pad.undo();
    else if (id === "redo") pad.redo();
    else if (id === "clear") pad.clear();
    else if (id === "advanced") {
      settings.advanced = !settings.advanced;
      saveSettings();
      if (!settings.advanced && pad.tool.kind === "pick") pad.tool = { kind: this.beforePick, color: pad.tool.color };
    }
    else return false;
    return true;
  }

  /** Draws the custom tool cards; the caller's ButtonMenu draws UNDO, REDO, CLEAR and ADVANCED. */
  draw(ctx: CanvasRenderingContext2D, buttons: Button[], focus: string | undefined): void {
    const tool = this.pad.tool;
    const at = (id: string) => buttons.find((candidate) => candidate.id === id)!;
    const toolCard = (id: string, text: string, active: boolean) => {
      const b = at(id);
      card(ctx, b.x, b.y, b.w, b.h, INK, active || focus === id);
      const font = this.layout.tools.font * (settings.advanced ? 0.87 : 1);
      title(ctx, text, b.x + b.w / 2, b.y + b.h / 2 + font * 0.4, font, active ? INK : PENCIL, "center", b.w - 12);
    };
    toolCard("pencil", "pencil", tool.kind === "pen");
    toolCard("eraser", "eraser", tool.kind === "eraser");
    toolCard("fill", "fill", tool.kind === "fill");
    if (settings.advanced) toolCard("pick", "pick", tool.kind === "pick");
    SIZES.forEach((size, i) => {
      const b = at(`size${i}`);
      card(ctx, b.x, b.y, b.w, b.h, INK, this.pad.size === i || focus === b.id);
      ctx.save();
      ctx.fillStyle = tool.kind === "pen" ? tool.color : INK;
      ctx.beginPath(); ctx.arc(b.x + b.w / 2, b.y + b.h / 2, 3 + size * 10, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    });
    if (performance.now() - this.pad.leakedAt < 1800) label(ctx, "fill leaks to the edge", this.layout.leak.x, this.layout.leak.y, this.layout === DESK_PAD ? 28 : 40, "#c0392b");
    COLORS.forEach((color, i) => {
      const b = at(`color${i}`);
      const active = tool.kind !== "eraser" && tool.kind !== "pick" && tool.color === color;
      ctx.save();
      ctx.fillStyle = color;
      const dot = this.layout.colors.dot;
      ctx.beginPath(); ctx.arc(b.x + b.w / 2, b.y + b.h / 2, active ? dot * 1.3 : dot, 0, Math.PI * 2); ctx.fill();
      ctx.lineWidth = active || focus === b.id ? 4 : 1.5; ctx.strokeStyle = INK; ctx.stroke();
      ctx.restore();
    });
    if (settings.advanced) { this.wheel.draw(ctx); this.drawWheelSwatch(ctx, at("wheel"), focus); }
  }

  private drawWheelSwatch(ctx: CanvasRenderingContext2D, w: Button, focus: string | undefined): void {
    const tool = this.pad.tool, wx = w.x + w.w / 2, wy = w.y + w.h / 2, dot = this.layout.colors.dot;
    const active = tool.kind !== "eraser" && tool.kind !== "pick" && tool.color === this.custom && !COLORS.includes(tool.color);
    const rainbow = ctx.createConicGradient(0, wx, wy);
    ["#f00", "#ff0", "#0f0", "#0ff", "#00f", "#f0f", "#f00"].forEach((c, i) => rainbow.addColorStop(i / 6, c));
    ctx.save();
    ctx.fillStyle = rainbow;
    ctx.beginPath(); ctx.arc(wx, wy, active ? dot * 1.3 : dot, 0, Math.PI * 2); ctx.fill();
    ctx.lineWidth = active || focus === w.id ? 4 : 1.5; ctx.strokeStyle = INK; ctx.stroke();
    if (this.custom) {
      ctx.fillStyle = this.custom;
      ctx.beginPath(); ctx.arc(wx, wy, (active ? 10 : 8) * dot / 14, 0, Math.PI * 2); ctx.fill();
      ctx.lineWidth = 1.5; ctx.stroke();
    }
    ctx.restore();
  }
}

/**
 * A picture's pixels for the pad. PNGs are decoded here; other formats only through a canvas, and Firefox's
 * fingerprinting protection (and some privacy add-ons) hand back noise from that, so there they're refused.
 */
export async function picturePixels(blob: Blob): Promise<Pixels> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (isPng(bytes)) return decodePng(bytes);
  if (!canvasReadable()) throw new Error("this browser scrambles pictures read through a canvas (a privacy setting): use a PNG");
  const bmp = await createImageBitmap(blob);
  const c = document.createElement("canvas");
  c.width = bmp.width; c.height = bmp.height;
  const g = c.getContext("2d", { willReadFrequently: true })!;
  g.drawImage(bmp, 0, 0);
  return { w: c.width, h: c.height, data: g.getImageData(0, 0, c.width, c.height).data };
}

/** Whether this browser hands back what was drawn on a canvas, rather than a scrambled placeholder. */
function canvasReadable(): boolean {
  const c = document.createElement("canvas");
  c.width = c.height = 8;
  const g = c.getContext("2d", { willReadFrequently: true })!;
  g.fillStyle = "#d02020"; g.fillRect(0, 0, 4, 8);
  g.fillStyle = "#2040d0"; g.fillRect(4, 0, 4, 8);
  const d = g.getImageData(0, 0, 8, 8).data;
  const near = (i: number, r: number, gr: number, b: number) => Math.abs(d[i] - r) < 24 && Math.abs(d[i + 1] - gr) < 24 && Math.abs(d[i + 2] - b) < 24;
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
    const i = (y * 8 + x) * 4;
    if (!(x < 4 ? near(i, 0xd0, 0x20, 0x20) : near(i, 0x20, 0x40, 0xd0))) return false;
  }
  return true;
}

/** The pad as a PNG data URL, or why it can't be sent. */
export async function padPng(pad: DrawPad): Promise<{ png: string } | { problem: string }> {
  const png = await pad.toPng();
  const bytes = Math.floor(((png.length - png.indexOf(",") - 1) * 3) / 4);
  if (bytes > DRAW_PNG_MAX_BYTES) return { problem: `this drawing is ${Math.round(bytes / 1000)} KB; the limit is ${DRAW_PNG_MAX_BYTES / 1000} KB` };
  return { png };
}
