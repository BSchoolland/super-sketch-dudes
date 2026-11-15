import { VIEW_W } from "../../render/camera";
import { inkRect, PENCIL } from "../../render/paper";
import { allChoices, type FighterChoice } from "../../fighters";
import { portraitLoad } from "../../gen";
import { roster } from "../../../../shared/fighters/index";
import { drawImageIn } from "../images";
import { drawFighterPortrait } from "../portrait";
import { PRELOAD_ROWS } from "../character";
import { ScrollView, type Rect } from "../scroll";
import { grow, hover, label, small, INK } from "../ui";

/** A tile of the roster: a fighter, or (null) RANDOM. */
export type Tile = FighterChoice | null;

/**
 * Where the roster sits: `cols` boxes across `x0`..`x0 + span`, the first row's boxes `padTop` into a view at `viewY`.
 * On a small screen the boxes are bigger and fewer (finger-sized), and two rows show before it scrolls.
 */
interface Grid { cols: number; boxW: number; boxH: number; x0: number; span: number; gapX: number; rowH: number; padTop: number; name: number; viewY: number; viewH: number }
const SPAN = 1700, X0 = (VIEW_W - SPAN) / 2;
export function gridLayout(): Grid {
  if (!small()) return { cols: 8, boxW: 150, boxH: 120, x0: X0, span: SPAN, gapX: 34, rowH: 174, padTop: 34, name: 22, viewY: 96, viewH: 536 };
  const name = grow(22, 11), boxH = 166;
  const rowH = boxH + name + 34;
  return { cols: 6, boxW: 220, boxH, x0: X0, span: SPAN, gapX: 34, rowH, padTop: 34, name, viewY: 96, viewH: 34 + rowH + boxH + name + 16 };
}

/**
 * Every fighter that can be picked, in boxes across the top of the lobby with RANDOM first: your ready characters,
 * then the house's. More than fit scroll (wheel, finger, the keyboard's highlight). Read live, so a library that's
 * still loading fills in.
 */
export class RosterGrid {
  readonly scroll: ScrollView;
  private drawnAt = -1;

  constructor() {
    const g = gridLayout();
    this.scroll = new ScrollView({ x: g.x0, y: g.viewY, w: g.span, h: g.viewH });
  }

  get tiles(): Tile[] {
    const { mine, house } = allChoices();
    return [null, ...mine, ...house.filter((h) => !mine.some((m) => m.id === h.id))];
  }

  /** The fighters RANDOM picks from. */
  get fighters(): FighterChoice[] {
    return this.tiles.filter((t): t is FighterChoice => t !== null);
  }

  indexOf(id: string): number {
    return id ? this.tiles.findIndex((t) => t?.id === id) : -1;
  }

  /** Tile `i`'s box in the scroll's own coordinates. */
  private box(i: number): Rect {
    const g = gridLayout(), colW = (g.span - (g.cols - 1) * g.gapX) / g.cols;
    return { x: g.x0 + (i % g.cols) * (colW + g.gapX) + (colW - g.boxW) / 2, y: g.padTop + Math.floor(i / g.cols) * g.rowH, w: g.boxW, h: g.boxH };
  }

  /** Tile `i`'s box on screen, and whether any of it shows. */
  rect(i: number): Rect & { shown: boolean } {
    const b = this.box(i);
    return { ...b, y: this.scroll.at(b.y), shown: this.scroll.shows(b.y - 30, b.h + 60) };
  }

  /** The tile under a screen point, or -1 (outside the view counts as nothing). */
  at(x: number, y: number): number {
    const v = this.scroll.view;
    if (y < v.y || y > v.y + v.h) return -1;
    const tiles = this.tiles.length;
    for (let i = 0; i < tiles; i++) {
      const r = this.rect(i);
      // the name under a box is part of it
      if (x >= r.x - 10 && x <= r.x + r.w + 10 && y >= r.y - 10 && y <= r.y + r.h + gridLayout().name + 14) return i;
    }
    return -1;
  }

  /** Brings tile `i` into view. */
  reveal(i: number): void {
    const b = this.box(i), g = gridLayout();
    this.scroll.reveal(b.y - g.padTop, b.y + g.rowH - g.padTop, 0);
  }

  /** The tile `i` moves to on an arrow: rows of `cols`, clamped at the edges; null stepping down off the last row. */
  step(i: number, dx: number, dy: number): number | null {
    const n = this.tiles.length, cols = gridLayout().cols;
    if (dx) return Math.max(0, Math.min(n - 1, i + dx));
    const to = i + dy * cols;
    if (to < 0) return i;
    if (to >= n) return Math.floor(i / cols) < Math.floor((n - 1) / cols) ? n - 1 : null;
    return to;
  }

  /** Draws the boxes, then `over` (outlines and tokens) inside the same clip. The wheel and a finger dragged on it scroll it. */
  draw(ctx: CanvasRenderingContext2D, t: number, over: () => void): void {
    const tiles = this.tiles, g = gridLayout(), scroll = this.scroll, v = scroll.view;
    v.y = g.viewY; v.h = g.viewH;
    scroll.tick(this.drawnAt < 0 ? 0 : Math.min(0.1, t - this.drawnAt), g.padTop + Math.ceil(tiles.length / g.cols) * g.rowH - 14);
    this.drawnAt = t;
    scroll.draw(ctx, () => {
      tiles.forEach((tile, i) => {
        const b = this.box(i);
        if (!scroll.shows(b.y - g.padTop, g.rowH)) {
          if (tile && scroll.shows(b.y - g.padTop - PRELOAD_ROWS * g.rowH, (PRELOAD_ROWS + 1) * g.rowH)) portraitLoad(tile.bundleUrl);
          return;
        }
        drawTile(ctx, tile, b.x, scroll.at(b.y), b.w, b.h, g.name);
      });
      over();
    });
  }
}

/** One box: the fighter standing in it (its drawing, faint, while it loads), its name in ink caps under it. */
function drawTile(ctx: CanvasRenderingContext2D, tile: Tile, x: number, y: number, w: number, h: number, name: number): void {
  inkRect(ctx, x, y, w, h, INK, 2);
  label(ctx, tile ? tile.name.toUpperCase() : "RANDOM", x + w / 2, y + h + name * 0.3 + 18, name, INK, "center", 400, w + 60);
  if (!tile) { label(ctx, "?", x + w / 2, y + h * 0.78, h * 0.75, PENCIL, "center", 400); return; }
  const load = portraitLoad(tile.bundleUrl);
  const def = load.state === "ready" ? roster[tile.id] : null;
  const pad = 8, art = { x: x + pad, y: y + pad, w: w - pad * 2, h: h - pad * 2 };
  if (def) { drawFighterPortrait(ctx, def, `tile:${tile.id}`, art, { picked: hover(x, y, w, h) }); return; }
  if (load.state === "failed") { label(ctx, "didn't load", x + w / 2, y + h / 2 + 6, grow(18, 10), "#c0392b", "center", 700, w - 12); return; }
  const drawing = tile.entry?.drawingUrl ?? null;
  if (!drawing) { label(ctx, "…", x + w / 2, y + h / 2 + 10, 40, PENCIL); return; }
  ctx.save();
  ctx.globalAlpha *= 0.45;
  drawImageIn(ctx, drawing, art.x + (art.w - art.h) / 2, art.y, art.h);
  ctx.restore();
}
