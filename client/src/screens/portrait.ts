import type { FighterDef } from "../../../shared/types";
import { drawSprite } from "../render/sprite";
import { cellForAnim } from "../../../shared/gen/sprite";

export interface PortraitBounds { x: number; y: number; w: number; h: number }

/** The fighter's idle cell fitted into the box, feet on its bottom edge, breathing. */
export function drawFighterPortrait(ctx: CanvasRenderingContext2D, def: FighterDef, t: number, ready: boolean, b: PortraitBounds): void {
  const sp = def.sprite;
  if (!sp) throw new Error(`${def.id} has no sprite`);
  const u = def.stats.height / sp.heightPx;
  const side = sp.px * u;
  const k = Math.min(b.w, b.h) / side;
  const breath = 0.5 - 0.5 * Math.cos(t * Math.PI * 2 * (ready ? 2 : 0.8));
  ctx.save();
  ctx.beginPath(); ctx.rect(b.x, b.y, b.w, b.h); ctx.clip();
  ctx.translate(b.x + b.w / 2, b.y + (b.h - Math.min(b.w, b.h)) / 2 + sp.feetPx * u * k);
  ctx.scale(k, k);
  drawSprite(ctx, def, cellForAnim(def, "idle"), { sy: 1 - breath * (ready ? 0.06 : 0.03), sx: 1 + breath * (ready ? 0.03 : 0.01) });
  ctx.restore();
}
