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

export interface Bot { fighter: FighterChoice; level: number }
export interface BotsPick { you: FighterChoice; device: DeviceId; bots: Bot[] }

const SHELF_Y = 130, SLOT_Y = SHELF_Y + SHELF_H + 30, SLOT_W = 380, SLOT_H = 500, SLOT_GAP = 36, MAX_BOTS = 3;

/** A keyboard stop: up/down walks them, left/right changes the focused one, Enter on "add" adds a bot. */
type Row = { kind: "you" } | { kind: "fighter" | "level"; bot: number } | { kind: "add" };

/** VS BOTS: your characters on the shelf, you against one to three CPU slots; FIGHT goes on to the stage. */
export class BotsScreen implements Screen {
  t = 0;
  private shelf: CharacterShelf;
  private opponents: FighterChoice[];
  private you: FighterChoice | null;
  private bots: { fighter: number; level: number }[];
  private focus = 0;
  private device: DeviceId = "kb1";

  constructor(preferred: FighterChoice | null, private onFight: (pick: BotsPick) => Screen, private onBack: () => Screen) {
    const { mine, house } = allChoices();
    this.shelf = new CharacterShelf(SHELF_Y);
    this.you = mine.find((c) => c.id === preferred?.id) ?? null;
    this.opponents = [...house, ...mine];
    this.bots = [{ fighter: Math.max(0, house.findIndex((h) => h.id !== preferred?.id)), level: settings.cpuTier }];
  }

  private get rows(): Row[] {
    const rows: Row[] = [{ kind: "you" }];
    this.bots.forEach((_, bot) => rows.push({ kind: "fighter", bot }, { kind: "level", bot }));
    if (this.bots.length < MAX_BOTS) rows.push({ kind: "add" });
    return rows;
  }

  private stepYou(d: number): void {
    const list = this.shelf.choices;
    if (!list.length) return;
    const i = list.findIndex((c) => c.id === this.you?.id);
    this.you = list[(i + d + list.length) % list.length];
    this.shelf.show(this.you.id);
    sfx.menuMove();
  }

  private stepFighter(bot: number, d: number): void {
    const b = this.bots[bot];
    b.fighter = (b.fighter + d + this.opponents.length) % this.opponents.length;
    sfx.menuMove();
  }

  /** The level sticks as the default for the next bot and the next visit. */
  private stepLevel(bot: number, d: number): void {
    const b = this.bots[bot];
    b.level = Math.max(1, Math.min(CPU_TIERS.length, b.level + d));
    settings.cpuTier = b.level;
    saveSettings();
    sfx.menuMove();
  }

  /** A new bot plays someone nobody has yet, when the house has anyone left. */
  private addBot(): void {
    const taken = new Set([this.you?.id, ...this.bots.map((b) => this.opponents[b.fighter].id)]);
    const fresh = this.opponents.findIndex((c) => !taken.has(c.id));
    this.bots.push({ fighter: Math.max(0, fresh), level: settings.cpuTier });
    sfx.menuConfirm();
  }

  private removeBot(bot: number): void {
    this.bots.splice(bot, 1);
    this.focus = Math.min(this.focus, this.rows.length - 1);
    sfx.menuBack();
  }

  update(dt: number, m: MenuInput): Screen | null {
    this.t += dt;
    if (m.from) this.device = m.from;
    this.you ??= this.shelf.choices[0] ?? null;
    const rows = this.rows;
    if (m.up) { this.focus = (this.focus + rows.length - 1) % rows.length; sfx.menuMove(); }
    if (m.down) { this.focus = (this.focus + 1) % rows.length; sfx.menuMove(); }
    const row = rows[this.focus];
    if (m.left || m.right) {
      const d = m.right ? 1 : -1;
      if (row.kind === "you") this.stepYou(d);
      else if (row.kind === "fighter") this.stepFighter(row.bot, d);
      else if (row.kind === "level") this.stepLevel(row.bot, d);
    }
    if (m.confirm && row.kind === "add") this.addBot();
    else if ((m.confirm || m.start) && this.you) return this.fight();
    if (m.back) { sfx.menuBack(); return this.onBack(); }
    return null;
  }

  private fight(): Screen {
    sfx.go();
    return this.onFight({ you: this.you!, device: this.device, bots: this.bots.map((b) => ({ fighter: this.opponents[b.fighter], level: b.level })) });
  }

  private focusOn(match: (row: Row) => boolean): void {
    this.focus = Math.max(0, this.rows.findIndex(match));
  }

  draw(ctx: CanvasRenderingContext2D): void {
    bg(ctx, this.t);
    title(ctx, "VS BOTS", VIEW_W / 2, 90, 64);
    const clicked = this.shelf.draw(ctx, this.t, this.you?.id ?? null, false);
    if (clicked) { this.you = clicked; this.focus = 0; sfx.menuMove(); }
    const focused = this.rows[this.focus];
    const x0 = (VIEW_W - (4 * SLOT_W + 3 * SLOT_GAP)) / 2;
    this.drawSlot(ctx, x0, 0, this.you, "YOU", focused.kind === "you");
    for (let i = 0; i < MAX_BOTS; i++) {
      const x = x0 + (i + 1) * (SLOT_W + SLOT_GAP);
      const bot = this.bots[i];
      if (!bot) {
        if (i === this.bots.length && this.drawAdd(ctx, x, focused.kind === "add")) this.addBot();
        continue;
      }
      const here = (focused.kind === "fighter" || focused.kind === "level") && focused.bot === i;
      this.drawSlot(ctx, x, i + 1, this.opponents[bot.fighter], `CPU ${i + 1}`, here && focused.kind === "fighter");
      const d = arrows(ctx, x + SLOT_W / 2, SLOT_Y + 180, SLOT_W / 2 - 34, 40);
      if (d) { this.focusOn((r) => r.kind === "fighter" && r.bot === i); this.stepFighter(i, d); }
      const ly = SLOT_Y + 400;
      label(ctx, tierName(bot.level), x + SLOT_W / 2, ly, 26, here && focused.kind === "level" ? INK : PENCIL, "center", 900);
      const l = arrows(ctx, x + SLOT_W / 2, ly, 120, 30);
      if (l) { this.focusOn((r) => r.kind === "level" && r.bot === i); this.stepLevel(i, l); }
      if (this.bots.length > 1 && button(ctx, x + SLOT_W / 2 - 80, SLOT_Y + SLOT_H - 70, 160, 50, "REMOVE", { size: 20 })) this.removeBot(i);
    }
    if (button(ctx, VIEW_W / 2 - 170, VIEW_H - 170, 340, 84, "FIGHT", { key: "Enter", size: 36, disabled: !this.you })) goTo(this.fight());
    if (backButton(ctx)) goTo(this.onBack());
    hint(ctx, "click a character, or up/down + left/right · Enter: fight");
  }

  private drawSlot(ctx: CanvasRenderingContext2D, x: number, i: number, choice: FighterChoice | null, who: string, focused: boolean): void {
    card(ctx, x, SLOT_Y, SLOT_W, SLOT_H, SLOT_COLORS[i], focused);
    label(ctx, who, x + SLOT_W / 2, SLOT_Y + 44, 26, SLOT_COLORS[i], "center", 900);
    if (!choice) return;
    const def = choiceDef(choice).def;
    if (def) drawFighterPortrait(ctx, def, this.t + i * 0.4, false, { x: x + 40, y: SLOT_Y + 64, w: SLOT_W - 80, h: 240 });
    else label(ctx, "…", x + SLOT_W / 2, SLOT_Y + 180, 40, PENCIL);
    title(ctx, choice.name, x + SLOT_W / 2, SLOT_Y + 352, 38, INK, "center", SLOT_W - 32);
  }

  /** The empty slot after the last bot: the whole card is the ADD BOT button. */
  private drawAdd(ctx: CanvasRenderingContext2D, x: number, focused: boolean): boolean {
    return button(ctx, x, SLOT_Y, SLOT_W, SLOT_H, "+ ADD BOT", { size: 34, focused });
  }
}
