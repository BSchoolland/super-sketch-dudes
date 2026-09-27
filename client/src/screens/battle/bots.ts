import { VIEW_W } from "../../render/camera";
import { PENCIL } from "../../render/paper";
import type { DeviceId, MenuInput } from "../../input/devices";
import { sfx } from "../../audio/audio";
import { allChoices, choiceDef, type FighterChoice } from "../../fighters";
import { CPU_TIERS, tierName } from "../../../../shared/cpu-skill";
import { CharacterShelf } from "../shelf";
import { ACTION_Y, SETUP, drawEmptySlot, drawSlotCard, slotX, type SlotFighter } from "./slots";
import { bg, hint, label, title, arrows, button, backButton, goTo, type Screen, INK, settings, saveSettings } from "../ui";

export interface Bot { fighter: FighterChoice; level: number }
export interface BotsPick { you: FighterChoice; device: DeviceId; bots: Bot[] }

const MAX_BOTS = 3;
const slotFighter = (c: FighterChoice | null): SlotFighter | null => c && { def: choiceDef(c).def, name: c.name };

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
    this.shelf = new CharacterShelf(SETUP.shelfY);
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
    title(ctx, "VS BOTS", VIEW_W / 2, SETUP.titleY, 52);
    const clicked = this.shelf.draw(ctx, this.t, this.you?.id ?? null, false);
    if (clicked) { this.you = clicked; this.focus = 0; sfx.menuMove(); }
    const focused = this.rows[this.focus];
    drawSlotCard(ctx, 0, "YOU", slotFighter(this.you), { focused: focused.kind === "you" });
    const { slotY, slotW, slotH } = SETUP;
    for (let i = 0; i < MAX_BOTS; i++) {
      const bot = this.bots[i];
      if (!bot) {
        if (i > this.bots.length) drawEmptySlot(ctx, i + 1, "");
        else if (button(ctx, slotX(i + 1), slotY, slotW, slotH, "+ ADD BOT", { size: 34, focused: focused.kind === "add" })) this.addBot();
        continue;
      }
      const here = (focused.kind === "fighter" || focused.kind === "level") && focused.bot === i;
      const x = drawSlotCard(ctx, i + 1, `CPU ${i + 1}`, slotFighter(this.opponents[bot.fighter]), { focused: here && focused.kind === "fighter" });
      const d = arrows(ctx, x + slotW / 2, slotY + 180, slotW / 2 - 34, 40);
      if (d) { this.focusOn((r) => r.kind === "fighter" && r.bot === i); this.stepFighter(i, d); }
      const ly = slotY + 392;
      label(ctx, tierName(bot.level), x + slotW / 2, ly, 26, here && focused.kind === "level" ? INK : PENCIL, "center", 900);
      const l = arrows(ctx, x + slotW / 2, ly, 120, 30);
      if (l) { this.focusOn((r) => r.kind === "level" && r.bot === i); this.stepLevel(i, l); }
      if (this.bots.length > 1 && button(ctx, x + slotW / 2 - 80, slotY + slotH - 58, 160, 44, "REMOVE", { size: 20 })) this.removeBot(i);
    }
    if (button(ctx, VIEW_W / 2 - 170, ACTION_Y, 340, 84, "FIGHT", { key: "Enter", size: 36, disabled: !this.you })) goTo(this.fight());
    if (backButton(ctx)) goTo(this.onBack());
    hint(ctx, "click a character, or up/down + left/right · Enter: fight");
  }
}
