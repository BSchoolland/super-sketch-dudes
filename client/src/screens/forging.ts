import { VIEW_H, VIEW_W } from "../render/camera";
import type { MenuInput } from "../input/devices";
import { consumeTaps } from "../input/pointer";
import { sfx } from "../audio/audio";
import { library } from "../account";
import { libraryChoices, refreshLibrary } from "../fighters";
import type { LibraryEntry } from "../../../shared/account";
import { bg, label, type Screen } from "./ui";
import { ButtonMenu, type Button } from "./draw/buttons";
import { characterStatus, drawCharacterArt, RED } from "./draw/character";
import type { DrawPad } from "./draw/pad";
import { wrapped } from "./draw/text";
import { drawCharacterDetail } from "./charcard";
import type { Nav } from "./nav";

const POLL_S = 2;
const ART = 640;

/** The forge at work on one character: its stage while it runs, the fighter once it's done. */
export class ForgeScreen implements Screen {
  t = 0;
  private menu = new ButtonMenu();
  private sincepoll = 0;
  private polling = false;
  private pollError = "";

  constructor(private nav: Nav, private entry: LibraryEntry, private pad: DrawPad | null) {}

  get done(): boolean {
    return this.entry.status === "ready" || this.entry.status === "failed";
  }

  private buttons(): Button[] {
    const y = VIEW_H - 150, w = 440;
    if (this.entry.status === "ready") return [
      { id: "battle", x: VIEW_W / 2 - w - 20, y, w, h: 110, text: "BATTLE WITH IT", size: 44 },
      { id: "back", x: VIEW_W / 2 + 20, y, w, h: 110, text: "BACK", size: 44 },
    ];
    if (this.entry.status === "failed" && this.pad) return [
      { id: "retry", x: VIEW_W / 2 - w - 20, y, w, h: 110, text: "TRY AGAIN", size: 44 },
      { id: "back", x: VIEW_W / 2 + 20, y, w, h: 110, text: "BACK", size: 44 },
    ];
    return [{ id: "back", x: VIEW_W / 2 - w / 2, y, w, h: 110, text: "BACK", size: 44 }];
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

  draw(ctx: CanvasRenderingContext2D): void {
    bg(ctx, this.t);
    const e = this.entry;
    if (e.status === "ready") drawCharacterDetail(ctx, e, 160, 110, ART, 820, this.t);
    else {
      const x = (VIEW_W - ART) / 2, y = 70;
      drawCharacterArt(ctx, e, x, y, ART, this.t);
      const status = characterStatus(e, this.t);
      if (status) wrapped(ctx, status.text, VIEW_W / 2, y + ART + 60, 1200, 38, status.color, 2);
    }
    if (this.pollError) label(ctx, this.pollError, VIEW_W / 2, VIEW_H - 190, 24, RED);
    this.menu.draw(ctx, this.buttons());
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
