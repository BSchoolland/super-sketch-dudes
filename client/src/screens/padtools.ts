import { DRAW_PNG_MAX_BYTES } from "../../../shared/account";
import { card, label, title, INK, settings, saveSettings } from "./ui";
import { PENCIL } from "../render/paper";
import { onPointer, type PointerStroke } from "../input/pointer";
import type { Button } from "./buttons";
import { DrawPad, COLORS, SIZES } from "./pad";
import { ColorWheel } from "./colorwheel";

const LEFT = 90, COL_W = 340;
/** Swatch width: the colour wheel takes a ninth slot in advanced mode. */
const swatchW = () => (settings.advanced ? 37 : 42);
/** Tool cards: the eyedropper takes a fourth slot in advanced mode. */
const TOOLS = () => (settings.advanced ? ["pencil", "eraser", "fill", "pick"] : ["pencil", "eraser", "fill"]);
const toolW = () => (settings.advanced ? 79 : 108);

/**
 * The tool column left of a draw pad: colours, a custom colour, pencil, eraser, fill, sizes, undo, redo, clear.
 * The ADVANCED toggle adds a colour wheel in the screen's right column, above its buttons, a swatch holding its
 * last pick, and an eyedropper that sets the wheel from the drawing. Ctrl+Z undoes and Ctrl+Shift+Z or Ctrl+Y redoes while attached.
 */
export class PadTools {
  private readonly onKey = (e: KeyboardEvent) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    if (e.code === "KeyY" || (e.code === "KeyZ" && e.shiftKey)) { e.preventDefault(); this.pad.redo(); }
    else if (e.code === "KeyZ") { e.preventDefault(); this.pad.undo(); }
  };

  private wheel = new ColorWheel(1660, 405, 170);
  /** The last colour picked on the wheel, kept for its swatch. */
  private custom: string | null = null;
  private unsubscribe: (() => void) | null = null;

  /** The tool the eyedropper hands back to once it has picked. */
  private beforePick: "pen" | "fill" = "pen";

  constructor(readonly pad: DrawPad) {
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
    const b: Button[] = [];
    COLORS.forEach((_, i) => b.push({ id: `color${i}`, x: LEFT + i * swatchW(), y: 100, w: swatchW(), h: 64, text: "", custom: true }));
    if (settings.advanced) b.push({ id: "wheel", x: LEFT + COLORS.length * swatchW(), y: 100, w: swatchW(), h: 64, text: "", custom: true });
    TOOLS().forEach((id, i) => b.push({ id, x: LEFT + i * (toolW() + 8), y: 214, w: toolW(), h: 84, text: "", custom: true }));
    SIZES.forEach((_, i) => b.push({ id: `size${i}`, x: LEFT + i * 70, y: 422, w: 60, h: 90, text: "", custom: true }));
    b.push({ id: "undo", x: LEFT, y: 590, w: COL_W / 2 - 4, h: 84, text: "UNDO", size: 36, disabled: !this.pad.canUndo });
    b.push({ id: "redo", x: LEFT + COL_W / 2 + 4, y: 590, w: COL_W / 2 - 4, h: 84, text: "REDO", size: 36, disabled: !this.pad.canRedo });
    b.push({ id: "clear", x: LEFT, y: 700, w: COL_W, h: 84, text: "CLEAR", size: 36, disabled: this.pad.blank });
    b.push({ id: "advanced", x: LEFT, y: 810, w: COL_W, h: 70, text: "ADVANCED", size: 30, checked: settings.advanced });
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
      title(ctx, text, b.x + b.w / 2, b.y + 54, settings.advanced ? 26 : 30, active ? INK : PENCIL, "center", b.w - 12);
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
    if (performance.now() - this.pad.leakedAt < 1800) {
      const b = at("advanced");
      label(ctx, "fill leaks to the edge", b.x + b.w / 2, b.y + b.h + 44, 28, "#c0392b");
    }
    COLORS.forEach((color, i) => {
      const b = at(`color${i}`);
      const active = tool.kind !== "eraser" && tool.kind !== "pick" && tool.color === color;
      ctx.save();
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.arc(b.x + b.w / 2, b.y + 32, active ? 18 : 14, 0, Math.PI * 2); ctx.fill();
      ctx.lineWidth = active || focus === b.id ? 4 : 1.5; ctx.strokeStyle = INK; ctx.stroke();
      ctx.restore();
    });
    if (settings.advanced) { this.wheel.draw(ctx); this.drawWheelSwatch(ctx, at("wheel"), focus); }
  }

  private drawWheelSwatch(ctx: CanvasRenderingContext2D, w: Button, focus: string | undefined): void {
    const tool = this.pad.tool, wx = w.x + w.w / 2, wy = w.y + 32;
    const active = tool.kind !== "eraser" && tool.kind !== "pick" && tool.color === this.custom && !COLORS.includes(tool.color);
    const rainbow = ctx.createConicGradient(0, wx, wy);
    ["#f00", "#ff0", "#0f0", "#0ff", "#00f", "#f0f", "#f00"].forEach((c, i) => rainbow.addColorStop(i / 6, c));
    ctx.save();
    ctx.fillStyle = rainbow;
    ctx.beginPath(); ctx.arc(wx, wy, active ? 18 : 14, 0, Math.PI * 2); ctx.fill();
    ctx.lineWidth = active || focus === w.id ? 4 : 1.5; ctx.strokeStyle = INK; ctx.stroke();
    if (this.custom) {
      ctx.fillStyle = this.custom;
      ctx.beginPath(); ctx.arc(wx, wy, active ? 10 : 8, 0, Math.PI * 2); ctx.fill();
      ctx.lineWidth = 1.5; ctx.stroke();
    }
    ctx.restore();
  }
}

/** The pad as a PNG data URL, or why it can't be sent. */
export function padPng(pad: DrawPad): { png: string } | { problem: string } {
  const png = pad.toPng();
  const bytes = Math.floor(((png.length - png.indexOf(",") - 1) * 3) / 4);
  if (bytes > DRAW_PNG_MAX_BYTES) return { problem: `this drawing is ${Math.round(bytes / 1000)} KB; the limit is ${DRAW_PNG_MAX_BYTES / 1000} KB` };
  return { png };
}
