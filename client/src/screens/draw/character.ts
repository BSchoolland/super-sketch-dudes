import { inkLine, inkRect, PENCIL } from "../../render/paper";
import type { DrawCharacter } from "../../../../shared/draw";
import { INK } from "../ui";
import { drawImageIn } from "./images";

export const RED = "#c0392b";

/** The drawing, or once the forge is done the sheet it drew with the original drawing pinned to its corner. */
export function drawCharacterArt(ctx: CanvasRenderingContext2D, ch: DrawCharacter | null, x: number, y: number, size: number, t: number): void {
  if (!ch) { drawImageIn(ctx, null, x, y, size, "—"); inkRect(ctx, x, y, size, size, PENCIL, 1.2); return; }
  if (ch.status === "ready" && ch.sheetUrl) {
    drawImageIn(ctx, ch.sheetUrl, x, y, size);
    const inset = Math.round(size * 0.3);
    ctx.save();
    ctx.translate(x - size * 0.03, y - size * 0.03);
    ctx.rotate(-0.04);
    drawImageIn(ctx, ch.drawingUrl, 0, 0, inset);
    inkRect(ctx, 0, 0, inset, inset, INK, 1.6);
    ctx.restore();
  } else {
    drawImageIn(ctx, ch.drawingUrl, x, y, size, ch.status === "failed" ? "no drawing" : "");
  }
  inkRect(ctx, x, y, size, size, INK, 1.6);
  if (ch.status === "generating" || ch.status === "queued") {
    // a pencil sweeping across while the forge works
    const phase = (t * 0.45) % 1;
    ctx.save();
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = PENCIL;
    ctx.fillRect(x + size * phase * 0.9, y, size * 0.1, size);
    ctx.restore();
  }
  if (ch.spent) {
    inkLine(ctx, x + size * 0.08, y + size * 0.08, x + size * 0.92, y + size * 0.92, RED, Math.max(3, size / 40), 3);
    inkLine(ctx, x + size * 0.92, y + size * 0.08, x + size * 0.08, y + size * 0.92, RED, Math.max(3, size / 40), 7);
  }
}

/** What the forge is doing with it, in words; null once it's a fighter. */
export function characterStatus(ch: DrawCharacter, t: number): { text: string; color: string } | null {
  const dots = ".".repeat(1 + (Math.floor(t * 2) % 3));
  if (ch.status === "ready") return null;
  if (ch.status === "failed") return { text: ch.error ?? "the forge failed", color: RED };
  if (ch.status === "waiting") return { text: "still drawing", color: PENCIL };
  if (ch.status === "queued") return { text: `${ch.stage || "waiting for the forge"}${dots}`, color: PENCIL };
  return { text: `${ch.stage || "forging"}${dots}`, color: INK };
}
