import { inkRect, PENCIL } from "../render/paper";
import type { LibraryEntry } from "../../../shared/account";
import { INK, title } from "./ui";
import { drawImageIn } from "./images";
import { wrapped } from "./text";
import { drawFighterPortrait } from "./portrait";
import { fighterLoad } from "../gen";
import { roster } from "../../../shared/fighters/index";

export const RED = "#c0392b";

export type ArtSource = Pick<LibraryEntry, "id" | "status" | "bundleUrl" | "drawingUrl">;

/**
 * The drawing, or once the forge is done the fighter itself idling (big enough, with the original
 * drawing pinned to its corner). Until its bundle has loaded, a ready character shows its drawing.
 */
export function drawCharacterArt(ctx: CanvasRenderingContext2D, ch: ArtSource | null, x: number, y: number, size: number, t: number, picked = false): void {
  if (!ch) { drawImageIn(ctx, null, x, y, size, "—"); inkRect(ctx, x, y, size, size, PENCIL, 1.2); return; }
  const load = ch.status === "ready" && ch.bundleUrl ? fighterLoad(ch.bundleUrl) : null;
  const def = load?.state === "ready" ? roster[ch.id] : null;
  if (def) {
    drawImageIn(ctx, null, x, y, size);
    const pad = size * 0.08;
    drawFighterPortrait(ctx, def, `art@${Math.round(x)},${Math.round(y)}`, { x: x + pad, y: y + pad, w: size - pad * 2, h: size - pad * 2 }, { picked });
  } else drawImageIn(ctx, ch.drawingUrl, x, y, size, ch.status === "failed" ? "no drawing" : "");
  inkRect(ctx, x, y, size, size, INK, 1.6);
  if (def && size >= 200) {
    const inset = Math.round(size * 0.27);
    ctx.save();
    ctx.translate(x - size * 0.07, y - size * 0.07);
    ctx.rotate(-0.04);
    drawImageIn(ctx, ch.drawingUrl, 0, 0, inset);
    inkRect(ctx, 0, 0, inset, inset, INK, 1.6);
    ctx.restore();
  }
  if (ch.status === "generating" || ch.status === "queued") {
    // a pencil sweeping across while the forge works
    const band = size * 0.3, bx = x - band + ((t * 0.4) % 1) * (size + band);
    const g = ctx.createLinearGradient(bx, 0, bx + band, 0);
    g.addColorStop(0, "rgba(119,114,103,0)"); g.addColorStop(0.5, "rgba(119,114,103,0.16)"); g.addColorStop(1, "rgba(119,114,103,0)");
    ctx.save();
    ctx.beginPath(); ctx.rect(x, y, size, size); ctx.clip();
    ctx.fillStyle = g;
    ctx.fillRect(bx, y, band, size);
    ctx.restore();
  }
}

/** What the forge is doing with it, in words; null once it's a fighter. */
export function characterStatus(ch: Pick<LibraryEntry, "status" | "stage" | "error">, t: number): { text: string; color: string } | null {
  const dots = ".".repeat(1 + (Math.floor(t * 2) % 3));
  if (ch.status === "ready") return null;
  if (ch.status === "failed") return { text: ch.error ?? "couldn't be made", color: RED };
  if (ch.status === "queued") return { text: `${ch.stage || "waiting in line"}${dots}`, color: PENCIL };
  return { text: `${ch.stage || "forging"}${dots}`, color: INK };
}

/** One character as MY CHARACTERS shows it: the art, its name (or what the forge is doing) under it, a box when focused. */
export function drawCharacterCell(ctx: CanvasRenderingContext2D, e: LibraryEntry, x: number, y: number, size: number, t: number, focused: boolean): void {
  drawCharacterArt(ctx, e, x, y, size, t, focused);
  if (focused) {
    ctx.save(); ctx.strokeStyle = INK; ctx.lineWidth = Math.max(4, size / 40);
    ctx.strokeRect(x - 8, y - 8, size + 16, size + 16);
    ctx.restore();
  }
  const cx = x + size / 2, ty = y + size + Math.round(size * 0.16);
  const status = characterStatus(e, t);
  if (!status) title(ctx, e.name ?? "?", cx, ty, Math.round(size * 0.136), INK, "center", size + 20);
  else wrapped(ctx, e.status === "failed" ? "failed" : status.text, cx, ty, size + 20, Math.round(size * 0.096), status.color, 2);
}
