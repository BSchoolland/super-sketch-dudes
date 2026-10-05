import { DRAW_PNG_MAX_BYTES } from "../../../shared/account";
import { card, label, title, INK, settings } from "./ui";
import { PENCIL } from "../render/paper";
import { onPointer, type PointerStroke } from "../input/pointer";
import type { Button } from "./buttons";
import { DrawPad, COLORS, SIZES } from "./pad";
import { ColorWheel } from "./colorwheel";

const LEFT = 90, COL_W = 340;
/** Swatch width: the colour wheel takes a ninth slot in advanced mode. */
const swatchW = () => (settings.advanced ? 37 : 42);

/**
 * The tool column left of a draw pad: colours, a custom colour, pencil, eraser, fill, sizes, undo, clear.
 * In advanced mode a custom swatch opens a colour wheel over the tools and sizes. Ctrl+Z undoes while attached.
 */
export class PadTools {
  private readonly onKey = (e: KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.code === "KeyZ") { e.preventDefault(); this.pad.undo(); }
  };

  private wheel = new ColorWheel(LEFT + COL_W / 2, 335, 145, { x: LEFT + 25, y: 505, w: COL_W - 50, h: 40 });
  private wheelOpen = false;
  /** The last colour picked on the wheel, kept for its swatch. */
  private custom: string | null = null;
  private unsubscribe: (() => void) | null = null;

  constructor(readonly pad: DrawPad) {}

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
    this.wheelOpen = false;
  }

  private pointer(e: PointerStroke): void {
    if (!this.wheelOpen) return;
    const p = e.points[0];
    if (this.wheel.pointer(e)) { this.custom = this.wheel.color; this.pick(this.custom); }
    else if (e.phase === "down" && p.x > LEFT + COL_W) this.wheelOpen = false;
  }

  private pick(color: string): void {
    this.pad.tool = { kind: this.pad.tool.kind === "fill" ? "fill" : "pen", color };
  }

  buttons(): Button[] {
    const b: Button[] = [];
    COLORS.forEach((_, i) => b.push({ id: `color${i}`, x: LEFT + i * swatchW(), y: 100, w: swatchW(), h: 64, text: "", custom: true }));
    if (settings.advanced) b.push({ id: "wheel", x: LEFT + COLORS.length * swatchW(), y: 100, w: swatchW(), h: 64, text: "", custom: true });
    if (!this.wheelOpen) {
      ["pencil", "eraser", "fill"].forEach((id, i) => b.push({ id, x: LEFT + i * 116, y: 214, w: 108, h: 84, text: "", custom: true }));
      SIZES.forEach((_, i) => b.push({ id: `size${i}`, x: LEFT + i * 70, y: 422, w: 60, h: 90, text: "", custom: true }));
    }
    b.push({ id: "undo", x: LEFT, y: 590, w: COL_W, h: 84, text: "UNDO", size: 36, disabled: !this.pad.canUndo });
    b.push({ id: "clear", x: LEFT, y: 700, w: COL_W, h: 84, text: "CLEAR", size: 36, disabled: this.pad.blank });
    return b;
  }

  /** Handles a pressed tool button; false if the id isn't one of ours. */
  press(id: string): boolean {
    const pad = this.pad;
    if (id === "pencil") pad.tool = { kind: "pen", color: pad.tool.color };
    else if (id === "eraser") pad.tool = { kind: "eraser", color: pad.tool.color };
    else if (id === "fill") pad.tool = { kind: "fill", color: pad.tool.color };
    else if (id.startsWith("color")) { this.pick(COLORS[Number(id.slice(5))]); this.wheelOpen = false; }
    else if (id === "wheel") { this.wheelOpen = !this.wheelOpen; if (this.wheelOpen && this.custom) this.pick(this.custom); }
    else if (id.startsWith("size")) pad.size = Number(id.slice(4));
    else if (id === "undo") pad.undo();
    else if (id === "clear") pad.clear();
    else return false;
    return true;
  }

  /** Draws the custom tool cards; the caller's ButtonMenu draws UNDO and CLEAR. */
  draw(ctx: CanvasRenderingContext2D, buttons: Button[], focus: string | undefined): void {
    const tool = this.pad.tool;
    const at = (id: string) => buttons.find((candidate) => candidate.id === id)!;
    const toolCard = (id: string, text: string, active: boolean) => {
      const b = at(id);
      card(ctx, b.x, b.y, b.w, b.h, INK, active || focus === id);
      title(ctx, text, b.x + b.w / 2, b.y + 54, 30, active ? INK : PENCIL, "center", b.w - 12);
    };
    if (this.wheelOpen) this.wheel.draw(ctx);
    else {
      toolCard("pencil", "pencil", tool.kind === "pen");
      toolCard("eraser", "eraser", tool.kind === "eraser");
      toolCard("fill", "fill", tool.kind === "fill");
      SIZES.forEach((size, i) => {
        const b = at(`size${i}`);
        card(ctx, b.x, b.y, b.w, b.h, INK, this.pad.size === i || focus === b.id);
        ctx.save();
        ctx.fillStyle = tool.kind === "pen" ? tool.color : INK;
        ctx.beginPath(); ctx.arc(b.x + b.w / 2, b.y + b.h / 2, 3 + size * 10, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      });
    }
    if (performance.now() - this.pad.leakedAt < 1800) {
      const b = at("clear");
      label(ctx, "fill leaks to the edge", b.x + b.w / 2, b.y + b.h + 44, 28, "#c0392b");
    }
    COLORS.forEach((color, i) => {
      const b = at(`color${i}`);
      const active = tool.kind !== "eraser" && tool.color === color;
      ctx.save();
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.arc(b.x + b.w / 2, b.y + 32, active ? 18 : 14, 0, Math.PI * 2); ctx.fill();
      ctx.lineWidth = active || focus === b.id ? 4 : 1.5; ctx.strokeStyle = INK; ctx.stroke();
      ctx.restore();
    });
    if (settings.advanced) this.drawWheelSwatch(ctx, at("wheel"), focus);
  }

  private drawWheelSwatch(ctx: CanvasRenderingContext2D, w: Button, focus: string | undefined): void {
    const tool = this.pad.tool, wx = w.x + w.w / 2, wy = w.y + 32;
    const active = this.wheelOpen || (tool.kind !== "eraser" && tool.color === this.custom && !COLORS.includes(tool.color));
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
