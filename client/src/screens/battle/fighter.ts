import { VIEW_H, VIEW_W } from "../../render/camera";
import { PENCIL } from "../../render/paper";
import type { MenuInput } from "../../input/devices";
import { consumeTaps } from "../../input/pointer";
import { sfx } from "../../audio/audio";
import { allChoices, choiceDef, myLibrary, refreshLibrary, type FighterChoice } from "../../fighters";
import { bg, label, title, type Screen } from "../ui";
import { ButtonMenu, type Button } from "../buttons";
import { FighterGrid } from "./grid";

/** BATTLE, step 1: which of yours you fight with (or one of the house). */
export class PickFighterScreen implements Screen {
  t = 0;
  private menu = new ButtonMenu();
  private grid: FighterGrid | null = null;

  constructor(private onPick: (fighter: FighterChoice, from: MenuInput["from"]) => Screen, private onBack: () => Screen) {}

  enter(): void {
    if (!myLibrary.entries) void refreshLibrary();
  }

  private buttons(): Button[] {
    return [...(this.grid?.buttons() ?? []), { id: "back", x: 40, y: VIEW_H - 130, w: 240, h: 90, text: "BACK", size: 40 }];
  }

  update(dt: number, m: MenuInput): Screen | null {
    this.t += dt;
    if (!this.grid && (myLibrary.entries || (myLibrary.error && !myLibrary.loading))) {
      const { mine, house } = allChoices();
      this.grid = new FighterGrid([{ label: "YOURS", choices: mine }, { label: "HOUSE", choices: house }], 190);
    }
    const input = this.grid ? this.grid.nav(this.menu, m) : m;
    const id = this.menu.update(this.buttons(), input, consumeTaps());
    const picked = this.grid?.pressed(this.menu, id) ?? null;
    if (picked) return this.onPick(picked, m.from);
    if (id === "back" || m.back) { sfx.menuBack(); return this.onBack(); }
    return null;
  }

  draw(ctx: CanvasRenderingContext2D): void {
    bg(ctx, this.t);
    title(ctx, "PICK YOUR FIGHTER", VIEW_W / 2, 100, 72);
    const buttons = this.buttons();
    if (this.grid) {
      this.grid.draw(ctx, buttons, this.menu, this.t);
      const f = this.grid.focused(this.menu);
      const def = f ? choiceDef(f).def : null;
      if (def) label(ctx, def.tagline, VIEW_W / 2, 850, 30, PENCIL, "center", 700);
    } else label(ctx, myLibrary.error || "…", VIEW_W / 2, 500, 40, PENCIL);
    this.menu.draw(ctx, buttons);
  }
}
