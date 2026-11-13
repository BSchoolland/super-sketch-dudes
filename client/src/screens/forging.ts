import { VIEW_H, VIEW_W } from "../render/camera";
import type { MenuInput } from "../input/devices";
import { consumeTaps } from "../input/pointer";
import { sfx } from "../audio/audio";
import { library } from "../account";
import { libraryChoices, myLibrary, refreshLibrary } from "../fighters";
import type { LibraryEntry } from "../../../shared/account";
import { bg, hover, label, type Screen } from "./ui";
import { ButtonMenu, type Button } from "./buttons";
import { characterStatus, drawCharacterArt, forgeOpens, RED } from "./character";
import { etaWords, forgeProgress } from "./forge-progress";
import { INK, PENCIL, hatch, inkLine, inkRect } from "../render/paper";
import { wrapped } from "./text";
import { CharacterDetail, moveRows } from "./charcard";
import type { Nav } from "./nav";

const POLL_S = 2;
const ART = 560;

/** The forge at work on one character: its stage while it runs, the fighter once it's done. */
export class ForgeScreen implements Screen {
  t = 0;
  private detail: CharacterDetail | null = null;
  private menu = new ButtonMenu();
  private sincepoll = 0;
  private polling = false;
  private pollError = "";
  /** Where the bar is drawn up to; null until the first frame shows where the forge already is. */
  private shown: number | null = null;

  private retrying = false;

  constructor(private nav: Nav, private entry: LibraryEntry) {}

  get done(): boolean {
    return this.entry.status === "ready" || this.entry.status === "failed";
  }

  private buttons(): Button[] {
    const y = VIEW_H - 150, w = 520;
    const library: Button = { id: "back", x: VIEW_W / 2 + 20, y, w, h: 110, text: "GO TO MY CHARACTERS", size: 36 };
    if (this.entry.status === "ready") return [
      { id: "battle", x: VIEW_W / 2 - w - 20, y, w, h: 110, text: "BATTLE WITH IT", size: 44 },
      library,
    ];
    if (this.entry.retryable) return [
      { id: "retry", x: VIEW_W / 2 - w - 20, y, w, h: 110, text: "TRY AGAIN", size: 44, disabled: this.retrying },
      library,
    ];
    return [{ ...library, x: VIEW_W / 2 - w / 2 }];
  }

  update(dt: number, m: MenuInput): Screen | null {
    this.t += dt;
    this.sincepoll += dt;
    if (!this.done && !this.polling && this.sincepoll >= POLL_S) this.poll();
    const pressed = this.menu.update(this.buttons(), m, consumeTaps());
    if (pressed === "battle") {
      const choice = libraryChoices([this.entry])[0];
      if (!choice) throw new Error(`ready character ${this.entry.id} has no bundle`);
      return this.nav.battle(choice);
    }
    if (pressed === "retry") this.retry();
    if (pressed === "back" || m.back) { sfx.menuBack(); return this.nav.library(); }
    return null;
  }

  draw(ctx: CanvasRenderingContext2D, dt: number): void {
    bg(ctx, this.t);
    const e = this.entry;
    if (e.status === "ready") {
      if (this.detail?.entry !== e) this.detail = new CharacterDetail(e);
      const rows = moveRows(e, this.detail.movesTop);
      this.detail.draw(ctx, rows, rows.find((r) => hover(r.x, r.y, r.w, r.h)) ?? null, dt);
    } else {
      const x = (VIEW_W - ART) / 2, y = 70;
      drawCharacterArt(ctx, e, x, y, ART, this.t);
      if (e.status === "failed") {
        const status = characterStatus(e, this.t);
        if (status) wrapped(ctx, status.text, VIEW_W / 2, y + ART + 60, 1200, 38, status.color, 2);
      } else this.drawProgress(ctx, e, y + ART + 50, dt);
    }
    if (this.pollError) label(ctx, this.pollError, VIEW_W / 2, VIEW_H - 190, 24, RED);
    this.menu.draw(ctx, this.buttons());
  }

  /** How far along the forge is. The bar glides to each new reading and never goes back. */
  private drawProgress(ctx: CanvasRenderingContext2D, e: LibraryEntry, y: number, dt: number): void {
    const p = forgeProgress(e);
    this.shown = this.shown === null ? p.done : Math.max(this.shown, this.shown + (p.done - this.shown) * Math.min(1, dt * 3));
    // shaded in pencil, its edge still being drawn: alive even while a long step creeps
    const w = 760, h = 34, x = (VIEW_W - w) / 2, fill = w * this.shown;
    if (fill > 0) {
      ctx.save();
      ctx.beginPath(); ctx.rect(x, y, fill, h); ctx.clip();
      ctx.globalAlpha = 0.22; ctx.fillStyle = INK; ctx.fillRect(x, y, fill, h);
      ctx.globalAlpha = 1; hatch(ctx, x, y, fill, h, INK);
      ctx.restore();
      inkLine(ctx, x + fill, y + 2, x + fill, y + h - 2, INK, 3, 7, true);
    }
    inkRect(ctx, x, y, w, h, INK, 2);
    const dots = ".".repeat(1 + (Math.floor(this.t * 2) % 3));
    const resting = e.status === "queued" ? myLibrary.forge?.resting : null;
    label(ctx, `${resting ? "Waiting in line" : p.label}${dots}`, VIEW_W / 2, y + h + 50, 34, e.status === "queued" ? PENCIL : INK);
    const below = resting ? (resting.until ? `back ${forgeOpens(resting.until)}` : resting.reason!) : p.etaS !== null ? etaWords(p.etaS) : "";
    if (below) label(ctx, below, VIEW_W / 2, y + h + 92, 26, PENCIL);
  }

  private retry(): void {
    this.retrying = true;
    library.retry(this.entry.id).then(
      ({ character, forge }) => { this.entry = character; myLibrary.forge = forge; this.shown = 0; this.pollError = ""; void refreshLibrary(); },
      (error: unknown) => {
        console.error(`retry ${this.entry.id} failed`, error);
        this.pollError = error instanceof Error ? error.message : String(error);
      },
    ).finally(() => { this.retrying = false; });
  }

  private poll(): void {
    this.polling = true;
    library.get(this.entry.id).then(
      ({ character }) => {
        this.entry = character;
        this.pollError = "";
        if (this.done) { sfx.menuConfirm(); void refreshLibrary(); }
      },
      (error: unknown) => {
        console.error(`forge poll for ${this.entry.id} failed`, error);
        this.pollError = error instanceof Error ? error.message : String(error);
      },
    ).finally(() => { this.polling = false; this.sincepoll = 0; });
  }
}
