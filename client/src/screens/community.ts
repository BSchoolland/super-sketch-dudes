import { VIEW_H, VIEW_W } from "../render/camera";
import { inkLine, PENCIL } from "../render/paper";
import type { DeviceId, MenuInput } from "../input/devices";
import { consumeTaps } from "../input/pointer";
import { sfx } from "../audio/audio";
import { library, seeNews } from "../account";
import { allChoices, myLibrary } from "../fighters";
import { shareCharacter, sharing } from "../share";
import { SHARE_COPY } from "../../../shared/share";
import { localMatch } from "./localmatch";
import { DEFAULT_TIER } from "../../../shared/cpu-skill";
import { practiceDummy, refreshDummy, refreshLibrary, type FighterChoice } from "../fighters";
import { COMMUNITY_SORTS, type CommunityCharacter, type CommunitySort, type SharedCharacter } from "../../../shared/account";
import { backRect, bg, card, grow, hover, label, settings, small, title, type Screen, INK } from "./ui";
import { ButtonMenu, type Button } from "./buttons";
import { drawCharacterCell, preloadArt, PRELOAD_ROWS, RED } from "./character";
import { CharacterDetail, moveRows, type MoveRow } from "./charcard";
import type { Nav } from "./nav";
import { TextField } from "./textfield";
import { drawCharTabs, otherCharTab } from "./chartabs";
import { ScrollView, type Rect } from "./scroll";
import { tourSaved } from "./tour";

const COLS = 6, ART = 250, GAP = 50, ROW_H = 350, TOP = 250, BOTTOM = VIEW_H - 180;
const PAD_TOP = 30;
const X0 = (VIEW_W - (COLS * ART + (COLS - 1) * GAP)) / 2;
/** The search box, under the tabs on the left; the sorts are words on the right of the same row. */
const searchBox = (): { x: number; y: number; w: number; h: number } => (small() ? { x: X0, y: 140, w: 720, h: 100 } : { x: X0, y: 150, w: 720, h: 76 });
const SORT_W = 220;
const SORT_NAME: Record<CommunitySort, string> = { best: "BEST", new: "NEWEST" };

/**
 * CHARACTERS, COMMUNITY tab: everyone's public characters, the best or the newest first; one big with SAVE, PRACTICE and
 * SHARE. An admin's has the button that picks it for BEST. A share link (and the title-screen brawl) opens straight on one.
 */
export class CommunityScreen implements Screen {
  t = 0;
  private menu = new ButtonMenu();
  private detailMenu = new ButtonMenu();
  private sort: CommunitySort = "best";
  private picker = false;
  private device: DeviceId = "kb1";
  private items: CommunityCharacter[] | null = null;
  private pages = 0;
  private loaded = 0;
  /** Bumped on every sort switch so a page that lands late for the old sort is dropped. */
  private fetchId = 0;
  private loading = false;
  private selected: SharedCharacter | null = null;
  private detail: CharacterDetail | null = null;
  private saving = false;
  /** What SHARE last said ("link copied"), and when. */
  private shareNote: { text: string; at: number } | null = null;
  /** Where to go once a save lands: MINE, with it at the top. */
  private next: Screen | null = null;
  private scroll = new ScrollView({ x: X0, y: TOP, w: COLS * ART + (COLS - 1) * GAP, h: BOTTOM - TOP });
  /** The focus the scroll last followed: scrolling away from it leaves it be until it moves. */
  private followed = -1;
  private problem = "";
  private search: TextField | null = null;
  /** What the list was last fetched for; the box is refetched once typing stops. */
  private query = "";
  private typedAt = 0;

  /** `open`: a character to show straight away (a share link's, or clicked in the title-screen brawl); BACK from it goes to the title. */
  constructor(private nav: Nav, private open?: string) {}

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
    if (this.open) {
      library.shared(this.open).then(
        ({ character }) => { this.selected = character; this.detail = new CharacterDetail(character, character); this.detailMenu.focus = 0; },
        (error: unknown) => {
          console.error(`community character ${this.open} failed`, error);
          this.open = undefined;
          this.problem = "that character isn't shared anymore";
        },
      );
    }
  }

  private load(page: number): void {
    const id = ++this.fetchId;
    this.loading = true;
    library.community(this.sort, page, this.query).then(
      ({ characters, pages, picker }) => {
        if (id !== this.fetchId) return;
        this.picker = picker;
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
    this.scroll = new ScrollView(this.scroll.view);
    this.menu.focus = 0;
    this.load(0);
  }

  private get entries(): CommunityCharacter[] {
    return this.items ?? [];
  }

  /** Cell `i` in the scroll's content. */
  private cell(i: number): Rect {
    return { x: X0 + (i % COLS) * (ART + GAP), y: PAD_TOP + Math.floor(i / COLS) * ROW_H, w: ART, h: ART };
  }

  private gridButtons(): Button[] {
    const b: Button[] = this.entries.map((_, i) => this.scroll.button(`c${i}`, this.cell(i)));
    const SEARCH = searchBox();
    b.push({ id: "search", ...SEARCH, text: "", custom: true });
    const right = X0 + COLS * ART + (COLS - 1) * GAP;
    COMMUNITY_SORTS.forEach((s, i) => b.push({ id: s, x: right - (COMMUNITY_SORTS.length - i) * SORT_W, y: SEARCH.y, w: SORT_W, h: SEARCH.h, text: SORT_NAME[s], custom: true }));
    b.push(small() ? { id: "back", ...backRect(), text: "BACK", size: 40 } : { id: "back", x: 40, y: VIEW_H - 130, w: 240, h: 90, text: "BACK", size: 40 });
    b.push(otherCharTab("community"));
    return b;
  }

  private detailButtons(c: SharedCharacter): Button[] {
    const y = VIEW_H - 150, h = 110, gap = 24;
    const b: Button[] = [];
    if (c.saveable || c.mine) b.push({ id: "save", x: 0, y, w: 0, h, text: c.mine ? "YOURS" : c.saved ? "SAVED" : "SAVE", size: 44, disabled: c.mine || this.saving });
    b.push({ id: "practice", x: 0, y, w: 0, h, text: "PRACTICE", size: 44, disabled: !practiceDummy.choice });
    if (sharing.shown && c.mine) b.push({ id: "share", x: 0, y, w: 0, h, text: SHARE_COPY.share, size: 44 });
    b.push({ id: "back", x: 0, y, w: 0, h, text: "BACK", size: 44 });
    if (this.picker) b.push({ id: "best", x: 0, y, w: 0, h, text: c.best ? "TAKE OFF BEST" : "PUT IN BEST", size: 32, disabled: this.saving });
    const w = Math.min(320, (VIEW_W - 80 - (b.length - 1) * gap) / b.length);
    let x = (VIEW_W - (b.length * w + (b.length - 1) * gap)) / 2;
    for (const btn of b) { btn.w = w; btn.x = x; x += w + gap; }
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
    if (m.from) this.device = m.from;
    const typed = this.search?.value.trim() ?? "";
    if (typed !== this.query && this.t - this.typedAt > 0.3) { this.query = typed; this.reload(); }
    if (this.search) this.search.el.style.display = this.selected ? "none" : "";
    if (this.next) return this.next;
    const taps = consumeTaps();
    if (this.selected) return this.updateDetail(this.selected, m, taps);
    const buttons = this.gridButtons();
    const pressed = this.menu.update(buttons, this.menu.grid(m, COLS, this.entries.length, buttons.length), taps);
    this.scroll.tick(dt, PAD_TOP + Math.ceil(this.entries.length / COLS) * ROW_H);
    this.follow(m);
    if (pressed === "back" || m.back) { sfx.menuBack(); return this.nav.title(); }
    if (pressed === "tab") { sfx.menuConfirm(); return this.nav.library(); }
    const sort = COMMUNITY_SORTS.find((s) => s === pressed);
    if (sort) this.resort(sort);
    if (pressed === "search") this.search?.el.focus();
    if (pressed?.startsWith("c")) {
      const c = this.entries[Number(pressed.slice(1))];
      // the detail and the selection are the same object: the moves list (and so the demo) only shows for its own entry
      const picked: SharedCharacter = { ...c, saveable: true };
      this.selected = picked;
      this.detail = new CharacterDetail(picked, picked);
      this.detailMenu.focus = 0;
    }
    // the next page while the last loaded rows are still a screen away
    if (!this.loading && this.loaded < this.pages && this.scroll.nearEnd(this.scroll.view.h)) this.load(this.loaded);
    return null;
  }

  private updateDetail(c: SharedCharacter, m: MenuInput, taps: ReturnType<typeof consumeTaps>): Screen | null {
    const pressed = this.detailMenu.update(this.detailButtons(c), m, taps);
    if (pressed === "share") this.share(c);
    if (pressed === "save") this.toggleSave(c);
    if (pressed === "best") this.toggleBest(c);
    // leaving practice comes back to this character
    if (pressed === "practice") return this.nav.practice(c, this.device, () => this);
    if (pressed === "back" || m.back) {
      sfx.menuBack();
      this.selected = null;
      if (this.open) { this.search?.remove(); return this.nav.title(); }
    }
    return null;
  }

  private share(c: SharedCharacter): void {
    shareCharacter(c, c.mine).then(
      (text) => { this.shareNote = text ? { text, at: this.t } : null; },
      (error: unknown) => { this.shareNote = null; this.problem = error instanceof Error ? error.message : String(error); },
    );
  }

  private toggleSave(c: CommunityCharacter): void {
    this.saving = true;
    (c.saved ? library.unsave(c.id) : library.save(c.id)).then(
      async ({ saved }) => {
        c.saved = saved;
        await refreshLibrary();
        this.saving = false;
        if (saved) { sfx.menuConfirm(); tourSaved(c.id); this.next = this.nav.library(); }
      },
      (error: unknown) => {
        console.error(`save ${c.id} failed`, error);
        this.problem = error instanceof Error ? error.message : String(error);
        this.saving = false;
      },
    );
  }

  private toggleBest(c: CommunityCharacter): void {
    this.saving = true;
    library.setBest(c.id, !c.best).then(
      ({ best }) => { c.best = best; this.saving = false; sfx.menuConfirm(); },
      (error: unknown) => {
        console.error(`picking ${c.id} for BEST failed`, error);
        this.problem = error instanceof Error ? error.message : String(error);
        this.saving = false;
      },
    );
  }

  /** Brings the focused cell on screen when the focus moves or a direction is pressed. */
  private follow(m: MenuInput): void {
    const f = this.menu.focus;
    if (f === this.followed && !(m.up || m.down || m.left || m.right)) return;
    this.followed = f;
    if (f >= this.entries.length) return;
    const c = this.cell(f);
    this.scroll.reveal(c.y - PAD_TOP, c.y + ROW_H - GAP);
  }

  draw(ctx: CanvasRenderingContext2D, dt: number): void {
    bg(ctx, this.t);
    if (this.selected) this.drawDetail(ctx, this.selected, dt);
    else this.drawGrid(ctx);
    if (this.problem) label(ctx, this.problem, VIEW_W / 2, VIEW_H - 170, grow(24, 11), RED);
  }

  private drawGrid(ctx: CanvasRenderingContext2D): void {
    const buttons = this.gridButtons();
    drawCharTabs(ctx, "community", buttons[this.menu.focus]?.id === "tab");
    if (!this.items) label(ctx, "…", VIEW_W / 2, 500, 60, PENCIL);
    else if (!this.items.length) label(ctx, this.query ? `no characters called “${this.query}”` : "nobody has shared a character yet", VIEW_W / 2, 560, 40, PENCIL);
    const focus = this.menu.focus;
    this.scroll.draw(ctx, () => this.entries.forEach((c, i) => {
      const r = this.cell(i);
      if (!this.scroll.shows(r.y - PAD_TOP, ROW_H)) {
        if (this.scroll.shows(r.y - PAD_TOP - PRELOAD_ROWS * ROW_H, (PRELOAD_ROWS + 1) * ROW_H)) preloadArt({ ...c, status: "ready" });
        return;
      }
      const x = r.x, y = this.scroll.at(r.y);
      drawCharacterCell(ctx, { ...c, status: "ready", stage: "", error: null }, x, y, ART, this.t + i * 0.2, i === focus);
    }));
    for (const b of buttons) {
      const focused = buttons[focus] === b;
      if (b.id === "search") this.drawSearch(ctx, focused);
      if (!COMMUNITY_SORTS.some((s) => s === b.id)) continue;
      const on = b.id === this.sort;
      const size = grow(on ? 36 : 32, 13);
      title(ctx, b.text, b.x + b.w / 2, b.y + b.h / 2 + 12 + (size - (on ? 36 : 32)) * 0.36, size, on || focused ? INK : PENCIL);
      if (on || focused) inkLine(ctx, b.x + 40, b.y + b.h - 8, b.x + b.w - 40, b.y + b.h - 11, INK, on ? 4 : 2.4);
    }
    this.menu.draw(ctx, buttons);
  }

  private drawSearch(ctx: CanvasRenderingContext2D, focused: boolean): void {
    const SEARCH = searchBox();
    const typing = document.activeElement === this.search?.el;
    card(ctx, SEARCH.x, SEARCH.y, SEARCH.w, SEARCH.h, INK, focused || typing);
    // a pencilled magnifying glass
    const gx = SEARCH.x + 40, gy = SEARCH.y + SEARCH.h / 2 - 4;
    ctx.save(); ctx.strokeStyle = PENCIL; ctx.lineWidth = 3.5;
    ctx.beginPath(); ctx.arc(gx, gy, 13, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
    inkLine(ctx, gx + 9, gy + 9, gx + 20, gy + 20, PENCIL, 4);
    const hintSize = grow(30, 12);
    if (!this.search?.value && !typing) label(ctx, "search by name", SEARCH.x + 80, SEARCH.y + SEARCH.h / 2 + 10 + (hintSize - 30) * 0.36, hintSize, PENCIL, "left", 600);
    this.search?.place(SEARCH.x + 76, SEARCH.y + 12, SEARCH.w - 100, SEARCH.h - 24, 34);
    if (this.search) this.search.el.style.textAlign = "left";
  }

  private drawDetail(ctx: CanvasRenderingContext2D, c: SharedCharacter, dt: number): void {
    const rows = this.rows(c);
    const focused = this.detailMenu.focused(this.detailButtons(c));
    const active = rows.find((r) => hover(r.x, r.y, r.w, r.h)) ?? rows.find((r) => focused?.id === `m${r.i}`) ?? null;
    this.detail!.draw(ctx, rows, active, dt);
    this.detailMenu.draw(ctx, this.detailButtons(c));
    if (this.shareNote && this.t - this.shareNote.at < 3) label(ctx, this.shareNote.text, VIEW_W / 2, VIEW_H - 170, grow(28, 12), INK);
  }
}
