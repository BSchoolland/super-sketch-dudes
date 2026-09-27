import { VIEW_H, VIEW_W } from "../../render/camera";
import { PENCIL } from "../../render/paper";
import type { DeviceId, MenuInput } from "../../input/devices";
import { sfx } from "../../audio/audio";
import { SLOT_COLORS } from "../../render/hud";
import { allChoices, choiceDef, type FighterChoice } from "../../fighters";
import { CPU_TIERS, tierName } from "../../../../shared/cpu-skill";
import { drawFighterPortrait } from "../portrait";
import { CharacterShelf, SHELF_H } from "../shelf";
import { bg, card, hint, label, title, arrows, button, backButton, goTo, type Screen, INK, settings, saveSettings } from "../ui";

export interface BotsPick { you: FighterChoice; device: DeviceId; opponent: FighterChoice; level: number }

const SHELF_Y = 130, SLOT_Y = SHELF_Y + SHELF_H + 30, SLOT_W = 560, SLOT_H = 500, SLOT_GAP = 120;
/** Keyboard focus: your fighter, the bot's fighter, the bot's level. Left/right changes the focused one. */
const ROWS = 3;

/** VS BOTS: your characters on the shelf, you against one CPU slot; FIGHT goes on to the stage. */
export class BotsScreen implements Screen {
  t = 0;
  private shelf: CharacterShelf;
  private opponents: FighterChoice[];
  private you: FighterChoice | null;
  private opponent: number;
  private focus = 0;
  private device: DeviceId = "kb1";

  constructor(preferred: FighterChoice | null, private onFight: (pick: BotsPick) => Screen, private onBack: () => Screen) {
    const { mine, house } = allChoices();
    this.shelf = new CharacterShelf(SHELF_Y);
    this.you = mine.find((c) => c.id === preferred?.id) ?? null;
    this.opponents = [...house, ...mine];
    this.opponent = Math.max(0, house.findIndex((h) => h.id !== preferred?.id));
  }

  private stepYou(d: number): void {
    const list = this.shelf.choices;
    if (!list.length) return;
    const i = list.findIndex((c) => c.id === this.you?.id);
    this.you = list[(i + d + list.length) % list.length];
    this.shelf.show(this.you.id);
    sfx.menuMove();
  }

  private stepOpponent(d: number): void {
    this.opponent = (this.opponent + d + this.opponents.length) % this.opponents.length;
    sfx.menuMove();
  }

  private stepLevel(d: number): void {
    settings.cpuTier = Math.max(1, Math.min(CPU_TIERS.length, settings.cpuTier + d));
    saveSettings();
    sfx.menuMove();
  }

  update(dt: number, m: MenuInput): Screen | null {
    this.t += dt;
    if (m.from) this.device = m.from;
    this.you ??= this.shelf.choices[0] ?? null;
    if (m.up) { this.focus = (this.focus + ROWS - 1) % ROWS; sfx.menuMove(); }
    if (m.down) { this.focus = (this.focus + 1) % ROWS; sfx.menuMove(); }
    if (m.left || m.right) {
      const d = m.right ? 1 : -1;
      if (this.focus === 0) this.stepYou(d);
      else if (this.focus === 1) this.stepOpponent(d);
      else this.stepLevel(d);
    }
    if ((m.confirm || m.start) && this.you) return this.fight();
    if (m.back) { sfx.menuBack(); return this.onBack(); }
    return null;
  }

  private fight(): Screen {
    sfx.go();
    return this.onFight({ you: this.you!, device: this.device, opponent: this.opponents[this.opponent], level: settings.cpuTier });
  }

  draw(ctx: CanvasRenderingContext2D): void {
    bg(ctx, this.t);
    title(ctx, "VS BOTS", VIEW_W / 2, 90, 64);
    const clicked = this.shelf.draw(ctx, this.t, this.you?.id ?? null, false);
    if (clicked) { this.you = clicked; this.focus = 0; sfx.menuMove(); }
    const x0 = (VIEW_W - (2 * SLOT_W + SLOT_GAP)) / 2;
    this.drawSlot(ctx, x0, 0, this.you, "YOU", this.focus === 0);
    const bx = x0 + SLOT_W + SLOT_GAP;
    const bot = this.opponents[this.opponent];
    this.drawSlot(ctx, bx, 1, bot, "CPU", this.focus === 1);
    const d = arrows(ctx, bx + SLOT_W / 2, SLOT_Y + 200, SLOT_W / 2 - 30, 44);
    if (d) { this.focus = 1; this.stepOpponent(d); }
    const ly = SLOT_Y + SLOT_H - 50;
    label(ctx, tierName(settings.cpuTier), bx + SLOT_W / 2, ly, 30, this.focus === 2 ? INK : PENCIL, "center", 900);
    const l = arrows(ctx, bx + SLOT_W / 2, ly, 150, 34);
    if (l) { this.focus = 2; this.stepLevel(l); }
    if (button(ctx, VIEW_W / 2 - 170, VIEW_H - 170, 340, 84, "FIGHT", { key: "Enter", size: 36, disabled: !this.you })) goTo(this.fight());
    if (backButton(ctx)) goTo(this.onBack());
    hint(ctx, "click a character, or up/down + left/right · Enter: fight");
  }

  private drawSlot(ctx: CanvasRenderingContext2D, x: number, i: number, choice: FighterChoice | null, who: string, focused: boolean): void {
    card(ctx, x, SLOT_Y, SLOT_W, SLOT_H, SLOT_COLORS[i], focused);
    label(ctx, who, x + SLOT_W / 2, SLOT_Y + 44, 28, SLOT_COLORS[i], "center", 900);
    if (!choice) return;
    const def = choiceDef(choice).def;
    if (def) drawFighterPortrait(ctx, def, this.t + i * 0.4, false, { x: x + 60, y: SLOT_Y + 60, w: SLOT_W - 120, h: 280 });
    else label(ctx, "…", x + SLOT_W / 2, SLOT_Y + 200, 40, PENCIL);
    title(ctx, choice.name, x + SLOT_W / 2, SLOT_Y + 395, 46, INK, "center", SLOT_W - 40);
  }
}
