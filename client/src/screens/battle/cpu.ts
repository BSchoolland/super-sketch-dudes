import { VIEW_H, VIEW_W } from "../../render/camera";
import type { MenuInput } from "../../input/devices";
import { consumeTaps } from "../../input/pointer";
import { sfx } from "../../audio/audio";
import { allChoices, type FighterChoice } from "../../fighters";
import { bg, title, type Screen, settings, saveSettings, INK } from "../ui";
import { ButtonMenu, type Button } from "../draw/buttons";
import { FighterGrid } from "./grid";
import { CPU_TIERS, tierName } from "../../../../shared/cpu-skill";

/** VS CPU: who the CPU plays and how hard; stage and stocks come next. */
export class CpuSetupScreen implements Screen {
  t = 0;
  private menu = new ButtonMenu();
  private grid: FighterGrid;
  private opponent: FighterChoice;

  constructor(private you: FighterChoice, private onNext: (opponent: FighterChoice, level: number) => Screen, private onBack: () => Screen) {
    const { mine, house } = allChoices();
    this.grid = new FighterGrid([{ label: "HOUSE", choices: house }, { label: "YOURS", choices: mine }], 170);
    this.opponent = house.find((h) => h.id !== you.id) ?? house[0];
  }

  private buttons(): Button[] {
    const y = 170 + this.grid.height + 20;
    return [
      ...this.grid.buttons(),
      { id: "level", x: VIEW_W / 2 - 520, y, w: 480, h: 110, text: tierName(settings.cpuTier), size: 44, step: (d) => { settings.cpuTier = Math.max(1, Math.min(CPU_TIERS.length, settings.cpuTier + d)); saveSettings(); } },
      { id: "next", x: VIEW_W / 2 + 40, y, w: 480, h: 110, text: "NEXT", size: 52 },
      { id: "back", x: 40, y: VIEW_H - 130, w: 240, h: 90, text: "BACK", size: 40 },
    ];
  }

  update(dt: number, m: MenuInput): Screen | null {
    this.t += dt;
    const buttons = this.buttons();
    const id = this.menu.update(buttons, this.grid.nav(this.menu, m), consumeTaps());
    const picked = this.grid.pressed(this.menu, id);
    if (picked) {
      this.opponent = picked;
      this.menu.focus = buttons.findIndex((b) => b.id === "next");
    }
    if (id === "next") return this.onNext(this.opponent, settings.cpuTier);
    if (id === "back" || m.back) { sfx.menuBack(); return this.onBack(); }
    return null;
  }

  draw(ctx: CanvasRenderingContext2D): void {
    bg(ctx, this.t);
    title(ctx, `${this.you.name} VS ${this.opponent.name}`, VIEW_W / 2, 100, 64, INK, "center", VIEW_W - 160);
    const buttons = this.buttons();
    const tags = new Map([[this.opponent.id, "CPU"]]);
    if (this.you.id !== this.opponent.id) tags.set(this.you.id, "YOU");
    this.grid.draw(ctx, buttons, this.menu, this.t, tags);
    this.menu.draw(ctx, buttons);
  }
}
