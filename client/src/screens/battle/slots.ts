import { VIEW_H, VIEW_W } from "../../render/camera";
import { inkRect, PAPER, PENCIL } from "../../render/paper";
import { TEAM_COLORS, TEAM_NAMES } from "../../render/hud";
import type { FighterDef } from "../../../../shared/types";
import { drawFighterPortrait } from "../portrait";
import { clicked, grow, hover, label, small, INK } from "../ui";
import { gridLayout } from "./roster";

/** A ghost box's pencil grey: a box nobody holds yet. */
export const GHOST = "#b9b3a6";

/**
 * The row of boxes under the roster, left to right: who's in the room, + ADD BOT, a friend-here box. Inside a card,
 * from its top: who holds it, the fighter, its name, and on a bot's card its level.
 */
export interface SlotRow { y: number; h: number; w: number; x: (i: number) => number }
export function slotRow(count: number): SlotRow {
  const g = gridLayout(), gap = 20, x0 = 80;
  const y = g.viewY + g.viewH + 8;
  const h = small() ? VIEW_H - 154 - y : 290;
  const w = Math.min(small() ? 340 : 300, (VIEW_W - 2 * x0 - (count - 1) * gap) / count);
  return { y, h, w, x: (i) => x0 + i * (w + gap) };
}

/** Where things sit inside a card of height `h`, from its top. */
export function cardParts(h: number): { who: number; artY: number; artH: number; name: number; level: number } {
  if (!small()) return { who: 50, artY: 70, artH: 130, name: 236, level: 282 };
  return { who: 54, artY: 74, artH: h - 220, name: h - 100, level: h - 36 };
}

/** Who's in a slot as the card shows them; `def` is null while the fighter loads (`pending` says why). */
export interface SlotFighter { def: FighterDef | null; name: string; pending?: string }

/**
 * One slot's card: who holds it in `color` (in a team battle, its team's, washed over the card), the fighter alive
 * and its name. `key` names the portrait's spot so it acts on its own.
 */
export function drawSlotCard(ctx: CanvasRenderingContext2D, key: string, x: number, y: number, w: number, h: number, who: string, color: string, fighter: SlotFighter | null, opts: { focused?: boolean; team?: boolean } = {}): void {
  ctx.save();
  ctx.fillStyle = PAPER;
  ctx.fillRect(x, y, w, h);
  if (opts.team) {
    ctx.globalAlpha = 0.13; ctx.fillStyle = color;
    ctx.fillRect(x + 6, y + 6, w - 12, h - 12);
  }
  ctx.restore();
  inkRect(ctx, x, y, w, h, INK, opts.focused ? 3.2 : 2);
  if (opts.focused) inkRect(ctx, x - 4, y + 3, w + 7, h - 1, PENCIL, 1);
  const p = cardParts(h);
  if (who) label(ctx, who, x + w / 2, y + p.who, grow(30, 12), color, "center", 400, w - 90);
  if (!fighter) return;
  if (fighter.def) drawFighterPortrait(ctx, fighter.def, key, { x: x + 16, y: y + p.artY, w: w - 32, h: p.artH }, { cheerOnArrival: true, fidget: true });
  else label(ctx, fighter.pending ?? "…", x + w / 2, y + p.artY + p.artH / 2 + 10, grow(26, 11), fighter.pending === "didn't load" ? "#c0392b" : PENCIL, "center", 400, w - 24);
  label(ctx, fighter.name, x + w / 2, y + p.name, grow(36, 13), INK, "center", 400, w - 24);
}

/** A pencil-grey box: + ADD BOT (a button: true when clicked), or words for whoever could still join. */
export function drawGhostBox(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, lines: string[], opts: { button?: boolean; focused?: boolean } = {}): boolean {
  const over = !!opts.button && hover(x, y, w, h);
  inkRect(ctx, x, y, w, h, over || opts.focused ? INK : GHOST, over || opts.focused ? 2.6 : 2);
  if (opts.button) {
    label(ctx, lines[0], x + w / 2, y + h / 2 + 12, grow(36, 13), INK, "center", 400, w - 24);
    if (over) document.body.style.cursor = "pointer";
    return clicked(x, y, w, h);
  }
  const size = grow(26, 11), step = size * 1.5, top = y + h / 2 - ((lines.length - 1) * step) / 2 + size * 0.3 + 2;
  lines.forEach((line, i) => label(ctx, line, x + w / 2, top + i * step, size, PENCIL, "center", 400, w - 24));
  return false;
}

/**
 * A team battle card's header: a pill in the team's colour with who holds the slot, over the card's top. `canSwitch`:
 * it's theirs to change, so it takes the pointer. True when clicked.
 */
export function drawTeamTag(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, team: number, who: string, opts: { canSwitch: boolean; focused: boolean; room?: number }): boolean {
  const h = small() ? 60 : 46, px = x + 14, pw = w - 28 - (opts.room ?? 0), py = y + 12;
  const over = opts.canSwitch && hover(px, py, pw, h);
  if (over) document.body.style.cursor = "pointer";
  ctx.save();
  ctx.fillStyle = TEAM_COLORS[team];
  ctx.beginPath(); ctx.roundRect(px, py, pw, h, h / 2); ctx.fill();
  if (opts.focused || over) { ctx.lineWidth = 4; ctx.strokeStyle = INK; ctx.stroke(); }
  ctx.restore();
  const size = grow(22, 11);
  label(ctx, `${TEAM_NAMES[team]}${opts.canSwitch ? " ▸" : ""} · ${who}`, px + pw / 2, py + h / 2 + 9 + (size - 22) * 0.36, size, "#fff", "center", 900, pw - 24);
  return opts.canSwitch && clicked(px, py, pw, h);
}
