import { VIEW_H, VIEW_W } from "../render/camera";
import { inkLine, inkPath, PAPER, PENCIL } from "../render/paper";
import type { MenuInput } from "../input/devices";
import { consumeTaps } from "../input/pointer";
import { sfx } from "../audio/audio";
import { library, seeNews } from "../account";
import { refreshDummy, refreshLibrary } from "../fighters";
import type { CommunityCharacter, CommunitySort } from "../../../shared/account";
import { bg, card, hover, label, title, type Screen, INK } from "./ui";
import { ButtonMenu, type Button } from "./buttons";
import { drawCharacterCell, RED } from "./character";
import { CharacterDetail, moveRows, type MoveRow } from "./charcard";
import type { Nav } from "./nav";
import { TextField } from "./textfield";
import { drawCharTabs, otherCharTab } from "./chartabs";

const COLS = 6, ROWS = 2, ART = 250, GAP = 50, ROW_H = 350, TOP = 270;
const X0 = (VIEW_W - (COLS * ART + (COLS - 1) * GAP)) / 2;
/** The search box, under the tabs on the left; the sorts are words on the right of the same row. */
const SEARCH = { x: X0, y: 150, w: 720, h: 76 };
const SORT_W = 190, SORT_Y = SEARCH.y;
const SORTS: CommunitySort[] = ["popular", "new"];
const SORT_NAME: Record<CommunitySort, string> = { popular: "POPULAR", new: "NEWEST" };

/** A comic-book burst on a cell's top-right corner with how many online matches the character has been in. */
function drawPlays(ctx: CanvasRenderingContext2D, x: number, y: number, n: number): void {
  const spikes = 9, outer = 40, inner = 29;
  const pts: [number, number][] = [];
  for (let i = 0; i < spikes * 2; i++) {
    const a = (i / (spikes * 2)) * Math.PI * 2 - Math.PI / 2, r = i % 2 ? inner : outer;
    pts.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(0.12);
  inkPath(ctx, pts, true, Math.round(x));
  ctx.fillStyle = PAPER;
  ctx.fill();
  ctx.lineWidth = 2.4; ctx.lineJoin = "round"; ctx.strokeStyle = INK;
  ctx.stroke();
  ctx.restore();
  label(ctx, String(n), x, y + 10, 28, INK, "center", 900, inner * 2 - 6);
}

/** CHARACTERS, COMMUNITY tab: everyone's public characters, most played online or newest first; one big with SAVE. */
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
  /** Where to go once a save lands: MINE, with it at the top. */
  private next: Screen | null = null;
  private scroll = 0;
  private problem = "";
  private search: TextField | null = null;
  /** What the list was last fetched for; the box is refetched once typing stops. */
  private query = "";
  private typedAt = 0;

  constructor(private nav: Nav) {}

  enter(): void {
    this.search = new TextField({
      maxLength: 40, quiet: true,
      onSubmit: () => this.search?.el.blur(),
      onCancel: () => { this.search!.value = ""; this.search!.el.blur(); },
    });
    this.search.el.addEventListener("input", () => { this.typedAt = this.t; });
    seeNews("community");
    void refreshDummy();
    this.load(0);
  }

  private load(page: number): void {
    const id = ++this.fetchId;
    this.loading = true;
    library.community(this.sort, page, this.query).then(
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
    this.reload();
  }

  private reload(): void {
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
    b.push({ id: "search", ...SEARCH, text: "", custom: true });
    const right = X0 + COLS * ART + (COLS - 1) * GAP;
    SORTS.forEach((s, i) => b.push({ id: s, x: right - (SORTS.length - i) * SORT_W, y: SORT_Y, w: SORT_W, h: SEARCH.h, text: SORT_NAME[s], custom: true }));
    b.push({ id: "back", x: 40, y: VIEW_H - 130, w: 240, h: 90, text: "BACK", size: 40 });
    b.push(otherCharTab("community"));
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
    const next = this.step(dt, m);
    if (next) { this.search?.remove(); this.search = null; }
    return next;
  }

  abandon(): void {
    this.search?.remove();
  }

  private step(dt: number, m: MenuInput): Screen | null {
    this.t += dt;
    const typed = this.search?.value.trim() ?? "";
    if (typed !== this.query && this.t - this.typedAt > 0.3) { this.query = typed; this.reload(); }
    if (this.search) this.search.el.style.display = this.selected ? "none" : "";
    if (this.next) return this.next;
    const taps = consumeTaps();
    if (this.selected) return this.updateDetail(this.selected, m, taps);
    const buttons = this.gridButtons();
    const pressed = this.menu.update(buttons, this.menu.grid(m, COLS, this.entries.length, buttons.length), taps);
    this.follow();
    if (pressed === "back" || m.back) { sfx.menuBack(); return this.nav.title(); }
    if (pressed === "tab") { sfx.menuConfirm(); return this.nav.library(); }
    if (pressed === "up") this.scroll--;
    if (pressed === "down") this.scroll++;
    if (pressed === "popular" || pressed === "new") this.resort(pressed);
    if (pressed === "search") this.search?.el.focus();
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
      async ({ saved }) => {
        c.saved = saved;
        await refreshLibrary();
        this.saving = false;
        if (saved) { sfx.menuConfirm(); this.next = this.nav.library(); }
      },
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
    const buttons = this.gridButtons();
    drawCharTabs(ctx, "community", buttons[this.menu.focus]?.id === "tab");
    if (!this.items) label(ctx, "…", VIEW_W / 2, 500, 60, PENCIL);
    else if (!this.items.length) label(ctx, this.query ? `no characters called “${this.query}”` : "nobody has shared a character yet", VIEW_W / 2, 560, 40, PENCIL);
    const focus = this.menu.focus;
    this.entries.forEach((c, i) => {
      const b = buttons[i];
      if (b.y < 0) return;
      drawCharacterCell(ctx, { ...c, status: "ready", stage: "", error: null }, b.x, b.y, ART, this.t + i * 0.2, i === focus);
      if (c.plays) drawPlays(ctx, b.x + ART - 30, b.y + 18, c.plays);
    });
    for (const b of buttons) {
      const focused = buttons[focus] === b;
      if (b.id === "search") this.drawSearch(ctx, focused);
      if (b.id !== "popular" && b.id !== "new") continue;
      const on = b.id === this.sort;
      title(ctx, b.text, b.x + b.w / 2, b.y + b.h / 2 + 12, on ? 36 : 32, on || focused ? INK : PENCIL);
      if (on || focused) inkLine(ctx, b.x + 40, b.y + b.h - 8, b.x + b.w - 40, b.y + b.h - 11, INK, on ? 4 : 2.4);
    }
    this.menu.draw(ctx, buttons);
  }

  private drawSearch(ctx: CanvasRenderingContext2D, focused: boolean): void {
    const typing = document.activeElement === this.search?.el;
    card(ctx, SEARCH.x, SEARCH.y, SEARCH.w, SEARCH.h, INK, focused || typing);
    // a pencilled magnifying glass
    const gx = SEARCH.x + 40, gy = SEARCH.y + SEARCH.h / 2 - 4;
    ctx.save(); ctx.strokeStyle = PENCIL; ctx.lineWidth = 3.5;
    ctx.beginPath(); ctx.arc(gx, gy, 13, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
    inkLine(ctx, gx + 9, gy + 9, gx + 20, gy + 20, PENCIL, 4);
    if (!this.search?.value && !typing) label(ctx, "search by name", SEARCH.x + 80, SEARCH.y + SEARCH.h / 2 + 10, 30, PENCIL, "left", 600);
    this.search?.place(SEARCH.x + 76, SEARCH.y + 12, SEARCH.w - 100, SEARCH.h - 24, 34);
    if (this.search) this.search.el.style.textAlign = "left";
  }

  private drawDetail(ctx: CanvasRenderingContext2D, c: CommunityCharacter, dt: number): void {
    const rows = this.rows(c);
    const focused = this.detailMenu.focused(this.detailButtons(c));
    const active = rows.find((r) => hover(r.x, r.y, r.w, r.h)) ?? rows.find((r) => focused?.id === `m${r.i}`) ?? null;
    this.detail!.draw(ctx, rows, active, dt);
    this.detailMenu.draw(ctx, this.detailButtons(c));
  }
}
