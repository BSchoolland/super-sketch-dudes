import { VIEW_H, VIEW_W } from "../render/camera";
import type { MenuInput } from "../input/devices";
import { consumeTaps } from "../input/pointer";
import { sfx } from "../audio/audio";
import { library } from "../account";
import { libraryChoices, refreshLibrary } from "../fighters";
import type { LibraryEntry } from "../../../shared/account";
import { bg, hover, label, type Screen } from "./ui";
import { ButtonMenu, type Button } from "./buttons";
import { characterStatus, drawCharacterArt, forgeStep, RED } from "./character";
import { INK, PENCIL, inkRect } from "../render/paper";
import type { DrawPad } from "./pad";
import { wrapped } from "./text";
import { CharacterDetail, moveRows } from "./charcard";
import type { Nav } from "./nav";

const POLL_S = 2;
const ART = 560;
/** A typical forge from claim to done, in seconds: the bar paces each step against it. */
const FORGE_S = 280;

/** The forge at work on one character: its stage while it runs, the fighter once it's done. */
export class ForgeScreen implements Screen {
  t = 0;
  private detail: CharacterDetail | null = null;
  private menu = new ButtonMenu();
  private sincepoll = 0;
  private polling = false;
  private pollError = "";
  /** The bar: where it's drawn up to, and when the forge moved onto the step it's on. */
  private shown = 0;
  private stage = "";
  private stageAt = 0;

  constructor(private nav: Nav, private entry: LibraryEntry, private pad: DrawPad | null) {}

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
    if (this.entry.status === "failed" && this.pad) return [
      { id: "retry", x: VIEW_W / 2 - w - 20, y, w, h: 110, text: "TRY AGAIN", size: 44 },
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
    if (pressed === "retry" && this.pad) return this.nav.create(this.pad);
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

  /**
   * How far along the forge is: each step starts where it typically does and creeps toward the next
   * step's start, slowing as it goes, so a long step never looks finished. The bar never goes back.
   */
  private drawProgress(ctx: CanvasRenderingContext2D, e: LibraryEntry, y: number, dt: number): void {
    const stage = e.stage || (e.status === "queued" ? "waiting in line" : "reading the drawing");
    if (stage !== this.stage) { this.stage = stage; this.stageAt = this.t; }
    const step = forgeStep(stage);
    const span = step.end - step.start;
    const target = step.start + span * (1 - Math.exp(-(this.t - this.stageAt) / Math.max(4, span * FORGE_S * 0.7)));
    this.shown = Math.max(this.shown, this.shown + (target - this.shown) * Math.min(1, dt * 3));
    const w = 760, h = 34, x = (VIEW_W - w) / 2;
    ctx.save();
    ctx.fillStyle = "rgba(119,114,103,0.12)"; ctx.fillRect(x, y, w, h);
    ctx.fillStyle = INK; ctx.fillRect(x, y, w * this.shown, h);
    ctx.restore();
    inkRect(ctx, x, y, w, h, INK, 2);
    const dots = ".".repeat(1 + (Math.floor(this.t * 2) % 3));
    label(ctx, `${step.label}${dots}`, VIEW_W / 2, y + h + 50, 34, e.status === "queued" ? PENCIL : INK);
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
