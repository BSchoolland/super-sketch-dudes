import { VIEW_H, VIEW_W } from "../render/camera";
import { PENCIL } from "../render/paper";
import type { MenuInput } from "../input/devices";
import { consumeTaps } from "../input/pointer";
import { sfx } from "../audio/audio";
import { library } from "../account";
import { libraryChoices, myLibrary, refreshLibrary } from "../fighters";
import type { LibraryEntry } from "../../../shared/account";
import { bg, label, title, type Screen, INK } from "./ui";
import { ButtonMenu, type Button } from "./draw/buttons";
import { characterStatus, drawCharacterArt, RED } from "./draw/character";
import { wrapped } from "./draw/text";
import { drawCharacterDetail } from "./charcard";
import type { Nav } from "./nav";

const COLS = 6, ROWS = 2, ART = 250, GAP = 50, ROW_H = 350, TOP = 160;
const X0 = (VIEW_W - (COLS * ART + (COLS - 1) * GAP)) / 2;

/** MY CHARACTERS: the library as a grid; one of them big, with FIGHT and DELETE. */
export class LibraryScreen implements Screen {
  t = 0;
  private menu = new ButtonMenu();
  private detailMenu = new ButtonMenu();
  private selected: LibraryEntry | null = null;
  private scroll = 0;
  private deleteArmed = -1;
  private problem = "";

  constructor(private nav: Nav) {}

  enter(): void {
    void refreshLibrary();
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
    return b;
  }

  private detailButtons(e: LibraryEntry): Button[] {
    const y = VIEW_H - 150, w = 360;
    const armed = this.deleteArmed >= 0 && this.t - this.deleteArmed < 3;
    const b: Button[] = [];
    if (e.status === "ready") b.push({ id: "fight", x: VIEW_W / 2 - w * 1.5 - 30, y, w, h: 110, text: "FIGHT", size: 48 });
    if (!e.starter) b.push({ id: "delete", x: VIEW_W / 2 - w / 2, y, w, h: 110, text: armed ? "SURE?" : "DELETE", size: 44 });
    b.push({ id: "back", x: VIEW_W / 2 + w / 2 + 30, y, w, h: 110, text: "BACK", size: 44 });
    return b;
  }

  update(dt: number, m: MenuInput): Screen | null {
    this.t += dt;
    const taps = consumeTaps();
    if (this.selected) return this.updateDetail(this.selected, m, taps);
    const buttons = this.gridButtons();
    const count = this.entries.length;
    const pressed = this.menu.update(buttons, this.menu.grid(m, COLS, count, buttons.length), taps);
    this.follow();
    if (pressed === "new") return this.nav.create();
    if (pressed === "back" || m.back) { sfx.menuBack(); return this.nav.title(); }
    if (pressed === "up") this.scroll--;
    if (pressed === "down") this.scroll++;
    if (pressed?.startsWith("c")) {
      const e = this.entries[Number(pressed.slice(1))];
      if (e.status === "queued" || e.status === "generating") return this.nav.forge(e, null);
      this.selected = e;
      this.deleteArmed = -1;
      this.detailMenu.focus = 0;
    }
    return null;
  }

  private updateDetail(e: LibraryEntry, m: MenuInput, taps: ReturnType<typeof consumeTaps>): Screen | null {
    const pressed = this.detailMenu.update(this.detailButtons(e), m, taps);
    if (pressed === "fight") return this.nav.battle("any", libraryChoices([e])[0]);
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

  private remove(e: LibraryEntry): void {
    this.deleteArmed = -1;
    library.remove(e.id).then(
      () => { sfx.menuBack(); this.selected = null; void refreshLibrary(); },
      (error: unknown) => {
        console.error(`delete ${e.id} failed`, error);
        this.problem = error instanceof Error ? error.message : String(error);
      },
    );
  }

  draw(ctx: CanvasRenderingContext2D): void {
    bg(ctx, this.t);
    if (this.selected) this.drawDetail(ctx, this.selected);
    else this.drawGrid(ctx);
    const error = this.problem || myLibrary.error;
    if (error) label(ctx, error, VIEW_W / 2, VIEW_H - 170, 24, RED);
  }

  private drawGrid(ctx: CanvasRenderingContext2D): void {
    title(ctx, "MY CHARACTERS", VIEW_W / 2, 100, 72);
    const buttons = this.gridButtons();
    if (!myLibrary.entries) label(ctx, "…", VIEW_W / 2, 500, 60, PENCIL);
    else if (!this.entries.length) label(ctx, "nothing here yet: draw your first fighter", VIEW_W / 2, 480, 40, PENCIL);
    const focus = this.menu.focus;
    this.entries.forEach((e, i) => {
      const b = buttons[i];
      if (b.y < 0) return;
      drawCharacterArt(ctx, e, b.x, b.y, ART, this.t + i * 0.2);
      if (i === focus) {
        ctx.save(); ctx.strokeStyle = INK; ctx.lineWidth = 6;
        ctx.strokeRect(b.x - 8, b.y - 8, ART + 16, ART + 16);
        ctx.restore();
      }
      const cx = b.x + ART / 2, ty = b.y + ART + 40;
      const status = characterStatus(e, this.t);
      if (!status) title(ctx, e.name ?? "?", cx, ty, 34, INK, "center", ART + 20);
      else wrapped(ctx, e.status === "failed" ? "failed" : status.text, cx, ty, ART + 20, 24, status.color, 2);
    });
    this.menu.draw(ctx, buttons);
  }

  private drawDetail(ctx: CanvasRenderingContext2D, e: LibraryEntry): void {
    if (e.status === "ready") drawCharacterDetail(ctx, e, 160, 110, 640, 820, this.t);
    else {
      drawCharacterArt(ctx, e, 160, 110, 640, this.t);
      title(ctx, "FAILED", 870, 200, 96, RED, "left");
      wrapped(ctx, e.error ?? "couldn't be made", 870, 280, 860, 32, RED, 8, "left");
    }
    this.detailMenu.draw(ctx, this.detailButtons(e));
  }
}
