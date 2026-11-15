import { VIEW_W } from "../../render/camera";
import { PENCIL } from "../../render/paper";
import { SLOT_COLORS, TEAM_COLORS, TEAM_NAMES } from "../../render/hud";
import type { FighterDef } from "../../../../shared/types";
import { drawFighterPortrait } from "../portrait";
import { shelfHeight } from "../shelf";
import { card, clicked, grow, hover, label, small, title, INK } from "../ui";

/**
 * The battle setups (a lobby, BOTS & FRIENDS): title, your shelf, four slot cards (six, narrower, locally), one row of actions.
 * Inside a card, from its top: the fighter's portrait, its name, and a line under it (a bot's level, a friend's device).
 * On a small screen the shelf is one row and the cards are taller, with room for finger-sized targets inside them.
 */
export interface Setup { titleY: number; shelfY: number; slotY: number; slotW: number; slotH: number; gap: number; portraitY: number; portraitH: number; nameY: number; lineY: number; actionY: number }
const WIDE = { titleY: 80, shelfY: 120, slotW: 380, slotH: 350, gap: 36, portraitY: 56, portraitH: 160, nameY: 244, lineY: 284 };
const SMALL = { ...WIDE, slotH: 450, portraitY: 72, portraitH: 166, nameY: 280, lineY: 336 };
export function setup(): Setup {
  const s = small() ? SMALL : WIDE;
  const slotY = s.shelfY + shelfHeight() + (small() ? 14 : 20);
  return { ...s, slotY, actionY: slotY + s.slotH + (small() ? 20 : 24) };
}
/** The middle of a card's portrait, where its fighter arrows sit. */
export const portraitMid = (): number => setup().portraitY + setup().portraitH / 2;
/** Card width when `count` cards share the row: four at full width, more squeezed in. */
export const slotWidth = (count = 4): number => (count <= 4 ? setup().slotW : (VIEW_W - 160 - (count - 1) * 20) / count);
const slotGap = (count = 4): number => (count <= 4 ? setup().gap : 20);
export const slotX = (i: number, count = 4): number => (VIEW_W - (count * slotWidth(count) + (count - 1) * slotGap(count))) / 2 + i * (slotWidth(count) + slotGap(count));

/** Who's in a slot as the card shows them; `def` is null while the fighter loads (`pending` says why). */
export interface SlotFighter { def: FighterDef | null; name: string; pending?: string }

/**
 * One slot card: who holds it in the slot's colour (or `color`: a team's, washed over the card with `team`), the
 * fighter (alive, see portrait.ts), its name. `count`: how many cards share the row. Returns the card's x.
 */
export function drawSlotCard(ctx: CanvasRenderingContext2D, i: number, who: string, fighter: SlotFighter | null, opts: { focused?: boolean; ready?: boolean; count?: number; color?: string; team?: boolean } = {}): number {
  const SETUP = setup(), count = opts.count ?? 4, x = slotX(i, count), y = SETUP.slotY, w = slotWidth(count);
  const color = opts.color ?? SLOT_COLORS[i];
  card(ctx, x, y, w, SETUP.slotH, color, !!opts.focused || !!opts.ready);
  if (opts.team) {
    // a team's cards wear its colour, so the sides read at a glance
    ctx.save();
    ctx.globalAlpha = 0.13; ctx.fillStyle = color;
    ctx.fillRect(x + 6, y + 6, w - 12, SETUP.slotH - 12);
    ctx.restore();
  }
  label(ctx, who, x + w / 2, y + 42, grow(24, 11), color, "center", 900, w - 20);
  if (!fighter) return x;
  if (fighter.def) drawFighterPortrait(ctx, fighter.def, `slot${i}`, { x: x + 16, y: y + SETUP.portraitY, w: w - 32, h: SETUP.portraitH }, { ready: opts.ready, cheerOnArrival: true, fidget: true });
  else label(ctx, fighter.pending ?? "…", x + w / 2, y + portraitMid() + 10, grow(28, 11), fighter.pending === "didn't load" ? "#c0392b" : PENCIL);
  title(ctx, fighter.name, x + w / 2, y + SETUP.nameY, grow(count > 4 ? 30 : 38, 13), INK, "center", w - 32);
  return x;
}

/**
 * A team battle card's header: a pill in the team's colour with who holds the slot. `canSwitch`: it's theirs to
 * change, so it takes the pointer. True when clicked.
 */
export function drawTeamTag(ctx: CanvasRenderingContext2D, i: number, team: number, who: string, opts: { count: number; canSwitch: boolean; focused: boolean }): boolean {
  const w = slotWidth(opts.count) - 28, x = slotX(i, opts.count) + 14, y = setup().slotY + 12, h = small() ? 60 : 46;
  const over = opts.canSwitch && hover(x, y, w, h);
  if (over) document.body.style.cursor = "pointer";
  ctx.save();
  ctx.fillStyle = TEAM_COLORS[team];
  ctx.beginPath(); ctx.roundRect(x, y, w, h, h / 2); ctx.fill();
  if (opts.focused || over) { ctx.lineWidth = 4; ctx.strokeStyle = INK; ctx.stroke(); }
  ctx.restore();
  const size = grow(22, 11);
  label(ctx, `${TEAM_NAMES[team]}${opts.canSwitch ? " ▸" : ""} · ${who}`, x + w / 2, y + h / 2 + 9 + (size - 22) * 0.36, size, "#fff", "center", 900, w - 24);
  return opts.canSwitch && clicked(x, y, w, h);
}

/** A slot nobody holds. */
export function drawEmptySlot(ctx: CanvasRenderingContext2D, i: number, text: string, count = 4): void {
  const SETUP = setup(), x = slotX(i, count), w = slotWidth(count);
  card(ctx, x, SETUP.slotY, w, SETUP.slotH, "", false, 0.65);
  label(ctx, text, x + w / 2, SETUP.slotY + SETUP.slotH / 2, grow(28, 11), "rgba(41,39,34,0.65)", "center", w - 20);
}
