import { PENCIL } from "../render/paper";
import { cardLines, type LibraryEntry } from "../../../shared/account";
import { title, INK } from "./ui";
import { drawCharacterArt } from "./draw/character";
import { wrapped } from "./draw/text";

/** A library character big: the sheet (with the drawing pinned on) left, name, tagline and the 4-line card right. */
export function drawCharacterDetail(ctx: CanvasRenderingContext2D, e: LibraryEntry, x: number, y: number, size: number, textW: number, t: number): void {
  drawCharacterArt(ctx, e, x, y, size, t);
  const tx = x + size + 70;
  title(ctx, e.name ?? "?", tx, y + 90, e.name && e.name.length > 10 ? 72 : 96, INK, "left");
  let ty = y + 160;
  if (e.tagline) ty += wrapped(ctx, e.tagline, tx, ty, textW, 34, INK, 3, "left") + 30;
  for (const line of cardLines(e.card)) ty += wrapped(ctx, line, tx, ty, textW, 28, PENCIL, 2, "left", 700) + 10;
}
