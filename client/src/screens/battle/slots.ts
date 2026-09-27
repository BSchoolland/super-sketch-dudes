import { VIEW_W } from "../../render/camera";
import { PENCIL } from "../../render/paper";
import { SLOT_COLORS } from "../../render/hud";
import type { FighterDef } from "../../../../shared/types";
import { drawFighterPortrait } from "../portrait";
import { SHELF_H } from "../shelf";
import { card, label, title, INK } from "../ui";

/** The battle setups (a lobby, VS BOTS): title, your shelf, four slot cards, one row of actions. */
export const SETUP = { titleY: 80, shelfY: 120, slotY: 120 + SHELF_H + 30, slotW: 380, slotH: 470, gap: 36 } as const;
export const ACTION_Y = SETUP.slotY + SETUP.slotH + 24;
export const slotX = (i: number): number => (VIEW_W - (4 * SETUP.slotW + 3 * SETUP.gap)) / 2 + i * (SETUP.slotW + SETUP.gap);

/** Who's in a slot as the card shows them; `def` is null while the fighter loads (`pending` says why). */
export interface SlotFighter { def: FighterDef | null; name: string; pending?: string }

/** One slot card: who holds it in the slot's colour, the fighter (alive, see portrait.ts), its name. Returns the card's x. */
export function drawSlotCard(ctx: CanvasRenderingContext2D, i: number, who: string, fighter: SlotFighter | null, opts: { focused?: boolean; ready?: boolean } = {}): number {
  const x = slotX(i), y = SETUP.slotY, w = SETUP.slotW;
  card(ctx, x, y, w, SETUP.slotH, SLOT_COLORS[i], !!opts.focused || !!opts.ready);
  label(ctx, who, x + w / 2, y + 42, 24, SLOT_COLORS[i], "center", 900);
  if (!fighter) return x;
  if (fighter.def) drawFighterPortrait(ctx, fighter.def, `slot${i}`, { x: x + 16, y: y + 64, w: w - 32, h: 240 }, { ready: opts.ready, cheerOnArrival: true, fidget: true });
  else label(ctx, fighter.pending ?? "…", x + w / 2, y + 190, 28, fighter.pending === "didn't load" ? "#c0392b" : PENCIL);
  title(ctx, fighter.name, x + w / 2, y + 348, 38, INK, "center", w - 32);
  return x;
}

/** A slot nobody holds. */
export function drawEmptySlot(ctx: CanvasRenderingContext2D, i: number, text: string): void {
  const x = slotX(i);
  card(ctx, x, SETUP.slotY, SETUP.slotW, SETUP.slotH, "", false, 0.65);
  label(ctx, text, x + SETUP.slotW / 2, SETUP.slotY + SETUP.slotH / 2, 28, "rgba(41,39,34,0.65)");
}
