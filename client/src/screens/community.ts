import { VIEW_H, VIEW_W } from "../render/camera";
import { inkLine, inkPath, PAPER, PENCIL } from "../render/paper";
import type { MenuInput } from "../input/devices";
import { consumeTaps } from "../input/pointer";
import { sfx } from "../audio/audio";
import { library } from "../account";
import { refreshDummy, refreshLibrary } from "../fighters";
import type { CommunityCharacter, CommunitySort } from "../../../shared/account";
import { bg, card, hover, label, title, type Screen, INK } from "./ui";
import { ButtonMenu, type Button } from "./buttons";
import { drawCharacterCell, RED } from "./character";
import { CharacterDetail, moveRows, type MoveRow } from "./charcard";
import type { Nav } from "./nav";

const COLS = 6, ROWS = 2, ART = 250, GAP = 50, ROW_H = 350, TOP = 160;
const X0 = (VIEW_W - (COLS * ART + (COLS - 1) * GAP)) / 2;
const TAB = { w: 210, h: 72, y: 46, gap: 14 };
const SORTS: CommunitySort[] = ["popular", "new"];

/** A bookmark ribbon hanging off a cell's top-right corner with the save count on it: red once you've saved it. */
function drawRibbon(ctx: CanvasRenderingContext2D, x: number, y: number, n: number, saved: boolean): void {
  const w = 52, h = 70, notch = 14;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(0.03);
  inkPath(ctx, [[0, 0], [w, 0], [w, h], [w / 2, h - notch], [0, h]], true, Math.round(x));
  ctx.fillStyle = saved ? RED : PAPER;
  ctx.fill();
  ctx.lineWidth = 2.4; ctx.lineJoin = "round"; ctx.strokeStyle = INK;
  ctx.stroke();
  ctx.restore();
  label(ctx, String(n), x + w / 2, y + 36, 28, saved ? PAPER : INK, "center", 900, w - 8);
}

/** COMMUNITY: everyone's public characters, most saved or newest first; one big with SAVE. */
export class CommunityScreen implements Screen {
  t = 0;
  private menu = new ButtonMenu();
  private detailMenu = new ButtonMenu();
  private sort: CommunitySort = "popular";
  private items: CommunityCharacter[] | null = null;
  private pages = 0;
  private loaded = 0;
  /** Bumped on every sort switch so a page that lands late for the old sort is dropped. */
  private fetchId = 0;
  private loading = false;
  private selected: CommunityCharacter | null = null;
  private detail: CharacterDetail | null = null;
  private saving = false;
  private scroll = 0;
  private problem = "";

  constructor(private nav: Nav) {}

  enter(): void {
    void refreshDummy();
    this.load(0);
  }

  private load(page: number): void {
    const id = ++this.fetchId;
    this.loading = true;
    library.community(this.sort, page).then(
      ({ characters, pages }) => {
        if (id !== this.fetchId) return;
        this.items = page ? [...(this.items ?? []), ...characters] : characters;
        this.pages = pages;
        this.loaded = page + 1;
        this.loading = false;
      },
      (error: unknown) => {
        if (id !== this.fetchId) return;
        console.error("community fetch failed", error);
        this.problem = error instanceof Error ? error.message : String(error);
        this.loading = false;
      },
    );
  }

  private resort(sort: CommunitySort): void {
    if (sort === this.sort) return;
    this.sort = sort;
    this.items = null;
    this.scroll = 0;
    this.menu.focus = 0;
    this.load(0);
  }

  private get entries(): CommunityCharacter[] {
    return this.items ?? [];
  }

  private gridButtons(): Button[] {
    const entries = this.entries;
    const rows = Math.ceil(entries.length / COLS);
    const b: Button[] = entries.map((_, i) => {
      const row = Math.floor(i / COLS) - this.scroll;
      const visible = row >= 0 && row < ROWS;
      return { id: `c${i}`, x: X0 + (i % COLS) * (ART + GAP), y: visible ? TOP + row * ROW_H : -9999, w: ART, h: ART, text: "", custom: true };
    });
    if (this.scroll > 0) b.push({ id: "up", x: VIEW_W - 110, y: TOP, w: 80, h: 80, text: "▲", size: 40 });
    if (this.scroll + ROWS < rows) b.push({ id: "down", x: VIEW_W - 110, y: TOP + ROWS * ROW_H - 150, w: 80, h: 80, text: "▼", size: 40 });
    SORTS.forEach((s, i) => b.push({ id: s, x: VIEW_W - 40 - (SORTS.length - i) * (TAB.w + TAB.gap) + TAB.gap, y: TAB.y, w: TAB.w, h: TAB.h, text: s.toUpperCase(), custom: true }));
    b.push({ id: "back", x: 40, y: VIEW_H - 130, w: 240, h: 90, text: "BACK", size: 40 });
    return b;
  }

  private detailButtons(c: CommunityCharacter): Button[] {
    const y = VIEW_H - 150, w = 320, gap = 24;
    const b: Button[] = [
      { id: "save", x: 0, y, w, h: 110, text: c.mine ? "YOURS" : c.saved ? "SAVED" : "SAVE", size: 44, disabled: c.mine || this.saving },
      { id: "back", x: 0, y, w, h: 110, text: "BACK", size: 44 },
    ];
    const x0 = (VIEW_W - (b.length * w + (b.length - 1) * gap)) / 2;
    b.forEach((btn, i) => { btn.x = x0 + i * (w + gap); });
    for (const r of this.rows(c)) b.push({ id: `m${r.i}`, x: r.x, y: r.y, w: r.w, h: r.h, text: "", custom: true });
    return b;
  }

  private rows(c: CommunityCharacter): MoveRow[] {
    return this.detail?.entry === c ? moveRows(c, this.detail.movesTop) : [];
  }

  update(dt: number, m: MenuInput): Screen | null {
    this.t += dt;
    const taps = consumeTaps();
    if (this.selected) return this.updateDetail(this.selected, m, taps);
    const buttons = this.gridButtons();
    const pressed = this.menu.update(buttons, this.menu.grid(m, COLS, this.entries.length, buttons.length), taps);
    this.follow();
    if (pressed === "back" || m.back) { sfx.menuBack(); return this.nav.title(); }
    if (pressed === "up") this.scroll--;
    if (pressed === "down") this.scroll++;
    if (pressed === "popular" || pressed === "new") this.resort(pressed);
    if (pressed?.startsWith("c")) {
      const c = this.entries[Number(pressed.slice(1))];
      this.selected = c;
      this.detail = new CharacterDetail(c, c);
      this.detailMenu.focus = 0;
    }
    // the next page once the last loaded row is on screen
    if (!this.loading && this.loaded < this.pages && this.scroll + ROWS >= Math.ceil(this.entries.length / COLS)) this.load(this.loaded);
    return null;
  }

  private updateDetail(c: CommunityCharacter, m: MenuInput, taps: ReturnType<typeof consumeTaps>): Screen | null {
    const pressed = this.detailMenu.update(this.detailButtons(c), m, taps);
    if (pressed === "save") this.toggleSave(c);
    if (pressed === "back" || m.back) { sfx.menuBack(); this.selected = null; }
    return null;
  }

  private toggleSave(c: CommunityCharacter): void {
    this.saving = true;
    (c.saved ? library.unsave(c.id) : library.save(c.id)).then(
      ({ saves, saved }) => { c.saves = saves; c.saved = saved; this.saving = false; void refreshLibrary(); },
      (error: unknown) => {
        console.error(`save ${c.id} failed`, error);
        this.problem = error instanceof Error ? error.message : String(error);
        this.saving = false;
      },
    );
  }

  /** Keeps the focused cell's row on screen. */
  private follow(): void {
    const f = this.menu.focus;
    if (f >= this.entries.length) return;
    const row = Math.floor(f / COLS);
    if (row < this.scroll) this.scroll = row;
    if (row >= this.scroll + ROWS) this.scroll = row - ROWS + 1;
  }

  draw(ctx: CanvasRenderingContext2D, dt: number): void {
    bg(ctx, this.t);
    if (this.selected) this.drawDetail(ctx, this.selected, dt);
    else this.drawGrid(ctx);
    if (this.problem) label(ctx, this.problem, VIEW_W / 2, VIEW_H - 170, 24, RED);
  }

  private drawGrid(ctx: CanvasRenderingContext2D): void {
    title(ctx, "COMMUNITY", VIEW_W / 2, 100, 72);
    const buttons = this.gridButtons();
    if (!this.items) label(ctx, "…", VIEW_W / 2, 500, 60, PENCIL);
    else if (!this.items.length) label(ctx, "nobody has shared a character yet", VIEW_W / 2, 480, 40, PENCIL);
    const focus = this.menu.focus;
    this.entries.forEach((c, i) => {
      const b = buttons[i];
      if (b.y < 0) return;
      drawCharacterCell(ctx, { ...c, status: "ready", stage: "", error: null }, b.x, b.y, ART, this.t + i * 0.2, i === focus);
      drawRibbon(ctx, b.x + ART - 70, b.y - 12, c.saves, c.saved);
    });
    for (const b of buttons) {
      if (b.id !== "popular" && b.id !== "new") continue;
      const on = b.id === this.sort, focused = buttons[focus] === b;
      card(ctx, b.x, b.y, b.w, b.h, INK, focused, on || focused ? 1 : 0.55);
      title(ctx, b.text, b.x + b.w / 2, b.y + b.h / 2 + 11, 30, INK);
      if (on) inkLine(ctx, b.x + 30, b.y + b.h - 14, b.x + b.w - 30, b.y + b.h - 17, INK, 4);
    }
    this.menu.draw(ctx, buttons);
  }

  private drawDetail(ctx: CanvasRenderingContext2D, c: CommunityCharacter, dt: number): void {
    const rows = this.rows(c);
    const focused = this.detailMenu.focused(this.detailButtons(c));
    const active = rows.find((r) => hover(r.x, r.y, r.w, r.h)) ?? rows.find((r) => focused?.id === `m${r.i}`) ?? null;
    this.detail!.draw(ctx, rows, active, dt);
    this.detailMenu.draw(ctx, this.detailButtons(c));
  }
}
