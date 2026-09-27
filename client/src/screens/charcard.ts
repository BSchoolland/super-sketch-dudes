import { VIEW_H, VIEW_W } from "../render/camera";
import { PENCIL } from "../render/paper";
import { cardLines, type LibraryEntry } from "../../../shared/account";
import { practiceDummy } from "../fighters";
import { fighterLoad } from "../gen";
import { card, label, title, INK } from "./ui";
import { drawImageIn } from "./images";
import { inkRect } from "../render/paper";
import { wrapped } from "./text";
import { MoveDemo, cardText, demoMoves, type DemoMove } from "./movedemo";
import { roster } from "../../../shared/fighters/index";

const DEMO = { x: 90, y: 100, w: 1060 };
const COL_X = 1210, COL_W = 620, ROW_H = 76, ROW_GAP = 10;

/** One of the fighter's moves as a button in the right-hand column, with what the card says about it. */
export interface MoveRow { i: number; head: string; rest: string; move: DemoMove; x: number; y: number; w: number; h: number }

/** The fighter's moves (none until its bundle has loaded). */
export function moveRows(e: LibraryEntry, top: number): MoveRow[] {
  const def = roster[e.id];
  if (!def) return [];
  const card = cardLines(e.card);
  return demoMoves(def).map((move, i) => ({ i, head: move.name, rest: cardText(card, move.name), move, x: COL_X, y: top + i * (ROW_H + ROW_GAP), w: COL_W, h: ROW_H }));
}

/**
 * A ready library character big: a live preview of it (against the practice dummy) on the left,
 * name, tagline and its moves on the right. Hover or focus a move and the preview does it; otherwise
 * it cycles through them all.
 */
export class CharacterDetail {
  private demo: MoveDemo | null = null;
  /** The row the preview is on while nothing is hovered or focused. */
  private cycle = 0;
  /** Where the move buttons start, below however many lines the tagline took. */
  movesTop = 330;

  constructor(readonly entry: LibraryEntry) {}

  private demoReady(): MoveDemo | null {
    if (this.demo) return this.demo;
    const you = this.entry.bundleUrl ? fighterLoad(this.entry.bundleUrl) : null;
    const dummy = practiceDummy.choice ? fighterLoad(practiceDummy.choice.bundleUrl) : null;
    if (you?.state !== "ready" || (dummy && dummy.state === "loading")) return null;
    this.demo = new MoveDemo(this.entry.id, dummy?.state === "ready" ? practiceDummy.choice!.id : null);
    return this.demo;
  }

  draw(ctx: CanvasRenderingContext2D, rows: MoveRow[], active: MoveRow | null, dt: number): void {
    const e = this.entry;
    const h = (DEMO.w * VIEW_H) / VIEW_W;
    const demo = this.demoReady();
    if (!active && rows.length) {
      if (demo?.shownAll) this.cycle++;
      active = rows[this.cycle % rows.length];
    }
    if (demo) {
      demo.play(active?.move ?? null);
      demo.update(dt);
      demo.draw(ctx, DEMO.x, DEMO.y, DEMO.w, dt);
    } else {
      drawImageIn(ctx, e.drawingUrl, DEMO.x, DEMO.y + (h - DEMO.w * 0.5) / 2, DEMO.w * 0.5);
      label(ctx, "…", DEMO.x + DEMO.w / 2, DEMO.y + h / 2, 60, PENCIL);
    }
    // the drawing it all came from, pinned to the corner
    const pin = 170;
    ctx.save();
    ctx.translate(DEMO.x + DEMO.w - pin + 24, DEMO.y - 30);
    ctx.rotate(0.04);
    drawImageIn(ctx, e.drawingUrl, 0, 0, pin);
    inkRect(ctx, 0, 0, pin, pin, INK, 1.6);
    ctx.restore();

    title(ctx, e.name ?? "?", COL_X, DEMO.y + 70, 80, INK, "left", COL_W);
    let ty = DEMO.y + 130;
    if (e.tagline) ty += wrapped(ctx, e.tagline, COL_X, ty, COL_W, 30, INK, 3, "left") + 24;
    this.movesTop = ty;
    for (const r of rows) {
      const on = r === active;
      card(ctx, r.x, r.y, r.w, r.h, INK, on);
      title(ctx, r.head, r.x + 20, r.y + 33, 24, INK, "left");
      wrapped(ctx, r.rest, r.x + 20, r.y + 60, r.w - 40, 20, on ? INK : PENCIL, 1, "left", 700);
    }
    if (!practiceDummy.choice) label(ctx, "no practice dummy yet", DEMO.x + DEMO.w / 2, DEMO.y + h + 34, 22, PENCIL);
  }
}
