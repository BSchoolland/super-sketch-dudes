import { DRAW_PNG_MAX_BYTES } from "../../../../shared/draw";
import { card, title, INK } from "../ui";
import { PENCIL } from "../../render/paper";
import type { Button } from "./buttons";
import { DrawPad, MARKERS, SIZES } from "./pad";

const LEFT = 90, COL_W = 340;

/** The tool column left of a draw pad: pencil, markers, eraser, sizes, undo, clear. Ctrl+Z undoes while attached. */
export class PadTools {
  private readonly onKey = (e: KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.code === "KeyZ") { e.preventDefault(); this.pad.undo(); }
  };

  constructor(readonly pad: DrawPad) {}

  attach(): void {
    this.pad.attach();
    window.addEventListener("keydown", this.onKey);
  }

  detach(): void {
    this.pad.detach();
    window.removeEventListener("keydown", this.onKey);
  }

  buttons(): Button[] {
    const b: Button[] = [{ id: "pencil", x: LEFT, y: 100, w: COL_W, h: 84, text: "", custom: true }];
    MARKERS.forEach((_, i) => b.push({ id: `marker${i}`, x: LEFT + i * 69, y: 214, w: 64, h: 64, text: "", custom: true }));
    b.push({ id: "eraser", x: LEFT, y: 308, w: COL_W, h: 84, text: "", custom: true });
    SIZES.forEach((_, i) => b.push({ id: `size${i}`, x: LEFT + i * 116, y: 422, w: 104, h: 90, text: "", custom: true }));
    b.push({ id: "undo", x: LEFT, y: 590, w: COL_W, h: 84, text: "UNDO", size: 36, disabled: !this.pad.canUndo });
    b.push({ id: "clear", x: LEFT, y: 700, w: COL_W, h: 84, text: "CLEAR", size: 36, disabled: this.pad.blank });
    return b;
  }

  /** Handles a pressed tool button; false if the id isn't one of ours. */
  press(id: string): boolean {
    const pad = this.pad;
    if (id === "pencil") pad.tool = { kind: "pencil", color: INK };
    else if (id === "eraser") pad.tool = { kind: "eraser", color: INK };
    else if (id.startsWith("marker")) pad.tool = { kind: "marker", color: MARKERS[Number(id.slice(6))] };
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
      title(ctx, text, b.x + b.w / 2, b.y + 56, 40, active ? INK : PENCIL);
    };
    toolCard("pencil", "pencil", tool.kind === "pencil");
    toolCard("eraser", "eraser", tool.kind === "eraser");
    MARKERS.forEach((color, i) => {
      const b = at(`marker${i}`);
      const active = tool.kind === "marker" && tool.color === color;
      ctx.save();
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.arc(b.x + 32, b.y + 32, active ? 30 : 24, 0, Math.PI * 2); ctx.fill();
      ctx.lineWidth = active || focus === b.id ? 4 : 1.5; ctx.strokeStyle = INK; ctx.stroke();
      ctx.restore();
    });
    SIZES.forEach((size, i) => {
      const b = at(`size${i}`);
      card(ctx, b.x, b.y, b.w, b.h, INK, this.pad.size === i || focus === b.id);
      ctx.save();
      ctx.fillStyle = tool.kind === "marker" ? tool.color : INK;
      ctx.beginPath(); ctx.arc(b.x + b.w / 2, b.y + b.h / 2, 5 + size * 11, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    });
  }
}

/** The pad as a PNG data URL, or why it can't be sent. */
export function padPng(pad: DrawPad): { png: string } | { problem: string } {
  const png = pad.toPng();
  const bytes = Math.floor(((png.length - png.indexOf(",") - 1) * 3) / 4);
  if (bytes > DRAW_PNG_MAX_BYTES) return { problem: `this drawing is ${Math.round(bytes / 1000)} KB; the limit is ${DRAW_PNG_MAX_BYTES / 1000} KB` };
  return { png };
}
