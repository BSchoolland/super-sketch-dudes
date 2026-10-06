import { VIEW_H, VIEW_W } from "../render/camera";
import { PENCIL } from "../render/paper";
import type { DeviceId, MenuInput } from "../input/devices";
import { consumeTaps } from "../input/pointer";
import { sfx } from "../audio/audio";
import { library } from "../account";
import { libraryChoices, myLibrary, practiceDummy, refreshDummy, refreshLibrary } from "../fighters";
import type { LibraryEntry } from "../../../shared/account";
import { bg, hover, label, title, type Screen } from "./ui";
import { ButtonMenu, type Button } from "./buttons";
import { drawCharacterArt, drawCharacterCell, RED } from "./character";
import { wrapped } from "./text";
import { CharacterDetail, COL_W, COL_X, moveRows, type MoveRow } from "./charcard";
import { DrawPad } from "./pad";
import { PAD } from "./create";
import type { Nav } from "./nav";
import { drawCharTabs, otherCharTab } from "./chartabs";

const COLS = 6, ROWS = 2, ART = 250, GAP = 50, ROW_H = 350, TOP = 160;
const X0 = (VIEW_W - (COLS * ART + (COLS - 1) * GAP)) / 2;

/** CHARACTERS, MINE tab: the library as a grid (yours, the ones you saved, the starters); one of them big, with PRACTICE and DELETE. */
export class LibraryScreen implements Screen {
  t = 0;
  private menu = new ButtonMenu();
  private detailMenu = new ButtonMenu();
  private selected: LibraryEntry | null = null;
  private detail: CharacterDetail | null = null;
  private device: DeviceId = "kb1";
  /** Seconds since the library was last fetched: while anything is forging it's refetched every few. */
  private sinceFetch = 0;
  private scroll = 0;
  private deleteArmed = -1;
  private problem = "";
  private next: Screen | null = null;

  constructor(private nav: Nav) {}

  enter(): void {
    void refreshLibrary();
    void refreshDummy();
  }

  private get entries(): LibraryEntry[] {
    return myLibrary.entries ?? [];
  }

  private gridButtons(): Button[] {
    const entries = this.entries;
    const rows = Math.ceil(entries.length / COLS);
    const b: Button[] = entries.map((e, i) => {
      const row = Math.floor(i / COLS) - this.scroll;
      const visible = row >= 0 && row < ROWS;
      return { id: `c${i}`, x: X0 + (i % COLS) * (ART + GAP), y: visible ? TOP + row * ROW_H : -9999, w: ART, h: ART, text: "", custom: true };
    });
    if (this.scroll > 0) b.push({ id: "up", x: VIEW_W - 110, y: TOP, w: 80, h: 80, text: "▲", size: 40 });
    if (this.scroll + ROWS < rows) b.push({ id: "down", x: VIEW_W - 110, y: TOP + ROWS * ROW_H - 150, w: 80, h: 80, text: "▼", size: 40 });
    b.push({ id: "new", x: VIEW_W / 2 - 250, y: VIEW_H - 150, w: 500, h: 110, text: "NEW CHARACTER", size: 44 });
    b.push({ id: "back", x: 40, y: VIEW_H - 130, w: 240, h: 90, text: "BACK", size: 40 });
    b.push(otherCharTab("mine"));
    return b;
  }

  private detailButtons(e: LibraryEntry): Button[] {
    const y = VIEW_H - 150, w = 320, gap = 24;
    const armed = this.deleteArmed >= 0 && this.t - this.deleteArmed < 3;
    const b: Button[] = [];
    if (e.status === "ready") b.push({ id: "practice", x: 0, y, w, h: 110, text: "PRACTICE", size: 44, disabled: !practiceDummy.choice });
    b.push({ id: "copy", x: 0, y, w, h: 110, text: "COPY DRAWING", size: 34 });
    if (!e.starter) b.push({ id: "delete", x: 0, y, w, h: 110, text: armed ? "SURE?" : e.saved ? "UNSAVE" : "DELETE", size: 44 });
    b.push({ id: "back", x: 0, y, w, h: 110, text: "BACK", size: 44 });
    const x0 = (VIEW_W - (b.length * w + (b.length - 1) * gap)) / 2;
    b.forEach((btn, i) => { btn.x = x0 + i * (w + gap); });
    // your own character's sharing sits under its moves, in the right column
    const rows = this.rows(e), last = rows[rows.length - 1];
    if (!e.starter && !e.saved && e.status === "ready" && last) b.push({ id: "public", x: COL_X, y: last.y + last.h + 36, w: COL_W, h: 80, text: "SHARE WITH EVERYONE", size: 32, checked: !!e.public });
    // the moves come after the row, so focus starts on it and the preview starts out standing still
    for (const r of this.rows(e)) b.push({ id: `m${r.i}`, x: r.x, y: r.y, w: r.w, h: r.h, text: "", custom: true });
    return b;
  }

  private rows(e: LibraryEntry): MoveRow[] {
    return this.detail?.entry === e ? moveRows(e, this.detail.movesTop) : [];
  }

  /** Opens the creator with this character's drawing already on the pad. */
  private copyDrawing(e: LibraryEntry): void {
    const img = new Image();
    img.onload = () => {
      const pad = new DrawPad(PAD);
      pad.startFrom(img);
      this.next = this.nav.create(pad, { name: e.name ?? "", description: "" });
    };
    img.onerror = () => { this.problem = "couldn't load that drawing"; console.error(`copy drawing failed: ${e.drawingUrl}`); };
    img.src = e.drawingUrl;
  }

  update(dt: number, m: MenuInput): Screen | null {
    this.t += dt;
    if (m.from) this.device = m.from;
    this.sinceFetch += dt;
    if (this.sinceFetch >= 3 && !myLibrary.loading && this.entries.some((e) => e.status === "queued" || e.status === "generating")) {
      this.sinceFetch = 0;
      void refreshLibrary();
    }
    if (this.next) { const n = this.next; this.next = null; this.selected = null; return n; }
    const taps = consumeTaps();
    if (this.selected) return this.updateDetail(this.selected, m, taps);
    const buttons = this.gridButtons();
    const count = this.entries.length;
    const pressed = this.menu.update(buttons, this.menu.grid(m, COLS, count, buttons.length), taps);
    this.follow();
    if (pressed === "new") return this.nav.create();
    if (pressed === "tab") { sfx.menuConfirm(); return this.nav.community(); }
    if (pressed === "back" || m.back) { sfx.menuBack(); return this.nav.title(); }
    if (pressed === "up") this.scroll--;
    if (pressed === "down") this.scroll++;
    if (pressed?.startsWith("c")) {
      const e = this.entries[Number(pressed.slice(1))];
      if (e.status === "queued" || e.status === "generating") return this.nav.forge(e, null);
      this.selected = e;
      this.detail = e.status === "ready" ? new CharacterDetail(e) : null;
      this.deleteArmed = -1;
      this.detailMenu.focus = 0;
    }
    return null;
  }

  private updateDetail(e: LibraryEntry, m: MenuInput, taps: ReturnType<typeof consumeTaps>): Screen | null {
    const pressed = this.detailMenu.update(this.detailButtons(e), m, taps);
    if (pressed === "practice") return this.nav.practice(libraryChoices([e])[0], this.device);
    if (pressed === "copy") { sfx.menuConfirm(); this.copyDrawing(e); }
    if (pressed === "public") this.flipPublic(e);
    if (pressed === "delete") {
      if (this.deleteArmed >= 0 && this.t - this.deleteArmed < 3) this.remove(e);
      else this.deleteArmed = this.t;
    }
    if (pressed === "back" || m.back) { sfx.menuBack(); this.selected = null; }
    return null;
  }

  /** Keeps the focused cell's row on screen. */
  private follow(): void {
    const f = this.menu.focus;
    if (f >= this.entries.length) return;
    const row = Math.floor(f / COLS);
    if (row < this.scroll) this.scroll = row;
    if (row >= this.scroll + ROWS) this.scroll = row - ROWS + 1;
  }

  private flipPublic(e: LibraryEntry): void {
    library.setPublic(e.id, !e.public).then(
      ({ character }) => { e.public = character.public; void refreshLibrary(); },
      (error: unknown) => {
        console.error(`public ${e.id} failed`, error);
        this.problem = error instanceof Error ? error.message : String(error);
      },
    );
  }

  private remove(e: LibraryEntry): void {
    this.deleteArmed = -1;
    (e.saved ? library.unsave(e.id) : library.remove(e.id)).then(
      () => { sfx.menuBack(); this.selected = null; void refreshLibrary(); },
      (error: unknown) => {
        console.error(`delete ${e.id} failed`, error);
        this.problem = error instanceof Error ? error.message : String(error);
      },
    );
  }

  draw(ctx: CanvasRenderingContext2D, dt: number): void {
    bg(ctx, this.t);
    if (this.selected) this.drawDetail(ctx, this.selected, dt);
    else this.drawGrid(ctx);
    const error = this.problem || myLibrary.error;
    if (error) label(ctx, error, VIEW_W / 2, VIEW_H - 170, 24, RED);
  }

  private drawGrid(ctx: CanvasRenderingContext2D): void {
    const buttons = this.gridButtons();
    drawCharTabs(ctx, "mine", buttons[this.menu.focus]?.id === "tab");
    if (!myLibrary.entries) label(ctx, "…", VIEW_W / 2, 500, 60, PENCIL);
    else if (!this.entries.length) label(ctx, "nothing here yet: draw your first fighter", VIEW_W / 2, 480, 40, PENCIL);
    const focus = this.menu.focus;
    this.entries.forEach((e, i) => {
      const b = buttons[i];
      if (b.y < 0) return;
      drawCharacterCell(ctx, e, b.x, b.y, ART, this.t + i * 0.2, i === focus);
    });
    this.menu.draw(ctx, buttons);
  }

  private drawDetail(ctx: CanvasRenderingContext2D, e: LibraryEntry, dt: number): void {
    if (this.detail) {
      const rows = this.rows(e);
      const focused = this.detailMenu.focused(this.detailButtons(e));
      const active = rows.find((r) => hover(r.x, r.y, r.w, r.h)) ?? rows.find((r) => focused?.id === `m${r.i}`) ?? null;
      this.detail.draw(ctx, rows, active, dt);
    } else {
      drawCharacterArt(ctx, e, 160, 110, 640, this.t);
      title(ctx, "FAILED", 870, 200, 96, RED, "left");
      wrapped(ctx, e.error ?? "couldn't be made", 870, 280, 860, 32, RED, 8, "left");
    }
    this.detailMenu.draw(ctx, this.detailButtons(e));
  }
}
