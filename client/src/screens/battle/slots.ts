import { VIEW_W } from "../../render/camera";
import { PENCIL } from "../../render/paper";
import { SLOT_COLORS } from "../../render/hud";
import type { FighterDef } from "../../../../shared/types";
import { drawFighterPortrait } from "../portrait";
import { SHELF_H } from "../shelf";
import { card, label, title, INK } from "../ui";

/**
 * The battle setups (a lobby, BOTS & FRIENDS): title, your shelf, four slot cards (six, narrower, locally), one row of actions.
 * Inside a card, from its top: the fighter's portrait, its name, and a line under it (a bot's level, a friend's device).
 */
export const SETUP = { titleY: 80, shelfY: 120, slotY: 120 + SHELF_H + 20, slotW: 380, slotH: 350, gap: 36, portraitY: 56, portraitH: 160, nameY: 244, lineY: 284 } as const;
/** The middle of a card's portrait, where its fighter arrows sit. */
export const PORTRAIT_MID = SETUP.portraitY + SETUP.portraitH / 2;
export const ACTION_Y = SETUP.slotY + SETUP.slotH + 24;
/** Card width when `count` cards share the row: four at full width, more squeezed in. */
export const slotWidth = (count = 4): number => (count <= 4 ? SETUP.slotW : (VIEW_W - 160 - (count - 1) * 20) / count);
const slotGap = (count = 4): number => (count <= 4 ? SETUP.gap : 20);
export const slotX = (i: number, count = 4): number => (VIEW_W - (count * slotWidth(count) + (count - 1) * slotGap(count))) / 2 + i * (slotWidth(count) + slotGap(count));

/** Who's in a slot as the card shows them; `def` is null while the fighter loads (`pending` says why). */
export interface SlotFighter { def: FighterDef | null; name: string; pending?: string }

/**
 * One slot card: who holds it in the slot's colour (or `color`: a team's, washed over the card with `team`), the
 * fighter (alive, see portrait.ts), its name. `count`: how many cards share the row. Returns the card's x.
 */
export function drawSlotCard(ctx: CanvasRenderingContext2D, i: number, who: string, fighter: SlotFighter | null, opts: { focused?: boolean; ready?: boolean; count?: number; color?: string; team?: boolean } = {}): number {
  const count = opts.count ?? 4, x = slotX(i, count), y = SETUP.slotY, w = slotWidth(count);
  const color = opts.color ?? SLOT_COLORS[i];
  card(ctx, x, y, w, SETUP.slotH, color, !!opts.focused || !!opts.ready);
  if (opts.team) {
    // a team's cards wear its colour, so the sides read at a glance
    ctx.save();
    ctx.globalAlpha = 0.13; ctx.fillStyle = color;
    ctx.fillRect(x + 6, y + 6, w - 12, SETUP.slotH - 12);
    ctx.restore();
  }
  label(ctx, who, x + w / 2, y + 42, 24, color, "center", 900);
  if (!fighter) return x;
  if (fighter.def) drawFighterPortrait(ctx, fighter.def, `slot${i}`, { x: x + 16, y: y + SETUP.portraitY, w: w - 32, h: SETUP.portraitH }, { ready: opts.ready, cheerOnArrival: true, fidget: true });
  else label(ctx, fighter.pending ?? "…", x + w / 2, y + PORTRAIT_MID + 10, 28, fighter.pending === "didn't load" ? "#c0392b" : PENCIL);
  title(ctx, fighter.name, x + w / 2, y + SETUP.nameY, count > 4 ? 30 : 38, INK, "center", w - 32);
  return x;
}

/** A slot nobody holds. */
export function drawEmptySlot(ctx: CanvasRenderingContext2D, i: number, text: string, count = 4): void {
  const x = slotX(i, count), w = slotWidth(count);
  card(ctx, x, SETUP.slotY, w, SETUP.slotH, "", false, 0.65);
  label(ctx, text, x + w / 2, SETUP.slotY + SETUP.slotH / 2, 28, "rgba(41,39,34,0.65)", "center", w - 20);
}
