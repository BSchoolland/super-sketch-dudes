import { VIEW_H, VIEW_W } from "../render/camera";
import { PENCIL } from "../render/paper";
import type { LibraryEntry, Player } from "../../../shared/account";
import { practiceDummy } from "../fighters";
import { fighterLoad } from "../gen";
import { card, label, title, INK } from "./ui";
import { drawAvatar, drawImageIn } from "./images";
import { inkRect } from "../render/paper";
import { wrapped } from "./text";
import { MoveDemo, demoMoves, type DemoMove } from "./movedemo";
import { roster } from "../../../shared/fighters/index";

const DEMO = { x: 90, y: 100, w: 1060 };
const COL_X = 1210, COL_W = 620, ROW_H = 56, ROW_GAP = 10;

/** One of the fighter's moves as a button in the right-hand column. */
export interface MoveRow { i: number; head: string; move: DemoMove; x: number; y: number; w: number; h: number }

/** The fighter's moves (none until its bundle has loaded). */
export function moveRows(e: Pick<LibraryEntry, "id">, top: number): MoveRow[] {
  const def = roster[e.id];
  if (!def) return [];
  return demoMoves(def).map((move, i) => ({ i, head: move.name, move, x: COL_X, y: top + i * (ROW_H + ROW_GAP), w: COL_W, h: ROW_H }));
}

export type DetailSource = Pick<LibraryEntry, "id" | "name" | "tagline" | "bundleUrl" | "drawingUrl">;
/** Who made someone else's character, and how many players have it saved; read every frame, so it can change. */
export interface Credit { creator: Pick<Player, "name" | "avatar">; saves: number }

export const savesWords = (n: number): string => `${n} ${n === 1 ? "save" : "saves"}`;

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

  constructor(readonly entry: DetailSource, private credit: Credit | null = null) {}

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
    if (this.credit) {
      const r = 22, cy = ty - 10;
      drawAvatar(ctx, this.credit.creator, COL_X + r, cy, r);
      label(ctx, this.credit.creator.name, COL_X + r * 2 + 14, cy + 10, 28, INK, "left", 800, COL_W - 260);
      label(ctx, savesWords(this.credit.saves), COL_X + COL_W, cy + 10, 28, PENCIL, "right", 800);
      ty += 64;
    }
    if (e.tagline) ty += wrapped(ctx, e.tagline, COL_X, ty, COL_W, 30, INK, 3, "left") + 24;
    this.movesTop = ty;
    for (const r of rows) {
      const on = r === active;
      card(ctx, r.x, r.y, r.w, r.h, INK, on);
      title(ctx, r.head, r.x + 20, r.y + r.h / 2 + 9, 24, INK, "left");
    }
    if (!practiceDummy.choice) label(ctx, "no practice dummy yet", DEMO.x + DEMO.w / 2, DEMO.y + h + 34, 22, PENCIL);
  }
}
